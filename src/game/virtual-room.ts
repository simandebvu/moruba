/**
 * "Virtual table" mode: a wooden table under the board inside a warm, dim
 * room. Used in the browser preview, and in the headset when the real room is
 * not usable (poor passthrough, no table) or for clean film shots. Being
 * opaque, the dome hides passthrough. Four draw calls, no textures.
 */

import {
  BackSide,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
} from '@iwsdk/core';
import { woodTexture } from './textures.js';

const TABLE_RADIUS = 0.6;
const TABLE_THICKNESS = 0.035;

export class VirtualRoom {
  readonly group = new Group();
  private pedestal: Mesh;
  private floor: Mesh;
  private drop = -1;

  constructor() {
    this.group.name = 'virtual-room';

    const tableTexture = woodTexture('#3d2413', 31);
    tableTexture.repeat.set(2, 2);
    // Grain runs across the table, left to right, as seen from the seat.
    tableTexture.center.set(0.5, 0.5);
    tableTexture.rotation = Math.PI / 2;
    const top = new Mesh(
      new CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS - 0.02, TABLE_THICKNESS, 48),
      new MeshStandardMaterial({ map: tableTexture, color: 0xb8a898, roughness: 0.6 }),
    );
    top.position.y = -TABLE_THICKNESS / 2 - 0.0005;
    top.name = 'virtual-table-top';

    this.pedestal = new Mesh(
      new CylinderGeometry(0.06, 0.16, 1, 20),
      new MeshStandardMaterial({ color: 0x2a190e, roughness: 0.7 }),
    );
    this.pedestal.name = 'virtual-table-pedestal';

    this.floor = new Mesh(
      new CircleGeometry(7.5, 40).rotateX(-Math.PI / 2),
      new MeshStandardMaterial({ color: 0x33231a, roughness: 0.9 }),
    );
    this.floor.name = 'virtual-floor';

    // Dome with a baked vertical gradient: lamp-lit amber at table height
    // fading to near-dark above and below.
    const domeGeometry = new SphereGeometry(8, 32, 20);
    const position = domeGeometry.getAttribute('position');
    const colours: number[] = [];
    const low = new Color(0x1c120c);
    const mid = new Color(0x8a5a33);
    const high = new Color(0x120c09);
    const c = new Color();
    for (let i = 0; i < position.count; i++) {
      const t = position.getY(i) / 8; // -1 .. 1
      if (t < 0.1) c.copy(low).lerp(mid, Math.max(0, (t + 0.5) / 0.6));
      else c.copy(mid).lerp(high, Math.min(1, (t - 0.1) / 0.6));
      colours.push(c.r, c.g, c.b);
    }
    domeGeometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
    const dome = new Mesh(
      domeGeometry,
      new MeshBasicMaterial({ vertexColors: true, side: BackSide }),
    );
    dome.name = 'virtual-dome';

    this.group.add(dome, this.floor, this.pedestal, top);
    this.setFloorDrop(0.75);
  }

  /** How far below the table top the floor is (the board's height above the floor). */
  setFloorDrop(drop: number): void {
    const d = Math.max(0.2, drop);
    if (Math.abs(d - this.drop) < 0.002) return;
    this.drop = d;
    const height = d - TABLE_THICKNESS;
    this.pedestal.scale.y = height;
    this.pedestal.position.y = -TABLE_THICKNESS - height / 2;
    this.floor.position.y = -d;
  }
}
