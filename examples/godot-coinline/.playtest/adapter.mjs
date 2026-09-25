// Playtest Lab adapter for the Godot CoinLine sample — runs the project headless over the bridge.
// Set GODOT_BIN to your Godot 4 executable (e.g. "C:/Program Files/Godot/Godot_console.exe"); default "godot".
export const meta = { name: 'CoinLine (Godot)', dt: 1 / 60, decisionEvery: 6, maxSeconds: 40 };

export const bridge = {
  command: process.env.GODOT_BIN || 'godot',
  cwd: '.',
  args: ['--headless', '--fixed-fps', '60', '--path', '.', '--', '--playtestPort={PORT}'],
  startupTimeoutMs: 60000,
};

export const idleAction = () => ({ move: 0 });
export const randomAction = (_obs, rng) => ({ move: rng.pick([-1, 0, 1]) });

const DANGER = 1.2;

export const policies = {
  reckless: (o) => ({ move: Math.sign(o.coin - o.x) }),
  careful: (o) => {
    const dir = Math.sign(o.coin - o.x);
    const ahead = Math.sign(o.hazard - o.x) === dir;
    if (ahead && Math.abs(o.hazard - o.x) < DANGER) return { move: -dir };
    return { move: dir };
  },
};

export function findings(p) {
  const out = [];
  const m = (pol, k) => p[pol]?.metrics[k]?.mean;
  if (m('careful', 'score') !== undefined && m('careful', 'score') <= (m('reckless', 'score') ?? 0))
    out.push({ title: 'Careful play does not beat reckless play', severity: 'P2', category: 'balance', evidence: `careful ${m('careful', 'score')} vs reckless ${m('reckless', 'score')}` });
  return out;
}
