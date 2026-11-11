# Moruba rules (the version we build)

## Background
**Moruba** (Sepedi; also spelled Maruba) is a four-row mancala game traditionally played by the Pedi in Limpopo and Mpumalanga, South Africa: originally a men's game played in holes dug in the earth with pebbles or morula pips, spread by mine workers to Gauteng, and now played by men and women. It is part of South Africa's indigenous-games programme (CSIR/SASC since 2003, with tournaments in Polokwane and Tzaneen). The Venda play a near-identical game, **Mefuvha** ("foggy rain"); in Mozambique the Tonga/Chopi play **Tchouba**. (Isafuba is listed under Zimbabwe; Bao la Kiswahili is a different, East African family.)

## Ruleset
- **Board:** 4 rows × 8 pits (classic) or 4 × 6 (quick game). Each player owns the two rows nearest them (inner + outer), a 16-pit (or 12-pit) loop.
- **Setup:** 2 seeds in every pit (64 on 4×8).
- **Move:** choose one of your pits holding **≥2 seeds**; lift all its seeds and sow one per pit **counter-clockwise around your own loop only**.
- **Relay sowing:** if the last seed lands in an **occupied** pit, lift that pit's whole contents (including the seed just sown) and continue sowing from the next pit. The move ends ("sleeps") when the last seed lands in an **empty** pit.
- **Capture:** if the move ends in an empty pit in **your inner row**, and the opponent's facing **inner** pit is occupied, capture that pit's seeds **and** the seeds in the opponent's **outer** pit in the same column. Then capture the contents of **one other opponent pit of your choice**. Captured seeds leave the board. **The move ends after a capture** (no continued sowing).
  - Option (setting): two bonus pits instead of one (the competition rule on large boards).
- **Singletons:** a pit with exactly 1 seed may be played only if you have **no pit with ≥2 seeds**, and only if the next pit is **empty** (the seed moves one pit).
- **End:** a player who has no legal move on their turn **loses**.
- **Safety caps (engine):** if a single move sows **1,000 seeds**, it ends where it is (no capture). After **150 moves** in total, the player with more seeds on their side wins (equal = draw).
- Who moves first: the human, unless they choose otherwise.

## Engine notes
- Represent each side as a 16-length array in sowing order (inner row and outer row joined in a loop), plus a column map to find "facing" pits. Unit-test: simple sow, wrap-around, multi-lap relay, capture with/without outer seeds, capture blocked when facing inner pit is empty, bonus pit choice, singleton legality, no-move loss, both caps.
- Branching factor ≤16 (up to ~16 more for the bonus choice). AI: alpha-beta 2/4/6 ply + quiescence on captures; evaluation = seed difference, mobility (pits ≥2), exposure of own inner-row pits.

## Words (show with English glosses; have a Sepedi speaker check before shipping)
- *mekoti*: holes, pits
- *mathlapa*: stones (also glossed "cattle")
- *tlaba*: "kill / stab", the inner-row capture
- *tlola*: the outer-row capture
- (*tinkhomo* "cows" and *kulala* "to sleep" appear in sources but look Xitsonga rather than Sepedi; Sepedi "to sleep" is *go robala*. Avoid until checked.)

## Sources
- Mancala World: https://mancala.fandom.com/wiki/Moruba (also Moruba (Deutsch), Mefuvha, Tchouba, Tsoro, Names)
- Ludii: https://ludii.games/details.php?keyword=Moruba (and Mefuvha, Tsoro)
- Behind those (not read directly): Wagner 1917, *Trans. Royal Society of South Africa* 6(1):47–68; Stayt 1931, *The BaVenda*; Malesa 2012, MA thesis, University of Limpopo; SRSA *Indigenous Games Rule Book* (2006).
- Conflicts noted: Ludii/Malesa use 4×12 with 4 seeds and "most captured seeds wins"; English vs German Mancala World disagree on draws by repetition; Mefuvha has an uneven start and a fixed opening, Moruba has none.
