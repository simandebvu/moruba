# Headset check

The check now guides you from inside the headset and sends its results to the
Mac by itself. You do not need to read this file while wearing the headset.

## Before you put the headset on (once)

1. Mark your table: Settings → Physical Space → Space Setup, add the table as furniture.
2. Turn on hand tracking: Settings → Movement Tracking → Hand Tracking.
3. Quest on the same Wi-Fi as the Mac. The Mac must be awake with `npm run dev` running.
4. Sit at the table. Put the controllers away, out of the headset's view.

## Part 1: guided check (about 3 minutes)

1. In the Quest Browser open `https://<mac-address>:8081/?check`
   (`npm run dev:status` prints the address). On the warning page choose
   **Advanced → Proceed**.
2. Pinch **Enter mixed reality** and allow the permission prompts.
3. Follow the panel in front of you. Each step passes with a chime or moves on
   by itself after a few seconds; there is nothing to press.
4. At the end it asks you to reload the page and enter again once, to check
   that the cube returns.

## Part 2: the game (about 5 minutes)

1. Open the same address without `?check` and enter mixed reality.
2. The board should appear in front of you. **Move board** lets you point at
   the table and pinch to set it down.
3. Play a few turns: pinch or touch one of your pits, let go to sow.

## Results

Results are written on the Mac to `.tmp/device-report.jsonl` (not committed).
The only thing to say afterwards is anything that looked or felt wrong, and
whether a Quest recording (Meta button → Camera → Record video) shows the real
room behind the game or black.
