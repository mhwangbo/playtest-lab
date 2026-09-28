/*
 * fun.js — fun metrics from bot runs. Needs no extra runs: it reads the rows in bots.json.
 *   skill gradient     score per policy in skill order; flags inversions, a flat gradient, random ≈ best
 *   luck vs skill      two-way variance split of the score over policy × seed: skill share, luck share, the rest
 *   upsets             how often the less skilled of two neighbouring policies wins on the same seed
 *   dominant strategy  among declared alternative strategies (same skill level): does one win nearly every seed?
 *   action mix         share of the best policy's time spent on its most-used action (discrete actions only)
 *   tension curve      mean adapter.tension(obs) over 10 slices of each run, when the adapter exports it
 *
 * Settings live in .playtest/config.json → "fun" (all optional):
 *   { "score": "points", "better": "higher",       the metric that says how well a run went
 *     "skillOrder": ["idle", "random", "greedy", "careful"],   least to most skilled; checks the order
 *     "strategies": ["rush", "turtle"],            equally skilled policies that play differently
 *     "luckPolicies": [..], "tensionPolicy": "careful",
 *     "luckMax": 0.5, "randomMax": 0.8, "minSpread": 0.1, "dominantMin": 0.8 }
 */
'use strict';

const FUN = 'playtest-fun/1';
const SLICES = 10;
const DEFAULTS = { better: 'higher', luckMax: 0.5, randomMax: 0.8, minSpread: 0.1, dominantMin: 0.8 };
const BASELINES = ['idle', 'random'];

const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const r3 = (n) => (typeof n === 'number' ? +n.toFixed(3) : n);
const pct = (x) => `${Math.round(100 * x)}%`;

/**
 * Per-run extras recorded by the bot runner: the time-weighted action mix, and tension samples bucketed into
 * SLICES of the run. `actions` is the runner's change list [[step, action]], `samples` is [[step, value]].
 */
function runExtras(actions, steps, samples) {
  const out = {};
  if (actions.length && steps > 0) {
    const held = new Map();
    actions.forEach(([step, a], i) => {
      const until = i + 1 < actions.length ? actions[i + 1][0] : steps;
      const key = JSON.stringify(a).slice(0, 80);
      held.set(key, (held.get(key) || 0) + Math.max(0, until - step));
    });
    // Continuous actions (aim points, analog sticks) are nearly all distinct: keep only the counts.
    const continuous = held.size / actions.length > 0.5 && held.size > 20;
    const top = continuous ? [] : [...held.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => [k, r3(n / steps)]);
    out.actionMix = { kinds: held.size, changes: actions.length, top };
  }
  if (samples && samples.length && steps > 0) {
    const sum = Array(SLICES).fill(0); const n = Array(SLICES).fill(0);
    for (const [step, v] of samples) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const i = Math.min(SLICES - 1, Math.floor((step / steps) * SLICES));
      sum[i] += v; n[i]++;
    }
    out.tension = sum.map((s, i) => (n[i] ? r3(s / n[i]) : null));
  }
  return out;
}

/** Score metric: the configured one, else `score` or `points` when every policy reports it. */
function scoreMetric(rows, cfg) {
  if (cfg.score) return cfg.score;
  const has = (k) => rows.length && rows.every((r) => typeof (r.metrics || {})[k] === 'number');
  return ['score', 'points'].find(has) || null;
}

/** policy → seed → score, oriented so that higher is always better. */
function scoreTable(rows, metric, better) {
  const t = {};
  for (const r of rows) {
    const v = (r.metrics || {})[metric];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    (t[r.policy] ||= {})[r.seed] = better === 'lower' ? -v : v;
  }
  return t;
}

const commonSeeds = (table, names) => {
  const sets = names.map((n) => Object.keys(table[n] || {}));
  return sets.length ? sets[0].filter((s) => sets.every((x) => x.includes(s))) : [];
};

/** Least to most skilled. Without a declared order: idle and random first, the rest by mean score. */
function skillOrderOf(table, cfg) {
  if (cfg.skillOrder) return cfg.skillOrder.filter((n) => table[n]);
  const m = (n) => mean(Object.values(table[n]));
  const base = BASELINES.filter((n) => table[n]);
  return [...base, ...Object.keys(table).filter((n) => !base.includes(n)).sort((a, b) => m(a) - m(b))];
}

function skillGradient(table, order, cfg, out) {
  const m = Object.fromEntries(order.map((n) => [n, mean(Object.values(table[n]))]));
  const best = order.reduce((a, b) => (m[b] > m[a] ? b : a), order[0]);
  // "No skill" reference: idle when it is in the order, else the weakest policy. A declared skillOrder may leave
  // idle out even though it ran, so only policies in the order count.
  const floorName = order.includes('idle') ? 'idle' : order.reduce((a, b) => (m[b] < m[a] ? b : a), order[0]);
  const floor = m[floorName];
  const shown = (v) => r3(cfg.better === 'lower' ? -v : v);
  const g = { order, declared: !!cfg.skillOrder, means: Object.fromEntries(order.map((n) => [n, shown(m[n])])), best, inversions: [] };

  for (let i = 1; i < order.length; i++) {
    const lo = order[i - 1]; const hi = order[i];
    // Undeclared, only "a real policy loses to idle/random" counts; random input losing to idle is normal.
    if (m[hi] < m[lo] && (g.declared || (BASELINES.includes(lo) && !BASELINES.includes(hi)))) g.inversions.push([lo, hi]);
  }
  for (const [lo, hi] of g.inversions) {
    out.findings.push({ severity: 'P2', category: 'balance', title: `"${hi}" scores worse than the less skilled "${lo}"`, evidence: `${cfg.metric}: ${lo} ${shown(m[lo])} vs ${hi} ${shown(m[hi])} (mean over ${Object.keys(table[hi]).length} seeds)` });
  }

  const range = m[best] - floor;
  g.floor = floorName;
  g.spread = Math.abs(m[best]) > 1e-9 && best !== floorName ? r3(range / Math.abs(m[best])) : null;
  if (g.spread !== null && order.length > 1 && g.spread < cfg.minSpread) {
    out.findings.push({ severity: 'P2', category: 'balance', title: 'Skill barely changes the score', evidence: `best policy "${best}" ${shown(m[best])} vs ${floorName} ${shown(floor)} (${pct(g.spread)} of the best score)` });
  }
  if (order.includes('random') && best !== 'random' && range > 1e-9) {
    g.randomShare = r3((m.random - floor) / range);
    if (g.randomShare >= cfg.randomMax) {
      out.findings.push({ severity: 'P2', category: 'balance', title: `Random play gets ${pct(g.randomShare)} of the way to the best policy`, evidence: `${cfg.metric}: random ${shown(m.random)}, best "${best}" ${shown(m[best])}${floorName !== 'random' ? `, ${floorName} ${shown(floor)}` : ''}; decisions barely matter` });
    }
  }
  return g;
}

/** Two-way variance split without replication: SS_total = SS_policy + SS_seed + SS_rest. */
function luckVsSkill(table, names, cfg, out) {
  const seeds = commonSeeds(table, names);
  if (names.length < 2 || seeds.length < 3) return { policies: names, seeds: seeds.length, note: 'needs 2+ policies on 3+ common seeds' };
  const x = names.map((n) => seeds.map((s) => table[n][s]));
  const grand = mean(x.flat());
  const pm = x.map(mean);
  const sm = seeds.map((_, j) => mean(x.map((row) => row[j])));
  const ssT = x.flat().reduce((a, v) => a + (v - grand) ** 2, 0);
  if (ssT < 1e-12) return { policies: names, seeds: seeds.length, note: 'the score never varies' };
  const ssP = seeds.length * pm.reduce((a, v) => a + (v - grand) ** 2, 0);
  const ssS = names.length * sm.reduce((a, v) => a + (v - grand) ** 2, 0);
  const res = { policies: names, seeds: seeds.length, skill: r3(ssP / ssT), luck: r3(ssS / ssT), rest: r3(Math.max(0, ssT - ssP - ssS) / ssT) };
  if (res.luck > cfg.luckMax) {
    out.findings.push({ severity: 'P2', category: 'balance', title: `The seed decides more of the score than skill does (luck ${pct(res.luck)}, skill ${pct(res.skill)})`, evidence: `variance of ${cfg.metric} over ${names.join(', ')} × ${seeds.length} seeds; "rest" ${pct(res.rest)} is how much a seed favours one policy over another` });
  }
  return res;
}

/** For each neighbouring pair in skill order: share of common seeds where the less skilled policy won. */
function upsets(table, order) {
  const out = [];
  for (let i = 1; i < order.length; i++) {
    const lo = order[i - 1]; const hi = order[i];
    const seeds = commonSeeds(table, [lo, hi]);
    if (seeds.length) out.push({ lower: lo, higher: hi, rate: r3(seeds.filter((s) => table[lo][s] > table[hi][s]).length / seeds.length), seeds: seeds.length });
  }
  return out;
}

function dominance(table, names, cfg, out) {
  if (!names || names.length < 2) return null;
  names = names.filter((n) => table[n]);
  const seeds = commonSeeds(table, names);
  if (names.length < 2 || !seeds.length) return { strategies: names, note: 'strategies need common seeds' };
  const wins = Object.fromEntries(names.map((n) => [n, 0]));
  for (const s of seeds) {
    const top = Math.max(...names.map((n) => table[n][s]));
    const winners = names.filter((n) => table[n][s] === top);
    for (const n of winners) wins[n] += 1 / winners.length;
  }
  const share = Object.fromEntries(names.map((n) => [n, r3(wins[n] / seeds.length)]));
  const [lead, leadShare] = Object.entries(share).sort((a, b) => b[1] - a[1])[0];
  const res = { strategies: names, seeds: seeds.length, winShare: share, dominant: leadShare >= cfg.dominantMin ? lead : null };
  if (res.dominant) {
    const never = names.filter((n) => share[n] === 0);
    out.findings.push({ severity: 'P2', category: 'balance', title: `Strategy "${lead}" wins ${pct(leadShare)} of seeds`, evidence: `win share over ${seeds.length} seeds: ${names.map((n) => `${n} ${pct(share[n])}`).join(', ')}${never.length ? `; never the better choice: ${never.join(', ')}` : ''}` });
  }
  return res;
}

/** Averages the best policy's action mix; skipped for continuous actions (almost every change is a new action). */
function actionMix(rows, policy) {
  const mixes = rows.filter((r) => r.policy === policy && r.actionMix).map((r) => r.actionMix);
  if (!mixes.length) return null;
  if (mixes.some((m) => !m.top.length)) return { policy, continuous: true };
  // Engine-side bots (the adapter only sends {"policy": name}) hide their real choices from the lab.
  if (mixes.every((m) => m.kinds === 1 && /^\{"policy":/.test(m.top[0][0]))) return { policy, engineSide: true };
  const share = {};
  for (const m of mixes) for (const [k, v] of m.top) share[k] = (share[k] || 0) + v / mixes.length;
  const top = Object.entries(share).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => [k, r3(v)]);
  return { policy, continuous: false, kinds: r3(mean(mixes.map((m) => m.kinds))), top, oneAction: top[0][1] >= 0.8 };
}

function tension(rows, policies, focus, out) {
  const curves = {};
  for (const p of policies) {
    const ts = rows.filter((r) => r.policy === p && r.tension).map((r) => r.tension);
    if (!ts.length) continue;
    curves[p] = Array.from({ length: SLICES }, (_, i) => { const v = ts.map((t) => t[i]).filter((x) => x !== null); return v.length ? r3(mean(v)) : null; });
  }
  if (!Object.keys(curves).length) return null;
  const c = curves[focus] || Object.values(curves).pop();
  const name = curves[focus] ? focus : Object.keys(curves).pop();
  const vals = c.filter((v) => v !== null);
  const lo = Math.min(...vals); const hi = Math.max(...vals);
  const peak = c.indexOf(hi);
  const third = (a) => mean(a.filter((v) => v !== null)) ?? 0;
  const shape = { policy: name, range: r3(hi - lo), peakAt: r3((peak + 0.5) / SLICES), start: r3(third(c.slice(0, 3))), end: r3(third(c.slice(-3))) };
  if (shape.range < 0.1) out.findings.push({ severity: 'P3', category: 'feel', title: 'Tension stays flat through the run', evidence: `"${name}" tension ${lo}–${hi} across the run` });
  else if (peak < 3) out.findings.push({ severity: 'P3', category: 'feel', title: `Tension peaks in the first ${pct(0.3)} of the run`, evidence: `"${name}" peaks at ${pct(shape.peakAt)} of the run (${hi}), ends at ${shape.end}` });
  else if (shape.end < shape.start) out.findings.push({ severity: 'P3', category: 'feel', title: 'The run ends calmer than it starts', evidence: `"${name}" tension: first 30% ${shape.start}, last 30% ${shape.end}` });
  return { curves, shape };
}

/**
 * bots.json → fun report { fun, metric, skill, luck, upsets, strategies, actions, tension, findings, notes }.
 * Findings use source "bot:fun" and are not written to issues.jsonl, so running it twice never duplicates them.
 */
function computeFun(bots, userCfg = {}) {
  const rows = (bots && bots.rows) || [];
  const cfg = Object.assign({}, DEFAULTS, userCfg);
  const out = { fun: FUN, findings: [], notes: [] };
  if (!rows.length) { out.notes.push('no per-run rows in bots.json (imported level results have none)'); return out; }
  cfg.metric = out.metric = scoreMetric(rows, cfg);
  out.better = cfg.better;

  const table = cfg.metric ? scoreTable(rows, cfg.metric, cfg.better) : {};
  if (cfg.metric && !Object.keys(table).length) {
    out.notes.push(`no run reports the score metric "${cfg.metric}" (fun.score)`);
  } else if (cfg.metric) {
    const order = skillOrderOf(table, cfg);
    out.skill = skillGradient(table, order, cfg, out);
    // Random's big gap to any real policy would make skill look like everything, so compare the scripted
    // policies with each other when there are two or more.
    const scripted = order.filter((n) => !BASELINES.includes(n));
    out.luck = luckVsSkill(table, cfg.luckPolicies || (scripted.length >= 2 ? scripted : order.filter((n) => n !== 'idle')), cfg, out);
    out.upsets = upsets(table, order);
    out.strategies = dominance(table, cfg.strategies, cfg, out);
    if (!cfg.skillOrder) out.notes.push('skill order guessed (idle, random, then by score): set fun.skillOrder to check scripted policies against each other');
    if (!cfg.strategies) out.notes.push('no fun.strategies: list equally skilled policies that play differently to test for a dominant strategy');
  } else {
    out.notes.push('no score metric: set fun.score in .playtest/config.json (or report "score"/"points" from metrics())');
  }
  const best = out.skill ? out.skill.best : null;
  const policies = [...new Set(rows.map((r) => r.policy))];
  out.actions = best ? actionMix(rows, best) : null;
  out.tension = tension(rows, policies, cfg.tensionPolicy || best, out);
  if (!out.tension) out.notes.push('no tension curve: export tension(obs) → 0..1 from the adapter');
  for (const f of out.findings) f.source = 'bot:fun';
  return out;
}

const BARS = '▁▂▃▄▅▆▇█';
const spark = (c) => c.map((v) => (v === null ? ' ' : BARS[Math.max(0, Math.min(7, Math.round(v * 7)))])).join('');

/** Markdown lines for report.md and the CLI. */
function renderFun(f) {
  const L = [];
  if (f.skill) {
    const s = f.skill;
    L.push(`Score metric \`${f.metric}\` (${f.better} is better).`, '');
    L.push(`- **Skill gradient** (${s.declared ? 'declared' : 'guessed'} order): ${s.order.map((n) => `${n} ${s.means[n]}`).join(' → ')}${s.spread !== null ? `; best is ${pct(s.spread)} above ${s.floor}` : ''}${s.randomShare !== undefined ? `; random gets ${pct(s.randomShare)} of the way` : ''}`);
  }
  if (f.luck) L.push(f.luck.note ? `- **Luck vs skill:** ${f.luck.note}` : `- **Luck vs skill** (${f.luck.policies.join(', ')} × ${f.luck.seeds} seeds): skill ${pct(f.luck.skill)} · luck ${pct(f.luck.luck)} · seed × policy ${pct(f.luck.rest)}`);
  if (f.upsets && f.upsets.length) L.push(`- **Upsets** (less skilled policy wins the same seed): ${f.upsets.map((u) => `${u.lower} over ${u.higher} ${pct(u.rate)}`).join(', ')}`);
  if (f.strategies) L.push(f.strategies.note ? `- **Strategies:** ${f.strategies.note}` : `- **Strategies** (win share): ${Object.entries(f.strategies.winShare).map(([n, v]) => `${n} ${pct(v)}`).join(', ')}${f.strategies.dominant ? ` → **"${f.strategies.dominant}" dominates**` : ''}`);
  if (f.actions && f.actions.engineSide) L.push(`- **Action mix** ("${f.actions.policy}"): the policy runs engine-side, so its choices are not visible to the lab; skipped`);
  else if (f.actions) L.push(f.actions.continuous ? `- **Action mix** ("${f.actions.policy}"): continuous actions, skipped` : `- **Action mix** ("${f.actions.policy}", ${f.actions.kinds} distinct per run): ${f.actions.top.map(([k, v]) => `\`${k}\` ${pct(v)}`).join(', ')}${f.actions.oneAction ? ' → mostly one action' : ''}`);
  if (f.tension) {
    L.push('- **Tension** (start → end of run, 10 slices):');
    for (const [p, c] of Object.entries(f.tension.curves)) L.push(`  - \`${spark(c)}\` ${p}`);
  }
  for (const n of f.notes) L.push(`- _${n}_`);
  return L;
}

module.exports = { computeFun, renderFun, runExtras, FUN, SLICES };
