// User interface of ChargeTrek (browser version). Rules live in engine.js; this file only draws and dispatches actions.
(function () {
  "use strict";
  const E = window.ChargeTrek;
  const $ = id => document.getElementById(id);
  const board = $("board"), strip = $("prices");
  const NDAYS = 30;
  const REF = { imm: ["#E69F00", [7, 4], 2], step: ["#CC79A7", [2, 3], 2], opt: ["#0072B2", [], 3] };
  // grid geometry (canvas pixels); the price strip shares the horizontal layout so columns line up
  const L = 38, TOP = 8, ROW = 4, GH = 101 * ROW, BAR_W = 18, GW = board.width - L - BAR_W - 22;

  let level = null, game = null, refs = null, showRefs = false, undoUsed = false;

  const css = v => getComputedStyle(document.body).getPropertyValue(v).trim();
  const money = c => (c < 0 ? "-$" : "$") + Math.abs(c).toFixed(2);
  const clock = k => { const m = ((k % 96) + 96) % 96; return String(Math.floor(m / 4)).padStart(2, "0") + ":" + String(15 * (m % 4)).padStart(2, "0"); };
  const colX = t => L + t * GW / (level.T + 1);
  const rowY = s => TOP + (E.SOC_MAX - s) * ROW;            // top edge of the row of SoC s

  // ---------------------------------------------------------------- game life cycle
  function load() {
    level = E.makeLevel(+$("driver").value, +$("day").value);
    const plans = { imm: E.immediatePlan(level), step: E.stepwisePlan(level), opt: E.optimalPlan(level) };
    refs = {};
    for (const k in plans) refs[k] = E.replay(level, plans[k]);
    restart();
  }
  function restart() { game = new E.Game(level); showRefs = false; undoUsed = false; render(); }

  function act(a) {
    if (!game || game.done) return;
    const p = game.preview(a), was = game.reachable;
    game.step(a);
    render();
    if (!game.done && was && !p.reachable) flash("This move makes the target unreachable before departure (reward -10).", true);
  }

  function undo() {
    if (!game || game.history.length === 0) return;
    game = E.replay(level, game.history.slice(0, -1));
    undoUsed = true; showRefs = false;
    render();
  }

  function flash(t, bad) { $("msg").textContent = t; $("msg").className = bad ? "bad" : ""; }

  // ---------------------------------------------------------------- drawing
  function render() {
    drawBoard(); drawStrip(); stats();
    document.querySelectorAll(".ref").forEach(e => { e.hidden = !showRefs; });
    $("refs").disabled = !game.done;
    $("refs").textContent = showRefs ? "Hide reference paths" : "Show reference paths";
    $("undo").disabled = game.history.length === 0;
    document.querySelectorAll("[data-act]").forEach(b => {
      b.disabled = game.done;
      b.classList.toggle("warn", !game.done && game.reachable && !game.preview(b.dataset.act).reachable);
    });
    if (game.done) flash(result());
    else if (!game.reachable) flash("The target can no longer be met exactly; you can still keep the cost down.", true);
    else if (game.t === 0) flash(`Plugged in at ${clock(level.arrivalStep)} with ${level.s0} %. ` +
      `Leave at ${clock(level.arrivalStep + level.T)} with exactly ${level.goal} %.` +
      (level.lengthened ? " (Window lengthened so the target can be met.)" : ""));
    else flash("");
  }

  function result() {
    const c = game.cost, ci = refs.imm.cost, co = refs.opt.cost;
    const gap = game.soc - level.goal;
    const soc = gap === 0 ? `left with ${game.soc} %, the target` :
      `left with ${game.soc} %, ${Math.abs(gap)} point(s) ${gap < 0 ? "below" : "above"} the target of ${level.goal} %`;
    const g = E.gain(ci, c);
    let s = `Departure: ${soc}. Net cost ${money(c)}. `;
    s += `Gain over charging immediately (Eq. 11): ${g >= 0 ? "+" : ""}${g.toFixed(1)} %. `;
    if (gap === 0) s += `Normalised score ${E.normalised(c, ci, co).toFixed(2)} (0 = charge immediately, 1 = optimum).`;
    else s += "Scores are comparable only when the target is met.";
    if (undoUsed) s += " Undo was used.";
    return s + " O shows the reference paths, N the next day.";
  }

  function stats() {
    const t = Math.min(game.t, level.T - 1);
    $("s-time").textContent = `${clock(level.arrivalStep + game.t)} (step ${game.t} of ${level.T})`;
    $("s-soc").textContent = `${game.soc} % (target ${level.goal} % at ${clock(level.arrivalStep + level.T)})`;
    $("s-price").textContent = game.done ? "-" : `${level.forecast[t].toFixed(3)} / ${level.real[t].toFixed(3)} $/kWh`;
    $("s-cost").textContent = money(game.cost);
    $("s-reward").textContent = game.reward.toFixed(2);
    $("s-imm").textContent = money(refs.imm.cost);
    $("s-step").textContent = money(refs.step.cost);
    $("s-opt").textContent = money(refs.opt.cost);
  }

  function priceRange() {
    let lo = Math.min(...level.forecast), hi = Math.max(...level.forecast);
    if (hi - lo < 1e-9) { lo -= 0.01; hi += 0.01; }
    return [lo, hi];
  }

  function drawBoard() {
    const ctx = board.getContext("2d"), T = level.T, cw = GW / (T + 1);
    ctx.clearRect(0, 0, board.width, board.height);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(L, TOP, GW, GH);     // white base in both themes
    const [lo, hi] = priceRange();
    for (let t = 0; t < T; t++) {
      const n = Math.max(0, Math.min(1, (level.forecast[t] - lo) / (hi - lo)));
      const R = Math.round(255 * n), G = 255 - R;
      let B = 0, A = 1;
      if (t < game.t || (t === game.t && !game.done) || game.done) {      // real-time price known
        const err = level.real[t] - level.forecast[t];
        B = err > 0 ? 255 : 0;
        A = 1 - 0.7 * Math.min(1, Math.abs(err) / 0.05);
      }
      ctx.fillStyle = `rgba(${R},${G},${B},${A})`;
      ctx.fillRect(colX(t), TOP, cw + 0.5, GH);
    }
    ctx.fillStyle = "#d1d5db"; ctx.fillRect(colX(T), TOP, cw, GH);       // departure column
    ctx.fillStyle = "rgba(17,24,39,0.45)";                                 // reserve below 20 %
    ctx.fillRect(L, rowY(E.SOC_MIN - 1), GW, GH - (rowY(E.SOC_MIN - 1) - TOP));
    ctx.setLineDash([4, 4]); ctx.strokeStyle = "rgba(17,24,39,0.6)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, rowY(E.CC_LIMIT - 1)); ctx.lineTo(L + GW, rowY(E.CC_LIMIT - 1)); ctx.stroke();
    ctx.setLineDash([]);
    // goal cell (yellow) at departure
    const gh = 10, gy = rowY(level.goal) + ROW / 2 - gh / 2;
    ctx.fillStyle = "#FFFF00"; ctx.fillRect(colX(T), gy, cw, gh);
    ctx.strokeStyle = "#111827"; ctx.lineWidth = 1; ctx.strokeRect(colX(T) + 0.5, gy + 0.5, cw - 1, gh - 1);
    // reference paths after departure
    if (showRefs) for (const k of ["imm", "step", "opt"]) drawPath(ctx, refs[k].path, ...REF[k]);
    // player path and car
    drawPath(ctx, game.path, "#000000", [], 2);
    if (!game.done) {
      for (const a of E.ACTIONS) {
        const p = game.preview(a), y = rowY(p.soc) + ROW / 2;
        ctx.strokeStyle = game.reachable && !p.reachable ? "#c0392b" : "#111827";
        ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]);
        ctx.strokeRect(colX(game.t + 1) + 1, y - 4, Math.max(4, cw - 2), 8);
        ctx.setLineDash([]);
      }
    }
    const w = Math.max(6, Math.min(cw, 12)), x = colX(game.t) + cw / 2 - w / 2, y = rowY(game.soc) + ROW / 2 - 5;
    ctx.fillStyle = "#000000"; ctx.fillRect(x, y, w, 10);
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1; ctx.strokeRect(x - 0.5, y - 0.5, w + 1, 11);
    drawAxes(ctx, cw);
    drawMoneyBar(ctx);
  }

  function drawPath(ctx, path, color, dash, width) {
    const cw = GW / (level.T + 1);
    const pts = path.map((s, t) => [colX(t) + cw / 2, rowY(s) + ROW / 2]);
    ctx.lineJoin = "round";
    for (const [c, wd] of [["rgba(255,255,255,0.85)", width + 2], [color, width]]) {
      ctx.strokeStyle = c; ctx.lineWidth = wd; ctx.setLineDash(c === color ? dash : []);
      ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function drawAxes(ctx, cw) {
    ctx.fillStyle = css("--muted") || "#5f6b7a"; ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let s = 0; s <= 100; s += 20) ctx.fillText(s + "%", L - 4, rowY(s) + ROW / 2);
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    let last = -1e9;
    for (let t = 0; t <= level.T; t++) {
      const k = level.arrivalStep + t, x = colX(t);
      if (k % 4 !== 0 || x - last < 44) continue;
      ctx.fillText(clock(k), Math.min(Math.max(x, L + 14), L + GW - 14), TOP + GH + 6);
      last = x;
    }
  }

  // Net cost bar: 101 cells centred at zero, cost upward in red, revenue downward in green.
  function drawMoneyBar(ctx) {
    const x = L + GW + 12, mid = TOP + GH / 2;
    const scale = 1.2 * Math.max(Math.abs(refs.imm.cost), Math.abs(refs.opt.cost), Math.abs(refs.step.cost),
                                 Math.abs(game.cost), 0.5);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(x, TOP, BAR_W, GH);
    const h = Math.round(50 * Math.min(1, Math.abs(game.cost) / scale)) * ROW;
    ctx.fillStyle = game.cost > 0 ? "#d62728" : "#1a9850";
    if (game.cost > 0) ctx.fillRect(x, mid - h, BAR_W, h); else ctx.fillRect(x, mid, BAR_W, h);
    ctx.strokeStyle = "#111827"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, mid); ctx.lineTo(x + BAR_W, mid); ctx.stroke();
    ctx.strokeStyle = css("--muted") || "#5f6b7a"; ctx.strokeRect(x + 0.5, TOP + 0.5, BAR_W - 1, GH - 1);
  }

  function drawStrip() {
    const ctx = strip.getContext("2d"), T = level.T, cw = GW / (T + 1), top = 8, h = strip.height - 24;
    ctx.clearRect(0, 0, strip.width, strip.height);
    const shown = game.done ? T : game.t + 1;
    const vals = level.forecast.concat(level.real.slice(0, shown));
    let lo = Math.min(0, ...vals), hi = Math.max(...vals);
    if (hi - lo < 1e-9) hi = lo + 0.01;
    const y = p => top + h * (hi - p) / (hi - lo);
    const fg = css("--fg") || "#111827", muted = css("--muted") || "#5f6b7a", accent = css("--accent") || "#003DA5";
    if (!game.done) { ctx.fillStyle = css("--line") || "#dfe3ea"; ctx.fillRect(colX(game.t), top, cw, h); }
    ctx.strokeStyle = muted; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, y(0)); ctx.lineTo(L + GW, y(0)); ctx.stroke();
    const step = (arr, n, color, width) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
      for (let t = 0; t < n; t++) {
        const yy = y(arr[t]);
        if (t === 0) ctx.moveTo(colX(0), yy); else ctx.lineTo(colX(t), yy);
        ctx.lineTo(colX(t + 1), yy);
      }
      ctx.stroke();
    };
    step(level.forecast, T, "#9CA3AF", 2);
    step(level.real, shown, accent, 1.5);
    ctx.fillStyle = muted; ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ctx.fillText(hi.toFixed(2), L - 4, y(hi)); ctx.fillText(lo.toFixed(2), L - 4, y(lo));
    if (y(0) - y(hi) > 12 && y(lo) - y(0) > 12) ctx.fillText("0", L - 4, y(0));
    ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillStyle = fg;
    ctx.fillText("$/kWh", L + 4, top + h + 4);
  }

  // ---------------------------------------------------------------- input
  const KEYS = { ArrowUp: "charge", c: "charge", ArrowRight: "idle", " ": "idle", i: "idle", ArrowDown: "discharge", d: "discharge" };
  document.addEventListener("keydown", ev => {
    if (ev.target.tagName === "SELECT" || ev.target.tagName === "BUTTON" && ev.key === " " || !game) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    if (KEYS[k]) { ev.preventDefault(); act(KEYS[k]); }
    else if (k === "z" || k === "Backspace") { ev.preventDefault(); undo(); }
    else if (k === "r") restart();
    else if (k === "n" || (k === "Enter" && game.done)) changeDay(1);
    else if (k === "p") changeDay(-1);
    else if (k === "o" && game.done) { showRefs = !showRefs; render(); }
  });
  function changeDay(d) { $("day").value = String((+$("day").value - 1 + d + NDAYS) % NDAYS + 1); load(); }

  document.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", () => act(b.dataset.act)));
  $("undo").addEventListener("click", undo);
  $("restart").addEventListener("click", restart);
  $("next").addEventListener("click", () => changeDay(1));
  $("refs").addEventListener("click", () => { showRefs = !showRefs; render(); });
  // after a choice, give the keys back to the game (a focused select would take the arrow keys)
  for (const id of ["driver", "day"]) $(id).addEventListener("change", () => { load(); $(id).blur(); });
  document.addEventListener("click", ev => { if (ev.target.tagName === "BUTTON" && ev.detail > 0) ev.target.blur(); });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => game && render());

  const hhmm = h => clock(Math.round(h * 4));
  $("driver").innerHTML = E.DRIVERS.map(d =>
    `<option value="${d.id}">Driver ${d.id}: ${hhmm(d.arrival)} to ${hhmm(d.departure)}, ${d.s0} % to ${d.goal} %</option>`).join("");
  $("day").innerHTML = Array.from({ length: NDAYS }, (_, k) =>
    `<option value="${k + 1}">Day ${k + 1}${E.priceDay(k + 1).weekend ? " (weekend)" : ""}</option>`).join("");
  load();
})();
