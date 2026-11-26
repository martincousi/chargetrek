// Tests of the ChargeTrek rules engine. Run: node test/engine_test.js
"use strict";
const assert = require("assert");
const path = require("path");
const E = require(path.resolve(__dirname, "..", "engine.js"));

const DAYS = 20;
const allLevels = [];
for (let u = 1; u <= 15; u++) for (let d = 1; d <= DAYS; d++) allLevels.push(E.makeLevel(u, d));

let failed = 0;
function test(name, fn) {
  try { fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, "\n    ", e.message); }
}
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

// Independent recomputation of the cost from the SoC path: energy drawn = dSoC * 0.75 / 0.8 kWh when charging,
// energy sold = dSoC * 0.75 * 0.8 kWh when discharging, settled at the real-time price of the step.
function recomputeCost(level, socPath) {
  let c = 0;
  for (let t = 0; t + 1 < socPath.length; t++) {
    const ds = socPath[t + 1] - socPath[t];
    c += level.real[t] * (ds > 0 ? ds * 0.75 / 0.8 : ds * 0.75 * 0.8);
  }
  return c;
}

test("determinism: same driver and day give the same level and the same prices", () => {
  for (const [u, d] of [[1, 1], [8, 7], [15, 20]]) {
    assert.deepStrictEqual(E.makeLevel(u, d), E.makeLevel(u, d));
    assert.deepStrictEqual(E.priceDay(d), E.priceDay(d));
  }
  assert.notDeepStrictEqual(E.makeLevel(1, 1).real, E.makeLevel(1, 2).real);
  const r1 = E.mulberry32(42), r2 = E.mulberry32(42);
  for (let k = 0; k < 100; k++) assert.strictEqual(r1(), r2());
});

test("the same day gives all drivers the same price curve (clock time)", () => {
  const a = E.makeLevel(5, 3), b = E.makeLevel(6, 3);   // 08:00 and 09:00 arrivals
  const off = b.arrivalStep - a.arrivalStep;
  for (let t = 0; t + off < a.T && t < b.T; t++) assert.strictEqual(b.real[t], a.real[t + off]);
});

test("levels: windows within +-30 min of Table 1 unless lengthened, target always reachable", () => {
  for (const lv of allLevels) {
    const d = E.DRIVERS[lv.driver - 1];
    const nominal = ((Math.round(d.departure * 4) - Math.round(d.arrival * 4) + 96) % 96) || 96;
    if (!lv.lengthened) assert.ok(Math.abs(lv.T - nominal) <= 4, `driver ${lv.driver} day ${lv.day}: T=${lv.T}`);
    assert.ok(lv.T >= E.stepsToGoal(lv.s0, lv.goal));
    assert.strictEqual(new E.Game(lv).reachable, true);
    assert.strictEqual(lv.forecast.length, lv.T); assert.strictEqual(lv.real.length, lv.T);
  }
});

test("battery dynamics: 2 %/step below 80 %, 1 % above, saturation at 20 % and 100 %, stop at target", () => {
  const f = (s, a, g) => E.transition(s, a, g)[0];
  assert.strictEqual(f(50, "charge", 100), 52);
  assert.strictEqual(f(79, "charge", 100), 81);
  assert.strictEqual(f(80, "charge", 100), 81);
  assert.strictEqual(f(100, "charge", 100), 100);
  assert.strictEqual(f(99, "charge", 30), 100);         // above the target: no stop, saturate at 100
  assert.strictEqual(f(50, "discharge", 20), 48);
  assert.strictEqual(f(21, "discharge", 20), 20);
  assert.strictEqual(f(20, "discharge", 20), 20);
  assert.strictEqual(f(64, "charge", 65), 65);          // would pass the target: stops at it
  assert.strictEqual(f(66, "discharge", 65), 65);
  assert.strictEqual(f(65, "discharge", 65), 63);       // leaving the target is allowed
  assert.strictEqual(f(50, "idle", 65), 50);
  close(E.transition(50, "charge", 100)[1], 1.875);     // 2 % of 75 kWh / 0.8
  close(E.transition(50, "discharge", 20)[1], -1.2);    // 2 % of 75 kWh * 0.8
  close(E.transition(80, "charge", 100)[1], 0.9375);
  assert.strictEqual(E.transition(100, "charge", 100)[1], 0);
  assert.throws(() => E.transition(50, "boost", 60));
});

test("SoC stays within [20, 100] under random play on every level", () => {
  const rng = E.mulberry32(123);
  for (const lv of allLevels) {
    const g = new E.Game(lv);
    while (!g.done) {
      g.step(E.ACTIONS[Math.floor(rng() * 3)]);
      assert.ok(g.soc >= E.SOC_MIN && g.soc <= E.SOC_MAX && Number.isInteger(g.soc), `SoC ${g.soc}`);
    }
  }
});

test("cost equals the recomputation from the action history (random play, every level)", () => {
  const rng = E.mulberry32(7);
  for (const lv of allLevels) {
    const acts = Array.from({ length: lv.T }, () => E.ACTIONS[Math.floor(rng() * 3)]);
    const g = E.replay(lv, acts);
    assert.deepStrictEqual(g.history, acts);
    // rebuild the SoC path from the history alone, then the cost from the path
    let s = lv.s0; const socPath = [s];
    for (const a of acts) { s = E.transition(s, a, lv.goal)[0]; socPath.push(s); }
    assert.deepStrictEqual(g.path, socPath);
    close(g.cost, recomputeCost(lv, socPath), 1e-9);
  }
});

test("scripted episode with a hand-checked outcome", () => {
  // 4 steps, 50 % -> 52 %, real prices 0.10, 0.20, -0.05, 0.30 $/kWh, forecast = real (p_max = 0.30).
  const lv = E.customLevel({ s0: 50, goal: 52, real: [0.10, 0.20, -0.05, 0.30] });
  const g = new E.Game(lv);
  // charge: +2 %, buys 1.875 kWh at 0.10 -> 0.1875
  close(g.step("charge"), -0.1875 / 0.3);
  // discharge: -2 %, sells 1.2 kWh at 0.20 -> -0.24
  close(g.step("discharge"), 0.24 / 0.3);
  // charge at a negative price: buys 1.875 kWh at -0.05 -> -0.09375
  close(g.step("charge"), 0.09375 / 0.3);
  // idle at 52 %: no energy; departure exactly at the target -> +10
  close(g.step("idle"), 10);
  assert.ok(g.done); assert.strictEqual(g.soc, 52); assert.strictEqual(g.success, true);
  close(g.cost, 0.1875 - 0.24 - 0.09375);                   // -0.14625: a net profit
  close(g.reward, (0.14625) / 0.3 + 10);
  assert.throws(() => g.step("idle"), /episode over/);
  // optimum on this level: charge at 0.10 (0.1875), idle, charge again at the negative price (-0.09375) to 54 %,
  // then sell 2 % (1.2 kWh) at 0.30 (-0.36) and land on 52 %: 0.1875 - 0.09375 - 0.36 = -0.26625.
  assert.deepStrictEqual(E.optimalPlan(lv), ["charge", "idle", "charge", "discharge"]);
  close(E.replay(lv, E.optimalPlan(lv)).cost, -0.26625);
});

test("departure requirement: penalty once when the target becomes unreachable, no terminal bonus", () => {
  // 50 % -> 60 % in 5 steps: exactly 5 charges are needed, so any idle makes the target unreachable.
  const lv = E.customLevel({ s0: 50, goal: 60, real: [0.1, 0.1, 0.1, 0.1, 0.1] });
  const g = new E.Game(lv);
  assert.strictEqual(g.preview("idle").reachable, false);
  assert.strictEqual(g.preview("charge").reachable, true);
  close(g.step("idle"), E.R_FEAS);                          // no energy, penalty -10
  assert.strictEqual(g.reachable, false);
  for (let k = 0; k < 4; k++) g.step("charge");             // no further penalty once unreachable
  assert.strictEqual(g.penalties, 1);
  assert.strictEqual(g.soc, 58); assert.strictEqual(g.success, false);
  close(g.reward, -10 - 4 * 1.875 * 0.1 / 0.1);             // no terminal bonus
  // a level whose target cannot be met from the start: infeasible for the optimum
  const bad = E.customLevel({ s0: 20, goal: 100, real: [0.1, 0.1] });
  assert.strictEqual(E.optimalPlan(bad), null);
  assert.throws(() => E.customLevel({ s0: 10, goal: 50, real: [0.1] }));
});

test("charge-immediately rule meets the target on every level", () => {
  for (const lv of allLevels) assert.strictEqual(E.replay(lv, E.immediatePlan(lv)).soc, lv.goal);
});

test("dynamic program: meets the target and is never worse than charging immediately or stepwise", () => {
  let better = 0;
  for (const lv of allLevels) {
    const opt = E.replay(lv, E.optimalPlan(lv));
    const imm = E.replay(lv, E.immediatePlan(lv));
    const stp = E.replay(lv, E.stepwisePlan(lv));
    assert.strictEqual(opt.soc, lv.goal); assert.strictEqual(stp.soc, lv.goal);
    assert.ok(opt.cost <= imm.cost + 1e-9, `driver ${lv.driver} day ${lv.day}: ${opt.cost} > ${imm.cost}`);
    assert.ok(opt.cost <= stp.cost + 1e-9);
    close(E.solve(lv, lv.real, 0, lv.s0).value, opt.cost, 1e-9);
    if (opt.cost < imm.cost - 1e-6) better++;
  }
  assert.ok(better > allLevels.length / 2, `optimum strictly better on only ${better} levels`);
});

test("dynamic program agrees with exhaustive search on short random levels", () => {
  const rng = E.mulberry32(99);
  for (let k = 0; k < 60; k++) {
    const T = 3 + Math.floor(rng() * 4);
    const real = Array.from({ length: T }, () => Math.round((rng() * 0.4 - 0.08) * 1e4) / 1e4);
    const s0 = 20 + Math.floor(rng() * 81), goal = 20 + Math.floor(rng() * 81);
    const lv = E.customLevel({ s0, goal, real });
    let best = Infinity;
    const rec = (t, s, c) => {
      if (t === T) { if (s === goal && c < best) best = c; return; }
      for (const a of E.ACTIONS) { const [s2, kwh] = E.transition(s, a, goal); rec(t + 1, s2, c + real[t] * kwh); }
    };
    rec(0, s0, 0);
    const plan = E.optimalPlan(lv);
    if (best === Infinity) assert.strictEqual(plan, null);
    else close(E.replay(lv, plan).cost, best, 1e-9);
  }
});

test("scores: Eq. (11) gain and min-max normalisation", () => {
  close(E.gain(10, 5), 100 * 5 / 7.5);
  close(E.gain(-2, 2), -200);
  assert.strictEqual(E.gain(0, 0), 0);
  close(E.normalised(10, 10, 4), 0); close(E.normalised(4, 10, 4), 1); close(E.normalised(7, 10, 4), 0.5);
});

console.log(failed ? `${failed} test(s) failed` : "all tests passed");
process.exit(failed ? 1 : 0);
