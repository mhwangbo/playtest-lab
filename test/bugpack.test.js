'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { runBots, replayTrace, errorLines } = require('../lab/bots.js');
const { createBridgeAdapter } = require('../lab/bridge.js');
const { makeBaseline, compare } = require('../lab/check.js');

const FIX = path.join(__dirname, 'fixtures');
const LAB = path.join(__dirname, '..', 'lab', 'lab.js');
const loadBuggy = () => import(pathToFileURL(path.join(FIX, 'buggy.adapter.mjs')).href);

test('each planted bug becomes its own finding, with a saved trace', async () => {
  const adapter = await loadBuggy();
  const traces = [];
  const res = await runBots(adapter, { runs: 5, saveTrace: (t) => { traces.push(t); return `t${traces.length}.json`; } });
  const kinds = res.policies.walker.failureKinds;
  assert.deepStrictEqual(kinds, { crash: 1, invariant: 1, error: 1, softlock: 1 });
  const byCat = (c) => res.findings.find((f) => f.category === c);
  assert.ok(byCat('crash').seeds.includes(3));
  assert.ok(byCat('softlock').seeds.includes(5));
  const inv = res.findings.find((f) => f.title.includes('hp-non-negative'));
  assert.deepStrictEqual(inv.seeds, [2]);
  const err = res.findings.find((f) => f.title.includes('logged an error'));
  assert.match(err.evidence, /texture missing/);
  assert.strictEqual(traces.length, 4);
  assert.ok(res.findings.every((f) => /lab\.js replay t\d\.json/.test(f.repro)));
  assert.strictEqual(res.policies.walker.runs, 3, 'crashed and invariant runs are left out of the aggregates');
});

test('replaying a trace reproduces the failure, and stops reproducing once fixed', async () => {
  const adapter = await loadBuggy();
  const traces = [];
  await runBots(adapter, { runs: 5, saveTrace: (t) => { traces.push(JSON.parse(JSON.stringify(t))); return 'x'; } });
  for (const t of traces) {
    const r = await replayTrace(adapter, t);
    assert.strictEqual(r.reproduced, true, `${t.outcome.kind} reproduces`);
    assert.strictEqual(r.outcome.step, t.outcome.step, `${t.outcome.kind} at the same step`);
  }
  globalThis.__buggyFixed = true;
  try {
    for (const t of traces) assert.strictEqual((await replayTrace(adapter, t)).reproduced, false, `${t.outcome.kind} fixed`);
  } finally { delete globalThis.__buggyFixed; }
});

test('error lines: Unity exceptions and Godot errors match, custom patterns override', () => {
  const log = 'loading...\nNullReferenceException: Object reference not set\nERROR: Node not found\n   at: get_node\nSCRIPT ERROR: Invalid call\nfine';
  assert.deepStrictEqual(errorLines(log).length, 3);
  assert.deepStrictEqual(errorLines(log, [/^fine$/]), ['fine']);
  assert.deepStrictEqual(errorLines(log, null, [/SCRIPT/]).length, 2);
});

test('engine games: violations, logged errors and a mid-run process crash', async () => {
  const adapter = createBridgeAdapter({
    meta: { dt: 1 / 60, decisionEvery: 6, maxSeconds: 5 },
    bridge: { command: process.execPath, args: [path.join(FIX, 'fake-engine.js'), '{PORT}'], startupTimeoutMs: 10000, logSettleMs: 50 },
    idleAction: () => ({}),
  }, FIX);
  const res = await runBots(adapter, { runs: 5, policies: ['idle'] });
  const k = res.policies.idle.failureKinds;
  assert.deepStrictEqual(k, { crash: 1, invariant: 1, error: 1, softlock: 0 });
  const titles = res.findings.map((f) => f.title).join('\n');
  assert.match(titles, /coins-conserved/);
  const err = res.findings.find((f) => f.title.includes('logged an error'));
  assert.match(err.evidence, /Node not found/);
  assert.deepStrictEqual(err.seeds, [3]);
  const crash = res.findings.find((f) => f.category === 'crash');
  assert.deepStrictEqual(crash.seeds, [4]);
  assert.match(crash.evidence, /exit code 3/);
  assert.strictEqual(res.policies.idle.runs, 3, 'seed 5 ran on a restarted game process');
});

test('check: identical passes; drift, new failures and missing policies fail; "better" direction improves', () => {
  const bots = (m, kinds = {}) => ({ opts: { runs: 5, seed: 1, policies: ['a'] }, policies: { a: { runs: 5, failures: 0, failureKinds: { crash: 0, invariant: 0, error: 0, softlock: 0, ...kinds }, metrics: { score: { mean: m, p10: m, p50: m, p90: m } } } } });
  const base = makeBaseline(bots(10), 'R1');
  assert.strictEqual(compare(base, bots(10)).status, 'pass');
  assert.strictEqual(compare(base, bots(10.9)).status, 'pass', 'inside 10%');
  assert.strictEqual(compare(base, bots(12)).status, 'fail');
  assert.strictEqual(compare(base, bots(12), { metrics: { score: { better: 'higher' } } }).status, 'pass');
  assert.strictEqual(compare(base, bots(12), { metrics: { 'a.score': { tolerance: 0.5 } } }).status, 'pass');
  assert.strictEqual(compare(base, bots(10), { metrics: { score: { min: 11 } } }).status, 'fail');
  assert.strictEqual(compare(base, bots(10, { softlock: 1 })).status, 'fail');
  assert.strictEqual(compare(base, { policies: {} }).status, 'fail');
});

test('CLI: bots save traces, baseline + check gate the build, replay --expect fixed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playtest-bugpack-'));
  const lab = (...a) => spawnSync(process.execPath, [LAB, '--game', dir, ...a], { encoding: 'utf8' });
  assert.strictEqual(lab('init', '--name', 'Line').status, 0);
  fs.copyFileSync(path.join(FIX, 'line.adapter.mjs'), path.join(dir, '.playtest', 'adapter.mjs'));
  lab('run', 'new');
  const bots = lab('bots', '--runs', '15');
  assert.strictEqual(bots.status, 0, bots.stderr);
  const traceDir = path.join(dir, '.playtest', 'runs', 'R1', 'traces');
  const traces = fs.readdirSync(traceDir);
  assert.ok(traces.some((t) => /-s13-crash\.json$/.test(t)), traces.join(','));
  const rel = `.playtest/runs/R1/traces/${traces[0]}`;
  const rp = lab('replay', rel, '--expect', 'reproduced');
  assert.strictEqual(rp.status, 0, rp.stdout + rp.stderr);
  assert.strictEqual(lab('replay', rel, '--expect', 'fixed').status, 1);

  assert.strictEqual(lab('baseline', 'set').status, 0);
  const ok = lab('check');
  assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /PASS/);

  // A "regression": the seeker gets slower.
  const f = path.join(dir, '.playtest', 'adapter.mjs');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('dt * 2', 'dt * 1'));
  const bad = lab('check', '--label', 'slower');
  assert.strictEqual(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /FAIL/);
  const report = JSON.parse(fs.readFileSync(path.join(dir, '.playtest', 'runs', 'R3', 'playtest-report.json'), 'utf8'));
  assert.strictEqual(report.check.status, 'fail');
  assert.ok(report.check.rows.some((r) => r.status === 'regressed'));
  assert.match(fs.readFileSync(path.join(dir, '.playtest', 'runs', 'R3', 'report.md'), 'utf8'), /Regression check/);
});

test('CLI: determinism passes on a deterministic game; check --seed runs a holdout range', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playtest-determinism-'));
  const lab = (...a) => spawnSync(process.execPath, [LAB, '--game', dir, ...a], { encoding: 'utf8' });
  lab('init', '--name', 'Line');
  fs.copyFileSync(path.join(FIX, 'line.adapter.mjs'), path.join(dir, '.playtest', 'adapter.mjs'));
  lab('run', 'new');
  const d = lab('determinism', '--runs', '15');
  assert.strictEqual(d.status, 0, d.stdout + d.stderr);
  assert.match(d.stdout, /deterministic: 45 rows identical/);
  lab('bots', '--runs', '15');
  lab('baseline', 'set');
  const h = lab('check', '--seed', '101', '--json');
  const c = JSON.parse(h.stdout);
  assert.strictEqual(c.holdout, true);
  assert.strictEqual(c.seed, 101);
});
