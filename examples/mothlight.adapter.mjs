// Playtest Lab adapter for Mothlight (a small web game built by ai-game-studio). Copy to <game>/.playtest/adapter.mjs.
// Imports the game's DOM-free sim modules relative to the game folder.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const GAME = join(dirname(fileURLToPath(import.meta.url)), '..', 'Game');
const mod = (f) => import(new URL(`file:///${join(GAME, 'js', f).replace(/\\/g, '/')}`).href);
const { DEFAULT_TUNING, mergeTuning, SIM } = await mod('config.js');
const { STATE, createGame, stepGame, startNight, createInputFrame, lanternRange } = await mod('state.js');
const { MOTH_STATUS } = await mod('moths.js');
const { getLights, LIGHT_KIND } = await mod('world.js');

let tuning = DEFAULT_TUNING;
try { tuning = mergeTuning(DEFAULT_TUNING, JSON.parse(readFileSync(join(GAME, 'data', 'tuning.json'), 'utf8'))); } catch {}

export const meta = { name: 'Mothlight', dt: 1 / (SIM.TICK_RATE || 60), decisionEvery: 6, maxSeconds: tuning.night.length_s + 30 };

export function create(seed) {
  const game = createGame(tuning, seed);
  startNight(game, seed);
  return game;
}

export function observe(g) {
  const lights = getLights(g.world).map((l) => ({ kind: l.kind, x: Math.round(l.x), y: Math.round(l.y), range: Math.round(l.range || 0), lethal: !!l.lethal }));
  const alive = g.swarm.moths.filter((m) => m.status === MOTH_STATUS.FREE || m.status === MOTH_STATUS.DRAWN);
  const following = alive.filter((m) => m.targetId === 'lantern').length;
  const free = alive.filter((m) => m.targetId !== 'lantern');
  let nearest = null; let nd = Infinity;
  for (const m of free) { const d = Math.hypot(m.x - g.lantern.x, m.y - g.lantern.y); if (d < nd) { nd = d; nearest = { x: Math.round(m.x), y: Math.round(m.y), dist: Math.round(d) }; } }
  const moon = lights.find((l) => l.kind === LIGHT_KIND.MOON) || null;
  const hot = g.swarm.moths.reduce((a, m) => Math.max(a, m.heat || 0), 0);
  return {
    t: +g.night.elapsed.toFixed(1), left: +(g.night.length - g.night.elapsed).toFixed(1),
    lantern: { x: Math.round(g.lantern.x), y: Math.round(g.lantern.y), b: +g.lantern.brightness.toFixed(2), range: Math.round(lanternRange(g.lantern.brightness, tuning)) },
    following, freeMoths: free.length, nearestFree: nearest, moon, hazards: lights.filter((l) => l.lethal), maxHeat: +hot.toFixed(2),
    score: { ...g.score, combo: undefined },
  };
}

export function step(g, a, dt) {
  stepGame(g, createInputFrame({ x: a.x ?? g.lantern.x, y: a.y ?? g.lantern.y, held: !!a.held, hasPointer: true }), dt);
}

export const done = (g) => g.state === STATE.DAWN;

export function metrics(g) {
  const s = g.score;
  const spawned = s.delivered + s.singed + s.lostToLights + s.lost;
  return { points: s.points, delivered: s.delivered, singed: s.singed, lostToLights: s.lostToLights, drifted: s.lost, hazardLossPct: spawned ? (100 * s.lostToLights) / spawned : 0 };
}

export const idleAction = (o) => ({ x: o.lantern.x, y: o.lantern.y, held: false });
export const randomAction = (o, rng) => ({ x: rng.range(40, 920), y: rng.range(60, 500), held: rng.next() < 0.5 });

// Carrier: gather moths with moderate glow, then carry them to the moon and go dark.
function carrier(o, _rng, memo, { greedyGlow = false, avoid = true } = {}) {
  const L = o.lantern;
  if (!memo.mode) memo.mode = 'gather';
  if (memo.mode === 'gather' && (o.following >= 8 || (o.following >= 3 && !o.nearestFree))) memo.mode = 'carry';
  if (memo.mode === 'carry' && o.following === 0) memo.mode = 'gather';
  let tx = L.x; let ty = L.y; let held = true;
  if (memo.mode === 'gather' && o.nearestFree) { tx = o.nearestFree.x; ty = o.nearestFree.y; }
  if (memo.mode === 'carry' && o.moon) {
    tx = o.moon.x; ty = o.moon.y + 30;
    if (Math.hypot(o.moon.x - L.x, o.moon.y - L.y) < (o.moon.range || 200) * 0.6) held = false;
  }
  if (avoid) for (const h of o.hazards) { const d = Math.hypot(h.x - L.x, h.y - L.y); if (d < h.range + 40) { tx += (L.x - h.x) * 0.8; ty += (L.y - h.y) * 0.8; } }
  if (!greedyGlow && held && (L.b > 0.72 || o.maxHeat > 0.5)) held = false; // pulse to avoid singeing
  return { x: tx, y: ty, held };
}

export const policies = {
  carrier: (o, r, m) => carrier(o, r, m),
  'full-glow': (o, r, m) => carrier(o, r, m, { greedyGlow: true, avoid: false }),
};

export function actionMenu(o) {
  const L = o.lantern; const step = 80;
  const moves = [['stay', 0, 0], ['up', 0, -step], ['down', 0, step], ['left', -step, 0], ['right', step, 0]];
  const menu = [];
  for (const [n, dx, dy] of moves) for (const held of [true, false]) menu.push({ id: `${n}-${held ? 'glow' : 'dark'}`, label: `${n}, ${held ? 'glow' : 'dark'}`, action: { x: L.x + dx, y: L.y + dy, held } });
  if (o.moon) menu.push({ id: 'to-moon-dark', label: 'go to moon and go dark', action: { x: o.moon.x, y: o.moon.y + 30, held: false } });
  if (o.nearestFree) menu.push({ id: 'to-moths-glow', label: 'go to nearest free moths glowing', action: { x: o.nearestFree.x, y: o.nearestFree.y, held: true } });
  return menu;
}

export function findings(p) {
  const out = [];
  const m = (pol, k) => p[pol] && p[pol].metrics[k] && p[pol].metrics[k].mean;
  if (m('idle', 'hazardLossPct') > 50) out.push({ title: `Idle player loses ${m('idle', 'hazardLossPct').toFixed(0)}% of moths to hazards`, category: 'balance', severity: 'P2', evidence: 'bot:idle mean hazardLossPct' });
  if (p.carrier && p.idle && m('carrier', 'delivered') < m('idle', 'delivered') * 1.3) out.push({ title: 'Competent play barely beats doing nothing', category: 'balance', severity: 'P1', evidence: `carrier delivered ${m('carrier', 'delivered').toFixed(1)} vs idle ${m('idle', 'delivered').toFixed(1)}` });
  if (m('full-glow', 'singed') !== undefined && m('full-glow', 'singed') < 3) out.push({ title: 'Singe is not a threat even at full glow', category: 'balance', severity: 'P2', evidence: `full-glow singed ${m('full-glow', 'singed').toFixed(1)}` });
  return out;
}
