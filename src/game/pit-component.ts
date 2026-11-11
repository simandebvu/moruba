import { createComponent, Types } from '@iwsdk/core';

/** Marks the invisible touch target over one pit of the board. */
export const Pit = createComponent('Pit', {
  player: { type: Types.Int8, default: 0 },
  index: { type: Types.Int8, default: 0 },
});

/** Marks a pressable HUD button; `action` names what it does. */
export const HudButton = createComponent('HudButton', {
  action: { type: Types.String, default: '' },
});
