// Playtest Lab adapter for the CoinLine Unity sample — drives the built player over the bridge.
export const meta = { name: 'CoinLine', dt: 1 / 60, decisionEvery: 6, maxSeconds: 40 };

export const bridge = {
  command: 'Builds/Win/CoinLine.exe',
  args: ['-batchmode', '-nographics', '-playtestPort', '{PORT}', '-logFile', '-'],
  startupTimeoutMs: 60000,
};

export const idleAction = () => ({ move: 0 });
export const randomAction = (_obs, rng) => ({ move: rng.pick([-1, 0, 1]) });

const DANGER = 1.2;

export const policies = {
  // Walks straight to the coin, ignores the hazard.
  reckless: (o) => ({ move: Math.sign(o.coin - o.x) }),
  // Walks to the coin but stops/backs off when the hazard is close on the way.
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
  if ((m('idle', 'died') ?? 0) > 0.2) out.push({ title: 'Standing still gets you killed often', severity: 'P2', category: 'balance', evidence: `idle death rate ${(m('idle', 'died') * 100).toFixed(0)}%` });
  return out;
}
