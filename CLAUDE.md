# Moruba: project context (handoff, 2026-11-11)

Read this, then `PLAN.md` (schedule, scope, risks) and `RULES.md` (game rules + sources). Nothing is built yet: this folder holds only these three files.

## The goal
A hands-first mixed-reality version of **Moruba** (South Africa's Sepedi four-row seed-sowing game) for the **Meta VR Start Developer Competition 2026** (https://start-developer-competition-26.devpost.com).
- **Deadline: Tue 18 Nov 2026, 12:00 PT = 22:00 SAST.** Target submission: **18:00 SAST** that day. Judging is on the build *as it stands at the deadline*; it must stay online through ~9 Dec (winners ~11 Dec).
- **Entry:** Gaming track, **New Experience** division (must be built after 24 Sep 2026; nothing pre-existing), solo, build path **IWSDK (WebXR)**.
- **Prizes:** $100k winner / $50k runner-up per track+division, plus special awards. ~5,800 participants.

## Status (done on 11 Nov, each with the user's explicit approval)
- Meta developer team **"Simakk"** created (developer NDA accepted).
- **Meta Start program application submitted** (country South Africa, tool WebXR). Approval ~24 h; Start membership is **required by submission time**. If no approval by Fri 14 Nov, help the user file a support ticket.
- **Devpost registration done** (solo, with the Meta Start email; Meta marketing emails left OFF). The Devpost *project* is not created yet (do that near the end).
- Research done (below). `PLAN.md` written and approved in outline.

## Hard requirements (from the official rules page)
- **Hands-first:** fully usable end-to-end with hands; controllers optional. Must never need a controller.
- Policy compliance (Meta developer policies, content guidelines).
- Design guidelines: **seated** (works within a 2-foot radius), **fast in/out** (satisfying session in ≤10 min, clean pause/resume), **original, not a wrapper**.
- Submit: (1) playable build — for IWSDK a **public URL** (GitHub Pages / Vercel); (2) a **public YouTube/Vimeo video < 3 min** of footage on a Meta device or XR simulator/emulator; (3) the Devpost form (name, ≤140-char tagline, track, division, ≤500-word description, how hands are implemented, target launch date).
- **Judging, 25% each:** Innovation & creativity (use Meta device capabilities: hands, passthrough, scene understanding, anchors; drive repeat use) · Experience design (seated, hands-first, intuitive onboarding, habit-forming; **passthrough must be purposeful**: the real room changes the experience; FoV-aware UI) · Technical implementation (**≥60 fps on Quest**, bug-free, hand tracking/passthrough/anchoring; hold up in rooms never tested) · Polish & presentation (UI/UX, art, sound, video).

## The user and how to work with them
- Shingirayi, South Africa (SAST, UTC+2). Solo. Prefers that Claude builds; the user supplies accounts, approvals and **headset testing**.
- Device: **Meta Quest 2 only.** Implications: greyscale low-res passthrough; no automatic room scan (user marks the table manually in Space Setup: Settings → Physical Space → Space Setup); weakest GPU, so target 72 fps on Quest 2; **no eye tracking** (drop gaze ideas). Judges likely use Quest 3/3S.
- Claude cannot wear the headset. Plan ~10-min daily device checks by the user, each with a short checklist and a link.
- Orchestrator workflow from the user's global CLAUDE.md applies: plan first, delegate (deep-reasoner / fast-worker), keep context lean, report faithfully.
- Ask before: accepting any terms, submitting forms, publishing, deploying to anything public, purchases. Never type passwords; the user signs in themselves.
- Lessons from the previous project (Rotapot, PayPal hackathon, `~/Code/bheja`): verify a build completed before swapping it into production (a deploy once went live broken because a failed `&&` chain didn't abort); check a save actually persisted on Devpost (the first save silently failed); Chrome-extension file uploads cap at 10 MB, so the user drags large videos into YouTube.

## Decided design (details in PLAN.md)
- Pitch: *Moruba, South Africa's four-row seed-sowing game, on your real table.* One game in 5–8 min.
- Rules: 4×8 classic + 4×6 quick; 2 seeds per pit; sow counter-clockwise round your own 16 pits; relay sowing; inner-row capture of the facing inner+outer pits **plus one opponent pit of your choice**; move ends after capture; singleton rule; no legal move = loss; caps of 1,000 seeds per move and 150 moves. See RULES.md.
- Interaction: board placed on a detected table plane (horizontal, 0.6–0.95 m, or `table`-labelled mesh) **or pinch-to-place via hit-test** (default fallback, essential on Quest 2); point at a pit to highlight + show count; **pinch a pit to scoop**, release to sow (seeds hop with a clack; hold pinch to fast-forward); pinch the bonus pit on capture; small wrist/palm menu. Persistent anchor brings the board back to the same table.
- Also a **"virtual table" mode** (rendered wooden table + warm room) for headsets/rooms without usable passthrough and for clean film shots.
- AI: alpha-beta in a **Web Worker** (Easy 2 ply / Medium 4 / Hard 6 + capture quiescence); eval = seed difference, mobility (pits ≥2), inner-row exposure. "Teach me" first game.
- Out of scope unless ahead: online multiplayer, 4×12 board, custom scoop gesture from raw joints, gaze.

## Tech research (verified 2026-11-11; sources in the links)
- **IWSDK** `@iwsdk/core` **1.1.0-rc.2** (release candidate, 2026-10-23): pin the version on day 0. `npm create @iwsdk@latest` → choose TS, **AR**, features (hand tracking, hit test, plane detection, anchors, scene understanding, grabbing; physics off). Generates Vite + TypeScript + `super-three` (three.js fork) + `elics` ECS + UIKit/UIKitML. Docs: https://iwsdk.dev (guides 01 setup, 02 testing, 11 scene understanding, 12 physics, 14 environment raycast; concepts/xr-input, spatial-ui).
- Run: `npm run dev`; `npx @iwsdk/cli dev status` prints the URL (port varies). Dev server is HTTPS with a self-signed cert. On Quest: same Wi-Fi → open `https://<mac-ip>:<port>` in Quest Browser, accept the cert; or USB port-forward via `chrome://inspect`.
- **Emulator IWER** (injected on localhost): `dev.emulator.device` (e.g. `metaQuest3`), hands/controllers toggle, synthetic rooms (`kitchen`, `bedroom`) that report planes/meshes. **Headless automation:** `iwsdk xr enter`, `xr_set_input_mode(mode="hand")`, `iwsdk xr run-sequence` (scripted pinch/carry/release), `iwsdk browser screenshot`, `iwsdk ecs diff`; own Playwright scripts via `--allow-browser-automation` + `npx @iwsdk/cli browser run script.mjs` (https://iwsdk.dev/ai/workflows.html).
- Hands: `RayInteractable`, `PokeInteractable`, `Interactable` with `Hovered`/`Pressed`/`Grabbed`; `OneHandGrabbable`, `DistanceGrabbable`, `GrabSystem`; pinch-to-grab on by default. Hand visuals `XRHandVisualAdapter`/`AnimatedHand`. Joint poses for custom gestures: not documented; use raw WebXR `frame.getJointPose` if needed.
- MR: `SessionMode.ImmersiveAR` + `SceneUnderstandingSystem` (`XRPlane` with `orientation`, `XRMesh` with `semanticLabel` e.g. `table`); `EnvironmentRaycastSystem` + `EnvironmentRaycastTarget` (hit test); `XRAnchor` component auto-persists (`requestPersistentHandle` / `restorePersistentAnchor`, same device). Quest Browser: max **8 persistent anchors per site**; planes come from Space Setup; wait 2–3 s before `initiateRoomCapture` and call it at most once; an opaque clear colour hides passthrough. No MRUK equivalent: pick the table plane yourself.
- UI: UIKit/UIKitML (`UIKitDocument`, MSDF text). Audio: `AudioSource`/`AudioSystem` exported (positional; no guide). Performance: `updateTargetFrameRate()`; instance the seeds (one draw call), baked lighting, no post-processing.
- Recording: Quest record/cast (Meta button → Camera → Record) — **unverified whether it captures passthrough in a Quest Browser AR session; test on day 1.** Fallbacks: MQDH capture, scrcpy → OBS, emulator footage (allowed).

## Tools already on this machine
- Playwright with a cached Chromium: executablePath `~/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing` (a Playwright install lives in the Rotapot session's scratchpad; reinstall `playwright` locally if needed and pass that executablePath).
- **Film pipeline** (from Rotapot): HyperFrames project at `~/Code/rotapot-video/film-v2` (HTML+GSAP → MP4; `tools/build.mjs` generates the timeline and captions from HeyGen word timings). HeyGen CLI `heygen` is authenticated; narrator voice **"Zanele"** voice_id `RfBNjzs9Q1oMw84LzeNn` (`heygen voice speech create --voice-id … --text …` returns audio + word timestamps). Load the `hyperframes` skill before editing films.
- Chrome automation (Claude in Chrome) works with the user's signed-in Devpost/YouTube/Meta accounts; Devpost and the Meta site block plain web fetches, so read them in Chrome.
- GitHub CLI `gh` is authenticated as `simandebvu`.

## Status (end of day 0, 11 Nov)
- Scaffolded with `@iwsdk/create` 1.1.0-rc.2 (TS, AR; `@iwsdk/core` pinned exact). `@meta-quest/metavr` was **removed** from devDependencies (it collects usage data under a Meta SDK licence; ask the user before adding it back). Local git repo on `main`; **no GitHub repo and no public deploy yet (both need the user's OK)**.
- `src/engine/moruba.ts` rules engine + `search.ts` AI + `ai.worker.ts`; `npm test` = 83 passing tests (engine expectations were derived by hand from RULES.md by a separate agent). Interpretation choices are listed in the test report: cap drops in-hand seeds where it stops; no-moves is checked before the move limit; move-limit winner = more seeds on the board.
- `src/spike.ts` = day-1 device check scene (status board, pinch-to-place cube via hit-test, anchor restore). Verified in the IWER emulator with simulated hands, including restore after reload. `DEVICE-CHECK.md` is the user's checklist.
- IWSDK anchor model (read from the SDK source): `SceneUnderstandingSystem` keeps **one** persistent anchor per site (uuid in localStorage `iwsdk_scene_anchor_uuid`) and re-parents every `XRAnchor` entity under one anchored group. It does **not** save per-entity poses: we store the board's local pose in that group ourselves (see `spike.ts`).
- Hands: use `this.input.xr.getSelectState('left'|'right')` for pinch edges (hand sources may have no gamepad) and `isPrimary('hand', side)`.
- Emulator loop: `npx @iwsdk/cli dev up` → `xr enter` → `xr set-input-mode --input-json '{"mode":"hand"}'` → `xr select --input-json '{"device":"hand-right"}'` → `browser screenshot --output-file …`.
- AI timing on the Mac (classic board, no time limit): medium ~18 ms avg; hard ~280 ms avg, worst 5.9 s. Time limits cap it (hard 2.5 s), but Quest 2 is far slower: consider a transposition table before shipping Hard.

## Status (day-2 slice built early, evening 11 Nov; emulator-verified only, not yet on a headset)
- Public repo: https://github.com/simandebvu/moruba (this repo's git author is the GitHub no-reply address; keep the user's email out of committed files).
- **Playable game** at the root URL: `src/game/` = `layout.ts` (board maths), `board-view.ts` (procedural board, instanced seeds, HUD + 4 buttons drawn on canvas textures), `game-system.ts` (turn flow, sow/capture animation from engine events, AI via worker, hover ring + count), `placement.ts` (board pose: restore from anchor, else in front of the player snapped to a table plane; "Move board" = follows the hit-test ray, pinch to set down), `sounds.ts` (synthesised placeholder clacks). The device-check scene is now at **`/?check`**.
- Pits and buttons carry both `RayInteractable` (point + pinch, mouse in the browser) and `PokeInteractable` (fingertip touch). Press = lift, release = sow. Holding a pinch during sowing fast-forwards ×4 (buttons are ignored while seeds move).
- **SDK gotcha (fixed in `placement.ts` and `spike.ts`):** `EnvironmentRaycastTarget` binds its hit-test source to the input source present when requested; after a controller↔hand switch it returns nothing. Remove and re-add the component when `input.xr.getPrimaryInputSource(side)` changes.
- System method names `play`/`stop` are taken by the ECS base class; don't reuse them.
- Emulator testing notes: screenshots are 800 px wide but the canvas is 1200 px (multiply click coordinates by 1.5); `xr list-targets` lists `pit-<player>-<index>` and `button-<action>`; press buttons with a run-sequence `press` step; aim a hand ray with `xr set-transform` + euler `orientation`.
- Added later on 11 Nov: **Teach me** (on for a first game, flag `moruba_taught` in localStorage; tips on the HUD's third line, green ring on a suggested pit via a worker `purpose: 'hint'` request, fullest pit suggested for the bonus pick) and **virtual-table mode** (`virtual-room.ts`: table, floor, gradient dome; always on in the browser, `Room` button toggles it in the headset, flag `moruba_room`). HUD is now a tilted group entity with six buttons: new, size, level, teach, room, move.
- Art pass (procedural, no asset files; `textures.ts`): board top texture drawn in board coordinates (grain, burnt ring per pit, zigzag border), bevelled plate with separate side material, instanced bowl pits with baked shading, pip-shaped seeds with per-seed size/turn, capture trays, contact shadow. Virtual room now moves the board to table height in front of the player (`placement.virtual`; the saved real-room pose is untouched) and "Move board" becomes "Re-centre" there.
- AI speed-up (transposition table + best-first ordering; a test checks scores against plain minimax): on the Mac, medium ~9 ms avg, hard ~38 ms avg / 1.2 s worst with no time limit (was 279 ms / 5.9 s). 84 tests.
- Not done yet: wrist menu (HUD buttons stand in), recorded audio, board scaling to the table, public deploy (user said: after the headset check), per-frame string building in `updateHud` (tidy before the perf pass).

## Immediate next steps (the list below was day 0; 1, 2 and the emulator half of 3 are done)
1. Scaffold with `npm create @iwsdk@latest` (TS, AR, features above), pin `@iwsdk/core`, init git, create a public GitHub repo `simandebvu/moruba` (ask before creating), add an MIT license.
2. Write the **rules engine** as pure TypeScript (no 3D) with thorough unit tests from RULES.md, then the AI worker.
3. Get an empty AR scene + hands running in the emulator; deploy a preview URL (ask before the first public deploy).
4. Prepare the **day-1 device checklist** for the user: open URL in Quest Browser → enter AR → hands visible → table plane detected (after Space Setup) → place a test cube with pinch → reload and check the anchor persists → try Quest recording and see if passthrough is captured. This is the go/no-go.

## IWSDK scaffold guidance (generated by the scaffolder; read before touching src/, public/scenes, public/ui)
@AGENTS.md
