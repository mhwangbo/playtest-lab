'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { runBots, stats, mulberry32 } = require('../lab/bots.js');

const load = () => import(pathToFileURL(path.join(__dirname, 'fixtures', 'line.adapter.mjs')).href);

test('stats computes mean and percentiles', () => {
  const s = stats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.strictEqual(s.mean, 5.5);
  assert.strictEqual(s.min, 1);
  assert.strictEqual(s.max, 10);
  assert.strictEqual(s.n, 10);
  assert.strictEqual(stats([]), null);
});

test('seeded rng is deterministic', () => {
  const a = mulberry32(42); const b = mulberry32(42);
  for (let i = 0; i < 5; i++) assert.strictEqual(a.next(), b.next());
});

test('bots run every policy, find crashes and are deterministic', async () => {
  const adapter = await load();
  const opts = { runs: 15, seed: 1 };
  const r1 = await runBots(adapter, opts);
  const r2 = await runBots(adapter, opts);
  assert.deepStrictEqual(Object.keys(r1.policies).sort(), ['idle', 'random', 'seeker']);
  assert.ok(r1.policies.seeker.metrics.reached.mean > r1.policies.idle.metrics.reached.mean, 'skill gradient');
  const crash = r1.findings.find((f) => f.category === 'crash');
  assert.ok(crash, 'seed 13 crash reported');
  assert.deepStrictEqual(crash.seeds.includes(13), true);
  const strip = (r) => r.rows.map((x) => [x.policy, x.seed, x.metrics]);
  assert.deepStrictEqual(strip(r1), strip(r2));
});

test('unknown policy is rejected', async () => {
  const adapter = await load();
  await assert.rejects(runBots(adapter, { runs: 1, policies: ['nope'] }), /unknown policy/);
});
