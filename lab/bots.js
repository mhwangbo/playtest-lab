/*
 * bots.js — headless bot runner. Drives a game adapter (see CONTRACT.md) with several
 * policies over many seeds and aggregates metrics. Failing runs become findings:
 *   crash      the adapter/game threw                                     P0
 *   invariant  adapter.invariants() or the engine reported a broken rule  P1 (or the violation's severity)
 *   error      the game logged an error but kept going (engine log / console.error)   P1
 *   softlock   the run never ended                                        P1
 * Failing runs can be saved as action traces (playtest-trace/1) and replayed exactly.
 */
'use strict';

const TRACE = 'playtest-trace/1';
const KINDS = ['crash', 'invariant', 'error', 'softlock'];

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

/**
 * Same message with different numbers (ids, positions, line numbers) groups into one finding.
 * An engine process dying is one failure however its dump reads, so only the part before the exit code counts.
 */
const errorKey = (msg) => String(msg).split(' (game exit code')[0].replace(/0x[0-9a-f]+/gi, '#').replace(/\d+(\.\d+)?/g, '#').slice(0, 160);
const firstLine = (e) => String((e && e.message) || e).split('\n')[0].slice(0, 300);

/** Invariant results → [{id, message, severity?}]. A plain string is its own id. */
function normViolations(list) {
  return (Array.isArray(list) ? list : list ? [list] : []).filter(Boolean).map((v) => (typeof v === 'string'
    ? { id: v, message: v }
    : { id: String(v.id || v.message || 'invariant'), message: String(v.message || v.id || ''), ...(v.severity ? { severity: v.severity } : {}) }));
}

/** Default patterns for errors in a game's own log: Unity/C# exceptions, Godot ERROR / SCRIPT ERROR. */
const DEFAULT_ERROR_PATTERNS = [/\b\w*Exception\b:/, /^\s*(SCRIPT |USER )?ERROR:/];
function errorLines(text, patterns, ignore) {
  const pats = patterns && patterns.length ? patterns : DEFAULT_ERROR_PATTERNS;
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const s = line.trim();
    if (s && pats.some((p) => p.test(s)) && !(ignore || []).some((p) => p.test(s))) out.push(s.slice(0, 300));
  }
  return out;
}

/**
 * One seeded run. Decisions come from `policy`, or from a recorded trace when `replay` is a Map(step → action).
 * → { finished, seconds, steps, metrics, outcome: null | {kind, message, id?, severity?, step}, actions, dt, every, maxSteps }
 */
async function runOne(adapter, policy, seed, opts = {}, replay = null) {
  const meta = adapter.meta || {};
  const dt = opts.dt || meta.dt || 1 / 60;
  const every = Math.max(1, opts.every || meta.decisionEvery || 6);
  const maxSteps = opts.maxSteps || Math.ceil((opts.seconds || meta.maxSeconds || 600) / dt);
  const rng = mulberry32(seed * 7919 + 17);
  const memo = {};
  // Only action changes are recorded; replay keeps the last one in effect, as the live run did.
  const actions = []; let lastKey; let replayed = {};
  const decide = async (obs, sim, step) => {
    let a;
    if (replay) { if (replay.has(step)) replayed = replay.get(step); a = replayed; } else a = await policy(obs, rng, memo, sim);
    const key = JSON.stringify(a ?? null);
    if (key !== lastKey) { actions.push([step, a ?? null]); lastKey = key; }
    return a;
  };
  const broken = (sim, step) => {
    const v = normViolations([...(adapter.invariants ? normViolations(adapter.invariants(sim)) : []), ...normViolations(sim && sim.violations)]);
    return v.length ? { kind: 'invariant', ...v[0], step } : null;
  };

  // In-process games: console.error during the run counts as a logged error. Engine games: their own log.
  const consoleErrors = [];
  const origError = console.error;
  if (!adapter.stepMany && opts.captureConsole !== false) console.error = (...a) => { consoleErrors.push(a.map(String).join(' ').slice(0, 300)); };
  const logMark = adapter.logMark ? adapter.logMark() : null;

  let sim = null; let steps = 0; let outcome = null; let finished = false;
  try {
    sim = await adapter.create(seed);
    if (adapter.stepMany) {
      // Out-of-process games (engine bridge): one round trip per decision, not per frame.
      finished = await adapter.done(sim);
      outcome = broken(sim, 0);
      while (!outcome && steps < maxSteps && !finished) {
        const action = await decide(await adapter.observe(sim), sim, steps);
        finished = await adapter.stepMany(sim, action, every, dt);
        steps += every;
        outcome = broken(sim, steps);
      }
    } else {
      let action = adapter.idleAction ? adapter.idleAction(adapter.observe(sim)) : {};
      for (; steps < maxSteps && !adapter.done(sim); steps++) {
        if (steps % every === 0) {
          if ((outcome = broken(sim, steps))) break;
          action = await decide(adapter.observe(sim), sim, steps);
        }
        adapter.step(sim, action, dt);
      }
      finished = adapter.done(sim);
      outcome = outcome || broken(sim, steps);
    }
  } catch (e) {
    outcome = { kind: 'crash', message: firstLine(e), stack: String((e && e.stack) || e).split('\n').slice(0, 3).join(' | '), step: steps };
  } finally {
    console.error = origError;
  }

  let metrics = {};
  if (!outcome || outcome.kind !== 'crash') {
    try { metrics = (await adapter.metrics(sim)) || {}; } catch (e) { outcome = { kind: 'crash', message: `metrics: ${firstLine(e)}`, step: steps }; }
  }
  const logged = [...consoleErrors, ...(adapter.logSince ? errorLines(await adapter.logSince(logMark), adapter.errorPatterns, adapter.ignoreErrors) : [])];
  if (!outcome && logged.length) outcome = { kind: 'error', id: errorKey(logged[0]), message: logged[0], count: logged.length, step: steps };
  if (!outcome && !finished) outcome = { kind: 'softlock', message: `not done after ${+(steps * dt).toFixed(2)}s`, step: steps };
  return { finished, seconds: steps * dt, steps, metrics, outcome, actions, dt, every, maxSteps };
}

function traceOf(adapter, policyName, seed, r) {
  return { trace: TRACE, game: (adapter.meta || {}).name || '', policy: policyName, seed, dt: r.dt, decisionEvery: r.every, maxSteps: r.maxSteps, outcome: r.outcome, actions: r.actions };
}

/**
 * Runs every policy over `runs` seeds. opts: { runs, seed, seconds, policies, saveTrace(trace) → path, maxTraces }.
 * Crashed and invariant-broken runs stop early, so they are left out of the metric aggregates.
 */
async function runBots(adapter, opts = {}) {
  const t0 = Date.now();
  const all = Object.assign(builtinPolicies(adapter), adapter.policies || {});
  const names = opts.policies || Object.keys(all);
  const runs = opts.runs || 30;
  const out = {
    runsPerPolicy: runs, seconds: opts.seconds || (adapter.meta || {}).maxSeconds,
    opts: { runs, seed: opts.seed || 1, seconds: opts.seconds || null, policies: names },
    policies: {}, rows: [], findings: [],
  };
  try {
    for (const name of names) {
      const policy = all[name];
      if (!policy) throw new Error(`unknown policy "${name}"; available: ${Object.keys(all).join(', ')}`);
      const rows = []; const failed = [];
      for (let i = 0; i < runs; i++) {
        const seed = (opts.seed || 1) + i;
        const r = await runOne(adapter, policy, seed, opts);
        if (r.outcome) failed.push({ seed, r });
        if (!r.outcome || r.outcome.kind === 'error' || r.outcome.kind === 'softlock') rows.push({ policy: name, seed, ...r });
      }
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r.metrics || {})))];
      const failureKinds = Object.fromEntries(KINDS.map((k) => [k, failed.filter((f) => f.r.outcome.kind === k).length]));
      out.policies[name] = { runs: rows.length, failures: failed.length, failureKinds, metrics: Object.fromEntries(keys.map((k) => [k, stats(rows.map((r) => r.metrics[k]))])) };
      out.rows.push(...rows.map((r) => ({ policy: r.policy, seed: r.seed, finished: r.finished, seconds: +r.seconds.toFixed(2), metrics: r.metrics, ...(r.outcome ? { outcome: r.outcome.kind } : {}) })));
      out.findings.push(...failureFindings(adapter, name, runs, failed, opts.saveTrace, opts.maxTraces ?? 3));
    }
  } finally {
    if (adapter.close) await adapter.close();
  }
  if (adapter.findings) {
    for (const f of adapter.findings(out.policies) || []) out.findings.push({ severity: 'P2', category: 'balance', source: 'bot:analysis', ...f });
  }
  out.ms = Date.now() - t0;
  return out;
}

/** Groups a policy's failing runs into findings: one per kind, and one per invariant id / error message. */
function failureFindings(adapter, name, runs, failed, saveTrace, maxTraces) {
  const groups = new Map();
  for (const f of failed) {
    const o = f.r.outcome;
    const key = o.kind === 'invariant' || o.kind === 'error' ? `${o.kind}:${o.id}` : o.kind;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const out = [];
  for (const list of groups.values()) {
    const o = list[0].r.outcome;
    const n = `${list.length}/${runs} seeds`;
    const traces = saveTrace ? list.slice(0, maxTraces).map((f) => saveTrace(traceOf(adapter, name, f.seed, f.r))) : [];
    const base = { source: `bot:${name}`, seeds: list.map((f) => f.seed), ...(traces.length ? { traces } : {}) };
    base.repro = traces.length ? `lab.js replay ${traces[0]}` : `adapter seed ${list[0].seed}, policy ${name}`;
    if (traces.length) base.accept = [`\`lab.js replay ${traces[0]} --expect fixed\` passes`, `No new ${o.kind} findings for bot policy "${name}" in \`lab.js check\``];
    if (o.kind === 'crash') out.push({ ...base, title: `Crash under bot policy "${name}" (${n})`, severity: 'P0', category: 'crash', evidence: o.stack || o.message });
    else if (o.kind === 'softlock') out.push({ ...base, title: `Run never ends under bot policy "${name}" (${n})`, severity: 'P1', category: 'softlock', evidence: o.message });
    else if (o.kind === 'invariant') out.push({ ...base, title: `Invariant "${o.id}" broken under bot policy "${name}" (${n})`, severity: o.severity || 'P1', category: 'bug', evidence: `${o.message} (step ${o.step})` });
    else out.push({ ...base, title: `Game logged an error under bot policy "${name}" (${n})`, severity: 'P1', category: 'bug', evidence: `${o.message}${o.count > 1 ? ` (+${o.count - 1} more in that run)` : ''}` });
  }
  return out;
}

/** True when two outcomes are the same failure: same kind, and same invariant id / error or crash message. */
function sameFailure(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'invariant') return a.id === b.id;
  if (a.kind === 'crash' || a.kind === 'error') return errorKey(a.message) === errorKey(b.message);
  return true;
}

/**
 * Replays a recorded trace: same seed, same actions at the same steps, no policy involved.
 * → { reproduced, expected, outcome, steps, seconds, metrics }
 */
async function replayTrace(adapter, trace) {
  if (!trace || trace.trace !== TRACE) throw new Error(`not a ${TRACE} file`);
  const meta = adapter.meta || {};
  if (meta.dt && Math.abs(meta.dt - trace.dt) > 1e-9) throw new Error(`trace dt ${trace.dt} ≠ adapter meta.dt ${meta.dt}`);
  const map = new Map(trace.actions.map(([step, a]) => [step, a]));
  try {
    const r = await runOne(adapter, null, trace.seed, { dt: trace.dt, every: trace.decisionEvery, maxSteps: trace.maxSteps }, map);
    return { reproduced: sameFailure(trace.outcome, r.outcome), expected: trace.outcome, outcome: r.outcome, steps: r.steps, seconds: +r.seconds.toFixed(2), metrics: r.metrics };
  } finally {
    if (adapter.close) await adapter.close();
  }
}

module.exports = { runBots, runOne, replayTrace, sameFailure, errorLines, mulberry32, stats, TRACE, KINDS };
