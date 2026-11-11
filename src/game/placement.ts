/**
 * Where the board sits in the room.
 *
 * - In the browser (no XR): a fixed spot in front of the camera.
 * - In XR: restored from the persistent anchor if we have a saved pose;
 *   otherwise dropped in front of the seated player at table height (snapped
 *   to a detected table plane when there is one).
 * - "Move board": the board follows the surface under either hand's ray and a
 *   pinch sets it down (WebXR hit-test).
 *
 * IWSDK keeps one persistent anchor per site and parents every XRAnchor
 * entity under it; it does not remember per-entity poses, so the board's pose
 * relative to the anchor is saved here.
 */

import {
  createSystem,
  DoubleSide,
  EnvironmentRaycastTarget,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RaycastSpace,
  RingGeometry,
  Vector3,
  VisibilityState,
  XRAnchor,
  XRPlane,
  type Entity,
} from '@iwsdk/core';

const POSE_KEY = 'moruba_board_pose';
const ANCHOR_UUID_KEY = 'iwsdk_scene_anchor_uuid';
const TABLE_MIN_Y = 0.55;
const TABLE_MAX_Y = 1.0;
const BROWSER_POSITION = new Vector3(0, 0.8, -0.3);

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
  /** The player is moving the board with a hand ray. */
  | 'placing'
  | 'placed';

const UP = new Vector3(0, 1, 0);

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
  private awaitingUuid = false;
  private raySources: Record<'left' | 'right', unknown> = {
    left: undefined,
    right: undefined,
  };
  private uuidPoll = 0;
  private reticles!: Record<'left' | 'right', Entity>;

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

    const ringGeometry = new RingGeometry(0.02, 0.028, 32);
    ringGeometry.rotateX(-Math.PI / 2);
    const makeReticle = (side: 'left' | 'right'): Entity => {
      const mesh = new Mesh(
        ringGeometry,
        new MeshBasicMaterial({ color: 0xffd23a, side: DoubleSide }),
      );
      mesh.name = `reticle-${side}`;
      mesh.visible = false;
      const entity = this.world.createTransformEntity(mesh);
      this.aimReticle(entity, side);
      return entity;
    };
    this.reticles = { left: makeReticle('left'), right: makeReticle('right') };

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        const xr = state !== VisibilityState.NonImmersive;
        if (xr && this.mode === 'browser') this.enterXR();
        else if (!xr && this.mode !== 'browser') this.leaveXR();
      }),
    );
  }

  private aimReticle(entity: Entity, side: 'left' | 'right'): void {
    entity.addComponent(EnvironmentRaycastTarget, {
      space: side === 'left' ? RaycastSpace.Left : RaycastSpace.Right,
      maxDistance: 3,
    });
  }

  /**
   * The SDK binds a hit-test ray to the input source that was active when it
   * was requested. When that changes (controller put down, hand appears, hand
   * lost and found) the old ray goes dead, so ask again.
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
      if (source) this.aimReticle(entity, side);
    }
  }

  /** Let the player set the board down somewhere else (XR only). */
  startPlacing(): void {
    if (this.mode !== 'placed') return;
    this.setMode('placing');
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.modeTime = 0;
  }

  private enterXR(): void {
    this.setMode('settling');
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
  private placeInFront(): void {
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
    for (const entity of this.queries.planes.entities) {
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

  update(delta: number): void {
    if (this.mode === 'browser') return;
    this.modeTime += delta;
    if (this.cooldown > 0) this.cooldown -= delta;

    this.refreshRays();

    if (this.mode === 'settling') {
      // Give tracking, planes and the anchor a moment; do not wait for ever.
      if (this.modeTime < 0.8) return;
      const attached = this.anchorAttached;
      if (!attached && this.modeTime < 3) return;
      const saved = this.pendingRestore;
      this.pendingRestore = null;
      if (
        attached &&
        saved?.anchorUuid &&
        saved.anchorUuid === readStorage(ANCHOR_UUID_KEY)
      ) {
        this.root.position.fromArray(saved.position);
        this.root.quaternion.fromArray(saved.quaternion);
        this.note = 'back where you left it';
      } else {
        this.placeInFront();
        this.needsSave = true;
      }
      this.root.visible = true;
      this.cooldown = 0.3;
      this.setMode('placed');
      return;
    }

    if (this.mode === 'placing') {
      const xr = this.input.xr;
      for (const side of ['right', 'left'] as const) {
        const reticle = this.reticles[side];
        const object = reticle.object3D;
        if (
          !object ||
          !reticle.hasComponent(EnvironmentRaycastTarget) ||
          !reticle.getValue(EnvironmentRaycastTarget, 'xrHitTestResult')
        ) {
          continue;
        }
        object.getWorldPosition(this.tmp);
        this.setWorldPose(new Vector3().copy(this.tmp));
        if (this.modeTime > 0.5 && xr.getSelectState(side).start) {
          this.note = 'where you put it';
          this.needsSave = true;
          this.cooldown = 0.5;
          this.setMode('placed');
        }
        break;
      }
    }

    const showReticles = this.mode === 'placing';
    for (const side of ['left', 'right'] as const) {
      const object = this.reticles[side].object3D;
      // The raycast system turns reticles on when it has a hit; keep them
      // hidden unless the player is placing the board.
      if (object && !showReticles) object.visible = false;
    }

    if (this.mode === 'placed' && this.anchorAttached) {
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
