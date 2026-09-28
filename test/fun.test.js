'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { runBots } = require('../lab/bots.js');
const { computeFun, renderFun, runExtras } = require('../lab/fun.js');
const { Lab } = require('../lab/lab.js');

const FIX = path.join(__dirname, 'fixtures');

/** bots.json-shaped rows from policy → seed → score functions. */
function botsOf(scoreFns, seeds = 20) {
  const rows = [];
  for (const [policy, fn] of Object.entries(scoreFns)) {
    for (let seed = 1; seed <= seeds; seed++) rows.push({ policy, seed, finished: true, seconds: 1, metrics: { score: fn(seed) } });
  }
  return { rows };
}
const titles = (f) => f.findings.map((x) => x.title).join(' | ');
// Deterministic "luck" per seed that is not a simple trend.
const luck = (s) => ((s * 37) % 11) * 10;

test('skill-driven game: clean gradient, skill dominates the variance, no findings', () => {
  const f = computeFun(botsOf({ idle: () => 0, random: (s) => 5 + (s % 3), greedy: (s) => 50 + (s % 5), careful: (s) => 90 + (s % 5) }));
  assert.deepStrictEqual(f.skill.order, ['idle', 'random', 'greedy', 'careful']);
  assert.strictEqual(f.skill.best, 'careful');
  assert.ok(f.luck.skill > 0.9, `skill share ${f.luck.skill}`);
  assert.deepStrictEqual(f.luck.policies, ['greedy', 'careful'], 'luck split compares the scripted policies');
  assert.strictEqual(f.findings.length, 0, titles(f));
});

test('luck-driven game: the seed outweighs the policy', () => {
  const f = computeFun(botsOf({ idle: () => 0, greedy: (s) => luck(s), careful: (s) => luck(s) + 2 }));
  assert.ok(f.luck.luck > 0.9, `luck share ${f.luck.luck}`);
  assert.match(titles(f), /seed decides more of the score than skill/);
  assert.ok(f.findings.every((x) => x.source === 'bot:fun'));
});

test('random play nearly as good as the best policy is flagged; random losing to idle is not', () => {
  const f = computeFun(botsOf({ idle: () => 10, random: () => 95, expert: () => 100 }));
  assert.match(titles(f), /Random play gets 94% of the way/);
  const g = computeFun(botsOf({ idle: () => 10, random: () => 5, expert: () => 100 }));
  assert.strictEqual(g.findings.length, 0, titles(g));
});

test('inversions: a scripted policy below random always counts; declared order checks scripted pairs', () => {
  const bots = botsOf({ random: () => 20, novice: () => 10, expert: () => 80, master: () => 60 });
  assert.match(titles(computeFun(bots)), /"novice" scores worse than the less skilled "random"/);
  const declared = computeFun(bots, { skillOrder: ['random', 'novice', 'master', 'expert'] });
  assert.doesNotMatch(titles(declared), /"expert" scores worse/);
  const wrong = computeFun(bots, { skillOrder: ['random', 'novice', 'expert', 'master'] });
  assert.match(titles(wrong), /"master" scores worse than the less skilled "expert"/);
});

test('a declared skillOrder that leaves out a policy that ran (idle) never reads it', () => {
  const f = computeFun(botsOf({ idle: () => 0, random: (s) => 5 + (s % 3), solver: (s) => 90 + (s % 5) }), { skillOrder: ['random', 'solver'] });
  assert.strictEqual(f.skill.floor, 'random');
  assert.ok(Number.isFinite(f.skill.spread), `spread ${f.skill.spread}`);
  assert.doesNotMatch(renderFun(f).join('\n'), /NaN/);
  const g = computeFun(botsOf({ random: () => 95, solver: () => 100 }), { skillOrder: ['solver'] });
  assert.strictEqual(g.skill.randomShare, undefined, 'random outside the order is not compared');
});

test('engine-side policies ({"policy": name} actions) are not reported as "mostly one action"', () => {
  const rows = botsOf({ random: () => 1, solver: () => 9 }).rows.map((r) => ({ ...r, actionMix: { kinds: 1, changes: 1, top: [[`{"policy":"${r.policy}"}`, 1]] } }));
  const f = computeFun({ rows });
  assert.strictEqual(f.actions.engineSide, true);
  assert.match(renderFun(f).join('\n'), /engine-side/);
  assert.doesNotMatch(renderFun(f).join('\n'), /mostly one action/);
});

test('flat gradient: skill barely changes the score', () => {
  const f = computeFun(botsOf({ idle: () => 95, expert: () => 100 }));
  assert.match(titles(f), /Skill barely changes the score/);
});

test('lower-is-better metrics are oriented before comparing', () => {
  const rows = botsOf({ idle: () => 300, expert: (s) => 60 + (s % 4) }).rows.map((r) => ({ ...r, metrics: { time: r.metrics.score } }));
  const f = computeFun({ rows }, { score: 'time', better: 'lower' });
  assert.strictEqual(f.skill.best, 'expert');
  assert.strictEqual(f.skill.means.idle, 300, 'means are shown in the metric\'s own units');
  assert.strictEqual(f.findings.length, 0, titles(f));
});

test('dominant strategy among declared strategies', () => {
  const bots = botsOf({ rush: (s) => 60 + luck(s), turtle: (s) => 50 + luck(s), balanced: (s) => (s % 5 === 0 ? 200 : 40) });
  const f = computeFun(bots, { strategies: ['rush', 'turtle', 'balanced'] });
  assert.strictEqual(f.strategies.dominant, 'rush');
  assert.strictEqual(f.strategies.winShare.turtle, 0);
  assert.match(titles(f), /Strategy "rush" wins 80% of seeds/);
  assert.match(f.findings.find((x) => /Strategy/.test(x.title)).evidence, /never the better choice: turtle/);
  const even = computeFun(botsOf({ a: (s) => (s % 2 ? 10 : 0), b: (s) => (s % 2 ? 0 : 10) }), { strategies: ['a', 'b'] });
  assert.strictEqual(even.strategies.dominant, null);
});

test('no score metric: fun still runs and says how to configure it', () => {
  const rows = botsOf({ idle: () => 1 }).rows.map((r) => ({ ...r, metrics: { hp: 3 } }));
  const f = computeFun({ rows });
  assert.strictEqual(f.metric, null);
  assert.match(f.notes.join(' '), /set fun\.score/);
  const typo = computeFun({ rows }, { score: 'pionts' });
  assert.strictEqual(typo.skill, undefined);
  assert.match(typo.notes.join(' '), /no run reports the score metric "pionts"/);
});

test('run extras: time-weighted action mix, tension slices, continuous actions keep counts only', () => {
  const x = runExtras([[0, { m: 1 }], [80, { m: 0 }]], 100, [[0, 0.1], [50, 0.5], [99, 0.9]]);
  assert.deepStrictEqual(x.actionMix.top, [['{"m":1}', 0.8], ['{"m":0}', 0.2]]);
  assert.strictEqual(x.tension.length, 10);
  assert.deepStrictEqual([x.tension[0], x.tension[5], x.tension[9]], [0.1, 0.5, 0.9]);
  assert.strictEqual(x.tension[3], null);
  const aims = Array.from({ length: 40 }, (_, i) => [i * 2, { x: i * 1.5 }]);
  assert.deepStrictEqual(runExtras(aims, 80, []).actionMix.top, []);
});

test('bots record action mix and tension; tension shape findings', async () => {
  const line = await import(pathToFileURL(path.join(FIX, 'line.adapter.mjs')).href);
  // Tension falls as the seeker closes in, so it peaks at the start.
  const adapter = { ...line, tension: (o) => Math.min(1, Math.abs(o.target - o.x) / 7) };
  const res = await runBots(adapter, { runs: 6, policies: ['idle', 'random', 'seeker'] });
  const seekerRow = res.rows.find((r) => r.policy === 'seeker');
  assert.ok(seekerRow.actionMix.top.length, 'discrete actions keep their mix');
  assert.strictEqual(seekerRow.tension.length, 10);
  const f = computeFun(res, { score: 'reached', tensionPolicy: 'seeker' });
  assert.strictEqual(f.actions.policy, 'seeker');
  assert.strictEqual(f.actions.continuous, false);
  assert.ok(f.tension.curves.seeker);
  assert.match(titles(f), /Tension peaks in the first 30%/);
  assert.match(renderFun(f).join('\n'), /Tension/);
});

test('a throwing tension() never fails a run', async () => {
  const line = await import(pathToFileURL(path.join(FIX, 'line.adapter.mjs')).href);
  const res = await runBots({ ...line, tension: () => { throw new Error('nope'); } }, { runs: 3, policies: ['seeker'] });
  assert.strictEqual(res.policies.seeker.failures, 0);
});

test('report: fun section and findings, recomputed without piling up', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playtest-lab-'));
  const lab = new Lab(dir);
  lab.init({ name: 'Fixture' });
  const run = lab.newRun('fun');
  lab.write(path.join('runs', run, 'bots.json'), { runsPerPolicy: 20, policies: {}, ...botsOf({ idle: () => 0, greedy: (s) => luck(s), careful: (s) => luck(s) + 2 }) });
  lab.buildReport(run);
  const r = lab.buildReport(run);
  assert.strictEqual(r.fun.fun, 'playtest-fun/1');
  assert.strictEqual(r.fun.findings, undefined, 'findings live in issues, not twice');
  const funIssues = r.issues.filter((i) => i.source === 'bot:fun');
  assert.strictEqual(funIssues.length, 1);
  assert.strictEqual(funIssues[0].verified, true);
  assert.strictEqual(funIssues[0].suggestedTicket.team, 'design');
  assert.match(fs.readFileSync(path.join(dir, '.playtest', 'runs', run, 'report.md'), 'utf8'), /## Fun metrics/);
});

test('tension shapes: flat, and a late peak that ends calmer than it starts', () => {
  const withCurve = (c) => ({ rows: botsOf({ idle: () => 0, careful: () => 10 }, 3).rows.map((r) => ({ ...r, tension: c })) });
  assert.match(titles(computeFun(withCurve(Array(10).fill(0.5)))), /stays flat/);
  const f = computeFun(withCurve([0.9, 0.8, 0.8, 1, 0.5, 0.4, 0.3, 0.2, 0.2, 0.1]));
  assert.match(titles(f), /ends calmer than it starts/);
  assert.strictEqual(f.tension.shape.policy, 'careful', 'curve of the best policy');
  assert.strictEqual(computeFun(withCurve([0.1, 0.2, 0.3, 0.4, 0.5, 0.5, 0.6, 0.8, 1, 0.7])).findings.length, 0);
});
