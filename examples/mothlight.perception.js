/*
 * Mothlight perception module for the live persona harness. Copy to <game>/.playtest/perception.js.
 * Describes ONLY what a player can see, in visual terms — never internal names like "hazard",
 * "lethal", "delivered". Coordinates are logical pixels (960 x 540, origin top-left).
 *
 * fidelity 'human' (default): salience-limited like real eyes — tiny dots get vague quantities and
 * coarse regions, only events near where the player is looking (their orb) are noticed, and no
 * cause-and-effect wording. fidelity 'full': exact counts and every event (for debugging).
 */
(function () {
  'use strict';
  const FOCUS_RADIUS = 220;
  const events = [];
  const round = (n) => Math.round(n);
  const snap = (n) => Math.round(n / 20) * 20;
  const g = () => window.__mothlight && window.__mothlight.game;

  const LOOK = {
    moon: ['big white glowing circle', 'with a solid blue ring'],
    candle: ['small orange flame', 'with a dashed red-orange ring'],
    zapper: ['cyan grid', 'with a short-dashed cyan ring'],
    flower: ['pink flower', 'with a dotted pink ring'],
  };
  const SEEN_FULL = {
    moth_delivered: 'a speck flew into the big white circle and vanished',
    moth_candled: 'a speck burned up at an orange flame',
    moth_zapped: 'a speck was zapped at a cyan grid',
    moth_singed: 'a speck close to your orb flashed red and turned to ash',
    moth_lost: 'a speck drifted off the edge of the screen',
    moth_joined: 'a speck started circling your orb',
    light_on: 'a new light switched on',
    night_end: 'the sky is turning to dawn',
    night_start: 'the scene changed, specks start appearing',
  };
  // What a human glancing at the screen would plausibly register — no causes, no names.
  const SEEN_HUMAN = {
    moth_delivered: 'a faint dot near the big white circle disappeared',
    moth_candled: 'a faint dot near an orange flame flared and disappeared',
    moth_zapped: 'a faint dot near a cyan grid sparked and disappeared',
    moth_singed: 'a dot right next to your orb flashed red and disappeared',
    light_on: 'something new lit up',
    night_end: 'the sky is getting lighter',
    night_start: 'the title text is gone; the scene looks different',
  };
  const ALWAYS_NOTICED = new Set(['light_on', 'night_end', 'night_start']);

  function vague(n) {
    if (n === 0) return 'no';
    if (n <= 2) return 'a couple of';
    if (n <= 5) return 'a few';
    if (n <= 12) return 'several';
    return 'lots of';
  }
  function region(x, y) {
    const h = x < 320 ? 'left' : x < 640 ? 'middle' : 'right';
    const v = y < 180 ? 'top' : y < 360 ? 'center' : 'bottom';
    return v === 'center' && h === 'middle' ? 'center of the screen' : `${v}-${h}`;
  }
  function clusters(points, maxN) {
    const cs = [];
    for (const p of points) {
      let best = null;
      for (const c of cs) if (Math.hypot(c.x - p.x, c.y - p.y) < 120) { best = c; break; }
      if (best) { best.x = (best.x * best.n + p.x) / (best.n + 1); best.y = (best.y * best.n + p.y) / (best.n + 1); best.n++; } else cs.push({ x: p.x, y: p.y, n: 1 });
    }
    return cs.sort((a, b) => b.n - a.n).slice(0, maxN);
  }

  window.__labGame = {
    coords: 'logical pixels, x 0..960 left→right, y 0..540 top→bottom',
    toClient(x, y) {
      const r = window.__mothlight.renderer;
      const rect = r.canvas.getBoundingClientRect();
      return { x: rect.left + r.offsetX + x * r.scale, y: rect.top + r.offsetY + y * r.scale };
    },
    onFrame() {
      const game = g();
      if (!game) return;
      const L = game.lantern;
      for (const e of game.events) {
        if (!SEEN_FULL[e.type]) continue;
        const near = e.x === undefined || Math.hypot(e.x - L.x, e.y - L.y) < FOCUS_RADIUS;
        events.push({ type: e.type, near });
      }
    },
    drainEvents(fidelity = 'human') {
      const counts = {};
      for (const e of events.splice(0)) {
        let what;
        if (fidelity === 'full') what = SEEN_FULL[e.type];
        else if (SEEN_HUMAN[e.type] && (e.near || ALWAYS_NOTICED.has(e.type))) what = SEEN_HUMAN[e.type];
        if (what) counts[what] = (counts[what] || 0) + 1;
      }
      return Object.entries(counts).map(([what, n]) => (fidelity === 'full' ? `${n}× ${what}` : `${n > 1 ? vague(n) + ' times: ' : ''}${what}`));
    },
    describe(fidelity = 'human') {
      const game = g();
      if (!game) return 'loading';
      const human = fidelity !== 'full';
      const L = game.lantern;
      const b = L.brightness;
      const glow = b < 0.05 ? 'dark (tiny ember)' : b < 0.4 ? 'faint glow' : b < 0.75 ? 'bright glow' : 'blazing glow';
      const out = [];
      out.push(`screen: ${game.state === 'title' ? 'title screen' : game.state === 'night' ? 'playing' : 'dawn / end screen'}`);
      const ring = b >= 0.05 ? (human ? ', a faint amber ring around it' : `, faint amber ring radius ~${round(40 + 220 * b)}`) : '';
      out.push(`your warm orb at (${human ? snap(L.x) : round(L.x)},${human ? snap(L.y) : round(L.y)}), ${glow}${ring}`);
      const lights = (game.world ? [game.world.moon, ...game.world.candles, ...game.world.zappers, ...game.world.flowers] : []).filter(Boolean);
      for (const l of lights) {
        const lit = l.active && l.intensity > 0.02;
        const [what, ringLook] = LOOK[l.kind] || [l.kind, ''];
        if (human && !lit && l.kind !== 'moon') { out.push(`dim shape (${what.replace(/^(small|big) /, '')}?) at (${snap(l.x)},${snap(l.y)})`); continue; }
        const pos = human ? `(${snap(l.x)},${snap(l.y)})` : `(${round(l.x)},${round(l.y)})`;
        out.push(`${lit ? '' : 'unlit '}${what}${lit ? ' ' + ringLook : ''} at ${pos}${lit && l.range && !human ? `, ring radius ~${round(l.range)}` : ''}`);
      }
      const alive = (game.swarm ? game.swarm.moths : []).filter((m) => m.status !== 'delivered' && m.status !== 'lost' && m.status !== 'singed' && m.status !== 'captured');
      if (!human) {
        const circling = alive.filter((m) => m.targetId === 'lantern').length;
        const reddish = alive.filter((m) => (m.heat || 0) > 0.4).length;
        out.push(`tiny moving specks: ${alive.length} on screen${circling ? `, ${circling} circling your orb` : ''}${reddish ? `, ${reddish} of them glowing red` : ''}`);
        for (const c of clusters(alive.filter((m) => m.targetId !== 'lantern'), 4)) out.push(`  group of ${c.n} specks around (${round(c.x)},${round(c.y)})`);
        return out.join('\n');
      }
      // Human eyes: dots near the orb are noticeable, far ones are just faint clusters by region.
      const near = alive.filter((m) => Math.hypot(m.x - L.x, m.y - L.y) < FOCUS_RADIUS);
      const far = alive.filter((m) => Math.hypot(m.x - L.x, m.y - L.y) >= FOCUS_RADIUS);
      const reddish = near.filter((m) => (m.heat || 0) > 0.4).length;
      out.push(`near your orb: ${vague(near.length)} tiny dots${reddish ? `, ${vague(reddish)} of them tinted red` : ''}`);
      const groups = clusters(far, 3).filter((c) => c.n >= 3);
      if (groups.length) out.push(`elsewhere: faint dots in the ${groups.map((c) => region(c.x, c.y)).join(', ')}`);
      return out.join('\n');
    },
  };
})();
