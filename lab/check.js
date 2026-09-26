/*
 * check.js — regression gate. Compares a fresh bot run with a saved baseline (<game>/.playtest/baseline.json).
 * Bots are deterministic per seed, so with the baseline's seeds any difference is a real change in the game.
 *
 * Rules come from config.check (all optional):
 *   { "tolerance": 0.1,            relative drift of a metric's mean that still passes (default 10%)
 *     "abs": 0,                    absolute drift that always passes (for metrics near 0)
 *     "metrics": { "<metric>" | "<policy>.<metric>": { "tolerance", "abs", "min", "max",
 *                  "better": "higher" | "lower",   drift the good way is "improved", not a failure
 *                  "ignore": true } } }
 * A policy failing more often than in the baseline (per kind: crash, invariant, error, softlock) always fails.
 */
'use strict';
const { KINDS } = require('./bots.js');

const BASELINE = 'playtest-baseline/1';

function makeBaseline(bots, runId) {
  if (!bots || !bots.policies) throw new Error('no bots.json in that run — run `lab.js bots` first');
  const policies = {};
  for (const [name, p] of Object.entries(bots.policies)) {
    policies[name] = {
      runs: p.runs, failures: p.failures, failureKinds: p.failureKinds || { crash: 0, invariant: 0, error: 0, softlock: 0 },
      metrics: Object.fromEntries(Object.entries(p.metrics || {}).filter(([, v]) => v).map(([k, v]) => [k, { mean: v.mean, p10: v.p10, p50: v.p50, p90: v.p90 }])),
    };
  }
  const opts = bots.opts || { runs: bots.runsPerPolicy, seed: 1, seconds: null, policies: Object.keys(bots.policies) };
  return { baseline: BASELINE, runId, created: Date.now(), source: bots.source || 'bots', opts, policies };
}

function ruleFor(rules, policy, metric) {
  const m = (rules && rules.metrics) || {};
  return Object.assign({ tolerance: rules && rules.tolerance != null ? rules.tolerance : 0.1, abs: (rules && rules.abs) || 0 }, m[metric] || {}, m[`${policy}.${metric}`] || {});
}

/** → { status: 'pass'|'fail', rows: [{policy, metric, base, cur, limit, status, note}], regressions, improved } */
function compare(base, cur, rules = {}) {
  const rows = [];
  const add = (r) => rows.push(r);
  for (const [name, bp] of Object.entries(base.policies)) {
    const cp = cur.policies[name];
    if (!cp) { add({ policy: name, metric: '*', status: 'missing', note: 'policy did not run' }); continue; }
    const bk = bp.failureKinds || {}; const ck = cp.failureKinds || {};
    for (const k of KINDS) {
      const b = bk[k] || 0; const c = ck[k] || 0;
      if (c > b) add({ policy: name, metric: `failures.${k}`, base: b, cur: c, status: 'regressed', note: `more ${k} runs than the baseline` });
      else if (c < b) add({ policy: name, metric: `failures.${k}`, base: b, cur: c, status: 'improved' });
    }
    for (const [metric, bm] of Object.entries(bp.metrics)) {
      const rule = ruleFor(rules, name, metric);
      if (rule.ignore) continue;
      const cm = cp.metrics && cp.metrics[metric];
      if (!cm) { add({ policy: name, metric, base: bm.mean, status: 'missing', note: 'metric not reported' }); continue; }
      const delta = cm.mean - bm.mean;
      const limit = Math.max(rule.abs, rule.tolerance * Math.abs(bm.mean));
      let status = Math.abs(delta) <= limit + 1e-12 ? 'ok' : 'regressed';
      let note = '';
      if (status === 'regressed' && rule.better && (rule.better === 'higher' ? delta > 0 : delta < 0)) status = 'improved';
      if (status === 'regressed') note = `mean moved ${delta > 0 ? '+' : ''}${round(delta)} (allowed ±${round(limit)})`;
      if (rule.min != null && cm.mean < rule.min) { status = 'regressed'; note = `mean ${round(cm.mean)} below min ${rule.min}`; }
      if (rule.max != null && cm.mean > rule.max) { status = 'regressed'; note = `mean ${round(cm.mean)} above max ${rule.max}`; }
      add({ policy: name, metric, base: bm.mean, cur: cm.mean, limit, status, ...(note ? { note } : {}) });
    }
  }
  for (const name of Object.keys(cur.policies)) if (!base.policies[name]) add({ policy: name, metric: '*', status: 'new', note: 'policy not in the baseline' });
  const regressions = rows.filter((r) => r.status === 'regressed' || r.status === 'missing');
  return { status: regressions.length ? 'fail' : 'pass', rows, regressions: regressions.length, improved: rows.filter((r) => r.status === 'improved').length };
}

const round = (n) => (typeof n === 'number' ? +n.toFixed(Math.abs(n) >= 100 ? 0 : 3) : n);

function renderCheck(c) {
  const L = [`check vs baseline ${c.baselineRun || '?'}${c.holdout ? ` (holdout seeds from ${c.seed})` : ''}: **${c.status.toUpperCase()}** (${c.regressions} regression(s), ${c.improved} improved)`];
  for (const r of c.rows.filter((x) => x.status !== 'ok')) L.push(`  ${r.status.padEnd(9)} ${r.policy}.${r.metric}  ${r.base !== undefined ? round(r.base) : '-'} → ${r.cur !== undefined ? round(r.cur) : '-'}${r.note ? `  (${r.note})` : ''}`);
  return L.join('\n');
}

module.exports = { makeBaseline, compare, renderCheck, BASELINE };
