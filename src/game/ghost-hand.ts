/**
 * The opponent's hand: a pale, see-through hand that reaches in from the far
 * side of the board to scoop and sow Moruba's moves. The group's origin is the
 * point between its fingertips, where carried seeds sit.
 */

import {
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';

const OPACITY = 0.62;

export class GhostHand {
  readonly group = new Group();
  private material = new MeshStandardMaterial({
    color: 0xffe6b8,
    emissive: 0x7a5a2a,
    emissiveIntensity: 0.55,
    roughness: 0.6,
    transparent: true,
    opacity: 0,
  });
  private geometries: { dispose(): void }[] = [];
  private target = new Vector3();
  private rest = new Vector3();
  private shown = false;
  private fade = 0;
  private bob = 0;

  constructor() {
    this.group.name = 'ghost-hand';
    this.group.visible = false;
    const add = (
      geometry: SphereGeometry | CapsuleGeometry,
      x: number,
      y: number,
      z: number,
      rx = 0,
      rz = 0,
    ): Mesh => {
      const mesh = new Mesh(geometry, this.material);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, 0, rz);
      this.group.add(mesh);
      this.geometries.push(geometry);
      return mesh;
    };
    // The opponent sits on the -Z side, so the wrist is towards -Z and the
    // fingers curl down and forward (+Z) to the origin.
    const palm = add(new SphereGeometry(1, 20, 14), 0, 0.05, -0.04);
    palm.scale.set(0.04, 0.014, 0.046);
    const finger = new CapsuleGeometry(0.0078, 0.034, 4, 10);
    const tip = new CapsuleGeometry(0.0068, 0.024, 4, 10);
    this.geometries.push(finger, tip);
    [-0.027, -0.009, 0.009, 0.027].forEach((x, i) => {
      const shorter = i === 0 || i === 3 ? 0.004 : 0;
      // Two segments per finger: out from the knuckle, then down to the tip.
      const first = new Mesh(finger, this.material);
      first.position.set(x, 0.041, 0.013 - shorter);
      first.rotation.x = 1.15;
      const second = new Mesh(tip, this.material);
      second.position.set(x * 0.8, 0.019, 0.026 - shorter);
      second.rotation.x = 0.25;
      this.group.add(first, second);
    });
    // Thumb, coming round from the side to meet the fingertips.
    add(new CapsuleGeometry(0.0085, 0.03, 4, 10), 0.04, 0.034, -0.018, 0.9, -0.75);
    add(new CapsuleGeometry(0.0075, 0.022, 4, 10), 0.024, 0.014, 0.004, 0.5, -0.9);
    // Wrist and forearm, rising back towards the opponent's seat.
    add(new CapsuleGeometry(0.021, 0.15, 4, 12), 0, 0.075, -0.165, 1.32);
  }

  /** Where the hand waits, out of the way (board space). */
  setRest(x: number, y: number, z: number): void {
    this.rest.set(x, y, z);
    if (!this.shown) this.group.position.copy(this.rest);
  }

  moveTo(x: number, y: number, z: number): void {
    this.target.set(x, y, z);
    this.shown = true;
  }

  hide(): void {
    this.shown = false;
    this.target.copy(this.rest);
  }

  update(delta: number): void {
    this.fade += ((this.shown ? 1 : 0) - this.fade) * Math.min(1, delta * 6);
    this.group.visible = this.fade > 0.02;
    if (!this.group.visible) return;
    this.material.opacity = OPACITY * this.fade;
    this.bob += delta;
    this.group.position.lerp(this.target, Math.min(1, delta * 14));
    this.group.position.y += Math.sin(this.bob * 2.4) * 0.0004;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.material.dispose();
    for (const geometry of this.geometries) geometry.dispose();
  }
}
