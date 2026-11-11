# Moruba: build plan (Meta VR Start Developer Competition 2026)

**Deadline:** Tue 18 Nov 2026, 12:00 PT = **22:00 SAST**. Entry: Gaming track, **New Experience** division.
**Pitch:** *Moruba, South Africa's four-row seed-sowing game, on your real table.* Pinch a pit, scoop the seeds, watch them sow round the board with a wooden clack. One game in 5–8 minutes, seated, hands only.

## What judges score (25% each) and how we answer it
| Criterion | Our answer |
|---|---|
| Innovation & creativity | An indigenous Southern African strategy game (part of SA's official indigenous-games programme) rebuilt hands-first in mixed reality; not another shooter or puzzle clone. |
| Experience design | Seated by nature; the board finds and sits on **your** table (passthrough is purposeful: the room sets where and how big the board is); a "Teach me" first game; one game per sitting = daily habit. |
| Technical implementation | IWSDK hand interactions, plane detection + hit-test placement, persistent anchor (board returns to your table), alpha-beta AI in a Web Worker, steady 72 fps on Quest 3/3S. |
| Polish & presentation | Carved-wood board, instanced morula-pip seeds, real clack/sow audio, short film made with the same pipeline as Rotapot. |

## The game (one coherent ruleset, from Mancala World + Ludii; sources in RULES.md)
- **Board:** 4 rows × 8 pits. Each player owns their inner + outer row (a 16-pit loop). **Quick game:** 4 × 6.
- **Start:** 2 seeds per pit.
- **Move:** take all seeds from one of your pits holding ≥2; sow one per pit **counter-clockwise round your own 16 pits**.
- **Relay:** last seed lands in an occupied pit → lift that pit and keep sowing. Ends when the last seed lands in an empty pit.
- **Capture:** if that empty pit is in your inner row and the opponent's facing inner pit is occupied, take it **and** their outer pit in that column, plus **one** opponent pit of your choice. Captured seeds leave the board. The move ends.
- **Singletons:** a 1-seed pit can only be played if you have no pit with ≥2, and only into an empty next pit.
- **End:** a player with no legal move loses. Safety caps: 1,000 seeds per move (move ends), 150 moves (most seeds wins).
- Terms (shown with glosses, checked by a Sepedi speaker if we can find one): *mekoti* (pits), *mathlapa* (stones), *tlaba* (inner capture).

## Interaction (hands only, controllers never needed)
1. **Place:** on entering, Moruba looks for a horizontal plane at table height (0.6–0.95 m) or a `table`-labelled mesh, and offers to drop the board there; or you **pinch on any surface** (hit-test) to place it. The board scales to fit the table and is saved with a persistent anchor.
2. **Choose:** point at one of your pits → it glows and shows its count; opponent pits show counts on hover.
3. **Scoop:** **pinch** a pit → its seeds lift into a cluster above your hand.
4. **Sow:** release → seeds hop pit to pit (relay laps included) with a clack each; hold a pinch to fast-forward.
5. **Capture:** captured seeds fly to your side; you **pinch the bonus pit** you want to take.
6. **Menus:** a small wrist/palm menu (new game, quick/classic, difficulty, teach me, sound). Everything within a narrow field of view, all within two feet.

## Tech
- **IWSDK** (`npm create @iwsdk@latest`; Vite + TypeScript + three.js + ECS), AR session with hand tracking, plane detection, hit test, anchors. No physics.
- **Rules engine:** pure TypeScript, no 3D, fully unit-tested (sowing, relay, capture, singletons, caps, end).
- **AI:** alpha-beta (Easy 2 ply / Medium 4 / Hard 6 + capture quiescence) in a Web Worker so the headset never stutters.
- **Testing:** IWSDK's emulator (IWER) driven by Playwright for automated hand-input checks; **you** on a real Quest for 10 minutes a day.
- **Hosting:** public GitHub repo + Vercel (https URL for the submission).
- **Performance budget:** 72 fps; seeds instanced (one draw call), baked lighting on the board, no post-processing.

## Schedule
| Day | Date | Goal | Done when |
|---|---|---|---|
| 0 | Wed 11 | You: apply to Meta Start, join the hackathon. Me: scaffold, rules engine + tests | Engine passes tests; empty AR scene runs in emulator |
| 1 | Thu 12 | **Device spike (go/no-go):** AR + hands + plane detection + anchor on your Quest; test that Quest's recorder captures passthrough | You confirm in the headset; we know video capture works |
| 2 | Fri 13 | Board on your table, pinch-to-pick, sowing animation, AI opponent | A full game is playable in the headset |
| 3 | Sat 14 | Captures + bonus pick, Teach me first game, wrist menu, quick/classic | A first-timer can finish a game unaided |
| 4 | Sun 15 | Art + audio pass: wood board, pips, clacks, ambient; 72 fps on device | Feels like an object on your table |
| 5 | Mon 16 | Bug bash, rooms we didn't test (fallback hit-test), persistence, onboarding copy | No blockers; second person plays it |
| 6 | Tue 17 | Film: headset capture + HyperFrames edit; Devpost text | Video under 3 min, public on YouTube |
| 7 | Wed 18 | Buffer; submit by **18:00 SAST** (4-hour margin) | Submitted |

The Rotapot deadline (Thu 12, 22:00) doesn't clash: Rotapot is done.

## Who does what
- **Me:** plan, code, tests, AI, deploys, film edit. Delegates: `fast-worker` for engine tests and boilerplate, `deep-reasoner` for the AI and tricky rules, subagents for parallel scene work.
- **You:** Meta Start membership + Meta developer account; ~10 minutes a day in the headset with notes ("pinch misses the far pits", "board too low"); recording headset footage on day 6; the Devpost form; one person to play-test on day 5.

## Risks and fall-backs
| Risk | Fall-back |
|---|---|
| Start membership not approved in time | Apply today; meanwhile everything else proceeds. Ask support on day 2 if not approved. |
| IWSDK is a release candidate; APIs shift | Pin the version on day 0; drop to raw WebXR + three.js for any piece that misbehaves. |
| Table not detected (no Space Setup, odd room) | Pinch-to-place on any surface via hit-test; last resort: place in front of you at a fixed height. |
| Quest recorder doesn't capture passthrough in the browser | MQDH capture or scrcpy into OBS; worst case the emulator for gameplay shots (allowed by the rules). |
| Pinch precision on small pits | Bigger pits, sticky hover highlight, pinch selects the hovered pit not the exact fingertip spot. |
| Judges favour polished native Unity entries | Lean on originality, a tight 5-minute loop, and a strong film; don't over-scope. |

## Device: Quest 2 (decided 11 Nov)
- Develop and test on the user's **Quest 2**; judges likely use Quest 3/3S, so the target is "runs at 72 fps on Quest 2 → smooth everywhere".
- Quest 2 passthrough is greyscale and low-res; the game must still read well (high-contrast board and seeds, warm lighting on our objects).
- No automatic room scan on Quest 2: the user marks the table once in Space Setup; pinch-to-place (hit-test) is the default fall-back for everyone.
- Add a **"virtual table" mode** (board on a rendered wooden table in a warm room) for headsets/rooms without usable passthrough; also gives clean film shots.
- **Film:** try to borrow a Quest 3 on Mon 17 Nov for colour mixed-reality footage; fall-back is Quest 2 hand footage + IWER emulator wide shots (allowed by the rules).
- Day-1 spike adds: does Quest 2's recorder capture passthrough in a Quest Browser AR session?

## Out of scope (unless we're ahead)
Online multiplayer, two players on one board, 4×12 board, custom scoop gesture from raw joints, eye-gaze (Quest 3/3S have no eye tracking).
