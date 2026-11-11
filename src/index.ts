import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { GameSystem } from './game/game-system.js';
import { PlacementSystem } from './game/placement.js';
import { PanelSystem } from './panel.js';
import { installErrorReporting } from './report.js';
import { SpikeSystem } from './spike.js';

installErrorReporting();

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(PanelSystem);
  // "?check" opens the device-check scene (DEVICE-CHECK.md) instead of the game.
  if (new URLSearchParams(location.search).has('check')) {
    world.registerSystem(SpikeSystem);
  } else {
    world.registerSystem(PlacementSystem);
    world.registerSystem(GameSystem);
  }
});
