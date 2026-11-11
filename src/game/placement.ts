/**
 * Where the board sits in the room.
 *
 * - In the browser (no XR): a fixed spot in front of the camera.
 * - In XR: restored from the persistent anchor if we have a saved pose;
 *   otherwise dropped in front of the seated player at table height (snapped
 *   to a detected table plane when there is one).
 * - "Move board" (and a first visit with no table known): the board follows
 *   the player's fingertip, so they touch the table where it should sit, and a
 *   pinch sets it down. This needs nothing from the headset's room scan: a
 *   Quest 2 reports no table, and its hit-test only finds the floor.
 *
 * IWSDK keeps one persistent anchor per site and parents every XRAnchor
 * entity under it; it does not remember per-entity poses, so the board's pose
 * relative to the anchor is saved here.
 */

import {
  createSystem,
  Group,
  Quaternion,
  Vector3,
  VisibilityState,
  XRAnchor,
  XRPlane,
  type Entity,
} from '@iwsdk/core';
import { describeSession, report } from '../report.js';

const POSE_KEY = 'moruba_board_pose';
const ANCHOR_UUID_KEY = 'iwsdk_scene_anchor_uuid';
const TABLE_MIN_Y = 0.55;
const TABLE_MAX_Y = 1.0;
const BROWSER_POSITION = new Vector3(0, 0.8, -0.3);

interface SavedPose {
  /** Set when the player (or a detected table) chose the spot; older saves lack it. */
  chosen?: boolean;
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

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; the board then simply is not remembered.
  }
}

type Mode =
  | 'browser'
  /** XR just started: waiting for tracking and the anchor to settle. */
  | 'settling'
  /** The player is moving the board with a hand. */
  | 'placing'
  | 'placed';

const UP = new Vector3(0, 1, 0);
/** Fingertip to board centre while placing: half the board's depth and a little. */
const REACH = 0.15;

export class PlacementSystem extends createSystem({
  planes: { required: [XRPlane] },
}) {
  root!: Group;
  rootEntity!: Entity;
  /** Human-readable note about how the board got where it is (for the HUD/debug). */
  note = '';

  private mode: Mode = 'browser';
  private modeTime = 0;
  private cooldown = 0;
  private pendingRestore: SavedPose | null = null;
  private needsSave = false;
  /** Set by the game: the virtual room is showing. */
  virtual = false;
  private virtualApplied = false;
  private realPosition = new Vector3();
  private realQuaternion = new Quaternion();
  private awaitingUuid = false;
  private uuidPoll = 0;
  /** Dev only: seconds until the next status note to the Mac, and how many are left. */
  private reportIn = 0;
  private reportsLeft = 0;
  /** Smoothed spot the board is heading for while it follows a hand. */
  private follow = new Vector3();
  private following = false;

  private headPos = new Vector3();
  private headDir = new Vector3();
  private tmp = new Vector3();
  private tmpQuat = new Quaternion();
  private parentQuat = new Quaternion();

  /** True while pit and button presses should be ignored. */
  get busy(): boolean {
    return this.mode === 'settling' || this.mode === 'placing' || this.cooldown > 0;
  }

  get placing(): boolean {
    return this.mode === 'placing';
  }

  get inXR(): boolean {
    return this.mode !== 'browser';
  }

  init(): void {
    this.root = new Group();
    this.root.name = 'board-root';
    this.root.position.copy(BROWSER_POSITION);
    this.rootEntity = this.world.createTransformEntity(this.root);

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        const xr = state !== VisibilityState.NonImmersive;
        if (xr && this.mode === 'browser') this.enterXR();
        else if (!xr && this.mode !== 'browser') this.leaveXR();
      }),
    );
  }

  /**
   * World position of a hand's index fingertip (or of a controller), written
   * to `out`. False when that hand is not tracked this frame.
   */
  private handPoint(side: 'left' | 'right', out: Vector3): boolean {
    const source = this.input.xr.getPrimaryInputSource(side) as unknown as
      | XRInputSource
      | undefined;
    if (!source) return false;
    const joint = source.hand?.get('index-finger-tip');
    if (joint) {
      const frame = this.xrFrame as XRFrame | undefined;
      const space = this.xrManager.getReferenceSpace();
      const pose = frame?.getJointPose && space ? frame.getJointPose(joint, space) : null;
      if (!pose) return false;
      const p = pose.transform.position;
      this.player.localToWorld(out.set(p.x, p.y, p.z));
      return true;
    }
    this.player.raySpaces[side].getWorldPosition(out);
    return true;
  }

  /** Let the player set the board down somewhere else (XR only). */
  startPlacing(): void {
    if (this.mode !== 'placed') return;
    if (this.virtualApplied) {
      // Nothing real to point at in the virtual room: bring the table back
      // in front of the player instead.
      this.placeInFront(false);
      this.cooldown = 0.4;
      return;
    }
    this.following = false;
    this.setMode('placing');
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.modeTime = 0;
  }

  private enterXR(): void {
    this.setMode('settling');
    this.reportIn = 0;
    this.reportsLeft = 8;
    this.virtualApplied = false;
    this.root.visible = false;
    this.pendingRestore = null;
    const raw = readStorage(POSE_KEY);
    if (raw) {
      try {
        this.pendingRestore = JSON.parse(raw) as SavedPose;
      } catch {
        this.pendingRestore = null;
      }
    }
    if (!this.rootEntity.hasComponent(XRAnchor)) {
      this.rootEntity.addComponent(XRAnchor);
    }
  }

  private leaveXR(): void {
    this.setMode('browser');
    this.virtualApplied = false;
    if (this.rootEntity.hasComponent(XRAnchor)) {
      this.rootEntity.removeComponent(XRAnchor);
    }
    // The anchor group goes away with the session: back under the scene.
    if (this.root.parent !== this.scene) this.scene.add(this.root);
    this.root.position.copy(BROWSER_POSITION);
    this.root.quaternion.identity();
    this.root.visible = true;
    this.note = '';
  }

  private get anchorAttached(): boolean {
    return (
      this.rootEntity.hasComponent(XRAnchor) &&
      this.rootEntity.getValue(XRAnchor, 'attached') === true
    );
  }

  /** Put the board at a world position, turned so the player's side faces the player. */
  private setWorldPose(position: Vector3): void {
    this.player.head.getWorldPosition(this.headPos);
    const yaw = Math.atan2(
      this.headPos.x - position.x,
      this.headPos.z - position.z,
    );
    this.tmpQuat.setFromAxisAngle(UP, yaw);
    this.tmp.copy(position);
    const parent = this.root.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      parent.worldToLocal(this.tmp);
      parent.getWorldQuaternion(this.parentQuat).invert();
      this.tmpQuat.premultiply(this.parentQuat);
    }
    this.root.position.copy(this.tmp);
    this.root.quaternion.copy(this.tmpQuat);
  }

  /** In front of the seated player, on a detected table if there is one. */
  private placeInFront(snapToTable = true): void {
    const head = this.player.head;
    head.getWorldPosition(this.headPos);
    head.getWorldDirection(this.headDir); // points backwards (+Z of the head)
    this.headDir.y = 0;
    if (this.headDir.lengthSq() < 1e-6) this.headDir.set(0, 0, 1);
    this.headDir.normalize();
    const target = new Vector3()
      .copy(this.headPos)
      .addScaledVector(this.headDir, -0.45);
    let y = Math.min(1.25, Math.max(0.3, this.headPos.y - 0.45));
    let onTable = false;
    let best = Infinity;
    for (const entity of snapToTable ? this.queries.planes.entities : []) {
      const plane = entity.getValue(XRPlane, '_plane') as
        | { orientation?: string }
        | undefined;
      const object = entity.object3D;
      if (!object || plane?.orientation?.toLowerCase() !== 'horizontal') continue;
      object.getWorldPosition(this.tmp);
      if (this.tmp.y < TABLE_MIN_Y || this.tmp.y > TABLE_MAX_Y) continue;
      const dx = this.tmp.x - target.x;
      const dz = this.tmp.z - target.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 1.2 && distance < best) {
        best = distance;
        y = this.tmp.y;
        onTable = true;
      }
    }
    target.y = y;
    this.setWorldPose(target);
    this.note = onTable ? 'on your table' : 'in front of you';
  }

  private save(): void {
    const pose: SavedPose = {
      chosen: true,
      anchorUuid: readStorage(ANCHOR_UUID_KEY),
      position: [this.root.position.x, this.root.position.y, this.root.position.z],
      quaternion: [
        this.root.quaternion.x,
        this.root.quaternion.y,
        this.root.quaternion.z,
        this.root.quaternion.w,
      ],
    };
    writeStorage(POSE_KEY, JSON.stringify(pose));
    this.needsSave = false;
    // Until the anchor has its persistent id the save is provisional.
    this.awaitingUuid = pose.anchorUuid === null;
  }

  /** Dev only: a few notes on where the head and the board are, sent to the Mac. */
  private reportStatus(delta: number): void {
    if (this.reportsLeft <= 0) return;
    this.reportIn -= delta;
    if (this.reportIn > 0) return;
    this.reportIn = 2.5;
    this.reportsLeft -= 1;
    const round = (v: Vector3) => [v.x, v.y, v.z].map((n) => Math.round(n * 100) / 100);
    this.player.head.getWorldPosition(this.headPos);
    this.root.getWorldPosition(this.tmp);
    let planes = 0;
    for (const _ of this.queries.planes.entities) planes += 1;
    report('game-status', {
      mode: this.mode,
      note: this.note,
      head: round(this.headPos),
      board: round(this.tmp),
      boardVisible: this.root.visible,
      virtual: this.virtual,
      anchorAttached: this.anchorAttached,
      savedPose: readStorage(POSE_KEY) !== null,
      planes,
      session: describeSession(this.xrManager.getSession()),
    });
  }

  update(delta: number): void {
    if (this.mode === 'browser') return;
    this.modeTime += delta;
    if (this.cooldown > 0) this.cooldown -= delta;

    this.reportStatus(delta);

    if (this.mode === 'settling') {
      // Give tracking, planes and the anchor a moment; do not wait for ever.
      if (this.modeTime < 0.8) return;
      const attached = this.anchorAttached;
      if (!attached && this.modeTime < 3) return;
      const saved = this.pendingRestore;
      this.pendingRestore = null;
      let restored = false;
      if (
        attached &&
        saved?.chosen &&
        saved.anchorUuid &&
        saved.anchorUuid === readStorage(ANCHOR_UUID_KEY)
      ) {
        this.root.position.fromArray(saved.position);
        this.root.quaternion.fromArray(saved.quaternion);
        // Only if it is still within reach: the player may be sitting elsewhere.
        this.root.updateWorldMatrix(true, false);
        this.root.getWorldPosition(this.tmp);
        this.player.head.getWorldPosition(this.headPos);
        restored =
          Math.hypot(this.tmp.x - this.headPos.x, this.tmp.z - this.headPos.z) < 1.5 &&
          Math.abs(this.tmp.y - this.headPos.y) < 1.4;
      }
      if (restored) {
        this.note = 'back where you left it';
      } else {
        this.placeInFront();
        if (this.note === 'on your table') {
          this.needsSave = true;
        } else {
          // No table known (a Quest 2 reports none): the player points at it.
          this.root.visible = true;
          this.following = false;
          this.setMode('placing');
          return;
        }
      }
      this.root.visible = true;
      this.cooldown = 0.3;
      this.setMode('placed');
      return;
    }

    if (this.mode === 'placing') {
      const xr = this.input.xr;
      // The board's near edge sits just beyond the fingertip, at its height:
      // touch the table and the board lies on it.
      for (const side of ['right', 'left'] as const) {
        if (!this.handPoint(side, this.tmp)) continue;
        this.player.head.getWorldPosition(this.headPos);
        this.headDir.set(this.tmp.x - this.headPos.x, 0, this.tmp.z - this.headPos.z);
        if (this.headDir.lengthSq() > 1e-6) this.headDir.normalize();
        this.tmp.addScaledVector(this.headDir, REACH);
        this.tmp.y -= 0.012;
        if (this.following) this.follow.lerp(this.tmp, Math.min(1, delta * 12));
        else this.follow.copy(this.tmp);
        this.following = true;
        this.setWorldPose(this.follow);
        break;
      }
      if (
        this.modeTime > 1 &&
        (xr.getSelectState('left').start || xr.getSelectState('right').start)
      ) {
        this.note = this.following ? 'where you put it' : 'in front of you';
        this.needsSave = true;
        this.root.getWorldPosition(this.tmp);
        report('board-set-down', {
          note: this.note,
          board: [this.tmp.x, this.tmp.y, this.tmp.z].map((n) => Math.round(n * 100) / 100),
        });
        this.cooldown = 0.5;
        this.setMode('placed');
      }
    }

    // Virtual room: the board leaves its real-room spot for a comfortable
    // table height in front of the player, and goes back when the room is
    // switched off. The real-room pose is what stays saved.
    if (this.mode === 'placed') {
      if (this.virtual && !this.virtualApplied) {
        if (this.needsSave && this.anchorAttached) this.save();
        this.realPosition.copy(this.root.position);
        this.realQuaternion.copy(this.root.quaternion);
        this.placeInFront(false);
        this.virtualApplied = true;
        this.cooldown = 0.3;
      } else if (!this.virtual && this.virtualApplied) {
        this.root.position.copy(this.realPosition);
        this.root.quaternion.copy(this.realQuaternion);
        this.virtualApplied = false;
        this.cooldown = 0.3;
      }
    }

    if (this.mode === 'placed' && this.anchorAttached && !this.virtualApplied) {
      this.uuidPoll += delta;
      if (this.needsSave) {
        this.save();
      } else if (this.awaitingUuid && this.uuidPoll > 1) {
        this.uuidPoll = 0;
        if (readStorage(ANCHOR_UUID_KEY)) this.save();
      }
    }
  }
}
