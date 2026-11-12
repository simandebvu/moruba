/**
 * The visible board: wooden slab with pits, instanced seeds, hover highlight,
 * count label, and a small heads-up panel with buttons. No game logic here.
 */

import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { loopSize, type Options, type Player } from '../engine/moruba.js';
import {
  BASE_THICKNESS,
  BOWL_SPHERE_RADIUS,
  boardSize,
  PIT_DEPTH,
  PIT_RADIUS,
  pitCentre,
  SEED_RADIUS,
  SEED_SQUASH,
  TOP_Y,
  TRAY_THICKNESS,
  trayRect,
} from './layout.js';
import { boardTopTexture, shadowTexture, woodTexture } from './textures.js';

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
  private menuOpen = true;
  private menuBase = 0;
  private menuHome = new Vector3();
  private menuLayout = { rows: 2, pitch: 0.034, hudHeight: 0.092, barHeight: 0.016 };
  /** Tilted frame holding the status panel and the buttons. */
  readonly hudGroup = new Group();
  readonly seedCount: number;

  private seeds: InstancedMesh;
  private matrix = new Matrix4();
  private seedTurn: Quaternion[] = [];
  private seedSize: Vector3[] = [];
  private seedPosition = new Vector3();
  private highlight: Mesh;
  /** Extra rings for the move preview: where it ends, what it captures. */
  private marks: Mesh[] = [];
  /** Expanding rings that mark a capture, with each one's age in seconds (-1 = idle). */
  private flashes: Mesh[] = [];
  private flashAge: number[] = [];
  private label: TextPlane;
  private hud: TextPlane;
  private lesson: TextPlane;
  private handle: TextPlane;
  /** Centre of the grab handle along the board's depth (board space). */
  readonly handleZ: number;
  private texts: TextPlane[] = [];
  private disposables: { dispose(): void }[] = [];
  private dots: Mesh[] = [];
  private highlightPulse = false;
  private gains: TextPlane[] = [];
  private threats: Mesh[] = [];
  private threatMaterial: MeshBasicMaterial | null = null;
  private popups: TextPlane[] = [];
  private popupAge: number[] = [];
  private popupBase: number[] = [];
  private glow: Mesh | null = null;
  private glowAge = -1;
  private scoreGroup = new Group();
  private scoreMine: Mesh | null = null;
  private scoreTheirs: Mesh | null = null;
  private scoreText: TextPlane | null = null;
  private scoreWidth = 0.4;
  private share = 0.5;
  private shareTarget = 0.5;
  private time = 0;

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
    const bevel = 0.0014;
    const plateGeometry = new ExtrudeGeometry(shape, {
      depth: PIT_DEPTH - 2 * bevel,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelOffset: -bevel,
      bevelSegments: 2,
      curveSegments: 20,
    });
    plateGeometry.rotateX(-Math.PI / 2);
    plateGeometry.translate(0, BASE_THICKNESS + bevel, 0);
    const pits: { x: number; z: number }[] = [];
    for (const player of [0, 1] as const) {
      for (let i = 0; i < n; i++) {
        const [x, , z] = pitCentre(options, player, i);
        pits.push({ x, z });
      }
    }
    const topTexture = boardTopTexture({ width, depth, pits, pitRadius: PIT_RADIUS });
    const sideTexture = woodTexture('#8a5426', 11);
    sideTexture.repeat.set(4, 4);
    // Extrude groups: 0 = the flat faces (top and bottom), 1 = the sides.
    const topMaterial = new MeshStandardMaterial({ map: topTexture, roughness: 0.58 });
    const sideMaterial = new MeshStandardMaterial({ map: sideTexture, roughness: 0.62 });
    const plate = new Mesh(plateGeometry, [topMaterial, sideMaterial]);
    plate.name = 'board-plate';

    const baseGeometry = new BoxGeometry(width - 0.006, BASE_THICKNESS, depth - 0.006);
    baseGeometry.translate(0, BASE_THICKNESS / 2, 0);
    const baseMaterial = new MeshStandardMaterial({
      color: 0x3f2512,
      roughness: 0.8,
    });
    const base = new Mesh(baseGeometry, baseMaterial);
    base.name = 'board-base';
    this.root.add(plate, base);
    this.disposables.push(
      plateGeometry,
      topTexture,
      sideTexture,
      topMaterial,
      sideMaterial,
      baseGeometry,
      baseMaterial,
    );

    // Pits: bowls cut from a sphere, darker towards the bottom. One draw call.
    const cap = Math.asin(PIT_RADIUS / BOWL_SPHERE_RADIUS);
    const bowlGeometry = new SphereGeometry(
      BOWL_SPHERE_RADIUS,
      24,
      6,
      0,
      Math.PI * 2,
      Math.PI - cap,
      cap,
    );
    bowlGeometry.translate(0, BASE_THICKNESS + BOWL_SPHERE_RADIUS, 0);
    const bowlPosition = bowlGeometry.getAttribute('position');
    const bowlColours: number[] = [];
    for (let i = 0; i < bowlPosition.count; i++) {
      const t = (bowlPosition.getY(i) - BASE_THICKNESS) / PIT_DEPTH; // 0 bottom, 1 rim
      const shade = 0.42 + 0.58 * Math.min(1, Math.max(0, t));
      bowlColours.push(shade, shade, shade);
    }
    bowlGeometry.setAttribute('color', new Float32BufferAttribute(bowlColours, 3));
    const bowlMaterial = new MeshStandardMaterial({
      color: 0x7a4a22,
      roughness: 0.7,
      vertexColors: true,
      side: BackSide,
    });
    const bowls = new InstancedMesh(bowlGeometry, bowlMaterial, pits.length);
    bowls.name = 'pit-bowls';
    pits.forEach((pit, i) => {
      this.matrix.makeTranslation(pit.x, 0, pit.z);
      bowls.setMatrixAt(i, this.matrix);
    });
    this.root.add(bowls);
    this.disposables.push(bowlGeometry, bowlMaterial, bowls);

    // A thin line across the middle separates the two players' halves.
    const dividerGeometry = new BoxGeometry(width - 0.034, 0.0006, 0.0014);
    const dividerMaterial = new MeshBasicMaterial({ color: 0x2e1606 });
    const divider = new Mesh(dividerGeometry, dividerMaterial);
    divider.position.y = TOP_Y + 0.0003;
    this.root.add(divider);
    this.disposables.push(dividerGeometry, dividerMaterial);

    // Trays for captured seeds, one beside each player's right hand.
    const trayTexture = woodTexture('#5a3418', 23, 256);
    const trayMaterial = new MeshStandardMaterial({ map: trayTexture, roughness: 0.7 });
    this.disposables.push(trayTexture, trayMaterial);
    for (const player of [0, 1] as const) {
      const rect = trayRect(options, player);
      const trayShape = new Shape();
      const tw = rect.width / 2;
      const td = rect.depth / 2;
      const tr = 0.008;
      trayShape.moveTo(-tw + tr, -td);
      trayShape.lineTo(tw - tr, -td);
      trayShape.quadraticCurveTo(tw, -td, tw, -td + tr);
      trayShape.lineTo(tw, td - tr);
      trayShape.quadraticCurveTo(tw, td, tw - tr, td);
      trayShape.lineTo(-tw + tr, td);
      trayShape.quadraticCurveTo(-tw, td, -tw, td - tr);
      trayShape.lineTo(-tw, -td + tr);
      trayShape.quadraticCurveTo(-tw, -td, -tw + tr, -td);
      const trayGeometry = new ExtrudeGeometry(trayShape, {
        depth: TRAY_THICKNESS - 0.001,
        bevelEnabled: true,
        bevelThickness: 0.0005,
        bevelSize: 0.001,
        bevelSegments: 1,
        curveSegments: 6,
      });
      trayGeometry.rotateX(-Math.PI / 2);
      const tray = new Mesh(trayGeometry, trayMaterial);
      tray.name = `tray-${player}`;
      tray.position.set(rect.x, 0.0005, rect.z);
      this.root.add(tray);
      this.disposables.push(trayGeometry);
    }
    trayTexture.repeat.set(14, 14);

    // Soft shadow so the board sits on the table instead of floating over it.
    const shadowMap = shadowTexture();
    const shadowGeometry = new PlaneGeometry(width + 0.2, depth + 0.1);
    shadowGeometry.rotateX(-Math.PI / 2);
    const shadowMaterial = new MeshBasicMaterial({
      map: shadowMap,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const shadow = new Mesh(shadowGeometry, shadowMaterial);
    shadow.name = 'board-shadow';
    shadow.position.y = 0.0004;
    shadow.renderOrder = -1;
    this.root.add(shadow);
    this.disposables.push(shadowMap, shadowGeometry, shadowMaterial);

    // Seeds (morula pips): one instanced mesh, one draw call. Each pip keeps
    // its own slight size and turn so a pit full of them looks natural.
    const seedGeometry = new SphereGeometry(SEED_RADIUS, 12, 8);
    seedGeometry.scale(1, SEED_SQUASH, 0.82);
    const seedMaterial = new MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.38,
    });
    this.seeds = new InstancedMesh(seedGeometry, seedMaterial, this.seedCount);
    this.seeds.name = 'seeds';
    this.seeds.frustumCulled = false;
    const axis = new Vector3();
    for (let i = 0; i < this.seedCount; i++) {
      const a1 = ((i * 97) % 31) / 31;
      const a2 = ((i * 57) % 23) / 23;
      axis.set(a2 * 0.5 - 0.25, 1, a1 * 0.5 - 0.25).normalize();
      this.seedTurn.push(new Quaternion().setFromAxisAngle(axis, a1 * Math.PI * 2));
      const size = 0.92 + a2 * 0.16;
      this.seedSize.push(new Vector3(size, size * (0.94 + a1 * 0.12), size));
    }
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

    // A bright dot at each hand's pinch point: "this is where you pick".
    const dotGeometry = new SphereGeometry(0.006, 12, 8);
    this.disposables.push(dotGeometry);
    for (let i = 0; i < 2; i++) {
      const dotMaterial = new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      });
      this.disposables.push(dotMaterial);
      const dot = new Mesh(dotGeometry, dotMaterial);
      dot.name = `pinch-dot-${i}`;
      dot.renderOrder = 20;
      dot.visible = false;
      this.root.add(dot);
      this.dots.push(dot);
    }
    this.disposables.push(ringGeometry, ringMaterial);
    for (let i = 0; i < 4; i++) {
      const material = ringMaterial.clone();
      const mark = new Mesh(ringGeometry, material);
      mark.name = `pit-mark-${i}`;
      mark.visible = false;
      this.root.add(mark);
      this.marks.push(mark);
      this.disposables.push(material);
    }
    for (let i = 0; i < 3; i++) {
      const material = ringMaterial.clone();
      material.depthWrite = false;
      const flash = new Mesh(ringGeometry, material);
      flash.name = `pit-flash-${i}`;
      flash.visible = false;
      this.root.add(flash);
      this.flashes.push(flash);
      this.flashAge.push(-1);
      this.disposables.push(material);
    }

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
      const alone = !line2 && !tip;
      ctx.font = `bold ${Math.round(h * (alone ? 0.3 : 0.22))}px ${FONT}`;
      ctx.fillText(line1, w / 2, h * (alone ? 0.52 : tip ? 0.2 : 0.32), w * 0.94);
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

    const actions = ['new', 'level', 'daily', 'teach', 'size', 'room', 'move', 'menu'];
    const perRow = 4;
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
    this.menuLayout = { rows, pitch: buttonHeight + gap, hudHeight, barHeight: 0.016 };
    const menu = this.buttons[this.buttons.length - 1].mesh;
    this.menuHome.copy(menu.position);
    this.hudGroup.add(this.hud.mesh);
    this.texts.push(this.hud);

    // Tug-of-war bar above the panel: whose seeds fill more of the board.
    const barHeight = 0.016;
    this.scoreWidth = hudWidth;
    const barGeometry = new PlaneGeometry(1, barHeight);
    const mineMaterial = new MeshBasicMaterial({ color: 0xffc23a });
    const theirsMaterial = new MeshBasicMaterial({ color: 0xb8452a });
    this.disposables.push(barGeometry, mineMaterial, theirsMaterial);
    this.scoreMine = new Mesh(barGeometry, mineMaterial);
    this.scoreTheirs = new Mesh(barGeometry, theirsMaterial);
    this.scoreText = new TextPlane(hudWidth, barHeight, 2600, (ctx, w, h, text) => {
      const [mine = '', theirs = ''] = text.split('|');
      ctx.font = `bold ${Math.round(h * 0.72)}px ${FONT}`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#2a1608';
      ctx.textAlign = 'left';
      ctx.fillText(mine, h * 0.4, h * 0.54);
      ctx.fillStyle = '#fff3d6';
      ctx.textAlign = 'right';
      ctx.fillText(theirs, w - h * 0.4, h * 0.54);
      // Half-way mark.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillRect(w / 2 - 2, 0, 4, h);
    });
    this.scoreText.mesh.position.z = 0.0006;
    this.texts.push(this.scoreText);
    this.scoreGroup.name = 'score-bar';
    this.scoreGroup.add(this.scoreMine, this.scoreTheirs, this.scoreText.mesh);
    this.hudGroup.add(this.scoreGroup);
    this.layoutScore();

    // Badges over the human's playable pits: what the move takes ("+5", gold)
    // and a red "!" when it is clearly riskier than the safest move.
    for (let i = 0; i < n; i++) {
      const badge = new TextPlane(0.04, 0.02, 3200, (ctx, w, h, text) => {
        panel(ctx, w, h, 'rgba(24, 16, 10, 0.92)');
        const parts = text.split(' ');
        ctx.font = `bold ${Math.round(h * (parts.length > 1 ? 0.6 : 0.74))}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        parts.forEach((part, k) => {
          ctx.fillStyle = part[0] === '+' ? '#ffd23a' : '#ff7a55';
          ctx.fillText(part, (w * (k + 0.5)) / parts.length, h * 0.55, (w * 0.9) / parts.length);
        });
      });
      const [x, , z] = pitCentre(options, 0, i);
      badge.mesh.name = `pit-gain-${i}`;
      badge.mesh.position.set(x, TOP_Y + 0.02, z + 0.014);
      badge.mesh.rotation.set(-0.75, 0, 0);
      badge.mesh.renderOrder = 9;
      badge.mesh.visible = false;
      this.root.add(badge.mesh);
      this.gains.push(badge);
      this.texts.push(badge);
    }

    // Red warning rings on the human's pits the opponent could take next.
    this.threatMaterial = new MeshBasicMaterial({
      color: 0xff5a3a,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    this.disposables.push(this.threatMaterial);
    for (let i = 0; i < n; i++) {
      const ring = new Mesh(ringGeometry, this.threatMaterial);
      const [x, , z] = pitCentre(options, 0, i);
      ring.name = `pit-threat-${i}`;
      ring.position.set(x, TOP_Y + 0.0005, z);
      ring.scale.setScalar(1.1);
      ring.visible = false;
      this.root.add(ring);
      this.threats.push(ring);
    }

    // Words that rise out of a pit and fade ("+4", "Chain ×2").
    for (let i = 0; i < 4; i++) {
      const popup = new TextPlane(0.1, 0.03, 2600, (ctx, w, h, text) => {
        const [colour = '#ffd23a', words = ''] = text.split('|');
        ctx.font = `bold ${Math.round(h * 0.8)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = h * 0.16;
        ctx.strokeStyle = 'rgba(20, 12, 6, 0.95)';
        ctx.strokeText(words, w / 2, h * 0.54, w * 0.94);
        ctx.fillStyle = colour;
        ctx.fillText(words, w / 2, h * 0.54, w * 0.94);
      });
      popup.mesh.name = `popup-${i}`;
      popup.mesh.rotation.set(-0.75, 0, 0);
      popup.mesh.renderOrder = 12;
      popup.mesh.visible = false;
      (popup.mesh.material as MeshBasicMaterial).depthTest = false;
      this.root.add(popup.mesh);
      this.popups.push(popup);
      this.popupAge.push(-1);
      this.popupBase.push(0);
      this.texts.push(popup);
    }

    // A wash of light over the whole board for a big capture.
    const glowGeometry = new PlaneGeometry(width, depth);
    glowGeometry.rotateX(-Math.PI / 2);
    const glowMaterial = new MeshBasicMaterial({
      color: 0xffd23a,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(glowGeometry, glowMaterial);
    this.glow = new Mesh(glowGeometry, glowMaterial);
    this.glow.name = 'board-glow';
    this.glow.position.y = TOP_Y + 0.003;
    this.glow.visible = false;
    this.root.add(this.glow);

    // Grab handle on the player's side: pinch and hold it to carry the board.
    // A wide bar, well clear of the nearest pits so reaching for them never grabs it.
    this.handleZ = depth / 2 + 0.075;
    this.handle = new TextPlane(0.28, 0.04, 2600, (ctx, w, h, label) => {
      panel(ctx, w, h, 'rgba(232, 201, 138, 0.96)');
      ctx.fillStyle = '#3a2410';
      ctx.font = `bold ${Math.round(h * 0.44)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, w / 2, h / 2 + h * 0.03, w * 0.92);
    });
    this.handle.set('Pinch here and hold to move the board');
    this.handle.mesh.name = 'board-handle';
    this.handle.mesh.position.set(0, 0.006, this.handleZ);
    this.handle.mesh.rotation.x = -Math.PI / 2 + 0.45;
    this.root.add(this.handle.mesh);
    this.texts.push(this.handle);

    // "How to play" card: takes the status panel's place during the lesson,
    // with larger text. Lines: step, title, body (wrapped), what to do now.
    const lessonHeight = 0.17;
    const lessonWidth = 0.42;
    this.lesson = new TextPlane(lessonWidth, lessonHeight, 2600, (ctx, w, h, text) => {
      panel(ctx, w, h, 'rgba(24, 16, 10, 0.94)');
      const [step = '', title = '', body = '', todo = ''] = text.split('\n');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#c9b89c';
      ctx.font = `${Math.round(h * 0.075)}px ${FONT}`;
      ctx.fillText(step, w / 2, h * 0.09, w * 0.92);
      ctx.fillStyle = '#ffd23a';
      ctx.font = `bold ${Math.round(h * (todo ? 0.135 : 0.19))}px ${FONT}`;
      ctx.fillText(title, w / 2, h * (todo ? 0.235 : 0.36), w * 0.92);
      ctx.fillStyle = '#f3ead9';
      ctx.font = `${Math.round(h * (todo ? 0.1 : 0.12))}px ${FONT}`;
      const lines: string[] = [''];
      for (const word of body.split(' ')) {
        const last = lines[lines.length - 1];
        const trial = last ? `${last} ${word}` : word;
        if (last && ctx.measureText(trial).width > w * 0.9 && lines.length < 4) lines.push(word);
        else lines[lines.length - 1] = trial;
      }
      const top = (todo ? 0.57 : 0.7) - (lines.length - 1) * 0.056;
      lines.forEach((line, k) =>
        ctx.fillText(line, w / 2, h * (top + k * 0.112), w * 0.94),
      );
      ctx.fillStyle = '#9be28a';
      ctx.font = `bold ${Math.round(h * 0.1)}px ${FONT}`;
      ctx.fillText(todo, w / 2, h * 0.9, w * 0.94);
    });
    this.lesson.mesh.name = 'lesson-card';
    this.lesson.mesh.visible = false;
    this.lesson.mesh.position.set(0, rows * (buttonHeight + gap) + lessonHeight / 2, 0);
    this.hudGroup.add(this.lesson.mesh);
    this.menuOpen = true;
    this.menuBase = rows * (buttonHeight + gap);
    this.setMenu(false);
    this.texts.push(this.lesson);
  }

  setSeed(id: number, x: number, y: number, z: number): void {
    this.matrix.compose(
      this.seedPosition.set(x, y, z),
      this.seedTurn[id],
      this.seedSize[id],
    );
    this.seeds.setMatrixAt(id, this.matrix);
  }

  commitSeeds(): void {
    this.seeds.instanceMatrix.needsUpdate = true;
  }

  /** Show (board-space position) or hide the dot for hand `i`; gold when over something. */
  setDot(i: number, at: Vector3 | null, over = false): void {
    const dot = this.dots[i];
    dot.visible = at !== null;
    if (!at) return;
    dot.position.copy(at);
    dot.scale.setScalar(over ? 1.5 : 1);
    (dot.material as MeshBasicMaterial).color.setHex(over ? 0xffd27a : 0xffffff);
  }

  showHighlight(player: Player, pit: number, colour: number, pulse = false): void {
    this.highlightPulse = pulse;
    if (!pulse) this.highlight.scale.setScalar(1);
    const [x, , z] = pitCentre(this.options, player, pit);
    this.highlight.position.set(x, TOP_Y + 0.0008, z);
    (this.highlight.material as MeshBasicMaterial).color.setHex(colour);
    this.highlight.visible = true;
  }

  hideHighlight(): void {
    this.highlight.visible = false;
  }

  private layoutScore(): void {
    const w = this.scoreWidth;
    const mine = Math.max(0.001, this.share * w);
    const theirs = Math.max(0.001, w - mine);
    if (!this.scoreMine || !this.scoreTheirs) return;
    this.scoreMine.scale.x = mine;
    this.scoreMine.position.x = -w / 2 + mine / 2;
    this.scoreTheirs.scale.x = theirs;
    this.scoreTheirs.position.x = w / 2 - theirs / 2;
  }

  /** Seeds each side has on the board; the bar slides to match. */
  setScore(mine: number, theirs: number, name: string): void {
    const total = mine + theirs;
    this.shareTarget = total > 0 ? mine / total : 0.5;
    this.scoreText?.set(`You ${mine}|${name} ${theirs}`);
  }

  setScoreVisible(visible: boolean): void {
    this.scoreGroup.visible = visible;
  }

  /** A short label over each of the human's pits ('' = none): "+4", "!" or "+4 !". */
  showGains(labels: readonly string[] | null): void {
    for (let i = 0; i < this.gains.length; i++) {
      const label = labels ? (labels[i] ?? '') : '';
      this.gains[i].mesh.visible = label !== '';
      if (label) this.gains[i].set(label);
    }
  }

  /**
   * The buttons fold away behind one "Menu" button so nothing competes with
   * the board during play; the panel drops down to sit just above it.
   */
  setMenu(open: boolean): void {
    if (open === this.menuOpen) return;
    this.menuOpen = open;
    const { rows, pitch, hudHeight, barHeight } = this.menuLayout;
    const last = this.buttons.length - 1;
    this.buttons.forEach((button, i) => {
      if (i !== last) button.mesh.visible = open;
    });
    const menu = this.buttons[last];
    menu.setLabel(open ? 'Close menu' : 'Menu');
    if (open) menu.mesh.position.copy(this.menuHome);
    else menu.mesh.position.set(0, this.menuHome.y, 0);
    const base = (open ? rows : 1) * pitch;
    this.hud.mesh.position.set(0, base + hudHeight / 2, 0);
    this.lesson.mesh.position.y += base - this.menuBase;
    this.menuBase = base;
    this.scoreGroup.position.set(0, base + hudHeight + 0.005 + barHeight / 2, 0);
  }

  /** Warn on the human's pits the opponent could capture next turn. */
  showThreats(pits: readonly boolean[] | null): void {
    for (let i = 0; i < this.threats.length; i++) {
      this.threats[i].visible = pits ? pits[i] === true : false;
    }
  }

  /** Words rising out of a pit. `colour` is a CSS colour. */
  popup(player: Player, pit: number, words: string, colour: string, big = false): void {
    let slot = this.popupAge.indexOf(-1);
    if (slot < 0) slot = 0;
    const [x, , z] = pitCentre(this.options, player, pit);
    const popup = this.popups[slot];
    popup.set(`${colour}|${words}`);
    popup.mesh.position.set(x, TOP_Y + 0.04, z);
    popup.mesh.scale.setScalar(big ? 1.5 : 1);
    this.popupBase[slot] = TOP_Y + 0.04;
    this.popupAge[slot] = 0;
  }

  /** Light the whole board for a moment. */
  burst(colour: number): void {
    if (!this.glow) return;
    (this.glow.material as MeshBasicMaterial).color.setHex(colour);
    this.glowAge = 0;
  }

  /** A ring bursting outwards from a pit: something was captured there. */
  flash(player: Player, pit: number, colour: number): void {
    let slot = this.flashAge.indexOf(-1);
    if (slot < 0) slot = 0;
    const [x, , z] = pitCentre(this.options, player, pit);
    const mesh = this.flashes[slot];
    mesh.position.set(x, TOP_Y + 0.002, z);
    (mesh.material as MeshBasicMaterial).color.setHex(colour);
    this.flashAge[slot] = 0;
  }

  /** Advance the capture flashes. */
  update(delta: number): void {
    this.time += delta;
    if (this.highlightPulse) {
      this.highlight.scale.setScalar(1.12 + 0.14 * Math.sin(this.time * 6));
    }
    if (Math.abs(this.shareTarget - this.share) > 0.0005) {
      this.share += (this.shareTarget - this.share) * Math.min(1, delta * 4);
      this.layoutScore();
    }
    if (this.threatMaterial) {
      this.threatMaterial.opacity = 0.5 + 0.35 * Math.sin(this.time * 5);
    }
    for (let i = 0; i < this.popups.length; i++) {
      if (this.popupAge[i] < 0) continue;
      this.popupAge[i] += delta;
      const t = this.popupAge[i] / 1.3;
      const mesh = this.popups[i].mesh;
      if (t >= 1) {
        this.popupAge[i] = -1;
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.y = this.popupBase[i] + 0.05 * (1 - (1 - t) * (1 - t));
      (mesh.material as MeshBasicMaterial).opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    }
    if (this.glow && this.glowAge >= 0) {
      this.glowAge += delta;
      const t = this.glowAge / 0.7;
      this.glow.visible = t < 1;
      (this.glow.material as MeshBasicMaterial).opacity = t < 1 ? 0.45 * (1 - t) * (1 - t) : 0;
      if (t >= 1) this.glowAge = -1;
    }
    for (let i = 0; i < this.flashes.length; i++) {
      if (this.flashAge[i] < 0) continue;
      this.flashAge[i] += delta;
      const t = this.flashAge[i] / 0.55;
      const mesh = this.flashes[i];
      if (t >= 1) {
        this.flashAge[i] = -1;
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.scale.setScalar(1 + t * 1.9);
      (mesh.material as MeshBasicMaterial).opacity = 0.95 * (1 - t) * (1 - t);
    }
  }

  /** Ring up to three more pits (the move preview). Call with nothing to clear. */
  showMarks(marks: readonly { player: Player; pit: number; colour: number }[] = []): void {
    this.marks.forEach((mesh, i) => {
      const mark = marks[i];
      mesh.visible = mark !== undefined;
      if (!mark) return;
      const [x, , z] = pitCentre(this.options, mark.player, mark.pit);
      mesh.position.set(x, TOP_Y + 0.0012, z);
      (mesh.material as MeshBasicMaterial).color.setHex(mark.colour);
    });
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

  /** The handle swells while a hand is on it and says what letting go does. */
  setHandle(state: 'hidden' | 'idle' | 'near' | 'held' | 'resting'): void {
    this.handle.mesh.visible = state !== 'hidden';
    this.handle.mesh.scale.setScalar(state === 'idle' ? 1 : 1.12);
    this.handle.set(
      state === 'resting'
        ? 'On your table · let go'
        : state === 'held'
        ? 'Let go to set the board down'
        : state === 'near'
          ? 'Pinch now and hold'
          : 'Pinch here and hold to move the board',
    );
  }

  /** Show the lesson card in place of the status panel, or `null` to put the panel back. */
  setLesson(text: string | null): void {
    this.lesson.mesh.visible = text !== null;
    this.hud.mesh.visible = text === null;
    this.scoreGroup.visible = text === null;
    if (text !== null) this.lesson.set(text);
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const d of this.disposables) d.dispose();
    for (const t of this.texts) t.dispose();
    this.seeds.dispose();
  }
}
