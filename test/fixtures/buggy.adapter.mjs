// Deterministic game with one planted bug per seed, for bug-pack tests. globalThis.__buggyFixed = true "fixes" them.
//   seed 2: hp goes negative (invariant)   seed 3: throws once x reaches 3 (crash)
//   seed 4: console.error once (logged error)   seed 5: never ends (softlock)
export const meta = { name: 'Buggy', dt: 0.1, decisionEvery: 2, maxSeconds: 3 };

const fixed = () => !!globalThis.__buggyFixed;

export function create(seed) { return { seed, t: 0, x: 0, hp: 3, warned: false }; }
export function observe(s) { return { x: s.x, t: +s.t.toFixed(1) }; }
export function step(s, a, dt) {
  s.t += dt;
  s.x += a.move || 0;
  if (s.seed === 2 && s.t > 1 && !fixed()) s.hp = -1;
  if (s.seed === 3 && s.x >= 3 && !fixed()) throw new Error(`fell through the floor at x=${s.x}`);
  if (s.seed === 4 && s.t > 0.5 && !s.warned && !fixed()) { console.error('texture missing: id 42'); s.warned = true; }
}
export const done = (s) => (s.seed === 5 && !fixed() ? false : s.t >= 2 - 1e-9);
export const metrics = (s) => ({ x: s.x, hp: s.hp });
export const invariants = (s) => (s.hp < 0 ? [{ id: 'hp-non-negative', message: `hp is ${s.hp}` }] : []);
export const policies = { walker: (_o, rng) => ({ move: rng.pick([0, 1]) }) };
