// Minimal deterministic game for tests: walk to a target on a line before time runs out.
export const meta = { name: 'LineTest', dt: 1 / 10, decisionEvery: 1, maxSeconds: 5 };

export function create(seed) {
  return { x: 0, target: 3 + (seed % 5), t: 0, reached: false, crash: seed === 13 };
}
export function observe(s) { return { x: s.x, target: s.target }; }
export function step(s, a, dt) {
  if (s.crash) throw new Error('boom (seed 13)');
  s.t += dt;
  s.x += (a.move || 0) * dt * 2;
  if (Math.abs(s.x - s.target) < 0.2) s.reached = true;
}
export const done = (s) => s.reached || s.t >= 4;
export const metrics = (s) => ({ reached: s.reached ? 1 : 0, time: s.t });
export const idleAction = () => ({ move: 0 });
export const randomAction = (_o, rng) => ({ move: rng.pick([-1, 0, 1]) });
export const policies = { seeker: (o) => ({ move: Math.sign(o.target - o.x) }) };
export function findings(p) {
  return p.seeker && p.seeker.metrics.reached.mean < 0.5 ? [{ title: 'seeker cannot reach target', severity: 'P1' }] : [];
}
