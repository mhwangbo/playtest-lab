// Playtest Lab game adapter — fill this in for your game. Contract: PlaytestLab/CONTRACT.md
// The adapter lets bots play the game headless (no browser). Keep it DOM-free: import your
// game's pure simulation modules. If the game has no headless sim, skip bots and use personas only.

export const meta = {
  name: 'MyGame',
  dt: 1 / 60,            // simulation step (seconds)
  decisionEvery: 6,      // bots choose a new action every N steps (6 = 10 Hz)
  maxSeconds: 600,       // a run not done by then is reported as a softlock
};

/** Create a fresh session already in gameplay (skip menus). May be async. */
export async function create(seed) {
  throw new Error('adapter.create not implemented');
}

/** Compact, JSON-able state the bots decide on. */
export function observe(sim) { return {}; }

/** Advance one step with the current action. */
export function step(sim, action, dt) {}

/** True when the session/level/night is over. */
export function done(sim) { return true; }

/** Numbers to aggregate across runs (score, deaths, time, …). */
export function metrics(sim) { return {}; }

/** Do-nothing input (baseline policy "idle"). */
export function idleAction(obs) { return {}; }

/** Random input (baseline policy "random"). rng: { next(), range(a,b), int(a,b), pick(arr) } */
export function randomAction(obs, rng) { return {}; }

/** Scripted policies: name → (obs, rng, memo, sim) => action. */
export const policies = {};

/** Optional: discrete choices for menu-picking bot players (e.g. an external decision API). → [{ id, label, action }] */
export function actionMenu(obs) { return [{ id: 'idle', label: 'do nothing', action: idleAction(obs) }]; }

/** Optional: turn aggregates into findings. policies[name].metrics[m] = {mean,p10,p50,p90,min,max}. */
export function findings(policies) { return []; }

/**
 * Optional: how tense this moment is, 0 (calm) to 1 (on the edge), read from the observation at every bot
 * decision. The fun report averages it over 10 slices of each run and flags flat curves, early peaks and
 * endings calmer than the start (`lab.js fun`). E.g. danger nearby, time pressure, or how close a loss is.
 */
// export function tension(obs) { return 0; }

/**
 * Optional: rules that must always hold, checked at every bot decision. Return [] when fine, else strings
 * (the rule id) or { id, message, severity }. A broken rule stops the run, becomes a bug finding and is
 * saved as a trace you can replay (`lab.js replay <trace>`). Engine games get the observation instead of sim.
 */
export function invariants(sim) {
  const broken = [];
  // if (sim.hp < 0) broken.push({ id: 'hp-non-negative', message: `hp is ${sim.hp}` });
  return broken;
}
