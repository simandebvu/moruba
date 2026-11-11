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
}

export interface AiResponse extends SearchResult {
  id: number;
}

self.onmessage = (event: MessageEvent<AiRequest>) => {
  const { id, state, level } = event.data;
  const response: AiResponse = { id, ...searchLevel(state, level) };
  self.postMessage(response);
};
