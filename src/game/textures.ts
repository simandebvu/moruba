/**
 * Procedural textures drawn on canvases at start-up: no image downloads, and
 * the same result every run (seeded noise).
 */

import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from '@iwsdk/core';

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function grain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: string,
  seed: number,
  lines: number,
): void {
  const random = seeded(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  // Broad lighter and darker bands first, then fine grain lines along X.
  for (let i = 0; i < 14; i++) {
    const y = random() * h;
    const band = 12 + random() * 46;
    ctx.fillStyle =
      random() < 0.5 ? 'rgba(255, 214, 160, 0.05)' : 'rgba(52, 24, 6, 0.06)';
    ctx.fillRect(0, y, w, band);
  }
  for (let i = 0; i < lines; i++) {
    const y0 = random() * h;
    const amp = 1 + random() * 5;
    const freq = 0.004 + random() * 0.01;
    const phase = random() * 6.28;
    const dark = random() < 0.72;
    ctx.strokeStyle = dark
      ? `rgba(58, 28, 8, ${0.05 + random() * 0.13})`
      : `rgba(255, 222, 170, ${0.03 + random() * 0.07})`;
    ctx.lineWidth = 0.6 + random() * 2.2;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 24) {
      const y = y0 + Math.sin(x * freq + phase) * amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** Plain tileable-enough wood for sides, trays and the virtual table. */
export function woodTexture(base: string, seed: number, size = 512): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  grain(ctx, size, size, base, seed, Math.round(size / 3));
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

export interface BoardTopSpec {
  /** Board size in metres. */
  width: number;
  depth: number;
  /** Pit centres in board-local metres (x, z) and their radius. */
  pits: { x: number; z: number }[];
  pitRadius: number;
}

/**
 * The board's top face, drawn in board coordinates: grain, a darker "burnt"
 * ring round every pit, and a zigzag border burnt into the margin.
 * Canvas X = board X; canvas Y = board Z (far side at the top).
 */
export function boardTopTexture(spec: BoardTopSpec): CanvasTexture {
  const scale = 2400; // pixels per metre
  const w = Math.round(spec.width * scale);
  const h = Math.round(spec.depth * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  grain(ctx, w, h, '#a66a34', 7, 260);

  const px = (x: number) => (x / spec.width + 0.5) * w;
  const py = (z: number) => (z / spec.depth + 0.5) * h;

  // Soft darkening towards the edges.
  const edge = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.62);
  edge.addColorStop(0, 'rgba(40, 18, 4, 0)');
  edge.addColorStop(1, 'rgba(40, 18, 4, 0.28)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);

  // Burnt ring round each pit.
  const r = spec.pitRadius * scale;
  for (const pit of spec.pits) {
    const cx = px(pit.x);
    const cy = py(pit.z);
    const ring = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 1.3);
    ring.addColorStop(0, 'rgba(46, 20, 6, 0.6)');
    ring.addColorStop(1, 'rgba(46, 20, 6, 0)');
    ctx.fillStyle = ring;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Zigzag border in the margin, with a fine line inside it.
  const inset = 0.0075 * scale;
  const amp = 0.0032 * scale;
  const period = 0.011 * scale;
  ctx.strokeStyle = 'rgba(48, 22, 6, 0.8)';
  ctx.lineWidth = 2.4;
  ctx.lineJoin = 'round';
  const zigzag = (x0: number, y0: number, x1: number, y1: number) => {
    const length = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(2, Math.round(length / (period / 2)));
    const nx = -(y1 - y0) / length;
    const ny = (x1 - x0) / length;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const side = i % 2 === 0 ? -1 : 1;
      const x = x0 + (x1 - x0) * t + nx * amp * side;
      const y = y0 + (y1 - y0) * t + ny * amp * side;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  const corner = 0.02 * scale;
  zigzag(corner, inset, w - corner, inset);
  zigzag(w - inset, corner, w - inset, h - corner);
  zigzag(w - corner, h - inset, corner, h - inset);
  zigzag(inset, h - corner, inset, corner);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = 'rgba(48, 22, 6, 0.55)';
  const line = 0.0135 * scale;
  ctx.beginPath();
  ctx.roundRect(line, line, w - 2 * line, h - 2 * line, 0.008 * scale);
  ctx.stroke();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  // Extruded caps use the shape's own X/Y (metres) as UVs.
  texture.repeat.set(1 / spec.width, 1 / spec.depth);
  texture.offset.set(0.5, 0.5);
  texture.anisotropy = 4;
  return texture;
}

/** Soft dark blob that grounds an object on the table. */
export function shadowTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // A rounded rectangle blurred by stacking shrinking, faint fills.
  for (let i = 0; i < 24; i++) {
    const m = 6 + i * 2.6;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.035)';
    ctx.beginPath();
    ctx.roundRect(m, m, size - 2 * m, size - 2 * m, 40 - i);
    ctx.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
