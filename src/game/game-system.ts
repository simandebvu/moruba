/**
 * The game controller: turns, input, sowing animation and the AI opponent.
 * Rules come from the engine; this file only decides what to show and when.
 */

import {
  createSystem,
  Hovered,
  PokeInteractable,
  Pressed,
  RayInteractable,
  type Entity,
} from '@iwsdk/core';
import type { AiRequest, AiResponse } from '../engine/ai.worker.js';
import {
  bonusOptions,
  CLASSIC,
  legalPits,
  loopSize,
  newGame,
  other,
  outcome,
  QUICK,
  seedsOf,
  sow,
  takeBonus,
  type Move,
  type Options,
  type Player,
  type SowEvent,
  type State,
} from '../engine/moruba.js';
import { searchLevel, type Level } from '../engine/search.js';
import { BoardView } from './board-view.js';
import {
  CARRY_HEIGHT,
  pitCentre,
  seedSlot,
  storeSlot,
  TOP_Y,
  type Vec3,
} from './layout.js';
import { HudButton, Pit } from './pit-component.js';
import { PlacementSystem } from './placement.js';
import { Sounds } from './sounds.js';

type Phase =
  /** Human to choose a pit. */
  | 'human'
  /** Human is holding a pinch on a pit; seeds are lifted. */
  | 'held'
  /** A scripted animation is playing. */
  | 'animating'
  /** Human to choose a bonus pit after a capture. */
  | 'bonus'
  | 'thinking'
  | 'over';

const HUMAN: Player = 0;
const AI: Player = 1;
const LEVELS: Level[] = ['easy', 'medium', 'hard'];
const GOLD = 0xffd23a;
const GREY = 0x9a8f80;
const RED = 0xff6a3d;

interface Step {
  at: number;
  run: () => void;
}

export class GameSystem extends createSystem({
  hoveredPits: { required: [Pit, Hovered] },
  pressedPits: { required: [Pit, Pressed] },
  pressedButtons: { required: [HudButton, Pressed] },
}) {
  private placement!: PlacementSystem;
  private sounds = new Sounds();
  private options: Options = CLASSIC;
  private level: Level = 'medium';
  private state: State = newGame(CLASSIC);
  private phase: Phase = 'human';
  private mover: Player = HUMAN;

  private view!: BoardView;
  private viewEntity!: Entity;
  private entities: Entity[] = [];

  // Which seed (instance id) is where.
  private pitSeeds: [number[][], number[][]] = [[], []];
  private hand: number[] = [];
  private store: [number[], number[]] = [[], []];

  // Seed animation: straight-line tween with a hop.
  private pos!: Float32Array;
  private from!: Float32Array;
  private to!: Float32Array;
  private t0!: Float32Array;
  private dur!: Float32Array;
  private arc!: Float32Array;
  private moving!: Uint8Array;
  private movingCount = 0;

  private clock = 0;
  private steps: Step[] = [];
  private cursor = 0;
  private onScriptEnd: (() => void) | null = null;

  private heldPit = -1;
  private scriptHighlight: { player: Player; pit: number; colour: number } | null =
    null;
  private pointerDown = false;
  private worker: Worker | null = null;
  private requestId = 0;
  private thinkStarted = 0;
  private hudText = '';

  init(): void {
    this.placement = this.world.getSystem(PlacementSystem)!;
    try {
      this.worker = new Worker(
        new URL('../engine/ai.worker.ts', import.meta.url),
        { type: 'module' },
      );
      this.worker.onmessage = (event: MessageEvent<AiResponse>) =>
        this.onAiMove(event.data.id, event.data.move);
      this.worker.onerror = () => {
        this.worker = null;
      };
    } catch {
      this.worker = null;
    }

    const down = () => {
      this.pointerDown = true;
      this.sounds.unlock();
    };
    const up = () => {
      this.pointerDown = false;
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    this.cleanupFuncs.push(
      () => window.removeEventListener('pointerdown', down),
      () => window.removeEventListener('pointerup', up),
      this.queries.pressedPits.subscribe('qualify', (entity) =>
        this.onPitPressed(entity),
      ),
      this.queries.pressedPits.subscribe('disqualify', (entity) =>
        this.onPitReleased(entity),
      ),
      this.queries.pressedButtons.subscribe('qualify', (entity) =>
        this.onButton(String(entity.getValue(HudButton, 'action'))),
      ),
      () => this.worker?.terminate(),
    );

    this.buildBoard();
    this.startGame();
    // Read-only handle for automated checks and debugging.
    (globalThis as { __moruba?: unknown }).__moruba = {
      state: () => this.state,
      phase: () => this.phase,
      hud: () => this.hudText,
    };
  }

  // ---------------------------------------------------------------- set-up

  private buildBoard(): void {
    for (const entity of this.entities) entity.dispose();
    this.entities = [];
    if (this.view) {
      this.viewEntity.dispose();
      this.view.dispose();
    }
    this.view = new BoardView(this.options);
    this.viewEntity = this.world.createTransformEntity(
      this.view.root,
      this.placement.rootEntity,
    );
    for (const target of this.view.pitTargets) {
      const entity = this.world.createTransformEntity(target.mesh, this.viewEntity);
      entity.addComponent(Pit, { player: target.player, index: target.index });
      entity.addComponent(RayInteractable);
      entity.addComponent(PokeInteractable);
      this.entities.push(entity);
    }
    for (const button of this.view.buttons) {
      const entity = this.world.createTransformEntity(button.mesh, this.viewEntity);
      entity.addComponent(HudButton, { action: button.action });
      entity.addComponent(RayInteractable);
      entity.addComponent(PokeInteractable);
      this.entities.push(entity);
    }
    const n = this.view.seedCount;
    this.pos = new Float32Array(n * 3);
    this.from = new Float32Array(n * 3);
    this.to = new Float32Array(n * 3);
    this.t0 = new Float32Array(n);
    this.dur = new Float32Array(n);
    this.arc = new Float32Array(n);
    this.moving = new Uint8Array(n);
    this.updateButtons();
  }

  private updateButtons(): void {
    for (const button of this.view.buttons) {
      switch (button.action) {
        case 'new':
          button.setLabel('New game');
          break;
        case 'size':
          button.setLabel(this.options.cols === 8 ? 'Board: classic' : 'Board: quick');
          break;
        case 'level':
          button.setLabel(`Level: ${this.level}`);
          break;
        case 'move':
          button.setLabel('Move board');
          break;
      }
    }
  }

  private startGame(): void {
    this.requestId += 1; // drop any AI answer still on its way
    this.state = newGame(this.options, HUMAN);
    this.steps = [];
    this.onScriptEnd = null;
    this.scriptHighlight = null;
    this.heldPit = -1;
    this.clock = 0;
    this.cursor = 0;
    this.syncSeeds();
    this.phase = 'human';
    this.mover = HUMAN;
  }

  /** Rebuild every seed's place from the engine state (start of game, or to repair a mismatch). */
  private syncSeeds(): void {
    const n = loopSize(this.options);
    let id = 0;
    this.hand = [];
    this.movingCount = 0;
    this.moving.fill(0);
    for (const player of [0, 1] as const) {
      this.pitSeeds[player] = [];
      for (let pit = 0; pit < n; pit++) {
        const ids: number[] = [];
        for (let k = 0; k < this.state.pits[player][pit]; k++) {
          ids.push(id);
          this.place(id, this.slotIn(player, pit, k));
          id += 1;
        }
        this.pitSeeds[player].push(ids);
      }
    }
    for (const player of [0, 1] as const) {
      this.store[player] = [];
      for (let k = 0; k < this.state.captured[player]; k++) {
        if (id >= this.view.seedCount) break;
        this.store[player].push(id);
        this.place(id, storeSlot(this.options, player, k));
        id += 1;
      }
    }
    this.view.commitSeeds();
  }

  private slotIn(player: Player, pit: number, k: number): Vec3 {
    const c = pitCentre(this.options, player, pit);
    const s = seedSlot(k);
    return [c[0] + s[0], c[1] + s[1], c[2] + s[2]];
  }

  private carrySlot(player: Player, pit: number, k: number): Vec3 {
    const c = pitCentre(this.options, player, pit);
    const s = seedSlot(k);
    return [c[0] + s[0] * 0.8, TOP_Y + CARRY_HEIGHT + s[1], c[2] + s[2] * 0.8];
  }

  // ------------------------------------------------------------ animation

  private place(id: number, p: Vec3): void {
    this.pos[id * 3] = p[0];
    this.pos[id * 3 + 1] = p[1];
    this.pos[id * 3 + 2] = p[2];
    this.view.setSeed(id, p[0], p[1], p[2]);
  }

  private moveSeed(id: number, target: Vec3, duration: number, arc: number): void {
    const i = id * 3;
    this.from[i] = this.pos[i];
    this.from[i + 1] = this.pos[i + 1];
    this.from[i + 2] = this.pos[i + 2];
    this.to[i] = target[0];
    this.to[i + 1] = target[1];
    this.to[i + 2] = target[2];
    this.t0[id] = this.clock;
    this.dur[id] = duration;
    this.arc[id] = arc;
    if (!this.moving[id]) {
      this.moving[id] = 1;
      this.movingCount += 1;
    }
  }

  private updateSeeds(): void {
    if (this.movingCount === 0) return;
    for (let id = 0; id < this.moving.length; id++) {
      if (!this.moving[id]) continue;
      const i = id * 3;
      let t = (this.clock - this.t0[id]) / this.dur[id];
      if (t >= 1) {
        t = 1;
        this.moving[id] = 0;
        this.movingCount -= 1;
      }
      const e = t * t * (3 - 2 * t);
      const x = this.from[i] + (this.to[i] - this.from[i]) * e;
      const z = this.from[i + 2] + (this.to[i + 2] - this.from[i + 2]) * e;
      const y =
        this.from[i + 1] +
        (this.to[i + 1] - this.from[i + 1]) * e +
        this.arc[id] * 4 * t * (1 - t);
      this.pos[i] = x;
      this.pos[i + 1] = y;
      this.pos[i + 2] = z;
      this.view.setSeed(id, x, y, z);
    }
    this.view.commitSeeds();
  }

  /** Queue `run` to happen `gap` seconds after the previously queued step. */
  private queue(gap: number, run: () => void): void {
    this.cursor = Math.max(this.cursor, this.clock) + gap;
    this.steps.push({ at: this.cursor, run });
  }

  private runScript(onEnd: () => void): void {
    this.phase = 'animating';
    this.onScriptEnd = onEnd;
  }

  // ---------------------------------------------------- seed choreography

  private liftPit(player: Player, pit: number): void {
    const ids = this.pitSeeds[player][pit].splice(0);
    this.hand.push(...ids);
    this.hand.forEach((id, k) =>
      this.moveSeed(id, this.carrySlot(player, pit, k), 0.18, 0.004),
    );
    this.sounds.lift();
  }

  private dropInto(player: Player, pit: number): void {
    const id = this.hand.pop();
    if (id === undefined) return;
    const list = this.pitSeeds[player][pit];
    list.push(id);
    this.moveSeed(id, this.slotIn(player, pit, list.length - 1), 0.13, 0.006);
    this.hand.forEach((h, k) =>
      this.moveSeed(h, this.carrySlot(player, pit, k), 0.12, 0),
    );
    this.sounds.clack(list.length);
  }

  private capturePit(by: Player, pit: number): void {
    const ids = this.pitSeeds[other(by)][pit].splice(0);
    ids.forEach((id, k) => {
      const slot = this.store[by].length;
      this.store[by].push(id);
      this.moveSeed(id, storeSlot(this.options, by, slot), 0.5 + k * 0.03, 0.07);
    });
    this.sounds.capture();
  }

  /** Queue the animation for a sow. `skipFirstLift`: the human already lifted the pit. */
  private scriptSow(player: Player, events: SowEvent[], skipFirstLift: boolean): void {
    let drops = 0;
    let first = true;
    for (const event of events) {
      switch (event.type) {
        case 'lift': {
          const skip = first && skipFirstLift;
          first = false;
          if (skip) break;
          this.queue(0.1, () => this.liftPit(player, event.pit));
          this.queue(0.16, () => {});
          break;
        }
        case 'drop': {
          drops += 1;
          // Long relays speed up so nobody waits through fifty hops.
          const gap = drops < 10 ? 0.17 : drops < 28 ? 0.12 : 0.08;
          this.queue(gap, () => this.dropInto(player, event.pit));
          break;
        }
        case 'capture':
          this.queue(0.3, () => {
            this.scriptHighlight = { player, pit: event.at, colour: RED };
            for (const pit of event.pits) this.capturePit(player, pit);
          });
          this.queue(0.7, () => {
            this.scriptHighlight = null;
          });
          break;
        case 'capped':
          this.queue(0.1, () => {
            const last = events.filter((e) => e.type === 'drop').pop();
            if (!last || last.type !== 'drop') return;
            while (this.hand.length > 0) this.dropInto(player, last.pit);
          });
          break;
      }
    }
    this.queue(0.2, () => {});
  }

  /** After any state change: seeds on screen must match the engine. */
  private verify(): void {
    const n = loopSize(this.options);
    for (const player of [0, 1] as const) {
      for (let pit = 0; pit < n; pit++) {
        if (this.pitSeeds[player][pit].length !== this.state.pits[player][pit]) {
          console.error('Moruba: view and engine disagree; resyncing', player, pit);
          this.syncSeeds();
          return;
        }
      }
    }
  }

  // ------------------------------------------------------------ turn flow

  private beginSow(player: Player, pit: number, alreadyLifted: boolean): void {
    const result = sow(this.state, pit);
    this.mover = player;
    this.scriptSow(player, result.events, alreadyLifted);
    this.runScript(() => {
      this.state = result.state;
      this.verify();
      this.afterSow(player);
    });
  }

  private pendingBonus: number[] = [];

  private afterSow(player: Player): void {
    if (this.state.phase !== 'bonus') {
      this.nextTurn();
      return;
    }
    if (player === HUMAN) {
      this.phase = 'bonus';
      return;
    }
    const pit = this.pendingBonus.shift();
    const choice = pit ?? bonusOptions(this.state)[0];
    this.applyBonus(AI, choice);
  }

  private applyBonus(player: Player, pit: number): void {
    const next = takeBonus(this.state, pit);
    const victim = other(player);
    this.queue(0.15, () => {
      this.scriptHighlight = { player: victim, pit, colour: RED };
    });
    this.queue(player === AI ? 0.55 : 0.1, () => this.capturePit(player, pit));
    this.queue(0.7, () => {
      this.scriptHighlight = null;
    });
    this.runScript(() => {
      this.state = next;
      this.verify();
      this.afterSow(player);
    });
  }

  private nextTurn(): void {
    if (outcome(this.state).over) {
      this.phase = 'over';
      this.sounds.gameOver();
      return;
    }
    if (this.state.toMove === HUMAN) {
      this.phase = 'human';
      return;
    }
    this.phase = 'thinking';
    this.thinkStarted = this.clock;
    this.requestId += 1;
    const request: AiRequest = {
      id: this.requestId,
      state: this.state,
      level: this.level,
    };
    if (this.worker) {
      this.worker.postMessage(request);
    } else {
      // No worker available: think on the main thread (may hitch briefly).
      const id = this.requestId;
      const result = searchLevel(this.state, this.level);
      setTimeout(() => this.onAiMove(id, result.move), 0);
    }
  }

  private aiMove: Move | null = null;

  private onAiMove(id: number, move: Move | null): void {
    if (id !== this.requestId || this.phase !== 'thinking') return;
    if (!move) {
      this.nextTurn();
      return;
    }
    // Held until the "thinking" beat has been on screen long enough to read.
    this.aiMove = move;
  }

  private startAiMove(move: Move): void {
    this.pendingBonus = [...move.bonus];
    this.queue(0.05, () => {
      this.scriptHighlight = { player: AI, pit: move.pit, colour: GOLD };
    });
    this.queue(0.6, () => {
      this.scriptHighlight = null;
    });
    this.beginSow(AI, move.pit, false);
  }

  // ---------------------------------------------------------------- input

  private pitOf(entity: Entity): { player: Player; index: number } {
    return {
      player: (entity.getValue(Pit, 'player') ?? 0) as Player,
      index: entity.getValue(Pit, 'index') ?? 0,
    };
  }

  private onPitPressed(entity: Entity): void {
    this.sounds.unlock();
    if (this.placement.busy) return;
    const { player, index } = this.pitOf(entity);
    if (this.phase === 'human' && player === HUMAN) {
      if (!legalPits(this.state).includes(index)) {
        this.sounds.deny();
        return;
      }
      this.phase = 'held';
      this.heldPit = index;
      this.liftPit(HUMAN, index);
    } else if (this.phase === 'bonus' && player === AI) {
      if (!bonusOptions(this.state).includes(index)) {
        this.sounds.deny();
        return;
      }
      this.applyBonus(HUMAN, index);
    }
  }

  private onPitReleased(entity: Entity): void {
    if (this.phase !== 'held') return;
    const { player, index } = this.pitOf(entity);
    if (player !== HUMAN || index !== this.heldPit) return;
    this.heldPit = -1;
    this.beginSow(HUMAN, index, true);
  }

  private onButton(action: string): void {
    this.sounds.unlock();
    // While seeds are moving, a pinch means "faster", not a button press.
    if (this.placement.busy || this.phase === 'animating') return;
    switch (action) {
      case 'new':
        this.startGame();
        break;
      case 'size':
        this.options = this.options.cols === 8 ? QUICK : CLASSIC;
        this.buildBoard();
        this.startGame();
        break;
      case 'level':
        this.level = LEVELS[(LEVELS.indexOf(this.level) + 1) % LEVELS.length];
        this.updateButtons();
        break;
      case 'move':
        this.placement.startPlacing();
        break;
    }
    this.sounds.lift();
  }

  // --------------------------------------------------------------- frame

  update(delta: number): void {
    // Holding a pinch (or the mouse button) fast-forwards the sowing.
    let fast = this.pointerDown;
    if (this.placement.inXR) {
      const xr = this.input.xr;
      fast = xr.getSelectState('left').active || xr.getSelectState('right').active;
    }
    const speed = this.phase === 'animating' && fast ? 4 : 1;
    this.clock += Math.min(delta, 0.1) * speed;

    while (this.steps.length > 0 && this.steps[0].at <= this.clock) {
      this.steps.shift()!.run();
    }
    this.updateSeeds();
    if (
      this.phase === 'animating' &&
      this.steps.length === 0 &&
      this.movingCount === 0
    ) {
      const done = this.onScriptEnd;
      this.onScriptEnd = null;
      done?.();
    }
    if (
      this.phase === 'thinking' &&
      this.aiMove &&
      this.clock - this.thinkStarted > 0.7
    ) {
      const move = this.aiMove;
      this.aiMove = null;
      this.startAiMove(move);
    }

    this.updateHover();
    this.updateHud();
  }

  private updateHover(): void {
    if (this.scriptHighlight) {
      const h = this.scriptHighlight;
      this.view.showHighlight(h.player, h.pit, h.colour);
      this.view.hideLabel();
      return;
    }
    let shown = false;
    if (!this.placement.busy) {
      for (const entity of this.queries.hoveredPits.entities) {
        const { player, index } = this.pitOf(entity);
        const count =
          this.phase === 'held' && player === HUMAN && index === this.heldPit
            ? this.hand.length
            : this.pitSeeds[player][index].length;
        const actionable =
          (this.phase === 'human' &&
            player === HUMAN &&
            legalPits(this.state).includes(index)) ||
          (this.phase === 'held' && player === HUMAN && index === this.heldPit) ||
          (this.phase === 'bonus' && player === AI && count > 0);
        this.view.showHighlight(
          player,
          index,
          actionable ? (this.phase === 'bonus' ? RED : GOLD) : GREY,
        );
        this.view.showLabel(player, index, count);
        shown = true;
        break;
      }
    }
    if (!shown) {
      this.view.hideHighlight();
      this.view.hideLabel();
    }
  }

  private updateHud(): void {
    let line1: string;
    if (this.placement.placing) {
      line1 = 'Point at your table and pinch to set the board down';
    } else {
      switch (this.phase) {
        case 'human':
          line1 = 'Your turn: pinch one of your pits';
          break;
        case 'held':
          line1 = 'Let go to sow';
          break;
        case 'animating':
          line1 =
            this.mover === HUMAN
              ? 'Sowing… hold a pinch to speed up'
              : 'Moruba sows… hold a pinch to speed up';
          break;
        case 'bonus':
          line1 = 'Capture! Pinch any one of their pits to take it too';
          break;
        case 'thinking':
          line1 = 'Moruba is thinking…';
          break;
        case 'over': {
          const o = outcome(this.state);
          line1 = !o.over
            ? ''
            : o.winner === null
              ? 'A draw. Pinch New game'
              : o.winner === HUMAN
                ? 'You win! Pinch New game'
                : 'Moruba wins. Pinch New game';
          break;
        }
      }
    }
    const line2 = `Seeds: you ${seedsOf(this.state, HUMAN)} · Moruba ${seedsOf(
      this.state,
      AI,
    )}     Captured: you ${this.state.captured[HUMAN]} · Moruba ${this.state.captured[AI]}`;
    const text = `${line1}\n${line2}`;
    if (text !== this.hudText) {
      this.hudText = text;
      this.view.setHud(text);
    }
  }
}
