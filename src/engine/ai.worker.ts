/// <reference lib="webworker" />
/**
 * Web Worker wrapper round the search. Start it with:
 *   new Worker(new URL('./engine/ai.worker.ts', import.meta.url), { type: 'module' })
 */

import type { State } from './moruba.js';
import { searchLevel, type Level, type SearchResult } from './search.js';

export interface AiRequest {
  id: number;
  state: State;
  level: Level;
  /** 'move' = the opponent's reply; 'hint' = a suggestion for the human (never blunders). */
  purpose: 'move' | 'hint';
}

export interface AiResponse extends SearchResult {
  id: number;
  purpose: 'move' | 'hint';
}

self.onmessage = (event: MessageEvent<AiRequest>) => {
  const { id, state, level, purpose } = event.data;
  const overrides = purpose === 'hint' ? { blunder: 0, timeMs: 400 } : {};
  const response: AiResponse = {
    id,
    purpose,
    ...searchLevel(state, level, overrides),
  };
  self.postMessage(response);
};
