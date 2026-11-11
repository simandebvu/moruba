/**
 * The opponent's presence on the board: a small warm light, like a firefly,
 * that drifts in from the far side, hovers over the pit Moruba picks and
 * carries its seeds from pit to pit. (A modelled hand was tried first and
 * looked unsettling; an abstract light reads as "someone is playing" without
 * that.) The group's origin is where carried seeds sit.
 */

import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from '@iwsdk/core';

function glowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255, 236, 190, 1)');
    gradient.addColorStop(0.25, 'rgba(255, 200, 110, 0.55)');
    gradient.addColorStop(0.6, 'rgba(255, 160, 60, 0.14)');
    gradient.addColorStop(1, 'rgba(255, 140, 40, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  }
  return new CanvasTexture(canvas);
}

export class GhostHand {
  readonly group = new Group();
  private texture = glowTexture();
  private coreGeometry = new SphereGeometry(0.01, 16, 12);
  private coreMaterial = new MeshBasicMaterial({
    color: 0xfff1cf,
    transparent: true,
    opacity: 0,
  });
  private haloMaterial = new SpriteMaterial({
    map: this.texture,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });
  private halo = new Sprite(this.haloMaterial);
  private target = new Vector3();
  private rest = new Vector3();
  private shown = false;
  private fade = 0;
  private time = 0;

  constructor() {
    this.group.name = 'opponent-light';
    this.group.visible = false;
    const core = new Mesh(this.coreGeometry, this.coreMaterial);
    // A little above the carried seeds, so it lights them from over the top.
    core.position.y = 0.03;
    this.halo.position.y = 0.03;
    this.halo.scale.setScalar(0.15);
    this.group.add(core, this.halo);
  }

  /** Where the light waits, out of the way (board space). */
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
    this.fade += ((this.shown ? 1 : 0) - this.fade) * Math.min(1, delta * 5);
    this.group.visible = this.fade > 0.02;
    if (!this.group.visible) return;
    this.time += delta;
    const pulse = 1 + Math.sin(this.time * 5.5) * 0.08;
    this.coreMaterial.opacity = this.fade;
    this.haloMaterial.opacity = 0.9 * this.fade;
    this.halo.scale.setScalar(0.15 * pulse);
    this.group.position.lerp(this.target, Math.min(1, delta * 12));
    this.group.position.y += Math.sin(this.time * 3.1) * 0.0005;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.texture.dispose();
    this.coreGeometry.dispose();
    this.coreMaterial.dispose();
    this.haloMaterial.dispose();
  }
}
