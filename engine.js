// Rules engine of ChargeTrek, after Houalef et al. (2026), Applied Energy 414:127853.
// Pure and deterministic: a level is fully determined by (driver, day) through seeded random number generators.
// Units: state of charge (SoC) in integer percent, time in 15-minute steps, prices in $/kWh, energy in kWh.
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- constants (paper, Sections 3.1, 3.3, 4.3.1)
  const STEPS_PER_HOUR = 4;            // 15-minute steps
  const KWH_PER_PCT = 0.75;            // 75 kWh battery: 1 % = 0.75 kWh
  const ETA = 0.8;                     // charging and discharging efficiency
  const SOC_MIN = 20, SOC_MAX = 100;   // feasible SoC range, saturated
  const CC_LIMIT = 80;                 // charge 2 %/step below 80 %, 1 %/step from 80 %
  const R_FEAS = -10, R_TERMINAL = 10; // Eqs. (4) and (5)
  const ACTIONS = ["charge", "idle", "discharge"];

  // Table 1 of the paper: the 15 driver profiles (hours on a 24 h clock; departure < arrival = next day).
  const DRIVERS = [
    [16.0, 8.0, 25, 90], [18.0, 3.0, 50, 65], [0.0, 6.0, 90, 60], [3.0, 14.0, 50, 100], [8.0, 16.0, 75, 100],
    [9.0, 17.0, 30, 80], [14.5, 16.0, 60, 70], [20.0, 7.0, 95, 40], [5.0, 10.0, 46, 80], [23.0, 8.0, 20, 90],
    [10.0, 15.0, 40, 70], [8.0, 14.0, 85, 50], [1.0, 6.0, 60, 90], [11.0, 18.0, 35, 85], [15.0, 17.0, 65, 75],
  ].map(([arrival, departure, s0, goal], k) => ({ id: k + 1, arrival, departure, s0, goal }));

  // ---------------------------------------------------------------- seeded random numbers
  function mix(a, b) {                 // integer hash of two integers, 32-bit
    let h = (Math.imul(a | 0, 0x9E3779B1) ^ Math.imul(b | 0, 0x85EBCA77)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7FEB352D) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x846CA68B) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normal(rng) { return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()); }
  const round4 = x => Math.round(x * 1e4) / 1e4;

  // ---------------------------------------------------------------- synthetic prices (replace the paper's CAISO data)
  // One calendar day: hourly day-ahead forecast (constant over its four 15-minute steps) and 15-minute real-time
  // prices = forecast + autocorrelated error + rare spikes. Shape: morning bump, midday solar dip (can go negative),
  // evening peak. Values are retail-equivalent $/kWh.
  function priceDay(day) {
    const rng = mulberry32(mix(day, 7));
    const weekend = ((day % 7) + 7) % 7 >= 5;
    const base = 0.09 + 0.04 * rng();
    const morning = (0.03 + 0.04 * rng()) * (weekend ? 0.6 : 1);
    const evening = (0.12 + 0.14 * rng()) * (weekend ? 0.8 : 1);
    const eveningAt = 18.5 + rng();
    const dip = 0.05 + 0.11 * rng();
    const bump = (h, c, w) => Math.exp(-0.5 * ((h - c) / w) ** 2);
    const da = [], rt = [];
    for (let h = 0; h < 24; h++) {
      const p = base + morning * bump(h, 7.5, 1.5) + evening * bump(h, eveningAt, 1.8) - dip * bump(h, 13, 2.5)
              + 0.008 * normal(rng);
      for (let q = 0; q < STEPS_PER_HOUR; q++) da.push(round4(p));
    }
    let e = 0;
    for (let k = 0; k < 24 * STEPS_PER_HOUR; k++) {
      const h = k / STEPS_PER_HOUR;
      e = 0.6 * e + (0.012 + 0.02 * bump(h, eveningAt, 2)) * normal(rng);
      let spike = 0;
      const u = rng();
      if (u < 0.02) spike = 0.08 + 0.25 * rng();          // real-time price spike
      else if (u < 0.03) spike = -(0.04 + 0.06 * rng());  // real-time price drop
      rt.push(round4(da[k] + e + spike));
    }
    return { da, rt, weekend };
  }

  // ---------------------------------------------------------------- battery dynamics (paper, Section 3.3)
  // Returns [new SoC, energy exchanged with the grid in kWh: > 0 drawn, < 0 exported].
  // A step that would cross the target SoC stops at the target (see README, deviation D3).
  function transition(s, a, goal) {
    let s2 = s;
    if (a === "charge") {
      if (s < SOC_MAX) {
        s2 = Math.min(SOC_MAX, s + (s < CC_LIMIT ? 2 : 1));
        if (s < goal && s2 > goal) s2 = goal;
      }
    } else if (a === "discharge") {
      if (s > SOC_MIN) {
        s2 = Math.max(SOC_MIN, s - 2);
        if (s > goal && s2 < goal) s2 = goal;
      }
    } else if (a !== "idle") {
      throw new Error("unknown action " + a);
    }
    const ds = s2 - s;
    const kwh = ds > 0 ? ds * KWH_PER_PCT / ETA : ds * KWH_PER_PCT * ETA;
    return [s2, kwh];
  }

  // Charge-immediately rule (paper, Eq. 1): charge below the target, discharge above it, idle at it.
  function immediateAction(s, goal) { return s < goal ? "charge" : s > goal ? "discharge" : "idle"; }

  function stepsToGoal(s0, goal) {
    let s = s0, n = 0;
    while (s !== goal) {
      const s2 = transition(s, immediateAction(s, goal), goal)[0];
      if (s2 === s) return Infinity;
      s = s2; n++;
    }
    return n;
  }

  // ---------------------------------------------------------------- levels
  function validate(lv) {
    if (!(lv.T >= 1) || lv.forecast.length !== lv.T || lv.real.length !== lv.T) throw new Error("bad horizon");
    for (const s of [lv.s0, lv.goal])
      if (!Number.isInteger(s) || s < SOC_MIN || s > SOC_MAX) throw new Error("SoC must be an integer in [20, 100]");
    return lv;
  }

  // Level for a driver profile (1..15) on a synthetic day (integer). Arrival and departure are perturbed by up to
  // +-30 minutes (paper, Section 5.1); the window is lengthened when the target could not be reached otherwise.
  function makeLevel(driverId, day) {
    const d = DRIVERS[driverId - 1];
    if (!d) throw new Error("driver " + driverId);
    const rng = mulberry32(mix(day, 1000 + driverId));
    const shiftA = Math.floor(rng() * 5) - 2, shiftD = Math.floor(rng() * 5) - 2;
    const a0 = Math.round(d.arrival * STEPS_PER_HOUR), d0 = Math.round(d.departure * STEPS_PER_HOUR);
    const arrivalStep = Math.max(0, a0 + shiftA);
    const nominal = ((d0 - a0 + 96) % 96) || 96;
    const window = nominal + shiftD - (arrivalStep - a0);
    const need = stepsToGoal(d.s0, d.goal);
    const T = Math.max(window, need);
    const p1 = priceDay(day), p2 = priceDay(day + 1);
    const da = p1.da.concat(p2.da), rt = p1.rt.concat(p2.rt);
    return validate({
      driver: driverId, day, weekend: p1.weekend, arrivalStep, T, s0: d.s0, goal: d.goal, lengthened: T > window,
      forecast: da.slice(arrivalStep, arrivalStep + T), real: rt.slice(arrivalStep, arrivalStep + T),
    });
  }

  // Hand-made level (tests): forecast defaults to the real prices.
  function customLevel({ s0, goal, real, forecast, arrivalStep = 0 }) {
    return validate({ driver: 0, day: 0, weekend: false, arrivalStep, T: real.length, s0, goal, lengthened: false,
                      real: real.slice(), forecast: (forecast || real).slice() });
  }

  // reach[t][s] = 1 when the target can still be met exactly at departure from SoC s at step t.
  function reachTable(lv) {
    const reach = Array.from({ length: lv.T + 1 }, () => new Uint8Array(SOC_MAX + 1));
    reach[lv.T][lv.goal] = 1;
    for (let t = lv.T - 1; t >= 0; t--)
      for (let s = 0; s <= SOC_MAX; s++)
        for (const a of ACTIONS) if (reach[t + 1][transition(s, a, lv.goal)[0]]) { reach[t][s] = 1; break; }
    return reach;
  }

  // ---------------------------------------------------------------- game
  class Game {
    constructor(level) {
      this.level = level;
      this.reach = reachTable(level);
      this.pmax = Math.max(...level.forecast);       // normalisation of Eq. (3)
      if (!(this.pmax > 0)) this.pmax = 1;
      this.t = 0; this.soc = level.s0;
      this.cost = 0; this.reward = 0; this.penalties = 0;
      this.history = []; this.path = [level.s0]; this.costs = [0];
    }
    get done() { return this.t >= this.level.T; }
    get reachable() { return this.reach[this.t][this.soc] === 1; }
    get success() { return this.done && this.soc === this.level.goal; }
    preview(a) {
      const [s2, kwh] = transition(this.soc, a, this.level.goal);
      return { soc: s2, kwh, cost: this.level.real[this.t] * kwh, reachable: this.reach[this.t + 1][s2] === 1 };
    }
    step(a) {
      if (this.done) throw new Error("episode over");
      const was = this.reachable;
      const p = this.preview(a);
      let r = -p.cost / this.pmax;                                 // Eq. (3)
      if (was && !p.reachable) { r += R_FEAS; this.penalties++; }   // Eq. (4)
      this.soc = p.soc; this.cost += p.cost; this.t++;
      if (this.done && this.soc === this.level.goal) r += R_TERMINAL; // Eq. (5)
      this.reward += r;
      this.history.push(a); this.path.push(this.soc); this.costs.push(this.cost);
      return r;
    }
  }

  function replay(level, actions) {
    const g = new Game(level);
    for (const a of actions) g.step(a);
    return g;
  }

  // ---------------------------------------------------------------- reference policies
  // Minimum-cost schedule from (t0, s0) to the target at departure, by backward dynamic programming over the
  // integer SoC grid (exact for these dynamics). prices[t] is the price used at step t. Returns null if infeasible.
  function solve(level, prices, t0, s0) {
    const T = level.T, goal = level.goal, N = SOC_MAX + 1;
    let V = new Float64Array(N).fill(Infinity); V[goal] = 0;
    const choice = [];
    for (let t = T - 1; t >= t0; t--) {
      const W = new Float64Array(N).fill(Infinity), C = new Uint8Array(N);
      for (let s = SOC_MIN; s < N; s++)
        for (let k = 0; k < ACTIONS.length; k++) {          // ties: idle, then charge, then discharge
          const ak = k === 0 ? 1 : k === 1 ? 0 : 2;
          const [s2, kwh] = transition(s, ACTIONS[ak], goal);
          const v = prices[t] * kwh + V[s2];
          if (v < W[s] - 1e-12) { W[s] = v; C[s] = ak; }
        }
      choice[t] = C; V = W;
    }
    if (!isFinite(V[s0])) return null;
    const actions = [];
    let s = s0;
    for (let t = t0; t < T; t++) { const a = ACTIONS[choice[t][s]]; actions.push(a); s = transition(s, a, goal)[0]; }
    return { actions, value: V[s0] };
  }

  function immediatePlan(level) {
    const acts = []; let s = level.s0;
    for (let t = 0; t < level.T; t++) { const a = immediateAction(s, level.goal); acts.push(a); s = transition(s, a, level.goal)[0]; }
    return acts;
  }

  function optimalPlan(level) {                   // perfect information: real-time prices known in advance
    const r = solve(level, level.real, 0, level.s0);
    return r ? r.actions : null;
  }

  // Stepwise replanning (paper, Section 4.2.2): at each step, real price now, forecasts for the rest.
  function stepwisePlan(level) {
    const acts = []; let s = level.s0;
    for (let t = 0; t < level.T; t++) {
      const prices = level.forecast.slice(); prices[t] = level.real[t];
      const r = solve(level, prices, t, s);
      const a = r ? r.actions[0] : immediateAction(s, level.goal);
      acts.push(a); s = transition(s, a, level.goal)[0];
    }
    return acts;
  }

  // ---------------------------------------------------------------- scores
  // Gain of Eq. (11), in percent: positive when the agent pays less than the baseline.
  function gain(cBase, cAgent) {
    const den = (Math.abs(cAgent) + Math.abs(cBase)) / 2;
    return den > 0 ? 100 * (cBase - cAgent) / den : 0;
  }
  // Min-max normalised cost of Section 5.2: 0 = immediate charging, 1 = optimum.
  function normalised(c, cImm, cOpt) {
    const span = cImm - cOpt;
    if (Math.abs(span) < 1e-9) return c <= cOpt + 1e-9 ? 1 : 0;
    return (cImm - c) / span;
  }

  const api = {
    STEPS_PER_HOUR, KWH_PER_PCT, ETA, SOC_MIN, SOC_MAX, CC_LIMIT, R_FEAS, R_TERMINAL, ACTIONS, DRIVERS,
    mulberry32, mix, priceDay, transition, immediateAction, stepsToGoal, makeLevel, customLevel, reachTable,
    Game, replay, solve, immediatePlan, optimalPlan, stepwisePlan, gain, normalised,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ChargeTrek = api;
})(this);
