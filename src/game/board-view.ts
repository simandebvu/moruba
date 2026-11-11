/**
 * The visible board: wooden slab with pits, instanced seeds, hover highlight,
 * count label, and a small heads-up panel with buttons. No game logic here.
 */

import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  RingGeometry,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';
import { loopSize, type Options, type Player } from '../engine/moruba.js';
import {
  BASE_THICKNESS,
  boardSize,
  PIT_DEPTH,
  PIT_RADIUS,
  pitCentre,
  SEED_RADIUS,
  SEED_SQUASH,
  TOP_Y,
} from './layout.js';

export interface PitTarget {
  player: Player;
  index: number;
  mesh: Mesh;
}

export interface ButtonView {
  action: string;
  mesh: Mesh;
  setLabel(text: string): void;
}

class TextPlane {
  readonly mesh: Mesh;
  private canvas: HTMLCanvasElement;
  private texture: CanvasTexture;
  private last = '';

  constructor(
    width: number,
    height: number,
    private pxPerMetre: number,
    private draw: (
      ctx: CanvasRenderingContext2D,
      w: number,
      h: number,
      text: string,
    ) => void,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(width * pxPerMetre);
    this.canvas.height = Math.round(height * pxPerMetre);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(
      new PlaneGeometry(width, height),
      new MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        side: DoubleSide,
      }),
    );
  }

  set(text: string): void {
    if (text === this.last) return;
    this.last = text;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.draw(ctx, this.canvas.width, this.canvas.height, text);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function panel(ctx: CanvasRenderingContext2D, w: number, h: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, h * 0.22);
  ctx.fill();
}

export class BoardView {
  readonly root = new Group();
  readonly pitTargets: PitTarget[] = [];
  readonly buttons: ButtonView[] = [];
  /** Tilted frame holding the status panel and the buttons. */
  readonly hudGroup = new Group();
  readonly seedCount: number;

  private seeds: InstancedMesh;
  private matrix = new Matrix4();
  private highlight: Mesh;
  private label: TextPlane;
  private hud: TextPlane;
  private texts: TextPlane[] = [];
  private disposables: { dispose(): void }[] = [];

  constructor(readonly options: Options) {
    this.root.name = 'moruba-board';
    const { width, depth } = boardSize(options);
    const n = loopSize(options);
    this.seedCount = 2 * n * options.seedsPerPit;

    // Top plate: a rounded rectangle with a round hole for every pit.
    const shape = new Shape();
    const hw = width / 2;
    const hd = depth / 2;
    const r = 0.014;
    shape.moveTo(-hw + r, -hd);
    shape.lineTo(hw - r, -hd);
    shape.quadraticCurveTo(hw, -hd, hw, -hd + r);
    shape.lineTo(hw, hd - r);
    shape.quadraticCurveTo(hw, hd, hw - r, hd);
    shape.lineTo(-hw + r, hd);
    shape.quadraticCurveTo(-hw, hd, -hw, hd - r);
    shape.lineTo(-hw, -hd + r);
    shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
    for (const player of [0, 1] as const) {
      for (let i = 0; i < n; i++) {
        const [x, , z] = pitCentre(options, player, i);
        const hole = new Path();
        // Shape Y becomes -Z after the plate is laid flat.
        hole.absarc(x, -z, PIT_RADIUS, 0, Math.PI * 2, true);
        shape.holes.push(hole);
      }
    }
    const plateGeometry = new ExtrudeGeometry(shape, {
      depth: PIT_DEPTH,
      bevelEnabled: false,
      curveSegments: 20,
    });
    plateGeometry.rotateX(-Math.PI / 2);
    plateGeometry.translate(0, BASE_THICKNESS, 0);
    const plateMaterial = new MeshStandardMaterial({
      color: 0x9a6532,
      roughness: 0.62,
    });
    const plate = new Mesh(plateGeometry, plateMaterial);
    plate.name = 'board-plate';

    const baseGeometry = new BoxGeometry(width - 0.004, BASE_THICKNESS, depth - 0.004);
    baseGeometry.translate(0, BASE_THICKNESS / 2, 0);
    const baseMaterial = new MeshStandardMaterial({
      color: 0x4b2d16,
      roughness: 0.8,
    });
    const base = new Mesh(baseGeometry, baseMaterial);
    base.name = 'board-base';
    this.root.add(plate, base);
    this.disposables.push(plateGeometry, plateMaterial, baseGeometry, baseMaterial);

    // A thin line across the middle separates the two players' halves.
    const dividerGeometry = new BoxGeometry(width - 0.03, 0.0006, 0.0016);
    const dividerMaterial = new MeshBasicMaterial({ color: 0x3a2110 });
    const divider = new Mesh(dividerGeometry, dividerMaterial);
    divider.position.y = TOP_Y + 0.0003;
    this.root.add(divider);
    this.disposables.push(dividerGeometry, dividerMaterial);

    // Seeds: one instanced mesh, one draw call.
    const seedGeometry = new SphereGeometry(SEED_RADIUS, 12, 8);
    seedGeometry.scale(1, SEED_SQUASH, 1);
    const seedMaterial = new MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.45,
    });
    this.seeds = new InstancedMesh(seedGeometry, seedMaterial, this.seedCount);
    this.seeds.name = 'seeds';
    this.seeds.frustumCulled = false;
    const tint = new Color();
    for (let i = 0; i < this.seedCount; i++) {
      // Morula-pip ivory with a little variation per seed.
      const v = ((i * 37) % 11) / 11;
      tint.setRGB(0.93 - v * 0.1, 0.86 - v * 0.12, 0.7 - v * 0.14);
      this.seeds.setColorAt(i, tint);
    }
    this.root.add(this.seeds);
    this.disposables.push(seedGeometry, seedMaterial);

    // Invisible touch targets, a little bigger than the pits.
    const targetGeometry = new CylinderGeometry(
      PIT_RADIUS * 1.12,
      PIT_RADIUS * 1.12,
      0.03,
      12,
    );
    const targetMaterial = new MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.disposables.push(targetGeometry, targetMaterial);
    for (const player of [0, 1] as const) {
      for (let i = 0; i < n; i++) {
        const mesh = new Mesh(targetGeometry, targetMaterial);
        const [x, y, z] = pitCentre(options, player, i);
        mesh.position.set(x, y + 0.015, z);
        mesh.name = `pit-${player}-${i}`;
        this.pitTargets.push({ player, index: i, mesh });
      }
    }

    const ringGeometry = new RingGeometry(PIT_RADIUS * 0.98, PIT_RADIUS * 1.22, 36);
    ringGeometry.rotateX(-Math.PI / 2);
    const ringMaterial = new MeshBasicMaterial({
      color: 0xffd23a,
      transparent: true,
      opacity: 0.95,
    });
    this.highlight = new Mesh(ringGeometry, ringMaterial);
    this.highlight.name = 'pit-highlight';
    this.highlight.visible = false;
    this.root.add(this.highlight);
    this.disposables.push(ringGeometry, ringMaterial);

    this.label = new TextPlane(0.034, 0.034, 4000, (ctx, w, h, text) => {
      ctx.fillStyle = 'rgba(24, 16, 10, 0.9)';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff3d6';
      ctx.font = `bold ${Math.round(h * 0.6)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2 + h * 0.04);
    });
    this.label.mesh.name = 'pit-label';
    this.label.mesh.visible = false;
    this.label.mesh.renderOrder = 10;
    this.root.add(this.label.mesh);
    this.texts.push(this.label);

    // Heads-up panel on the far side, leaning back towards the player.
    const hudWidth = Math.min(0.4, width);
    const hudHeight = 0.092;
    this.hud = new TextPlane(hudWidth, hudHeight, 2600, (ctx, w, h, text) => {
      panel(ctx, w, h, 'rgba(24, 16, 10, 0.88)');
      const [line1, line2 = '', tip = ''] = text.split('\n');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd23a';
      ctx.font = `bold ${Math.round(h * 0.2)}px ${FONT}`;
      ctx.fillText(line1, w / 2, h * (tip ? 0.2 : 0.32), w * 0.94);
      ctx.fillStyle = '#f3ead9';
      ctx.font = `${Math.round(h * 0.15)}px ${FONT}`;
      ctx.fillText(line2, w / 2, h * (tip ? 0.45 : 0.68), w * 0.94);
      if (tip) {
        // Wrap the tip over at most two lines.
        ctx.fillStyle = '#bfe6a8';
        ctx.font = `${Math.round(h * 0.135)}px ${FONT}`;
        const words = tip.split(' ');
        const lines: string[] = [''];
        for (const word of words) {
          const trial = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${word}` : word;
          if (ctx.measureText(trial).width > w * 0.92 && lines.length < 2) lines.push(word);
          else lines[lines.length - 1] = trial;
        }
        lines.forEach((line, k) =>
          ctx.fillText(line, w / 2, h * (0.68 + k * 0.17), w * 0.94),
        );
      }
    });
    this.hudGroup.name = 'hud';
    this.hudGroup.position.set(0, 0.012, -(depth / 2 + 0.03));
    this.hudGroup.rotation.x = -0.5;
    this.root.add(this.hudGroup);

    const actions = ['new', 'size', 'level', 'teach', 'room', 'move'];
    const perRow = 3;
    const gap = 0.006;
    const buttonHeight = 0.028;
    const buttonWidth = (hudWidth - gap * (perRow - 1)) / perRow;
    const rows = Math.ceil(actions.length / perRow);
    actions.forEach((action, i) => {
      const text = new TextPlane(buttonWidth, buttonHeight, 2600, (ctx, w, h, label) => {
        panel(ctx, w, h, 'rgba(92, 56, 24, 0.95)');
        ctx.fillStyle = '#fff3d6';
        ctx.font = `bold ${Math.round(h * 0.46)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, w / 2, h / 2 + h * 0.03, w * 0.9);
      });
      const row = Math.floor(i / perRow);
      text.mesh.name = `button-${action}`;
      text.mesh.position.set(
        -hudWidth / 2 + buttonWidth / 2 + (i % perRow) * (buttonWidth + gap),
        buttonHeight / 2 + (rows - 1 - row) * (buttonHeight + gap),
        0,
      );
      this.texts.push(text);
      this.buttons.push({
        action,
        mesh: text.mesh,
        setLabel: (label) => text.set(label),
      });
    });
    this.hud.mesh.name = 'hud-panel';
    this.hud.mesh.position.set(
      0,
      rows * (buttonHeight + gap) + hudHeight / 2,
      0,
    );
    this.hudGroup.add(this.hud.mesh);
    this.texts.push(this.hud);
  }

  setSeed(id: number, x: number, y: number, z: number): void {
    this.matrix.makeTranslation(x, y, z);
    this.seeds.setMatrixAt(id, this.matrix);
  }

  commitSeeds(): void {
    this.seeds.instanceMatrix.needsUpdate = true;
  }

  showHighlight(player: Player, pit: number, colour: number): void {
    const [x, , z] = pitCentre(this.options, player, pit);
    this.highlight.position.set(x, TOP_Y + 0.0008, z);
    (this.highlight.material as MeshBasicMaterial).color.setHex(colour);
    this.highlight.visible = true;
  }

  hideHighlight(): void {
    this.highlight.visible = false;
  }

  /** Show a count bubble above a pit, leaning back towards the human's seat. */
  showLabel(player: Player, pit: number, count: number): void {
    const [x, , z] = pitCentre(this.options, player, pit);
    this.label.set(String(count));
    this.label.mesh.position.set(x, TOP_Y + 0.045, z - 0.012);
    this.label.mesh.rotation.set(-0.75, 0, 0);
    this.label.mesh.visible = true;
  }

  hideLabel(): void {
    this.label.mesh.visible = false;
  }

  setHud(text: string): void {
    this.hud.set(text);
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const d of this.disposables) d.dispose();
    for (const t of this.texts) t.dispose();
    this.seeds.dispose();
  }
}
