# Day-1 headset check (Thu 12 Nov, about 10 minutes)

This is the go/no-go for the whole plan: it tells us whether hands, table detection, pinch placement, a persistent anchor and video capture all work on your Quest 2. Just note yes/no per step and anything odd.

## Before you put the headset on
1. **Mark your table** (once): Settings → Physical Space → Space Setup → set up the room and add your table as furniture. Skip if already done.
2. Make sure **hand tracking** is on: Settings → Movement Tracking → Hand Tracking.
3. Mac and Quest on the **same Wi-Fi**. Tell Claude you're ready so the dev server is running, and get the current link (it looks like `https://192.168.1.109:8081/`; the number can change).
4. Sit at the table, controllers put away.

## In the headset
| # | Do this | Expect | Yes / no / notes |
|---|---|---|---|
| 1 | Open **Browser**, type the link. On the "connection is not private" page choose **Advanced → Proceed**. | A dark page with a "Moruba" panel. | |
| 2 | Pinch **Enter mixed reality** (allow the permission prompts: hands, room/spatial data). | You see your real room (grey on Quest 2) and a small "Moruba device check" board floating in front of you. | |
| 3 | Hold both hands up. | Hand models follow your hands. Board line **Hands** shows `L yes R yes`. | |
| 4 | Look at the table. | A wireframe outline on the table. Board line **Table** shows at least `1 plane` or `1 mesh`. | |
| 5 | Point a hand at the table top. | A yellow ring slides over the table under your pointing ray. **Surface under ray** says `yes`. | |
| 6 | **Pinch** (thumb + index) while the ring is on the table. | An orange 6 cm cube appears where the ring was, sitting on the table (not floating, not sunk). **Anchor** says `saved (persistent)`. | |
| 7 | Lean and move your head around the cube. | The cube stays put on the table. | |
| 8 | Read the last line of the board. | **72 fps** or close (tick at 70+). | |
| 9 | Press the Meta button, go back to the browser and **reload the page**, then enter mixed reality again. | The cube comes back **at the same spot** on the table. **Anchor** says `RESTORED from last session`. | |
| 10 | Start a recording: Meta button → Camera → **Record video**. Go back into the scene, wave at the cube for 10 seconds, stop the recording. Watch it in Files/Gallery. | Does the video show **your real room** behind the cube, or black? | |

## Also tell me
- Did step 4 work without Space Setup, or only after it?
- How far from the cube's real spot was it after the reload (step 9), roughly in cm?
- Was the pinch comfortable to aim at the table 40–60 cm in front of you? Any mis-fires?
- Any stutter, or the browser asking for anything unexpected.

## If something fails
- Page won't load: check the Wi-Fi, and that the address starts with `https://`.
- No "Enter mixed reality" button, or it does nothing: tell me exactly what you see.
- No ring on the table (step 5): that is hit-testing; note it and try pointing at the floor too.
- Any failure is useful: each one has a fall-back in PLAN.md, and we choose it tomorrow.
