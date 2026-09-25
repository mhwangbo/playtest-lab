/*
 * bots.js — headless bot runner. Drives a game adapter (see CONTRACT.md) with several
 * policies over many seeds and aggregates metrics. Crashes and never-ending runs become findings.
 */
'use strict';

function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, range: (lo, hi) => lo + next() * (hi - lo), int: (lo, hi) => Math.floor(lo + next() * (hi - lo + 1)), pick: (arr) => arr[Math.floor(next() * arr.length)] };
}

function stats(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const q = (p) => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
  return { mean: v.reduce((a, b) => a + b, 0) / v.length, min: v[0], p10: q(0.1), p50: q(0.5), p90: q(0.9), max: v[v.length - 1], n: v.length };
}

function builtinPolicies(adapter) {
  const p = {};
  if (adapter.idleAction) p.idle = (obs) => adapter.idleAction(obs);
  if (adapter.randomAction) p.random = (obs, rng) => adapter.randomAction(obs, rng);
  return p;
}

async function runOne(adapter, policy, seed, opts) {
  const meta = adapter.meta || {};
  const dt = meta.dt || 1 / 60;
  const every = Math.max(1, meta.decisionEvery || 6);
  const maxSteps = Math.ceil((opts.seconds || meta.maxSeconds || 600) / dt);
  const rng = mulberry32(seed * 7919 + 17);
  const sim = await adapter.create(seed);
  const memo = {};
  // Out-of-process games (engine bridge): one round trip per decision, not per frame.
  if (adapter.stepMany) {
    let steps = 0; let isDone = await adapter.done(sim);
    while (steps < maxSteps && !isDone) {
      const action = await policy(await adapter.observe(sim), rng, memo, sim);
      isDone = await adapter.stepMany(sim, action, every, dt);
      steps += every;
    }
    return { finished: isDone, seconds: steps * dt, metrics: await adapter.metrics(sim) };
  }
  let action = adapter.idleAction ? adapter.idleAction(adapter.observe(sim)) : {};
  let steps = 0;
  for (; steps < maxSteps && !adapter.done(sim); steps++) {
    if (steps % every === 0) {
      const obs = adapter.observe(sim);
      action = await policy(obs, rng, memo, sim);
    }
    adapter.step(sim, action, dt);
  }
  return { finished: adapter.done(sim), seconds: steps * dt, metrics: adapter.metrics(sim) };
}

async function runBots(adapter, opts = {}) {
  const t0 = Date.now();
  const all = Object.assign(builtinPolicies(adapter), adapter.policies || {});
  const names = opts.policies || Object.keys(all);
  const runs = opts.runs || 30;
  const out = { runsPerPolicy: runs, seconds: opts.seconds || (adapter.meta || {}).maxSeconds, policies: {}, rows: [], findings: [] };
  for (const name of names) {
    const policy = all[name];
    if (!policy) throw new Error(`unknown policy "${name}"; available: ${Object.keys(all).join(', ')}`);
    const rows = []; const crashes = []; const softlocks = [];
    for (let i = 0; i < runs; i++) {
      const seed = (opts.seed || 1) + i;
      try {
        const r = await runOne(adapter, policy, seed, opts);
        rows.push({ policy: name, seed, ...r });
        if (!r.finished) softlocks.push(seed);
      } catch (e) {
        crashes.push({ seed, error: String(e && e.stack || e).split('\n').slice(0, 3).join(' | ') });
      }
    }
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r.metrics || {})))];
    out.policies[name] = { runs: rows.length, failures: crashes.length + softlocks.length, metrics: Object.fromEntries(keys.map((k) => [k, stats(rows.map((r) => r.metrics[k]))])) };
    out.rows.push(...rows.map((r) => ({ policy: r.policy, seed: r.seed, finished: r.finished, seconds: +r.seconds.toFixed(2), metrics: r.metrics })));
    if (crashes.length) out.findings.push({ title: `Crash under bot policy "${name}" (${crashes.length}/${runs} seeds)`, severity: 'P0', category: 'crash', source: `bot:${name}`, evidence: crashes[0].error, seeds: crashes.map((c) => c.seed), repro: `adapter seed ${crashes[0].seed}, policy ${name}` });
    if (softlocks.length) out.findings.push({ title: `Run never ends under bot policy "${name}" (${softlocks.length}/${runs} seeds)`, severity: 'P1', category: 'softlock', source: `bot:${name}`, evidence: `not done after ${out.seconds}s`, seeds: softlocks });
  }
  if (adapter.close) await adapter.close();
  if (adapter.findings) {
    for (const f of adapter.findings(out.policies) || []) out.findings.push({ severity: 'P2', category: 'balance', source: 'bot:analysis', ...f });
  }
  out.ms = Date.now() - t0;
  return out;
}

module.exports = { runBots, mulberry32, stats };
