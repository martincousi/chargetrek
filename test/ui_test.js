// Stub-DOM test of index.html + ui.js (no browser needed). Run: node test/ui_test.js
// Checks the shared interface conventions: page layout and ids (watch, refs, msg, the replay bar), exact button
// labels, keys W and O at any time (no confirmation), keys acting on the replay only while the bar is open, the
// game restored on close, and that each replay ends on the values of the stats grids.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const dir = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");

let failed = 0;
function test(name, fn) {
  try { fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, "\n    ", e.message); }
}

const decode = s => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&rarr;/g, "\u2192").replace(/&larr;/g, "\u2190").replace(/&middot;/g, "\u00b7").replace(/&amp;/g, "&")
  .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
function element(id) {                        // [opening tag, decoded inner text] of the element with this id
  const m = new RegExp(`<(\\w+)([^>]*\\bid="${id}"[^>]*)>([\\s\\S]*?)</\\1>`).exec(html);
  return m ? { tag: m[1], attrs: m[2], text: decode(m[3]) } : null;
}
const pos = s => { const i = html.indexOf(s); assert.ok(i >= 0, "missing " + s); return i; };

// ------------------------------------------------------------------ stub DOM
function load() {
  const draws = { n: 0 };
  const ctx = new Proxy({}, {
    get: (o, k) => k in o ? o[k] : (...a) => {
      draws.n++;
      for (const v of a) if (typeof v === "number" && !isFinite(v)) throw new Error("non-finite argument to " + String(k));
    },
    set: (o, k, v) => (o[k] = v, true),
  });
  const els = {};
  const TAGS = { driver: "SELECT", day: "SELECT", "rp-which": "SELECT", "rp-speed": "SELECT", "rp-scrub": "INPUT",
                 board: "CANVAS", prices: "CANVAS" };
  const VALUES = { driver: "1", day: "1", "rp-which": "you", "rp-speed": "8", "rp-scrub": "0" };
  const SIZES = { board: [640, 440], prices: [640, 120] };
  const el = id => els[id] = els[id] || {
    id, tagName: TAGS[id] || (id === "msg" || id === "replay" || id.startsWith("s-") || id.startsWith("rp-") ? "DIV" : "BUTTON"),
    value: VALUES[id] || "", textContent: "", innerHTML: "", title: "", hidden: id === "replay", disabled: false,
    max: "0", className: "", width: (SIZES[id] || [0])[0], height: (SIZES[id] || [0, 0])[1], dataset: {}, style: {},
    attrs: {}, listeners: {}, classList: { toggle() {} },
    setAttribute(k, v) { this.attrs[k] = String(v); }, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    blur() {}, focus() {}, getContext: () => ctx };
  const pads = ["charge", "idle", "discharge"].map(a => { const e = el("pad-" + a); e.dataset.act = a; return e; });
  const legend = [0, 1, 2, 3].map(i => ({ hidden: true, i }));
  let keydown = null; const frames = [];
  const win = {
    document: { getElementById: el, body: {}, addEventListener: (t, f) => { if (t === "keydown") keydown = f; },
                querySelectorAll: s => s === "[data-act]" ? pads : s === ".ref" ? legend : [] },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    matchMedia: () => ({ addEventListener() {} }),
    requestAnimationFrame: f => frames.push(f),
  };
  win.window = win; vm.createContext(win);
  for (const f of ["engine.js", "ui.js"]) vm.runInContext(fs.readFileSync(path.join(dir, f), "utf8"), win, { filename: f });
  const key = (k, { shift = false, tagName = "BODY" } = {}) => {
    let prevented = false;
    keydown({ key: k, shiftKey: shift, ctrlKey: false, metaKey: false, altKey: false, target: { tagName },
              preventDefault() { prevented = true; } });
    return prevented;
  };
  const click = id => (els[id].listeners.click || []).forEach(f => f({ target: els[id] }));
  const fire = (id, t, value) => { if (value !== undefined) els[id].value = String(value); els[id].listeners[t].forEach(f => f({ target: els[id] })); };
  const runFrames = (n, dt) => { let ts = 0; for (let i = 0; i < n && frames.length; i++) frames.shift()(ts += dt); };
  return { els: new Proxy(els, { get: (o, id) => el(id) }), key, click, fire, frames, runFrames, draws, legend, E: win.ChargeTrek };
}
// running line: "Step k of n · hh:mm · state of charge s % · net cost so far $c · reward r"
function line(u) {
  const m = /^Step (\d+) of (\d+) \u00b7 (\d\d:\d\d) \u00b7 state of charge (\d+) % \u00b7 net cost so far (-?\$\d+\.\d\d) \u00b7 reward (-?\d+\.\d\d)$/
    .exec(u.els["rp-text"].textContent);
  assert.ok(m, "running line: " + u.els["rp-text"].textContent);
  return { k: +m[1], n: +m[2], time: m[3], soc: +m[4], cost: m[5], reward: m[6] };
}
const snapshot = u => ["s-cost", "s-time", "s-soc", "s-price", "s-reward", "msg"].map(id => u.els[id].textContent).join("|");

// ------------------------------------------------------------------ page structure
test("page layout: header without citation, toolbar, board, status, replay bar, price chart; footer cites the paper", () => {
  const header = html.slice(pos("<header>"), pos("</header>"));
  assert.ok(header.includes('class="crumbs"') && header.includes("<h1>ChargeTrek</h1>"));
  assert.ok(!/doi|Applied Energy|Houalef/.test(header), "citation in the header");
  assert.strictEqual((header.match(/<p>/g) || []).length, 1, "one paragraph in the header");
  const footer = html.slice(pos("<footer>"), pos("</footer>"));
  assert.ok(footer.includes("doi.org/10.1016/j.apenergy.2026.127853") && footer.includes("independent browser version")
            && footer.includes("README.md"));
  // left panel: toolbar row (driver, day, Next day, Restart, Undo), board, #msg, replay bar, then the price chart
  const order = ['id="driver"', 'id="day"', 'id="next"', 'id="restart"', 'id="undo"', 'id="board"', 'id="msg"',
                 'id="replay"', 'id="prices"'].map(pos);
  assert.deepStrictEqual(order, order.slice().sort((a, b) => a - b));
  assert.ok(/id="msg" role="status"/.test(html));
  // right panel: Your game, References on this instance, actions row (watch then refs), pad, help
  const side = ['>Your game<', 'id="s-cost"', 'id="s-time"', 'id="s-soc"', 'id="s-price"', 'id="s-reward"',
                '>References on this instance<', 'id="s-opt"', 'id="s-imm"', 'id="s-step"', 'id="watch"', 'id="refs"',
                'class="pad"', 'class="help"'].map(pos);
  assert.deepStrictEqual(side, side.slice().sort((a, b) => a - b));
  assert.ok(html.includes("<span>Net cost (lower is better)</span>"));
  // swatches in the colours of the overlay
  for (const [c, name] of [["#0072B2", "Optimum (perfect information)"], ["#E69F00", "Charge immediately"],
                           ["#CC79A7", "Stepwise replanning"]])
    assert.ok(html.includes(`<span class="sw" style="background:${c}"></span>${name}</span>`), name);
  assert.ok(!/spoil|seen before the end|Reveal/.test(html), "no spoiler confirmation");
});

test("labels: actions row and replay bar, exact characters, titles give the keys", () => {
  assert.strictEqual(element("watch").text, "Watch replays");
  assert.ok(/title="Watch replays \(W\)"/.test(element("watch").attrs));
  assert.strictEqual(element("refs").text, "Show references");
  assert.ok(/title="Show references \(O\)"/.test(element("refs").attrs));
  const want = { "rp-start": "\u21E4 Start", "rp-back": "\u2190 Back", "rp-play": "\u25B6 Play",
                 "rp-fwd": "Forward \u2192", "rp-end": "End \u21E5", "rp-close": "\u2715 Close" };
  for (const id in want) {
    const e = element(id);
    assert.ok(e && e.tag === "button", id);
    assert.strictEqual(e.text, want[id]);
    assert.ok(/title="[^"]*\([^)]+\)"/.test(e.attrs) && /aria-label="[^"]*\([^)]+\)"/.test(e.attrs), id + " title/aria-label");
  }
  for (const id of ["rp-back", "rp-fwd", "rp-start", "rp-end"]) assert.ok(!/[\u25B6\u25C0\u25BA\u25C4]/.test(want[id]));
  const which = html.slice(pos('id="rp-which"'));
  const opts = [...which.slice(0, which.indexOf("</select>"))
    .matchAll(/<option value="(\w+)">([^<]+)<\/option>/g)].map(m => [m[1], m[2]]);
  assert.deepStrictEqual(opts, [["you", "Watch: Your game"], ["opt", "Watch: Optimum"],
                                ["imm", "Watch: Charge immediately"], ["step", "Watch: Stepwise replanning"]]);
  assert.ok(html.includes('id="rp-scrub" type="range"') && html.includes('id="rp-speed"') && html.includes('id="rp-text"'));
  // replay bar order: Watch, Start, Back, Play, Forward, End, Speed, Close, then scrubber, then running line
  const order = ["rp-which", "rp-start", "rp-back", "rp-play", "rp-fwd", "rp-end", "rp-speed", "rp-close", "rp-scrub", "rp-line"]
    .map(id => pos(`id="${id}"`));
  assert.deepStrictEqual(order, order.slice().sort((a, b) => a - b));
});

// ------------------------------------------------------------------ behaviour
test("start: messages, stats and references shown, replay bar hidden", () => {
  const u = load();
  assert.ok(u.els.msg.textContent.startsWith("Plugged in at"));
  assert.strictEqual(u.els.replay.hidden, true);
  assert.strictEqual(u.els["s-cost"].textContent, "$0.00");
  for (const id of ["s-opt", "s-imm", "s-step"]) assert.ok(/^-?\$\d+\.\d\d$/.test(u.els[id].textContent), id);
  assert.ok(u.draws.n > 100);
});

test("O shows and hides the references at any time, without confirmation; the game is unchanged", () => {
  const u = load();
  u.key("c"); u.key("i");
  const before = snapshot(u);
  assert.strictEqual(u.key("o"), false);                    // O is not consumed by a dialog
  assert.strictEqual(u.els.refs.textContent, "Hide references");
  assert.ok(u.legend.every(e => !e.hidden));
  assert.strictEqual(snapshot(u), before);
  u.click("refs");
  assert.strictEqual(u.els.refs.textContent, "Show references");
  assert.ok(u.legend.every(e => e.hidden));
  assert.strictEqual(snapshot(u), before);
  u.key("c");                                              // the game goes on
  assert.notStrictEqual(snapshot(u), before);
});

test("W opens the replay bar before departure without confirmation; keys act on the replay only; Esc restores", () => {
  const u = load();
  for (const k of ["c", "c", "i", "d", "c"]) u.key(k);
  const before = snapshot(u);
  u.key("w");
  assert.strictEqual(u.els.replay.hidden, false);
  let r = line(u);
  assert.strictEqual(r.k, 0); assert.strictEqual(r.n, 5); assert.strictEqual(r.cost, "$0.00");
  // game keys do nothing to the game while the bar is open
  for (const k of ["c", "i", "d", "z", "r", "n", "p", "o", "Backspace"]) u.key(k);
  assert.strictEqual(snapshot(u), before);
  assert.strictEqual(u.els.refs.textContent, "Show references");
  assert.ok(u.els["pad-charge"].disabled, "pad disabled during the replay");
  // stepping
  u.key("ArrowRight"); assert.strictEqual(line(u).k, 1);
  u.key("ArrowRight", { shift: true }); assert.strictEqual(line(u).k, 5);       // clamped at n
  u.key("ArrowLeft"); assert.strictEqual(line(u).k, 4);
  u.key("Home"); assert.strictEqual(line(u).k, 0);
  u.key("End"); r = line(u);
  assert.strictEqual(r.k, 5);
  assert.strictEqual(r.cost, u.els["s-cost"].textContent);                       // ends on the current game
  assert.strictEqual(r.reward, u.els["s-reward"].textContent);
  assert.strictEqual(r.soc, parseInt(u.els["s-soc"].textContent, 10));
  assert.ok(u.els["s-time"].textContent.startsWith(r.time));
  u.key("Escape");
  assert.strictEqual(u.els.replay.hidden, true);
  assert.strictEqual(snapshot(u), before);
  assert.ok(!u.els["pad-charge"].disabled);
  u.key("w"); assert.strictEqual(u.els.replay.hidden, false);
  u.key("w"); assert.strictEqual(u.els.replay.hidden, true);                    // W also closes
  u.click("watch"); assert.strictEqual(u.els.replay.hidden, false);
  u.click("rp-close"); assert.strictEqual(u.els.replay.hidden, true);
  assert.strictEqual(snapshot(u), before);
});

test("each replay ends on the values of the stats grids (finished game and mid-game)", () => {
  for (const finish of [true, false]) {
    const u = load();
    const T = u.E.makeLevel(1, 1).T;
    const acts = ["c", "i", "d"];
    for (let t = 0; t < (finish ? T : 7); t++) u.key(acts[(t * 7) % 3]);
    if (finish) assert.ok(u.els.msg.textContent.startsWith("Departure:"));
    u.key("w");
    const seen = [];
    for (const [which, stat] of [["you", "s-cost"], ["opt", "s-opt"], ["imm", "s-imm"], ["step", "s-step"]]) {
      assert.strictEqual(u.els["rp-which"].value, which);
      u.key("End");
      const r = line(u);
      assert.strictEqual(r.cost, u.els[stat].textContent, which);
      assert.strictEqual(r.n, which === "you" ? (finish ? T : 7) : T);
      if (which === "you") {
        assert.strictEqual(r.reward, u.els["s-reward"].textContent);
        assert.strictEqual(r.soc, parseInt(u.els["s-soc"].textContent, 10));
      } else assert.strictEqual(r.soc, u.E.makeLevel(1, 1).goal);   // the references meet the target
      seen.push(which);
      u.key("Home"); assert.strictEqual(line(u).k, 0); assert.strictEqual(line(u).cost, "$0.00");
      u.key("ArrowDown");
    }
    assert.strictEqual(u.els["rp-which"].value, "you");                          // wraps around
    u.key("ArrowUp"); assert.strictEqual(u.els["rp-which"].value, "step");
    // the selector keeps the step: compare two schedules at the same time
    u.key("ArrowRight", { shift: true }); u.key("ArrowUp");
    assert.strictEqual(u.els["rp-which"].value, "imm"); assert.strictEqual(line(u).k, 10);
    // the change event of the selector
    u.fire("rp-which", "change", "opt"); assert.strictEqual(line(u).k, 10);
    u.key("End"); assert.strictEqual(line(u).cost, u.els["s-opt"].textContent);
    u.key("Escape");
  }
});

test("play / pause, speed, buttons and scrubber", () => {
  const u = load();
  for (let t = 0; t < 12; t++) u.key("c");
  u.key("w");
  u.key(" ");
  assert.strictEqual(u.els["rp-play"].textContent, "\u275A\u275A Pause");
  assert.strictEqual(u.els["rp-play"].attrs["aria-label"], "Pause (Space or K)");
  u.runFrames(3, 250);                                       // 8 steps/s, 0.5 s after the first frame: 4 steps
  assert.strictEqual(line(u).k, 4);
  u.key("k");                                                // pause
  assert.strictEqual(u.els["rp-play"].textContent, "\u25B6 Play");
  u.runFrames(5, 250); assert.strictEqual(line(u).k, 4);
  u.key("+"); assert.strictEqual(u.els["rp-speed"].value, "16");
  u.key("-"); u.key("-"); assert.strictEqual(u.els["rp-speed"].value, "4");
  u.key("="); u.key("+"); u.key("+"); u.key("+"); assert.strictEqual(u.els["rp-speed"].value, "32");
  u.key(" "); u.runFrames(100, 250);                         // plays to the end, then stops
  assert.strictEqual(line(u).k, 12);
  assert.strictEqual(u.els["rp-play"].textContent, "\u25B6 Play");
  u.click("rp-start"); assert.strictEqual(line(u).k, 0);
  u.click("rp-fwd"); u.click("rp-fwd"); assert.strictEqual(line(u).k, 2);
  u.click("rp-back"); assert.strictEqual(line(u).k, 1);
  u.click("rp-end"); assert.strictEqual(line(u).k, 12);
  u.fire("rp-scrub", "input", 6); assert.strictEqual(line(u).k, 6);
  assert.strictEqual(u.els["rp-scrub"].max, "12"); assert.strictEqual(u.els["rp-scrub"].value, "6");
  u.click("rp-play"); assert.strictEqual(u.els["rp-play"].textContent, "\u275A\u275A Pause");
  u.click("rp-close"); assert.strictEqual(u.els.replay.hidden, true);
  u.runFrames(10, 250);                                      // a closed bar does not keep playing
  assert.strictEqual(u.els.replay.hidden, true);
});

test("toolbar actions close the replay; game keys work again after closing; a focused link keeps Enter", () => {
  const u = load();
  u.key("c"); u.key("w");
  u.click("restart");
  assert.strictEqual(u.els.replay.hidden, true);
  assert.strictEqual(u.els["s-cost"].textContent, "$0.00");
  u.key("c"); assert.notStrictEqual(u.els["s-cost"].textContent, "$0.00");
  u.key("w"); u.click("next");
  assert.strictEqual(u.els.replay.hidden, true); assert.strictEqual(u.els.day.value, "2");
  // finished game: Enter goes to the next day, but not when a link has the focus
  const T = u.E.makeLevel(1, 2).T;
  for (let t = 0; t < T; t++) u.key("i");
  u.key("Enter", { tagName: "A" }); assert.strictEqual(u.els.day.value, "2");
  u.key("Enter"); assert.strictEqual(u.els.day.value, "3");
});

console.log(failed ? `${failed} test(s) failed` : "all tests passed");
process.exit(failed ? 1 : 0);
