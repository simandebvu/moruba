/**
 * Board geometry in board-local metres. Pure maths, no 3D library.
 *
 * Board-local frame: the board lies in the XZ plane, top surface at y = TOP_Y.
 * Player 0 (the human) sits on the +Z side looking towards -Z; player 1 sits
 * opposite. Each player's pits use the engine's indexing from their own seat.
 */

import { columnOf, isInner, type Options, type Player } from '../engine/moruba.js';

export const PITCH = 0.052;
export const PIT_RADIUS = 0.0215;
export const PIT_DEPTH = 0.012;
export const BASE_THICKNESS = 0.008;
export const TOP_Y = BASE_THICKNESS + PIT_DEPTH;
export const MARGIN = 0.016;
export const SEED_RADIUS = 0.0068;
export const SEED_SQUASH = 0.72;
/** Height above the board at which lifted seeds travel. */
export const CARRY_HEIGHT = 0.055;

/** Thickness of the trays that hold captured seeds. */
export const TRAY_THICKNESS = 0.004;
/** Radius of the sphere the pit bowls are cut from. */
export const BOWL_SPHERE_RADIUS =
  (PIT_RADIUS * PIT_RADIUS + PIT_DEPTH * PIT_DEPTH) / (2 * PIT_DEPTH);

export type Vec3 = [number, number, number];

/** Height of the bowl surface above the pit's lowest point, at radius r from its centre. */
export function bowlHeight(r: number): number {
  const R = BOWL_SPHERE_RADIUS;
  return R - Math.sqrt(Math.max(0, R * R - r * r));
}

/** Centre and size of a player's tray for captured seeds, beside the board on their right. */
export function trayRect(
  options: Options,
  player: Player,
): { x: number; z: number; width: number; depth: number } {
  const { width } = boardSize(options);
  const sign = player === 0 ? 1 : -1;
  const spacing = SEED_RADIUS * 2.3;
  const trayWidth = 2 * spacing + SEED_RADIUS * 2 + 0.012;
  const trayDepth = 6 * spacing + SEED_RADIUS * 2 + 0.012;
  return {
    x: sign * (width / 2 + 0.022 + spacing),
    z: sign * (0.012 + 3 * spacing),
    width: trayWidth,
    depth: trayDepth,
  };
}

export function boardSize(options: Options): { width: number; depth: number } {
  return {
    width: options.cols * PITCH + 2 * MARGIN,
    depth: 4 * PITCH + 2 * MARGIN,
  };
}

/** Centre of a pit's floor. */
export function pitCentre(options: Options, player: Player, pit: number): Vec3 {
  const col = columnOf(options, pit);
  const x = (col - (options.cols - 1) / 2) * PITCH;
  const z = (isInner(options, pit) ? 0.5 : 1.5) * PITCH;
  const sign = player === 0 ? 1 : -1;
  return [sign * x, BASE_THICKNESS, sign * z];
}

/** Resting place of the k-th seed in a pit (k from 0), relative to the pit centre. */
export function seedSlot(k: number): Vec3 {
  const layer = Math.floor(k / 7);
  const j = k % 7;
  const y = SEED_RADIUS * SEED_SQUASH + layer * SEED_RADIUS * 1.25;
  if (j === 0) return [0, y, 0];
  const angle = ((j - 1) * Math.PI) / 3 + layer * 0.5;
  const r = PIT_RADIUS * 0.56;
  // The pit is a bowl: seeds away from the middle sit a little higher.
  return [Math.cos(angle) * r, y + bowlHeight(r), Math.sin(angle) * r];
}

/** Resting place of the k-th captured seed in a player's store, beside the board on their right. */
export function storeSlot(options: Options, player: Player, k: number): Vec3 {
  const { width } = boardSize(options);
  const sign = player === 0 ? 1 : -1;
  const perRow = 3;
  const rows = 7;
  const layer = Math.floor(k / (perRow * rows));
  const i = k % (perRow * rows);
  const cx = i % perRow;
  const cz = Math.floor(i / perRow);
  const spacing = SEED_RADIUS * 2.3;
  const x = width / 2 + 0.022 + cx * spacing;
  const z = 0.012 + cz * spacing;
  const y = TRAY_THICKNESS + SEED_RADIUS * SEED_SQUASH + layer * SEED_RADIUS * 1.3;
  return [sign * x, y, sign * z];
}
