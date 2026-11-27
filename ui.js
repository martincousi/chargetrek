// User interface of ChargeTrek. Rules live in engine.js; this file only draws and dispatches actions.
// Layout, names, keys and replay bar follow the conventions shared by the games (CONVENTIONS.md of the games site).
(function () {
  "use strict";
  const E = window.ChargeTrek;
  const $ = id => document.getElementById(id);
  const board = $("board"), strip = $("prices");
  const NDAYS = 30;
  // the player's path: accent navy (the grid is white in both themes, so a fixed colour); references: Okabe-Ito
  const YOU = ["#003DA5", [], 2];
  const REF = { opt: ["#0072B2", [], 3], imm: ["#E69F00", [7, 4], 2], step: ["#CC79A7", [2, 3], 2] };
  const WATCH = ["you", "opt", "imm", "step"];            // order of "Watch:", as in the stats grids
  const SPEEDS = [2, 4, 8, 16, 32];                       // steps per second
  // grid geometry (canvas pixels); the price strip shares the horizontal layout so columns line up
  const L = 38, TOP = 8, ROW = 4, GH = 101 * ROW, BAR_W = 18, GW = board.width - L - BAR_W - 22;

  let level = null, game = null, refs = null, showRefs = false, undoUsed = false;
  // replay bar state: the Replay being watched, its step k, and the play loop
  const rp = { open: false, which: "you", replay: null, k: 0, playing: false, last: null, acc: 0 };

  const css = v => getComputedStyle(document.body).getPropertyValue(v).trim();
  const money = c => (c < 0 ? "-$" : "$") + Math.abs(c).toFixed(2);
  const clock = k => { const m = ((k % 96) + 96) % 96; return String(Math.floor(m / 4)).padStart(2, "0") + ":" + String(15 * (m % 4)).padStart(2, "0"); };
  const colX = t => L + t * GW / (level.T + 1);
  const rowY = s => TOP + (E.SOC_MAX - s) * ROW;            // top edge of the row of SoC s

  // ---------------------------------------------------------------- game life cycle
  function load() {
    closeReplay(false);
    level = E.makeLevel(+$("driver").value, +$("day").value);
    const plans = E.referencePlans(level);
    refs = {};                                    // each reference as a Replay of its action sequence
    for (const k in plans) refs[k] = new E.Replay(level, plans[k] || []);
    restart();
  }
  function restart() { closeReplay(false); game = new E.Game(level); showRefs = false; undoUsed = false; render(); }

  function act(a) {
    if (!game || game.done || rp.open) return;
    const p = game.preview(a), was = game.reachable;
    game.step(a);
    render();
    if (!game.done && was && !p.reachable) flash("This move makes the target unreachable before departure (reward -10).", true);
  }

  function undo() {
    if (!game || game.history.length === 0) return;
    closeReplay(false);
    game = E.replay(level, game.history.slice(0, -1));
    undoUsed = true;
    render();
  }

  function flash(t, bad) { $("msg").textContent = t; $("msg").className = bad ? "bad" : ""; }

  // ---------------------------------------------------------------- references and replays
  // Both work at any time, also before departure; neither changes the game (closing returns to it as it was).
  function toggleRefs() { showRefs = !showRefs; render(); }
  function watch() { if (rp.open) closeReplay(true); else openReplay(); }

  function replayOf(which) { return which === "you" ? new E.Replay(level, game.history) : refs[which]; }
  function openReplay() {
    rp.open = true; rp.which = "you"; rp.replay = replayOf("you"); rp.k = 0; pause();
    $("rp-which").value = rp.which;
    render();
  }
  function closeReplay(draw) {
    if (!rp.open) return;
    pause(); rp.open = false; rp.replay = null;
    if (draw) render();
  }
  function select(which) {                        // keep the step, so two schedules compare at the same time
    rp.which = which; rp.replay = replayOf(which); $("rp-which").value = which;
    seek(rp.k);
  }
  function seek(k) { rp.k = Math.max(0, Math.min(rp.replay.n, Math.round(k))); if (rp.k >= rp.replay.n) pause(); render(); }
  function pause() { rp.playing = false; rp.last = null; rp.acc = 0; }
  function play() {
    if (rp.playing) { pause(); render(); return; }
    if (rp.k >= rp.replay.n) rp.k = 0;             // play again from the start
    if (rp.replay.n === 0) return;
    rp.playing = true; rp.last = null; rp.acc = 0;
    render();
    requestAnimationFrame(tick);
  }
  function tick(ts) {
    if (!rp.open || !rp.playing) return;
    if (rp.last !== null) rp.acc += (ts - rp.last) * (+$("rp-speed").value) / 1000;
    rp.last = ts;
    let moved = false;
    while (rp.acc >= 1 && rp.k < rp.replay.n) { rp.k++; rp.acc -= 1; moved = true; }
    if (rp.k >= rp.replay.n) pause();
    if (moved || !rp.playing) render();
    if (rp.playing) requestAnimationFrame(tick);
  }
  function speed(d) {
    const i = SPEEDS.indexOf(+$("rp-speed").value);
    $("rp-speed").value = String(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 2 : i) + d))]);
  }

  // ---------------------------------------------------------------- drawing
  // A view is what the board shows: the live game, or the state of a replay at step k.
  function view() {
    if (!rp.open) return { live: true, t: game.t, soc: game.soc, cost: game.cost, done: game.done, path: game.path };
    return Object.assign({ live: false }, rp.replay.at(rp.k));
  }

  function render() {
    const v = view();
    drawBoard(v); drawStrip(v); stats(); replayBar();
    document.querySelectorAll(".ref").forEach(e => { e.hidden = !showRefs; });
    $("refs").textContent = showRefs ? "Hide references" : "Show references";
    $("refs").title = (showRefs ? "Hide references" : "Show references") + " (O)";
    $("watch").textContent = "Watch replays";
    $("undo").disabled = game.history.length === 0;
    document.querySelectorAll("[data-act]").forEach(b => {
      b.disabled = game.done || rp.open;
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
    const c = game.cost, ci = refs.imm.final.cost, co = refs.opt.final.cost;
    const gap = game.soc - level.goal;
    const soc = gap === 0 ? `left with ${game.soc} %, the target` :
      `left with ${game.soc} %, ${Math.abs(gap)} point(s) ${gap < 0 ? "below" : "above"} the target of ${level.goal} %`;
    const g = E.gain(ci, c);
    let s = `Departure: ${soc}. Net cost ${money(c)}. `;
    s += `Gain over charging immediately (Eq. 11): ${g >= 0 ? "+" : ""}${g.toFixed(1)} %. `;
    if (gap === 0) s += `Normalised score ${E.normalised(c, ci, co).toFixed(2)} (0 = charge immediately, 1 = optimum).`;
    else s += "Scores are comparable only when the target is met.";
    if (undoUsed) s += " Undo was used.";
    return s + " W watches the replays, N goes to the next day.";
  }

  function stats() {
    const t = Math.min(game.t, level.T - 1);
    $("s-cost").textContent = money(game.cost);
    $("s-time").textContent = `${clock(level.arrivalStep + game.t)} (step ${game.t} of ${level.T})`;
    $("s-soc").textContent = `${game.soc} % (target ${level.goal} % at ${clock(level.arrivalStep + level.T)})`;
    $("s-price").textContent = game.done ? "-" : `${level.forecast[t].toFixed(3)} / ${level.real[t].toFixed(3)} $/kWh`;
    $("s-reward").textContent = game.reward.toFixed(2);
    for (const k of ["opt", "imm", "step"]) $("s-" + k).textContent = money(refs[k].final.cost);
  }

  function replayBar() {
    $("replay").hidden = !rp.open;
    $("watch").setAttribute && $("watch").setAttribute("aria-expanded", rp.open ? "true" : "false");
    if (!rp.open) return;
    const st = rp.replay.at(rp.k);
    $("rp-scrub").max = String(rp.replay.n); $("rp-scrub").value = String(rp.k);
    const label = rp.playing ? "❚❚ Pause" : "▶ Play", aria = (rp.playing ? "Pause" : "Play") + " (Space or K)";
    $("rp-play").textContent = label; $("rp-play").title = aria;
    if ($("rp-play").setAttribute) $("rp-play").setAttribute("aria-label", aria);
    $("rp-sw").style.background = (rp.which === "you" ? YOU : REF[rp.which])[0];
    $("rp-text").textContent = `Step ${st.k} of ${st.n} · ${clock(level.arrivalStep + st.t)} · ` +
      `state of charge ${st.soc} % · net cost so far ${money(st.cost)} · reward ${st.reward.toFixed(2)}`;
  }

  function priceRange() {
    let lo = Math.min(...level.forecast), hi = Math.max(...level.forecast);
    if (hi - lo < 1e-9) { lo -= 0.01; hi += 0.01; }
    return [lo, hi];
  }

  function drawBoard(v) {
    const ctx = board.getContext("2d"), T = level.T, cw = GW / (T + 1);
    ctx.clearRect(0, 0, board.width, board.height);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(L, TOP, GW, GH);     // white base in both themes
    const [lo, hi] = priceRange();
    for (let t = 0; t < T; t++) {
      const n = Math.max(0, Math.min(1, (level.forecast[t] - lo) / (hi - lo)));
      const R = Math.round(255 * n), G = 255 - R;
      let B = 0, A = 1;
      if (t < v.t || (t === v.t && !v.done) || v.done) {           // real-time price known
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
    // reference paths (in reverse order of the stats grid, so the optimum is drawn on top)
    if (showRefs) for (const k of ["step", "imm", "opt"]) drawPath(ctx, refs[k].final.path, ...REF[k]);
    // the player's path (or the replayed path) and the car
    drawPath(ctx, v.path, ...(v.live || rp.which === "you" ? YOU : REF[rp.which]));
    if (v.live && !v.done) {
      for (const a of E.ACTIONS) {
        const p = game.preview(a), y = rowY(p.soc) + ROW / 2;
        ctx.strokeStyle = game.reachable && !p.reachable ? "#c0392b" : "#111827";
        ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]);
        ctx.strokeRect(colX(game.t + 1) + 1, y - 4, Math.max(4, cw - 2), 8);
        ctx.setLineDash([]);
      }
    }
    const w = Math.max(6, Math.min(cw, 12)), x = colX(v.t) + cw / 2 - w / 2, y = rowY(v.soc) + ROW / 2 - 5;
    ctx.fillStyle = "#000000"; ctx.fillRect(x, y, w, 10);
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1; ctx.strokeRect(x - 0.5, y - 0.5, w + 1, 11);
    drawAxes(ctx, cw);
    drawMoneyBar(ctx, v.cost);
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
  function drawMoneyBar(ctx, cost) {
    const x = L + GW + 12, mid = TOP + GH / 2;
    const scale = 1.2 * Math.max(Math.abs(refs.imm.final.cost), Math.abs(refs.opt.final.cost),
                                 Math.abs(refs.step.final.cost), Math.abs(game.cost), Math.abs(cost), 0.5);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(x, TOP, BAR_W, GH);
    const h = Math.round(50 * Math.min(1, Math.abs(cost) / scale)) * ROW;
    ctx.fillStyle = cost > 0 ? "#d62728" : "#1a9850";
    if (cost > 0) ctx.fillRect(x, mid - h, BAR_W, h); else ctx.fillRect(x, mid, BAR_W, h);
    ctx.strokeStyle = "#111827"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, mid); ctx.lineTo(x + BAR_W, mid); ctx.stroke();
    ctx.strokeStyle = css("--muted") || "#5f6b7a"; ctx.strokeRect(x + 0.5, TOP + 0.5, BAR_W - 1, GH - 1);
  }

  function drawStrip(v) {
    const ctx = strip.getContext("2d"), T = level.T, cw = GW / (T + 1), top = 8, h = strip.height - 24;
    ctx.clearRect(0, 0, strip.width, strip.height);
    const shown = v.done ? T : v.t + 1;                    // real-time prices revealed up to the current step
    const vals = level.forecast.concat(level.real.slice(0, shown));
    let lo = Math.min(0, ...vals), hi = Math.max(...vals);
    if (hi - lo < 1e-9) hi = lo + 0.01;
    const y = p => top + h * (hi - p) / (hi - lo);
    const fg = css("--fg") || "#111827", muted = css("--muted") || "#5f6b7a", accent = css("--accent") || "#003DA5";
    if (!v.done) { ctx.fillStyle = css("--line") || "#dfe3ea"; ctx.fillRect(colX(v.t), top, cw, h); }
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
  // While the replay bar is open, keys act on the replay only.
  function replayKey(k, ev) {
    const n10 = ev.shiftKey ? 10 : 1;
    if (k === " " || k === "k") play();
    else if (k === "ArrowLeft") seek(rp.k - n10);
    else if (k === "ArrowRight") seek(rp.k + n10);
    else if (k === "Home") seek(0);
    else if (k === "End") seek(rp.replay.n);
    else if (k === "ArrowUp" || k === "ArrowDown") {
      const i = WATCH.indexOf(rp.which) + (k === "ArrowUp" ? -1 : 1);
      select(WATCH[(i + WATCH.length) % WATCH.length]);
    }
    else if (k === "-" || k === "_") speed(-1);
    else if (k === "+" || k === "=") speed(1);
    else if (k === "Escape" || k === "w") closeReplay(true);
    else return;
    ev.preventDefault();
  }
  document.addEventListener("keydown", ev => {
    if (ev.target.tagName === "A" && ev.key === "Enter") return;   // follow a focused link (site navigation)
    if (ev.target.tagName === "SELECT" || !game) return;
    if (ev.target.tagName === "BUTTON" && (ev.key === " " || ev.key === "Enter")) return;   // the button's own click
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    if (rp.open) return replayKey(k, ev);
    if (KEYS[k]) { ev.preventDefault(); act(KEYS[k]); }
    else if (k === "z" || k === "Backspace") { ev.preventDefault(); undo(); }
    else if (k === "r") restart();
    else if (k === "n" || (k === "Enter" && game.done)) changeDay(1);
    else if (k === "p") changeDay(-1);
    else if (k === "w") watch();
    else if (k === "o") toggleRefs();
  });
  function changeDay(d) { $("day").value = String((+$("day").value - 1 + d + NDAYS) % NDAYS + 1); load(); }

  document.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", () => act(b.dataset.act)));
  $("undo").addEventListener("click", undo);
  $("restart").addEventListener("click", restart);
  $("next").addEventListener("click", () => changeDay(1));
  $("watch").addEventListener("click", watch);
  $("refs").addEventListener("click", toggleRefs);
  $("rp-start").addEventListener("click", () => seek(0));
  $("rp-back").addEventListener("click", () => seek(rp.k - 1));
  $("rp-play").addEventListener("click", play);
  $("rp-fwd").addEventListener("click", () => seek(rp.k + 1));
  $("rp-end").addEventListener("click", () => seek(rp.replay.n));
  $("rp-close").addEventListener("click", () => closeReplay(true));
  $("rp-scrub").addEventListener("input", () => { pause(); seek(+$("rp-scrub").value); });
  $("rp-which").addEventListener("change", () => { select($("rp-which").value); $("rp-which").blur(); });
  $("rp-speed").addEventListener("change", () => $("rp-speed").blur());
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
