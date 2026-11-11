/**
 * Day-1 device check ("spike"). Proves the platform pieces Moruba depends on:
 * hands, plane/mesh detection, hit-test placement by pinch, and a persistent
 * anchor that brings the placed object back after a reload.
 *
 * A status board floats in front of the player and reports each check live.
 * This file is throwaway: the real board placement replaces it on day 2.
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

  private board!: Mesh;
  private canvas!: HTMLCanvasElement;
  private texture!: CanvasTexture;
  private lastText = '';
  private sinceDraw = 0;

  private frames = 0;
  private fpsTime = 0;
  private fps = 0;
  private placements = 0;
  private pinches = 0;

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
      entity.addComponent(EnvironmentRaycastTarget, {
        space: space === 'left' ? RaycastSpace.Left : RaycastSpace.Right,
        maxDistance: 3,
      });
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
    this.canvas.width = 768;
    this.canvas.height = 512;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.board = new Mesh(
      new PlaneGeometry(0.36, 0.24),
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
          this.beginRestore();
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

  private placeCube(reticle: Entity): void {
    const from = reticle.object3D;
    const object = this.cube.object3D;
    if (!from || !object) return;
    from.getWorldPosition(this.tmp);
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
    this.placements += 1;
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

    const xr = this.input.xr;
    for (const side of ['left', 'right'] as const) {
      const select = xr.getSelectState(side);
      if (!select.start) continue;
      this.pinches += 1;
      const reticle = this.reticles[side];
      if (reticle.getValue(EnvironmentRaycastTarget, 'xrHitTestResult')) {
        this.placeCube(reticle);
      }
    }

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

  private updateBoard(delta: number): void {
    // Float the board ahead of the player, slightly below eye level.
    const head = this.player.head;
    head.getWorldPosition(this.headPos);
    head.getWorldDirection(this.headDir);
    this.headDir.y = 0;
    if (this.headDir.lengthSq() < 1e-6) this.headDir.set(0, 0, -1);
    this.headDir.normalize();
    // Object3D.getWorldDirection points along +Z; the head looks along -Z.
    // Off to one side so it never covers the table in front of the player.
    this.target
      .copy(this.headPos)
      .addScaledVector(this.headDir, -0.7)
      .addScaledVector(this.tmp.set(this.headDir.z, 0, -this.headDir.x), 0.32)
      .setY(this.headPos.y - 0.1);
    this.board.position.lerp(this.target, Math.min(1, delta * 2));
    this.board.lookAt(this.headPos);

    this.sinceDraw += delta;
    if (this.sinceDraw < 0.25) return;
    this.sinceDraw = 0;

    const xr = this.input.xr;
    const handL = xr.isPrimary('hand', 'left');
    const handR = xr.isPrimary('hand', 'right');
    let tablePlanes = 0;
    let planeCount = 0;
    for (const entity of this.queries.planes.entities) {
      planeCount += 1;
      const plane = entity.getValue(XRPlane, '_plane') as
        | { orientation?: string }
        | undefined;
      const y = entity.object3D ? entity.object3D.getWorldPosition(this.tmp).y : -1;
      if (
        plane?.orientation?.toLowerCase() === 'horizontal' &&
        y >= TABLE_MIN_Y &&
        y <= TABLE_MAX_Y
      ) {
        tablePlanes += 1;
      }
    }
    let meshCount = 0;
    let tableMeshes = 0;
    for (const entity of this.queries.meshes.entities) {
      meshCount += 1;
      if (entity.getValue(XRMesh, 'semanticLabel') === 'table') tableMeshes += 1;
    }
    const hitL = !!this.reticles.left.getValue(EnvironmentRaycastTarget, 'xrHitTestResult');
    const hitR = !!this.reticles.right.getValue(EnvironmentRaycastTarget, 'xrHitTestResult');

    const mark = (ok: boolean) => (ok ? '✔' : '·');
    const lines = [
      `${mark(handL || handR)} Hands: L ${handL ? 'yes' : 'no'}  R ${handR ? 'yes' : 'no'}`,
      `${mark(this.pinches > 0)} Pinches seen: ${this.pinches}`,
      `${mark(tablePlanes + tableMeshes > 0)} Table: ${tablePlanes} plane, ${tableMeshes} mesh  (all: ${planeCount}/${meshCount})`,
      `${mark(hitL || hitR)} Surface under ray: L ${hitL ? 'yes' : 'no'}  R ${hitR ? 'yes' : 'no'}`,
      `${mark(this.cubePlaced)} Cube placed: ${this.placements}`,
      `${mark(this.anchorNote.startsWith('RESTORED') || this.anchorNote.startsWith('saved (persistent'))} Anchor: ${this.anchorNote}`,
      `${mark(this.fps >= 70)} ${this.fps} fps`,
    ];
    const text = lines.join('\n');
    if (text === this.lastText) return;
    this.lastText = text;
    (globalThis as { __morubaSpike?: string }).__morubaSpike = text;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = 'rgba(20, 14, 10, 0.88)';
    ctx.beginPath();
    ctx.roundRect(0, 0, this.canvas.width, this.canvas.height, 36);
    ctx.fill();
    ctx.fillStyle = '#ffd23a';
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.fillText('Moruba device check', 36, 62);
    ctx.font = '32px system-ui, sans-serif';
    lines.forEach((line, i) => {
      ctx.fillStyle = line.startsWith('✔') ? '#9be28a' : '#f3ead9';
      ctx.fillText(line, 36, 128 + i * 54, this.canvas.width - 72);
    });
    this.texture.needsUpdate = true;
  }
}
