/**
 * The game controller: turns, input, sowing animation and the AI opponent.
 * Rules come from the engine; this file only decides what to show and when.
 */

import {
  createSystem,
  Hovered,
  Pressed,
  RayInteractable,
  Vector3,
  type Entity,
  type PlaneGeometry,
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
import { pinchPoint } from './hands.js';
import { LESSON, LESSON_BONUS, LESSON_END, lessonState } from './lesson.js';
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
import { report } from '../report.js';
import { Sounds } from './sounds.js';
import { VirtualRoom } from './virtual-room.js';

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
  /** Lesson: the player is reading; a pinch anywhere continues. */
  | 'reading'
  | 'over';

const HUMAN: Player = 0;
const AI: Player = 1;
const LEVELS: Level[] = ['easy', 'medium', 'hard'];
const GREEN = 0x9be28a;
const TAUGHT_KEY = 'moruba_taught';
const ROOM_KEY = 'moruba_room';
const LESSON_KEY = 'moruba_lesson_done';

function readFlag(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeFlag(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; harmless.
  }
}
const GOLD = 0xffd23a;
const GREY = 0x9a8f80;
const RED = 0xff6a3d;
const WHITE = 0xffffff;
const SIDES = ['right', 'left'] as const;
/** Pinch this close (metres, across the board) to a pit's centre to choose it. */
const PIT_REACH = 0.034;
/** Let go within this distance of the lifted pit to play it; farther away cancels. */
const KEEP_REACH = 0.075;

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
  private hudEntity!: Entity;
  private room = new VirtualRoom();
  /** In the headset: show the virtual table and room instead of the real one. */
  private virtualRoom = readFlag(ROOM_KEY) === 'virtual';
  private rootWorld = new Vector3();

  // "Teach me": tips on the panel and a suggested pit. On for a first game.
  private teach = readFlag(TAUGHT_KEY) !== '1';
  private teachEnds = false;
  private tip = '';
  private hintPit = -1;
  private hintId = 0;

  // "How to play": -1 when off, else the stage (LESSON.length = closing card).
  private lesson = -1;
  private lessonBody = '';
  /** Board size to go back to when the lesson ends. */
  private lessonReturn: Options | null = null;
  private readSince = 0;
  /** A mouse press arrived this frame (the browser's "pinch anywhere"). */
  private tapped = false;

  // Direct hand play (headset, hands): the pit or button at the pinch point.
  // Codes: -1 nothing, player * 100 + pit, or 1000 + button number.
  private pinch = new Vector3();
  private local = new Vector3();
  private nearHistory = {
    left: new Int16Array(8).fill(-1),
    right: new Int16Array(8).fill(-1),
  };
  private nearFrame = 0;
  private directHover = -1;
  private heldSide: 'left' | 'right' | null = null;
  /** Pit centres in board space: x, z per pit, the human's pits first. */
  private centres = new Float32Array(0);

  // Preview of the move under the hand: where it ends and what it captures.
  private previewPit = -1;
  private previewState: State | null = null;
  private previewText = '';
  /** Dev notes: the last phase reported, and when the AI was asked. */
  private reportedPhase = '';
  private askedAt = 0;

  init(): void {
    this.placement = this.world.getSystem(PlacementSystem)!;
    try {
      this.worker = new Worker(
        new URL('../engine/ai.worker.ts', import.meta.url),
        { type: 'module' },
      );
      this.worker.onmessage = (event: MessageEvent<AiResponse>) => {
        if (event.data.purpose === 'hint') {
          this.onHint(event.data.id, event.data.move);
        } else {
          this.onAiMove(event.data.id, event.data.move);
        }
      };
      this.worker.onerror = () => {
        this.worker = null;
      };
    } catch {
      this.worker = null;
    }

    const down = () => {
      this.pointerDown = true;
      this.tapped = true;
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
      this.queries.pressedButtons.subscribe('qualify', (entity) => {
        if (!this.direct) this.onButton(String(entity.getValue(HudButton, 'action')));
      }),
      () => this.worker?.terminate(),
    );

    this.world.createTransformEntity(this.room.group, this.placement.rootEntity);
    this.buildBoard();
    // First visit: learn the game before playing it.
    if (readFlag(LESSON_KEY) === '1') this.startGame();
    else this.startLesson();
    // Read-only handle for automated checks and debugging.
    (globalThis as { __moruba?: unknown }).__moruba = {
      state: () => this.state,
      phase: () => this.phase,
      hud: () => this.hudText,
      lesson: () => this.lesson,
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
      this.entities.push(entity);
    }
    this.hudEntity = this.world.createTransformEntity(
      this.view.hudGroup,
      this.viewEntity,
    );
    this.entities.push(this.hudEntity);
    for (const button of this.view.buttons) {
      const entity = this.world.createTransformEntity(button.mesh, this.hudEntity);
      entity.addComponent(HudButton, { action: button.action });
      entity.addComponent(RayInteractable);
      this.entities.push(entity);
    }
    const pits = loopSize(this.options);
    this.centres = new Float32Array(pits * 4);
    for (const player of [0, 1] as const) {
      for (let pit = 0; pit < pits; pit++) {
        const c = pitCentre(this.options, player, pit);
        this.centres[(player * pits + pit) * 2] = c[0];
        this.centres[(player * pits + pit) * 2 + 1] = c[2];
      }
    }
    this.previewState = null;
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
          button.setLabel(this.lesson >= 0 ? 'Skip lesson' : 'New game');
          break;
        case 'size':
          button.setLabel(this.options.cols === 8 ? 'Board: classic' : 'Board: quick');
          break;
        case 'level':
          button.setLabel(`Level: ${this.level}`);
          break;
        case 'teach':
          button.setLabel(this.lesson >= 0 ? 'Start again' : 'How to play');
          break;
        case 'room':
          button.setLabel(this.virtualRoom ? 'Room: virtual' : 'Room: yours');
          break;
        case 'move':
          button.setLabel(this.virtualRoom ? 'Re-centre' : 'Move board');
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
    if (this.teachEnds) {
      this.teachEnds = false;
      this.teach = false;
      this.updateButtons();
    }
    this.tip = this.teach
      ? 'You own the two rows nearest you. Pinch a pit with 2 or more seeds; the green ring is a good one.'
      : '';
    this.requestHint();
  }

  // ---------------------------------------------------------------- lesson

  private startLesson(): void {
    if (this.lesson < 0) this.lessonReturn = this.options;
    if (this.options !== QUICK) {
      this.options = QUICK;
      this.buildBoard();
    }
    this.loadStage(0);
    this.updateButtons();
  }

  private loadStage(index: number): void {
    const stage = LESSON[index];
    this.lesson = index;
    this.requestId += 1; // drop any AI answer or hint still on its way
    this.hintId += 1;
    this.aiMove = null;
    this.state = lessonState(stage);
    this.steps = [];
    this.onScriptEnd = null;
    this.scriptHighlight = null;
    this.heldPit = -1;
    this.clock = 0;
    this.cursor = 0;
    this.syncSeeds();
    this.phase = 'human';
    this.mover = HUMAN;
    this.hintPit = stage.pit;
    this.lessonBody = stage.ask;
    report('lesson-stage', { stage: index });
  }

  /** The move of a lesson stage has played out: let the player read about it. */
  private lessonRead(): void {
    this.phase = 'reading';
    this.readSince = this.clock;
    if (this.lesson < LESSON.length) this.lessonBody = LESSON[this.lesson].after;
  }

  private lessonNext(): void {
    if (this.lesson >= LESSON.length) {
      this.finishLesson();
    } else if (this.lesson + 1 < LESSON.length) {
      this.loadStage(this.lesson + 1);
    } else {
      this.lesson = LESSON.length;
      this.lessonBody = LESSON_END.body;
      this.readSince = this.clock;
    }
    this.sounds.lift();
  }

  private finishLesson(): void {
    this.lesson = -1;
    writeFlag(LESSON_KEY, '1');
    report('lesson-finished');
    const back = this.lessonReturn ?? this.options;
    this.lessonReturn = null;
    if (back !== this.options) {
      this.options = back;
      this.buildBoard();
    }
    this.startGame();
    this.updateButtons();
  }

  // -------------------------------------------------------------- teaching

  /** Ask for a suggested pit for the human (shown as a green ring). */
  private requestHint(): void {
    this.hintPit = -1;
    this.hintId += 1;
    if (!this.teach || this.phase !== 'human') return;
    const request: AiRequest = {
      id: this.hintId,
      state: this.state,
      level: 'medium',
      purpose: 'hint',
    };
    if (this.worker) {
      this.worker.postMessage(request);
    } else {
      this.hintPit = legalPits(this.state)[0] ?? -1;
    }
  }

  private onHint(id: number, move: Move | null): void {
    if (id !== this.hintId || this.phase !== 'human' || !move) return;
    this.hintPit = move.pit;
  }

  /** The fullest opponent pit: the obvious bonus pick. */
  private bestBonus(): number {
    let best = -1;
    let most = 0;
    const pits = this.state.pits[AI];
    for (let i = 0; i < pits.length; i++) {
      if (pits[i] > most) {
        most = pits[i];
        best = i;
      }
    }
    return best;
  }

  private sowTip(player: Player, events: SowEvent[], captured: boolean): string {
    const lifts = events.filter((e) => e.type === 'lift').length;
    if (player === HUMAN) {
      if (captured) {
        return 'Your last seed fell in an empty pit of your inner row, facing their seeds: you capture that pit and the one behind it.';
      }
      if (lifts > 1) {
        return 'When your last seed lands in a pit that has seeds, you scoop them all up and keep sowing. An empty pit ends the move.';
      }
      return 'Your last seed fell in an empty pit, so the move ends there.';
    }
    return captured
      ? 'Moruba ended in its empty inner pit facing your seeds, so it captures. Keep your inner row guarded or empty.'
      : 'Moruba plays the far two rows by the same rules.';
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
          if (id >= this.view.seedCount) break;
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
    // Lesson positions use fewer seeds than the board holds: park the rest out of sight.
    for (; id < this.view.seedCount; id++) this.place(id, [0, -50, 0]);
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
    report('sow', { player, pit, lesson: this.lesson, move: this.state.moveCount });
    this.hintPit = -1;
    if (this.teach) this.tip = this.sowTip(player, result.events, result.captured);
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
      if (this.lesson >= 0) this.lessonBody = LESSON_BONUS;
      if (this.teach) {
        this.tip = 'A capture also wins you any one other pit of theirs. The green ring marks their fullest.';
      }
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
    if (this.lesson >= 0) {
      this.lessonRead();
      return;
    }
    if (outcome(this.state).over) {
      this.phase = 'over';
      this.sounds.gameOver();
      if (this.teach) {
        this.tip = 'A player with no move left loses. That was your first game: Teach me turns off for the next one.';
        this.teachEnds = true;
        writeFlag(TAUGHT_KEY, '1');
      }
      return;
    }
    if (this.state.toMove === HUMAN) {
      this.phase = 'human';
      if (this.teach && this.state.moveCount > 1) {
        this.tip = 'Try to end in an empty pit of your inner row, opposite their seeds. Point at any pit to count it.';
      }
      this.requestHint();
      return;
    }
    this.phase = 'thinking';
    this.thinkStarted = this.clock;
    this.askedAt = performance.now();
    this.requestId += 1;
    const request: AiRequest = {
      id: this.requestId,
      state: this.state,
      level: this.level,
      purpose: 'move',
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
    report('ai-answer', { ms: Math.round(performance.now() - this.askedAt), worker: this.worker !== null });
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

  /**
   * In the headset with hands, pits and buttons answer to a pinch made right
   * at them (see `updateDirect`), not to the pointing ray: a ray pinch from a
   * distance and a brushing fingertip both chose things by accident.
   */
  private get direct(): boolean {
    if (!this.placement.inXR) return false;
    const xr = this.input.xr;
    return xr.isPrimary('hand', 'left') || xr.isPrimary('hand', 'right');
  }

  private onPitPressed(entity: Entity): void {
    if (this.direct) return;
    const { player, index } = this.pitOf(entity);
    this.pressPit(player, index);
  }

  private pressPit(player: Player, index: number): void {
    this.sounds.unlock();
    if (this.placement.busy) return;
    if (this.phase === 'human' && player === HUMAN) {
      const lessonPit = this.lesson >= 0 && this.lesson < LESSON.length ? LESSON[this.lesson].pit : index;
      if (index !== lessonPit || !legalPits(this.state).includes(index)) {
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
    if (this.direct || this.phase !== 'held') return;
    const { player, index } = this.pitOf(entity);
    if (player !== HUMAN || index !== this.heldPit) return;
    this.heldPit = -1;
    this.beginSow(HUMAN, index, true);
  }

  /** Put the lifted seeds back: the player changed their mind. */
  private cancelHold(): void {
    const pit = this.heldPit;
    this.heldPit = -1;
    this.heldSide = null;
    if (pit < 0) return;
    const list = this.pitSeeds[HUMAN][pit];
    for (const id of this.hand.splice(0)) {
      list.push(id);
      this.moveSeed(id, this.slotIn(HUMAN, pit, list.length - 1), 0.15, 0.003);
    }
    this.phase = 'human';
    this.sounds.lift();
  }

  /** The pit or button at a world point, as a code (see `directHover`). */
  private targetAt(point: Vector3): number {
    const buttons = this.view.buttons;
    for (let i = 0; i < buttons.length; i++) {
      const mesh = buttons[i].mesh;
      mesh.worldToLocal(this.local.copy(point));
      const size = (mesh.geometry as PlaneGeometry).parameters;
      if (
        Math.abs(this.local.x) < size.width / 2 + 0.004 &&
        Math.abs(this.local.y) < size.height / 2 + 0.004 &&
        Math.abs(this.local.z) < 0.04
      ) {
        return 1000 + i;
      }
    }
    this.view.root.worldToLocal(this.local.copy(point));
    if (this.local.y < TOP_Y - 0.03 || this.local.y > TOP_Y + 0.11) return -1;
    const pits = this.centres.length / 4;
    let best = -1;
    let nearest = PIT_REACH * PIT_REACH;
    for (let i = 0; i < pits * 2; i++) {
      const dx = this.centres[i * 2] - this.local.x;
      const dz = this.centres[i * 2 + 1] - this.local.z;
      const d = dx * dx + dz * dz;
      if (d < nearest) {
        nearest = d;
        best = i;
      }
    }
    if (best < 0) return -1;
    return best < pits ? best : 100 + (best - pits);
  }

  private updateDirect(): void {
    const xr = this.input.xr;
    this.directHover = -1;
    this.nearFrame = (this.nearFrame + 1) % 8;
    for (const side of SIDES) {
      const tracked = pinchPoint(this, side, this.pinch);
      const now = tracked ? this.targetAt(this.pinch) : -1;
      const history = this.nearHistory[side];
      // Closing the fingers drags the pinch point: trust where it was a few
      // frames earlier.
      const before = history[(this.nearFrame + 3) % 8];
      history[this.nearFrame] = now;
      const select = xr.getSelectState(side);
      if (select.start && !this.placement.busy) {
        const code = before >= 0 ? before : now;
        if (code >= 1000) {
          this.onButton(this.view.buttons[code - 1000].action);
        } else if (code >= 0) {
          this.pressPit(code >= 100 ? AI : HUMAN, code % 100);
          if (this.phase === 'held') this.heldSide = side;
        }
      }
      if (this.phase === 'held' && this.heldSide === side && !select.active) {
        // Let go over the pit: play it. Let go elsewhere (or hand lost): put back.
        let keep = false;
        if (tracked && this.heldPit >= 0) {
          this.view.root.worldToLocal(this.local.copy(this.pinch));
          keep =
            Math.hypot(
              this.centres[this.heldPit * 2] - this.local.x,
              this.centres[this.heldPit * 2 + 1] - this.local.z,
            ) < KEEP_REACH;
        }
        if (keep) {
          const pit = this.heldPit;
          this.heldPit = -1;
          this.heldSide = null;
          this.beginSow(HUMAN, pit, true);
        } else {
          this.cancelHold();
        }
      }
      if (now >= 0 && this.directHover < 0) this.directHover = now;
    }
    const buttons = this.view.buttons;
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].mesh.scale.setScalar(this.directHover === 1000 + i ? 1.12 : 1);
    }
  }

  /** Ring where the move from `pit` would end and what it would capture (-1 clears). */
  private setPreview(pit: number): void {
    if (pit === this.previewPit && this.state === this.previewState) return;
    this.previewPit = pit;
    this.previewState = this.state;
    if (pit < 0) {
      this.previewText = '';
      this.view.showMarks();
      return;
    }
    const result = sow(this.state, pit);
    let end = pit;
    let seeds = 0;
    const marks: { player: Player; pit: number; colour: number }[] = [];
    for (const event of result.events) {
      if (event.type === 'drop') end = event.pit;
      if (event.type === 'capture') {
        for (const taken of event.pits) {
          seeds += this.state.pits[AI][taken];
          marks.push({ player: AI, pit: taken, colour: RED });
        }
      }
    }
    marks.unshift({ player: HUMAN, pit: end, colour: WHITE });
    this.view.showMarks(marks);
    this.previewText =
      seeds > 0
        ? `This move captures ${seeds} seeds, plus a pit you choose`
        : 'This move ends in the white ring: no capture';
  }

  private onButton(action: string): void {
    this.sounds.unlock();
    // While seeds are moving, a pinch means "faster", not a button press.
    if (this.placement.busy || this.phase === 'animating') return;
    // A button press is not "pinch anywhere to continue".
    this.readSince = this.clock;
    if (this.lesson >= 0 && (action === 'size' || action === 'level')) {
      this.sounds.deny();
      return;
    }
    switch (action) {
      case 'new':
        if (this.lesson >= 0) this.finishLesson();
        else this.startGame();
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
      case 'teach':
        // The lesson, then tips again through the next game.
        this.teach = true;
        this.teachEnds = false;
        this.startLesson();
        break;
      case 'room':
        this.virtualRoom = !this.virtualRoom;
        writeFlag(ROOM_KEY, this.virtualRoom ? 'virtual' : 'real');
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
    // The virtual room always shows in the browser; in the headset it is a choice.
    this.placement.virtual = this.virtualRoom;
    const showRoom = this.virtualRoom || !this.placement.inXR;
    this.room.group.visible = showRoom;
    if (showRoom) {
      this.placement.root.getWorldPosition(this.rootWorld);
      this.room.setFloorDrop(this.rootWorld.y);
    }

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

    if (this.direct) this.updateDirect();
    else this.directHover = -1;

    if (this.phase === 'reading' && !this.placement.busy) {
      let tap = this.tapped;
      if (this.placement.inXR) {
        const xr = this.input.xr;
        tap = xr.getSelectState('left').start || xr.getSelectState('right').start;
      }
      if (tap && this.clock - this.readSince > 0.8) this.lessonNext();
    }
    this.tapped = false;

    if (this.phase !== this.reportedPhase) {
      this.reportedPhase = this.phase;
      report('phase', { phase: this.phase, lesson: this.lesson });
    }

    this.updateHover();
    this.updateHud();
  }

  private updateHover(): void {
    if (this.scriptHighlight) {
      const h = this.scriptHighlight;
      this.view.showHighlight(h.player, h.pit, h.colour);
      this.view.hideLabel();
      this.setPreview(-1);
      return;
    }
    // The pit under the hand: at the pinch point (hands) or under the ray (mouse, controller).
    let player: Player = HUMAN;
    let index = -1;
    if (!this.placement.busy) {
      if (this.direct) {
        if (this.directHover >= 0 && this.directHover < 1000) {
          player = this.directHover >= 100 ? AI : HUMAN;
          index = this.directHover % 100;
        }
      } else {
        for (const entity of this.queries.hoveredPits.entities) {
          ({ player, index } = this.pitOf(entity));
          break;
        }
      }
    }
    let shown = false;
    let preview = this.phase === 'held' ? this.heldPit : -1;
    if (index >= 0) {
      const count =
        this.phase === 'held' && player === HUMAN && index === this.heldPit
          ? this.hand.length
          : this.pitSeeds[player][index].length;
      const playable =
        this.phase === 'human' && player === HUMAN && legalPits(this.state).includes(index);
      const actionable =
        playable ||
        (this.phase === 'held' && player === HUMAN && index === this.heldPit) ||
        (this.phase === 'bonus' && player === AI && count > 0);
      this.view.showHighlight(
        player,
        index,
        actionable ? (this.phase === 'bonus' ? RED : GOLD) : GREY,
      );
      this.view.showLabel(player, index, count);
      shown = true;
      if (playable) preview = index;
    }
    this.setPreview(preview);
    if (!shown) {
      this.view.hideLabel();
      // Teach me and the lesson: ring the suggested pit while nothing else is pointed at.
      const guide = this.teach || this.lesson >= 0;
      if (guide && !this.placement.busy && this.phase === 'human' && this.hintPit >= 0) {
        this.view.showHighlight(HUMAN, this.hintPit, GREEN);
      } else if (guide && !this.placement.busy && this.phase === 'bonus' && this.bestBonus() >= 0) {
        this.view.showHighlight(AI, this.bestBonus(), GREEN);
      } else {
        this.view.hideHighlight();
      }
    }
  }

  private updateLessonCard(): void {
    const total = LESSON.length + 1;
    const closing = this.lesson >= LESSON.length;
    const pinch = this.placement.inXR ? 'Pinch' : 'Click';
    let todo: string;
    if (this.placement.placing) {
      todo = 'Touch your table where the board should sit, then pinch';
    } else {
      switch (this.phase) {
        case 'human':
          todo = `${pinch} the glowing pit`;
          break;
        case 'held':
          todo = this.direct ? 'Let go to play it · move away to cancel' : 'Let go to sow';
          break;
        case 'bonus':
          todo = `${pinch} one of their pits`;
          break;
        case 'reading':
          todo = closing
            ? `${pinch} anywhere to start a real game`
            : `${pinch} anywhere to continue`;
          break;
        default:
          todo = 'Watch the seeds…';
      }
    }
    const title = closing ? LESSON_END.title : LESSON[this.lesson].title;
    const text = `lesson\nHow to play · ${Math.min(this.lesson + 1, total)} of ${total}\n${title}\n${this.lessonBody}\n${todo}`;
    if (text !== this.hudText) {
      this.hudText = text;
      this.view.setLesson(text.slice(text.indexOf('\n') + 1));
    }
  }

  private updateHud(): void {
    if (this.lesson >= 0) {
      this.updateLessonCard();
      return;
    }
    if (this.hudText.startsWith('lesson\n')) this.view.setLesson(null);
    let line1: string;
    if (this.placement.placing) {
      line1 = 'Touch your table where the board should sit, then pinch';
    } else {
      switch (this.phase) {
        case 'human':
          line1 = this.previewText || 'Your turn: pinch one of your pits';
          break;
        case 'held':
          line1 = this.direct ? 'Let go to play it · move your hand away to cancel' : 'Let go to sow';
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
        case 'reading':
          line1 = '';
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
    const text = `${line1}\n${line2}\n${this.teach || this.teachEnds ? this.tip : ''}`;
    if (text !== this.hudText) {
      this.hudText = text;
      this.view.setHud(text);
    }
  }
}
