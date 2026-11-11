# Moruba

South Africa's four-row seed-sowing game (Sepedi), on your real table, played with your hands in mixed reality. Built with the Immersive Web SDK (WebXR) for Meta Quest.

Work in progress for the Meta VR Start Developer Competition 2026.

## Develop

```sh
npm install
npm run dev        # IWSDK dev server (https, with the XR emulator)
npm test           # rules engine and AI unit tests
npm run typecheck
npm run build
```

- `src/engine/moruba.ts`: the rules, pure TypeScript (see `RULES.md` for the ruleset and sources)
- `src/engine/search.ts`, `src/engine/ai.worker.ts`: alpha-beta AI, run in a Web Worker
- `src/game/`: the mixed-reality game (board, seeds, hand input, placement on your table)
- `src/spike.ts`: device check scene at `/?check` (hands, table detection, pinch placement, persistent anchor)

## Licence

MIT
