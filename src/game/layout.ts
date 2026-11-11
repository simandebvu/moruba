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

export type Vec3 = [number, number, number];

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
  return [Math.cos(angle) * r, y, Math.sin(angle) * r];
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
  const y = SEED_RADIUS * SEED_SQUASH + layer * SEED_RADIUS * 1.3;
  return [sign * x, y, sign * z];
}
