# ChargeTrek

A browser game in which you schedule the home charging of one electric vehicle (EV) with vehicle-to-grid (V2G):
every 15 minutes between arrival and departure you charge, stay idle, or discharge (sell energy back to the grid),
under uncertain electricity prices. You must leave with exactly the target state of charge (SoC), at the lowest cost.

**Game design by Houalef et al.; this is an independent browser version.** It is not the authors' release and
uses none of their code or data.

> Houalef A-R, Mendoza JE, Delavernhe F, Senouci S-M (2026). ChargeTrek: A gamified visual learning framework for
> EV charging in V2G systems. *Applied Energy* 414:127853. <https://doi.org/10.1016/j.apenergy.2026.127853>
> (open access, CC BY 4.0). The authors' code: <https://github.com/houaleframzi/ChargeTrek>.

Open `index.html` in a browser (no build step, no libraries; only the Google Fonts stylesheet is fetched).

## Rules as implemented

- **Grid** (paper, Section 3.1): time runs left to right in 15-minute columns from arrival to departure; SoC runs
  from 0 % (bottom) to 100 % (top) in 1 % rows. The car is the black square; the target at departure is the
  yellow cell. Charging moves the car up and right, discharging down and right, idling right. Your path is drawn
  in navy.
- **Colours**: each column shows the day-ahead price forecast, min-max scaled over the window: red channel = price,
  green = 255 - red (green cheap, red expensive). Once a step's real-time price is known, the blue channel shows
  the sign of the forecast error (blue = real price above forecast) and the opacity drops with its size.
- **Information**: you see the whole day-ahead forecast, and the real-time price of the current and past steps.
  A price strip under the grid shows both curves.
- **Battery** (Section 3.3): 75 kWh, so 1 % = 0.75 kWh; efficiency 0.8 both ways. Charging adds 2 % per step below
  80 % SoC and 1 % per step from 80 %; discharging removes 2 % per step. SoC is saturated to [20 %, 100 %].
  Grid energy: a charge of $\Delta$ % draws $0.75\,\Delta/0.8$ kWh; a discharge of $\Delta$ % exports $0.75\,\Delta \times 0.8$ kWh.
- **Cost**: each step costs real-time price $\times$ energy drawn, or earns real-time price $\times$ energy exported.
  The score is the net cost (negative = profit). A money bar next to the grid shows it: cost upward in red,
  revenue downward in green, centred at zero.
- **Reward** of the paper, shown alongside (Eqs. 3 to 6): $-\Delta m_t / p_{\max}$ per step, $-10$ when an action
  makes the target unreachable, $+10$ at departure if the SoC equals the target exactly.
- **End**: the episode ends at departure. The page then reports the SoC gap, the net cost, the gain over charging
  immediately (Eq. 11) and, when the target is met, the normalised score of Section 5.2 (0 = charge immediately,
  1 = optimum).
- **References for the same level**: charge immediately (the "typical human" rule of Eq. 1), stepwise replanning
  (Section 4.2.2: at each step, a shortest path using the real price now and forecasts afterwards), and the optimum
  with perfect information (Section 4.2.3), computed by dynamic programming over the time-SoC grid. Their net costs
  are listed under "References on this instance", with the colour of their paths: optimum `#0072B2`, charge
  immediately `#E69F00`, stepwise replanning `#CC79A7`. "Show references" (`O`) draws their paths on the grid, at
  any time, also before departure (the owner's choice for class use: nothing asks for confirmation).
- **Replays**: "Watch replays" (`W`) opens the replay bar under the status line, at any time. "Watch:" picks your
  game (the steps played so far), the optimum, charging immediately or stepwise replanning; the bar steps through
  it 15 minutes at a time: the path on the grid up to the step, the car, the money bar, the real-time prices
  revealed up to the step (grid colours and price strip), and the running line "Step k of n · time · state of
  charge · net cost so far · reward". Each replay re-steps the recorded action sequence through the engine
  (`Replay` in `engine.js`), so its last step equals the values of the stats grids. Changing the "Watch:" item keeps
  the step, to compare two schedules at the same time. Closing the bar returns to the game as it was.
- **Levels**: 15 drivers (Table 1 of the paper: arrival, departure, initial and target SoC) times 30 synthetic days.
  A level is fully determined by (driver, day).

## Controls

| Key | Action |
| --- | --- |
| `Up` or `C` | charge |
| `Right`, `Space` or `I` | idle |
| `Down` or `D` | discharge |
| `Z` or `Backspace` | undo |
| `R` | restart |
| `N` / `P` (`Enter` after departure) | next / previous day |
| `W` | watch replays: open or close the replay bar |
| `O` | show or hide references |

While the replay bar is open, keys act on the replay only: `Space` or `K` play / pause, `Left` / `Right` one step
back / forward (with `Shift`: 10 steps), `Home` / `End` start / end, `Up` / `Down` previous / next item in
"Watch:", `-` / `+` slower / faster, `Esc` or `W` close.

Buttons do the same for touch screens. The outlined cells one column ahead show where each action leads; a red
outline means the target could no longer be met.

## Assumptions and deviations from the paper

1. **Synthetic prices** (Section 3.2). The paper uses CAISO day-ahead (hourly) and real-time (15-minute) locational
   marginal prices, 1 January to 19 May 2025, mapped to retail-equivalent dollars per kWh by an unspecified scaling. These
   data are not shipped. `priceDay(day)` generates instead, from a seeded generator: an hourly day-ahead curve in
   dollars per kWh with a base level, a morning bump, a midday solar dip that can go below zero, and an evening peak (lower on
   weekend days, `day mod 7` in {5, 6}); real-time prices = day-ahead + AR(1) error (larger around the evening peak)
   + rare spikes (2 % of steps) and drops (1 %). Over days 1-30 about 6 % of real-time prices are negative.
   Prices of an overnight window come from `day` and `day + 1`, so all drivers of a day see the same clock prices.
2. **Which price is paid and when it is known** (Sections 3.2, 4.2.2). Steps are settled at the real-time price.
   The real-time price of the current step is known before deciding, as in the paper's stepwise planner ("the
   corrected real price for the current step"); later steps show only the forecast.
3. **Steps stop at the target** (Section 3.3 and Eq. 5). With 2 % steps, an exact target of odd parity (e.g.
   50 % to 65 %) would need costly round trips; the paper does not say how this is handled. Here a charge or
   discharge step that would pass the target stops at it (with the energy of the partial step). Moving away from
   the target is unrestricted.
4. **Charging taper** (Section 3.3). The paper's rate "progressively decreases to about half" above 80 %; here it
   is a flat 1 % per step from 80 %, chosen by the SoC at the start of the step (so 79 % charges to 81 %).
5. **Discharging floor** (Section 3.3). Discharging is 2 % per step and saturates at 20 %; the paper's 1 % rate
   below 20 % never applies because SoC cannot go below 20 % (all Table 1 SoCs are at least 20 %). Charging at
   100 % or discharging at 20 % does nothing (no energy, no cost).
6. **Grid width** (Section 3.1). The paper's grid always spans the next 24 hours (96 columns); here it spans the
   plug-in window (plus a departure column), so that short windows (1.5 h for driver 7) stay playable.
7. **Colour and bar scales** (Section 3.1). Not given in the paper: forecast min-max is over the plug-in window
   (paper: next 24 hours); blue = 255 when the real price exceeds the forecast, 0 otherwise; opacity
   $= 1 - 0.7\min(1, |\text{error}|/0.05)$; the money bar's half-height is 1.2 times the largest absolute net cost
   among the player and the three references. The grid is drawn on white in both themes.
8. **Arrival and departure noise** (Section 5.1). The $\pm 30$-minute perturbation is an independent uniform shift of
   $-2..2$ steps for arrival and for departure, seeded by (driver, day); an arrival at 00:00 is not moved before
   midnight. When the target cannot be reached in the window, the window is lengthened to the minimum needed and
   the page says so. This happens on 29 of 30 days for driver 10 (20 % to 90 % takes 10 h, Table 1 gives 9 h) and
   on some days for drivers 7, 9, 13, 14 and 15.
9. **Feasibility penalty** (Eq. 4). Applied once, on the action that turns a reachable target into an unreachable
   one, not again on later actions. $p_{\max}$ of Eq. (3) is the largest forecast price in the window.
10. **Charge-immediately rule** (Eq. 1). Eq. (1) discharges whenever $S_t \geq S^{goal}$, which would oscillate
    around the target; here the rule idles once at the target (and still discharges at once when arriving above it).
11. **Optimum** (Section 4.2.3). Backward dynamic programming on the time-SoC graph instead of Bellman-Ford; both give
    the same shortest path because the graph is acyclic in time. The SoC grid is the game's own integer grid, so
    no extra discretisation is involved. Ties are broken idle, then charge, then discharge.
12. **Not implemented**: the learning agents (C51, imitation-based C51, DAgger) and hybrid policies of Sections 4.3
    and 4.4, the relaxed optimum mentioned in Section 5.2, and the image observation used to train agents.
13. **Undo** is offered for human play. It lets a player see real prices and go back, so the result line says when
    undo was used.

## Files

| File | What |
| --- | --- |
| `index.html`, `ui.js` | Page and user interface (canvas drawing, keyboard and button input, replay bar). Layout, names, keys and colours follow the conventions shared by the games on the site |
| `engine.js` | Rules engine: seeded prices and levels, battery dynamics, game, step-by-step replay, reference policies, scores. UMD module (browser global `ChargeTrek`, or `require` from node) |
| `test/engine_test.js` | Node tests of the engine |
| `test/ui_test.js` | Node test of the page and `ui.js` with a stub DOM |

Tests: `node test/engine_test.js && node test/ui_test.js` (node 22). The engine test checks determinism under a seed, SoC bounds under random play on
300 levels, the battery steps, the departure requirement and penalty, cost against a recomputation from the
action history, a hand-checked 4-step episode, and that the dynamic program meets the target, is never worse than
charging immediately or stepwise replanning, matches exhaustive search on short random levels, and that a
`Replay` matches a game replayed to each step and ends on the final scores. The UI test checks the page layout and
ids (`watch`, `refs`, `msg`, the replay bar), the exact button labels, the keys `W` and `O` before departure
without confirmation, that game keys do not touch the game while the replay bar is open and that closing it
restores the game, play / pause, speed, scrubber, and that each of the four replays ends on the values of the
stats grids.
