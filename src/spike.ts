/**
 * Device check at `/?check`. Proves the platform pieces Moruba depends on:
 * hands, pinch, table detection, hit-test placement, a persistent anchor that
 * brings the placed object back after a reload, and frame rate.
 *
 * It is a guided walk-through: one instruction at a time on a panel in front
 * of the player, each step passing by itself (with a chime) or timing out, so
 * nothing has to be read off a screen outside the headset. Every result is
 * also sent to the dev server (src/report.ts).
 */

import {
  BoxGeometry,
  CanvasTexture,
  createSystem,
  DoubleSide,
  EnvironmentRaycastTarget,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RaycastSpace,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
  VisibilityState,
  XRAnchor,
  XRMesh,
  XRPlane,
  type Entity,
} from '@iwsdk/core';
import { Sounds } from './game/sounds.js';
import { describeSession, report, reportDelivered } from './report.js';

const POSE_KEY = 'moruba_spike_pose';
const ANCHOR_UUID_KEY = 'iwsdk_scene_anchor_uuid';
const TABLE_MIN_Y = 0.6;
const TABLE_MAX_Y = 0.95;

interface SavedPose {
  anchorUuid: string | null;
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return localStorage.getItem(key) === value;
  } catch {
    return false;
  }
}

type StepId =
  | 'restore'
  | 'hands'
  | 'pinch'
  | 'table'
  | 'point'
  | 'place'
  | 'save'
  | 'fps'
  | 'done';

type Grade = 'pass' | 'part' | 'fail';

interface Result {
  id: StepId;
  label: string;
  grade: Grade;
  detail: string;
}

interface StepText {
  /** Short name used in the summary. */
  label: string;
  headline: string;
  body: string;
  /** Seconds before the step gives up and moves on. */
  limit: number;
}

const STEP_TEXT: Record<StepId, StepText> = {
  restore: {
    label: 'Cube came back',
    headline: 'Welcome back',
    body: 'Look at where you put the cube. I am checking that it returns to the same spot.',
    limit: 12,
  },
  hands: {
    label: 'Hands',
    headline: 'Hold up both hands',
    body: 'Put the controllers down, out of sight. Hold both open hands in front of you.',
    limit: 25,
  },
  pinch: {
    label: 'Pinch',
    headline: 'Pinch with each hand',
    body: 'Touch thumb and first finger together, once with the left hand and once with the right.',
    limit: 25,
  },
  table: {
    label: 'Table found',
    headline: 'Look down at your table',
    body: 'I am looking for the table you marked in Space Setup.',
    limit: 12,
  },
  point: {
    label: 'Pointing at a surface',
    headline: 'Point at the table top',
    body: 'Reach a hand out and point at the table. A yellow ring should land on it.',
    limit: 30,
  },
  place: {
    label: 'Cube placed',
    headline: 'Pinch to drop a cube',
    body: 'Keep the yellow ring on the table and pinch. An orange cube appears there.',
    limit: 30,
  },
  save: {
    label: 'Spot remembered',
    headline: 'Remembering the spot',
    body: 'Hold on a moment while the headset saves where the cube is.',
    limit: 12,
  },
  fps: {
    label: 'Smoothness',
    headline: 'Look around slowly',
    body: 'Measuring how smoothly this runs.',
    limit: 6,
  },
  done: { label: '', headline: '', body: '', limit: Infinity },
};

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export class SpikeSystem extends createSystem({
  planes: { required: [XRPlane] },
  meshes: { required: [XRMesh] },
}) {
  private reticles!: Record<'left' | 'right', Entity>;
  private cube!: Entity;
  private cubePlaced = false;
  /** Saved pose waiting for the anchor group before it can be applied. */
  private pendingRestore: SavedPose | null = null;
  private anchorNote = 'none yet';
  private raySources: Record<'left' | 'right', unknown> = {
    left: undefined,
    right: undefined,
  };

  private board!: Mesh;
  private canvas!: HTMLCanvasElement;
  private texture!: CanvasTexture;
  private lastText = '';
  private sinceDraw = 0;
  private boardSnapped = false;
  private sounds = new Sounds();

  private frames = 0;
  private fpsTime = 0;
  private fps = 0;

  // The guided run.
  private steps: StepId[] = [];
  private stepIndex = 0;
  private stepTime = 0;
  /** Seconds left showing the result of the step that just finished. */
  private pause = 0;
  private results: Result[] = [];
  private handSeen = { left: false, right: false };
  private pinchSeen = { left: false, right: false };
  private hitTime = 0;
  private hitSeen = false;
  private autoPlaced = false;
  private sampleFrames = 0;
  private sampleTime = 0;
  private didRestore = false;
  private snapshot = { planes: 0, tablePlanes: 0, meshes: 0, tableMeshes: 0 };

  private headPos = new Vector3();
  private headDir = new Vector3();
  private target = new Vector3();
  private tmp = new Vector3();
  private tmpQuat = new Quaternion();

  init(): void {
    const ringGeometry = new RingGeometry(0.02, 0.028, 32);
    ringGeometry.rotateX(-Math.PI / 2);
    const makeReticle = (space: 'left' | 'right'): Entity => {
      const mesh = new Mesh(
        ringGeometry,
        new MeshBasicMaterial({ color: 0xffd23a, side: DoubleSide }),
      );
      mesh.name = `reticle-${space}`;
      mesh.visible = false;
      const entity = this.world.createTransformEntity(mesh);
      return entity;
    };
    this.reticles = { left: makeReticle('left'), right: makeReticle('right') };

    const cubeMesh = new Mesh(
      new BoxGeometry(0.06, 0.06, 0.06).translate(0, 0.03, 0),
      new MeshStandardMaterial({ color: 0xd9722b, roughness: 0.6 }),
    );
    cubeMesh.name = 'test-cube';
    cubeMesh.visible = false;
    this.cube = this.world.createTransformEntity(cubeMesh);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 800;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.board = new Mesh(
      new PlaneGeometry(0.62, 0.484),
      new MeshBasicMaterial({ map: this.texture, transparent: true }),
    );
    this.board.name = 'status-board';
    this.board.visible = false;
    this.world.createTransformEntity(this.board);

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        const inXR = state !== VisibilityState.NonImmersive;
        this.board.visible = inXR;
        if (inXR) {
          this.sounds.unlock();
          this.beginRestore();
          this.beginRun();
        } else {
          // The anchor group is torn down with the session; start clean.
          this.pendingRestore = null;
          if (this.cube.hasComponent(XRAnchor)) {
            this.cube.removeComponent(XRAnchor);
          }
          this.cubePlaced = false;
          if (this.cube.object3D) this.cube.object3D.visible = false;
          this.anchorNote = 'none yet';
        }
      }),
    );
    const unlock = () => this.sounds.unlock();
    window.addEventListener('pointerdown', unlock);
    this.cleanupFuncs.push(() => window.removeEventListener('pointerdown', unlock));
  }

  private beginRun(): void {
    this.didRestore = this.pendingRestore !== null;
    this.steps = [
      ...(this.didRestore ? (['restore'] as StepId[]) : []),
      'hands',
      'pinch',
      'table',
      'point',
      'place',
      'save',
      'fps',
      'done',
    ];
    this.stepIndex = 0;
    this.stepTime = 0;
    this.pause = 0;
    this.results = [];
    this.handSeen = { left: false, right: false };
    this.pinchSeen = { left: false, right: false };
    this.hitTime = 0;
    this.hitSeen = false;
    this.autoPlaced = false;
    this.boardSnapped = false;
    this.lastText = '';
    report('check-start', {
      steps: this.steps,
      session: describeSession(this.xrManager.getSession()),
    });
  }

  private get step(): StepId {
    return this.steps[this.stepIndex] ?? 'done';
  }

  /** Record how the current step went, show it briefly, then move on. */
  private finish(grade: Grade, detail: string): void {
    const id = this.step;
    const result: Result = { id, label: STEP_TEXT[id].label, grade, detail };
    this.results.push(result);
    this.pause = 1.6;
    if (grade === 'fail') this.sounds.deny();
    else this.sounds.capture();
    report('check-step', {
      ...result,
      seconds: Math.round(this.stepTime * 10) / 10,
      anchorNote: this.anchorNote,
      ...this.snapshot,
      session: describeSession(this.xrManager.getSession()),
    });
  }

  private advance(): void {
    this.stepIndex += 1;
    this.stepTime = 0;
    if (this.step === 'fps') {
      this.sampleFrames = 0;
      this.sampleTime = 0;
    }
    if (this.step === 'done') {
      report('check-done', {
        results: this.results,
        fps: this.fps,
        anchorNote: this.anchorNote,
        planeList: this.describePlanes(),
        ...this.snapshot,
        session: describeSession(this.xrManager.getSession()),
      });
    }
  }

  private describePlanes(): unknown[] {
    const list: unknown[] = [];
    for (const entity of this.queries.planes.entities) {
      const plane = entity.getValue(XRPlane, '_plane') as
        | { orientation?: string; semanticLabel?: string }
        | undefined;
      const y = entity.object3D ? entity.object3D.getWorldPosition(this.tmp).y : null;
      list.push({
        orientation: plane?.orientation ?? null,
        label: plane?.semanticLabel ?? null,
        y: y === null ? null : Math.round(y * 100) / 100,
      });
    }
    return list;
  }

  /**
   * The SDK binds a hit-test ray to the input source active when it was
   * requested; when that changes (controller put down, hand appears) the old
   * ray goes dead, so ask again.
   */
  private refreshRays(): void {
    for (const side of ['left', 'right'] as const) {
      const source = this.input.xr.getPrimaryInputSource(side);
      if (source === this.raySources[side]) continue;
      this.raySources[side] = source;
      const entity = this.reticles[side];
      if (entity.hasComponent(EnvironmentRaycastTarget)) {
        entity.removeComponent(EnvironmentRaycastTarget);
      }
      if (source) {
        entity.addComponent(EnvironmentRaycastTarget, {
          space: side === 'left' ? RaycastSpace.Left : RaycastSpace.Right,
          maxDistance: 3,
        });
      } else if (entity.object3D) {
        entity.object3D.visible = false;
      }
    }
  }

  private hasHit(side: 'left' | 'right'): boolean {
    const entity = this.reticles[side];
    return (
      entity.hasComponent(EnvironmentRaycastTarget) &&
      !!entity.getValue(EnvironmentRaycastTarget, 'xrHitTestResult')
    );
  }

  /** On entering XR: if a pose was saved last time, queue it for the anchor. */
  private beginRestore(): void {
    const raw = readStorage(POSE_KEY);
    if (!raw) return;
    try {
      this.pendingRestore = JSON.parse(raw) as SavedPose;
    } catch {
      return;
    }
    if (!this.cube.hasComponent(XRAnchor)) this.cube.addComponent(XRAnchor);
    this.anchorNote = 'restoring…';
  }

  private savePose(): void {
    const object = this.cube.object3D;
    if (!object) return;
    const pose: SavedPose = {
      anchorUuid: readStorage(ANCHOR_UUID_KEY),
      position: [object.position.x, object.position.y, object.position.z],
      quaternion: [
        object.quaternion.x,
        object.quaternion.y,
        object.quaternion.z,
        object.quaternion.w,
      ],
    };
    const ok = writeStorage(POSE_KEY, JSON.stringify(pose));
    this.anchorNote = !ok
      ? 'SAVE FAILED (storage)'
      : pose.anchorUuid
        ? 'saved (persistent)'
        : 'saved (no persistent id yet)';
  }

  /** Put the cube at the world position held in `this.tmp`. */
  private placeCube(): void {
    const object = this.cube.object3D;
    if (!object) return;
    // Keep the cube upright and turned to face the player.
    this.player.head.getWorldPosition(this.headPos);
    const yaw = Math.atan2(this.headPos.x - this.tmp.x, this.headPos.z - this.tmp.z);
    this.tmpQuat.setFromAxisAngle(this.headDir.set(0, 1, 0), yaw);

    if (!this.cube.hasComponent(XRAnchor)) this.cube.addComponent(XRAnchor);
    const parent = object.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      parent.worldToLocal(this.tmp);
      // The anchor group and the scene root are both unrotated about X/Z in
      // practice, but convert the rotation properly anyway.
      const parentQuat = parent.getWorldQuaternion(new Quaternion()).invert();
      this.tmpQuat.premultiply(parentQuat);
    }
    object.position.copy(this.tmp);
    object.quaternion.copy(this.tmpQuat);
    object.visible = true;
    this.cubePlaced = true;
    this.pendingRestore = null;
    this.anchorNote = 'placing…';
  }

  update(delta: number): void {
    this.frames += 1;
    this.fpsTime += delta;
    if (this.fpsTime >= 1) {
      this.fps = Math.round(this.frames / this.fpsTime);
      this.frames = 0;
      this.fpsTime = 0;
    }
    if (this.world.visibilityState.peek() === VisibilityState.NonImmersive) {
      return;
    }

    this.refreshRays();
    this.countSurfaces();
    this.runStep(delta);

    const attached =
      this.cube.hasComponent(XRAnchor) &&
      this.cube.getValue(XRAnchor, 'attached') === true;
    const object = this.cube.object3D;
    if (attached && object) {
      if (this.pendingRestore) {
        const saved = this.pendingRestore;
        this.pendingRestore = null;
        const currentUuid = readStorage(ANCHOR_UUID_KEY);
        object.position.fromArray(saved.position);
        object.quaternion.fromArray(saved.quaternion);
        object.visible = true;
        this.cubePlaced = true;
        this.anchorNote =
          saved.anchorUuid && saved.anchorUuid === currentUuid
            ? 'RESTORED from last session'
            : 'restored pose, but anchor is NEW (position may be off)';
      } else if (this.anchorNote === 'placing…') {
        this.savePose();
      } else if (
        this.anchorNote === 'saved (no persistent id yet)' &&
        readStorage(ANCHOR_UUID_KEY)
      ) {
        this.savePose();
      }
    }

    this.updateBoard(delta);
  }

  private countSurfaces(): void {
    const snap = this.snapshot;
    snap.planes = 0;
    snap.tablePlanes = 0;
    snap.meshes = 0;
    snap.tableMeshes = 0;
    for (const entity of this.queries.planes.entities) {
      snap.planes += 1;
      const plane = entity.getValue(XRPlane, '_plane') as
        | { orientation?: string }
        | undefined;
      const y = entity.object3D ? entity.object3D.getWorldPosition(this.tmp).y : -1;
      if (
        plane?.orientation?.toLowerCase() === 'horizontal' &&
        y >= TABLE_MIN_Y &&
        y <= TABLE_MAX_Y
      ) {
        snap.tablePlanes += 1;
      }
    }
    for (const entity of this.queries.meshes.entities) {
      snap.meshes += 1;
      if (entity.getValue(XRMesh, 'semanticLabel') === 'table') snap.tableMeshes += 1;
    }
  }

  private runStep(delta: number): void {
    if (this.pause > 0) {
      this.pause -= delta;
      if (this.pause <= 0) this.advance();
      return;
    }
    const id = this.step;
    if (id === 'done') return;
    this.stepTime += delta;
    const late = this.stepTime >= STEP_TEXT[id].limit;
    const xr = this.input.xr;
    const hitL = this.hasHit('left');
    const hitR = this.hasHit('right');

    switch (id) {
      case 'restore': {
        if (this.anchorNote.startsWith('RESTORED')) {
          this.finish('pass', 'the cube is back where you left it');
        } else if (this.anchorNote.startsWith('restored pose')) {
          this.finish('part', 'the cube is back, but its spot may have shifted');
        } else if (late) {
          this.finish('fail', 'the cube did not come back');
        }
        break;
      }
      case 'hands': {
        for (const side of ['left', 'right'] as const) {
          if (xr.isPrimary('hand', side)) this.handSeen[side] = true;
        }
        const { left, right } = this.handSeen;
        if (left && right) this.finish('pass', 'both hands seen');
        else if (late && (left || right)) {
          this.finish('part', `only the ${left ? 'left' : 'right'} hand was seen`);
        } else if (late) this.finish('fail', 'no hands seen');
        break;
      }
      case 'pinch': {
        for (const side of ['left', 'right'] as const) {
          if (xr.getSelectState(side).start) {
            if (!this.pinchSeen[side]) this.sounds.clack();
            this.pinchSeen[side] = true;
          }
        }
        const { left, right } = this.pinchSeen;
        if (left && right) this.finish('pass', 'both hands pinched');
        else if (late && (left || right)) {
          this.finish('part', `only the ${left ? 'left' : 'right'} pinch was seen`);
        } else if (late) this.finish('fail', 'no pinch seen');
        break;
      }
      case 'table': {
        const snap = this.snapshot;
        if (snap.tablePlanes + snap.tableMeshes > 0) {
          this.finish('pass', 'table found');
        } else if (late) {
          this.finish(
            'fail',
            snap.planes + snap.meshes > 0
              ? 'surfaces found, but none at table height'
              : 'the headset reported no surfaces',
          );
        }
        break;
      }
      case 'point': {
        this.hitTime = hitL || hitR ? this.hitTime + delta : 0;
        if (this.hitTime > 0.6) {
          this.hitSeen = true;
          this.finish('pass', 'the ring follows your hand');
        } else if (late) {
          this.finish('fail', 'no surface found under your hand');
        }
        break;
      }
      case 'place': {
        if (!this.hitSeen) {
          // Pointing does not work here: still test the anchor, with a cube
          // set down in front of the player.
          this.player.head.getWorldPosition(this.headPos);
          this.player.head.getWorldDirection(this.headDir);
          this.headDir.y = 0;
          if (this.headDir.lengthSq() < 1e-6) this.headDir.set(0, 0, 1);
          this.headDir.normalize();
          this.tmp
            .copy(this.headPos)
            .addScaledVector(this.headDir, -0.5)
            .setY(this.headPos.y - 0.4);
          this.placeCube();
          this.autoPlaced = true;
          this.finish('part', 'placed for you, in front of you');
          break;
        }
        for (const side of ['right', 'left'] as const) {
          if (!xr.getSelectState(side).start || !this.hasHit(side)) continue;
          const from = this.reticles[side].object3D;
          if (!from) continue;
          from.getWorldPosition(this.tmp);
          this.placeCube();
          this.finish('pass', 'cube placed with a pinch');
          break;
        }
        if (this.pause <= 0 && late) this.finish('fail', 'no pinch on a surface');
        break;
      }
      case 'save': {
        if (!this.cubePlaced) {
          this.finish('fail', 'no cube to remember');
        } else if (
          this.anchorNote === 'saved (persistent)' ||
          this.anchorNote.startsWith('RESTORED')
        ) {
          this.finish('pass', 'saved for next time');
        } else if (late) {
          this.finish(
            this.anchorNote.startsWith('saved') ? 'part' : 'fail',
            this.anchorNote.startsWith('saved')
              ? 'saved for this visit only'
              : `not saved (${this.anchorNote})`,
          );
        }
        break;
      }
      case 'fps': {
        this.sampleFrames += 1;
        this.sampleTime += delta;
        if (late) {
          const rate = Math.round(this.sampleFrames / this.sampleTime);
          this.finish(
            rate >= 68 ? 'pass' : rate >= 55 ? 'part' : 'fail',
            `${rate} frames a second`,
          );
        }
        break;
      }
    }
  }

  /** The lines for the panel: [kind, text] pairs, drawn top to bottom. */
  private panelText(): string {
    const id = this.step;
    const total = this.steps.length - 1;
    const mark = (grade: Grade) => (grade === 'pass' ? '✔' : grade === 'part' ? '~' : '✘');
    if (this.pause > 0) {
      const last = this.results[this.results.length - 1];
      return [
        `small|Step ${this.stepIndex + 1} of ${total}`,
        `${last.grade}|${mark(last.grade)}  ${last.label}`,
        `body|${last.detail}`,
      ].join('\n');
    }
    if (id === 'done') {
      const delivered = reportDelivered();
      const lines = ['head|All done'];
      for (const result of this.results) {
        lines.push(`${result.grade}row|${mark(result.grade)}  ${result.label}: ${result.detail}`);
      }
      lines.push(
        delivered === false
          ? 'foot|Could not reach the Mac: please read me this list.'
          : 'foot|Results sent to the Mac.',
      );
      lines.push(
        this.didRestore
          ? 'foot|You can take the headset off now.'
          : 'foot|Last thing: reload this page and enter again. I will check the cube comes back.',
      );
      return lines.join('\n');
    }
    const text = STEP_TEXT[id];
    const tick = (ok: boolean) => (ok ? '✔' : '…');
    let live = '';
    if (id === 'hands') {
      live = `Left ${tick(this.handSeen.left)}     Right ${tick(this.handSeen.right)}`;
    } else if (id === 'pinch') {
      live = `Left ${tick(this.pinchSeen.left)}     Right ${tick(this.pinchSeen.right)}`;
    } else if (id === 'table') {
      live = `Surfaces seen: ${this.snapshot.planes + this.snapshot.meshes}`;
    } else if (id === 'point' || id === 'place') {
      live = this.hasHit('left') || this.hasHit('right') ? 'Ring is on a surface ✔' : 'No surface yet …';
    }
    const left = Math.ceil(text.limit - this.stepTime);
    const lines = [
      `small|Step ${this.stepIndex + 1} of ${total}`,
      `head|${text.headline}`,
      `body|${text.body}`,
    ];
    if (live) lines.push(`live|${live}`);
    if (id !== 'fps' && left <= 8) lines.push(`foot|Moving on in ${left}…`);
    return lines.join('\n');
  }

  private updateBoard(delta: number): void {
    // Keep the panel straight ahead at about eye level, so it stays above the
    // table when the player looks down.
    const head = this.player.head;
    head.getWorldPosition(this.headPos);
    head.getWorldDirection(this.headDir);
    this.headDir.y = 0;
    if (this.headDir.lengthSq() < 1e-6) this.headDir.set(0, 0, 1);
    this.headDir.normalize();
    // Object3D.getWorldDirection points along +Z; the head looks along -Z.
    this.target
      .copy(this.headPos)
      .addScaledVector(this.headDir, -0.95)
      .setY(this.headPos.y - 0.04);
    if (this.boardSnapped) {
      this.board.position.lerp(this.target, Math.min(1, delta * 1.5));
    } else if (this.headPos.lengthSq() > 1e-6) {
      this.board.position.copy(this.target);
      this.boardSnapped = true;
    }
    this.board.lookAt(this.headPos);

    this.sinceDraw += delta;
    if (this.sinceDraw < 0.2) return;
    this.sinceDraw = 0;

    const text = this.panelText();
    if (text === this.lastText) return;
    this.lastText = text;
    (globalThis as { __morubaSpike?: string }).__morubaSpike = text;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = this.canvas;
    const pad = 56;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#1a120c';
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, 44);
    ctx.fill();

    const colours: Record<string, string> = {
      pass: '#9be28a',
      part: '#ffd23a',
      fail: '#ff8f7a',
    };
    let y = 40;
    for (const entry of text.split('\n')) {
      const cut = entry.indexOf('|');
      const kind = entry.slice(0, cut);
      const content = entry.slice(cut + 1);
      let size = 40;
      let colour = '#f3ead9';
      let weight = '';
      if (kind === 'small') {
        size = 40;
        colour = '#c9b89c';
      } else if (kind === 'head') {
        size = 88;
        colour = '#ffd23a';
        weight = 'bold ';
      } else if (kind === 'pass' || kind === 'part' || kind === 'fail') {
        size = 84;
        colour = colours[kind];
        weight = 'bold ';
      } else if (kind.endsWith('row')) {
        size = 34;
        colour = colours[kind.slice(0, -3)];
      } else if (kind === 'live') {
        size = 64;
        colour = '#9be28a';
        weight = 'bold ';
      } else if (kind === 'foot') {
        size = 40;
        colour = '#c9b89c';
      } else {
        size = 54;
      }
      ctx.font = `${weight}${size}px system-ui, sans-serif`;
      ctx.fillStyle = colour;
      if (kind === 'foot' || kind === 'live') y += 12;
      for (const line of wrap(ctx, content, width - pad * 2)) {
        y += size * 1.22;
        ctx.fillText(line, pad, y);
      }
      y += kind === 'head' || kind === 'small' ? 10 : 4;
    }
    this.texture.needsUpdate = true;
  }
}
