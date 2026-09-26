/*
 * live-harness.js — injected by `lab.js serve` into the game page BEFORE the game boots.
 * Classic script (not a module). Gives a cheap "mind/eyes/hands" persona session:
 *   - Clock: requestAnimationFrame runs on a fake clock. The game is frozen until __live.act()
 *     advances it, and then runs as fast as the CPU allows (no real-time waiting, no hidden-pane stalls).
 *   - Hands: a plan of low-level player verbs (moveTo / hold / release / key) executed at game-time offsets.
 *   - Eyes: text drawn on canvas (fillText) + visible DOM text + the game's perception module
 *     (window.__labGame, from <game>/.playtest/perception.js) describing ONLY what is on screen.
 *   - Log: every act() is POSTed to /__lab/log for replay review.
 */
(function () {
  'use strict';
  const FRAME_MS = 1000 / 60;
  const queue = [];
  let fakeNow = performance.now();
  let frame = 0;
  let framesLeft = 0;
  let pumping = false;
  let onDone = null;

  // Visible-tab illusion: the pane may be hidden; games that pause on visibilitychange must keep running.
  try {
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => 'visible' });
  } catch (e) { /* ignore */ }

  window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
  window.cancelAnimationFrame = () => {};

  // Canvas text drawn during the latest frame = what the player can read.
  let frameText = [];
  let lastFrameText = [];
  const origFill = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
    const s = String(text).trim();
    if (s && this.globalAlpha > 0.05) frameText.push(s);
    return origFill.call(this, text, ...rest);
  };

  // ---------------------------------------------------------------- hands
  let plan = [];
  let planStart = 0;
  let pointer = null; // logical coords
  let held = false;

  function target() { return document.querySelector('canvas') || document.body; }
  function toClient(x, y) {
    const g = window.__labGame;
    if (g && g.toClient) return g.toClient(x, y);
    const r = target().getBoundingClientRect();
    return { x: r.left + x, y: r.top + y };
  }
  function pointerEvent(type, x, y) {
    const c = toClient(x, y);
    const init = { bubbles: true, cancelable: true, clientX: c.x, clientY: c.y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: held || type === 'pointerdown' ? 1 : 0 };
    target().dispatchEvent(new PointerEvent(type, init));
  }
  function key(type, k) {
    const code = k === ' ' ? 'Space' : k;
    for (const t of [window, document]) t.dispatchEvent(new KeyboardEvent(type, { key: k, code, bubbles: true }));
  }
  function runStep(s) {
    if (s.moveTo) { pointer = { x: s.moveTo[0], y: s.moveTo[1] }; pointerEvent('pointermove', pointer.x, pointer.y); }
    if (s.hold === true && !held) { const p = pointer || { x: 480, y: 300 }; pointerEvent('pointerdown', p.x, p.y); held = true; }
    if ((s.hold === false || s.release) && held) { const p = pointer || { x: 480, y: 300 }; held = false; pointerEvent('pointerup', p.x, p.y); }
    if (s.keyDown) key('keydown', s.keyDown);
    if (s.keyUp) key('keyup', s.keyUp);
    if (s.tap) { const p = s.tap; pointer = { x: p[0], y: p[1] }; pointerEvent('pointermove', p[0], p[1]); held = true; pointerEvent('pointerdown', p[0], p[1]); held = false; pointerEvent('pointerup', p[0], p[1]); }
  }

  // ---------------------------------------------------------------- clock
  function pump() {
    pumping = true;
    const deadline = performance.now() + 12; // yield to the browser regularly
    while (framesLeft > 0 && performance.now() < deadline) {
      const t = (frame - planStart) / 60;
      while (plan.length && plan[0].at <= t) runStep(plan.shift());
      frameText = [];
      fakeNow += FRAME_MS;
      const cbs = queue.splice(0);
      for (const cb of cbs) { try { cb(fakeNow); } catch (e) { errors.push(String(e && e.message || e)); } }
      if (frameText.length) lastFrameText = frameText;
      if (window.__labGame && window.__labGame.onFrame) window.__labGame.onFrame();
      frame += 1;
      framesLeft -= 1;
    }
    if (framesLeft > 0) setTimeout(pump, 0);
    else { pumping = false; const d = onDone; onDone = null; if (d) d(); }
  }
  function advance(seconds) {
    return new Promise((resolve) => {
      framesLeft = Math.max(1, Math.round(seconds * 60));
      onDone = resolve;
      if (!pumping) setTimeout(pump, 0);
    });
  }

  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.message));

  function visibleDomText() {
    const out = [];
    document.querySelectorAll('body *:not(script):not(style):not(canvas)').forEach((el) => {
      if (el.children.length) return;
      const s = (el.textContent || '').trim();
      if (!s) return;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.05 || el.hidden) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push(s);
    });
    return out;
  }

  // Session config injected by `lab.js serve` (window.__labConfig):
  //   fidelity: 'human' (default) = salience-limited, vague like real eyes; 'full' = exact state
  //   visionFirstSeconds: during this opening window the scene text is withheld; look at screenshots instead
  const cfg = Object.assign({ fidelity: 'human', visionFirstSeconds: 0 }, window.__labConfig || {});

  // Salience helpers for perception modules (loaded after this script). Exact counts, positions and
  // far-away events make a game look clearer to a persona than pixels do to a human, so 'human'
  // fidelity should describe the scene through these. Example: examples/mothlight.perception.js.
  window.__labSalience = {
    /** 0 → 'no', 2 → 'a couple of', 4 → 'a few', 9 → 'several', 30 → 'lots of'. */
    vague(n) { return n === 0 ? 'no' : n <= 2 ? 'a couple of' : n <= 5 ? 'a few' : n <= 12 ? 'several' : 'lots of'; },
    /** Round a coordinate to a grid step, like a glance does. */
    snap(n, step = 20) { return Math.round(n / step) * step; },
    /** Coarse screen region ('top-left', 'center of the screen', ...) for a point in a w × h screen. */
    region(x, y, w, h) {
      const col = x < w / 3 ? 'left' : x < (2 * w) / 3 ? 'middle' : 'right';
      const row = y < h / 3 ? 'top' : y < (2 * h) / 3 ? 'center' : 'bottom';
      return row === 'center' && col === 'middle' ? 'center of the screen' : `${row}-${col}`;
    },
    /** True when a point is within the player's focus (e.g. their avatar or cursor). Big, obvious events should skip this. */
    near(p, focus, radius = 220) { return !!p && !!focus && Math.hypot(p.x - focus.x, p.y - focus.y) < radius; },
  };

  function perceive() {
    const g = window.__labGame;
    const gameTime = frame / 60;
    const vision = gameTime < cfg.visionFirstSeconds;
    const happened = g && g.drainEvents ? g.drainEvents(cfg.fidelity) : [];
    return {
      gameTime: +gameTime.toFixed(1),
      screenText: [...new Set([...lastFrameText, ...visibleDomText()])].slice(0, 20),
      scene: vision ? `(vision phase until ${cfg.visionFirstSeconds}s of game time: take a screenshot at scale 0.4 to see the screen)`
        : g && g.describe ? g.describe(cfg.fidelity) : '(no perception module)',
      happened: vision ? [] : happened,
      yourInput: { pointer: pointer && { x: Math.round(pointer.x), y: Math.round(pointer.y) }, holding: held },
      errors: errors.splice(0),
    };
  }

  const log = [];
  const logged = { notes: 0, issues: 0, done: false };
  let personaName = '';
  async function record(kind, body) {
    const r = await fetch(`/__lab/record/${kind}`, { method: 'POST', body: JSON.stringify(Object.assign({ persona: personaName }, body)) }).then((x) => x.json());
    if (!r.ok) throw new Error(`${kind} not saved: ${r.error}`);
    return r.saved;
  }
  window.__live = {
    /** Feedback note (include game time). */
    async note(text) { await record('note', { text: `[${(frame / 60).toFixed(0)}s] ${text}` }); logged.notes++; return 'noted'; },
    /** Real problem: {title, severity:'P0'..'P3', category, evidence, repro}. */
    async issue(i) { const r = await record('issue', i); logged.issues++; return `issue logged [${r.severity}] ${r.title}`; },
    /** Final verdict: {rating, replay, summary, unsure:[3 moments], scores:{clarity10s,clarity60s,agency,tension,reward,replay},
     *  issues:[{title, severity, category, evidence, repro}] (or noIssues:true)}. */
    async done(d) { const r = await record('done', d); logged.done = true; return `recorded: ${r.rating}/5`; },
    /** Queue verbs, advance game time, return what a player would perceive. */
    async act(opts = {}) {
      const seconds = Math.min(Math.max(Number(opts.seconds) || 5, 0.1), 60);
      planStart = frame;
      plan = (opts.plan || []).map((s) => Object.assign({ at: 0 }, s)).sort((a, b) => a.at - b.at);
      await advance(seconds);
      while (plan.length) runStep(plan.shift());
      if (opts.persona) personaName = opts.persona;
      const p = perceive();
      p.yourLog = `${logged.notes} notes, ${logged.issues} issues, verdict ${logged.done ? 'recorded' : 'NOT recorded yet (__live.done)'}`;
      const entry ={ persona: opts.persona || '', note: opts.note || '', plan: opts.plan || [], seconds, perception: p };
      log.push(entry);
      if (opts.persona) fetch('/__lab/log', { method: 'POST', body: JSON.stringify(entry) }).catch(() => {});
      return p;
    },
    perceive,
    config: cfg,
    info: () => ({ coords: window.__labGame && window.__labGame.coords, verbs: 'plan items: {at: s, moveTo:[x,y]} {at, hold:true} {at, release:true} {at, keyDown:" "} {at, keyUp:" "} {at, tap:[x,y]}' }),
    log,
  };
})();
