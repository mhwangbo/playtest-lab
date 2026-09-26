'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Lab, CONTRACT, importLevelBots } = require('../lab/lab.js');
const { classifyText } = require('../lab/classify.js');

function freshLab() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playtest-lab-'));
  const lab = new Lab(dir);
  lab.init({ name: 'Fixture' });
  const run = lab.newRun('test');
  return { lab, run, dir };
}

/** Personas must log notes before a verdict counts. */
const notes = (lab, run, n = 3) => { for (let i = 0; i < n; i++) lab.record(run, 'note', { persona: 'first-timer', text: `note ${i}` }); };

const verdict = (extra = {}) => ({
  persona: 'first-timer', rating: 3, replay: 'yes', summary: 'ok',
  unsure: ['a', 'b', 'c'],
  scores: { clarity10s: 3, clarity60s: 3, agency: 3, tension: 3, reward: 3, replay: 3 },
  ...extra,
});

test('init creates config with the studio integration defaulting to auto', () => {
  const { lab } = freshLab();
  assert.strictEqual(lab.config().integrations.gameStudio, 'auto');
  assert.ok(fs.existsSync(path.join(lab.root, '.playtest', 'adapter.mjs')), 'template adapter copied');
});

test('classifier maps common feedback to categories', () => {
  assert.strictEqual(classifyText('the game froze on level 2').category, 'crash');
  assert.strictEqual(classifyText("I didn't understand what to do").category, 'clarity');
  assert.strictEqual(classifyText('way too hard, feels unfair').category, 'balance');
  assert.strictEqual(classifyText('I love this, so relaxing').sentiment, 'positive');
});

test('persona verdict requires recorded notes', () => {
  const { lab, run } = freshLab();
  notes(lab, run, 2);
  assert.throws(() => lab.record(run, 'done', verdict({ noIssues: true })), /at least 3 recorded notes/);
  notes(lab, run, 1);
  assert.doesNotThrow(() => lab.record(run, 'done', verdict({ noIssues: true })));
});

test('persona verdict requires 3 unsure moments and all six scores', () => {
  const { lab, run } = freshLab();
  notes(lab, run);
  assert.throws(() => lab.record(run, 'done', verdict({ unsure: ['only one'], noIssues: true })), /3 moments/);
  assert.throws(() => lab.record(run, 'done', verdict({ scores: { clarity10s: 3 }, noIssues: true })), /scores/);
});

test('persona cannot finish without recorded issues or an explicit noIssues', () => {
  const { lab, run } = freshLab();
  notes(lab, run);
  assert.throws(() => lab.record(run, 'done', verdict()), /noIssues/);
  lab.record(run, 'done', verdict({ issues: [{ title: 'Menu text too small', severity: 'P3', category: 'accessibility' }] }));
  const issues = lab.readLines(run, 'issues.jsonl');
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].source, 'persona:first-timer');
});

test('issues recorded earlier count toward the verdict', () => {
  const { lab, run } = freshLab();
  notes(lab, run);
  lab.record(run, 'issue', { persona: 'first-timer', title: 'Hint unclear', severity: 'P2', category: 'clarity' });
  assert.doesNotThrow(() => lab.record(run, 'done', verdict()));
});

test('report excludes unverified persona issues from the verdict and keeps the contract', () => {
  const { lab, run } = freshLab();
  lab.addIssue(run, { title: 'Crash on start', severity: 'P0', category: 'crash', source: 'persona:x' });
  let r = lab.buildReport(run);
  assert.strictEqual(r.contract, CONTRACT);
  assert.strictEqual(r.summary.unverified, 1);
  assert.strictEqual(r.summary.verdict, 'playable');
  const all = lab.readLines(run, 'issues.jsonl');
  all[0].verified = true;
  fs.writeFileSync(lab.p('runs', run, 'issues.jsonl'), all.map((x) => JSON.stringify(x)).join('\n') + '\n');
  r = lab.buildReport(run);
  assert.strictEqual(r.summary.verdict, 'blocked');
  assert.strictEqual(r.issues[0].suggestedTicket.type, 'bug');
  assert.ok(fs.existsSync(lab.p('runs', run, 'report.md')));
});

test('bot findings count as verified', () => {
  const { lab, run } = freshLab();
  lab.addIssue(run, { title: 'Softlock', severity: 'P1', category: 'softlock', source: 'bot:random' });
  assert.strictEqual(lab.buildReport(run).summary.verdict, 'needs-work');
});

test('engine-side per-level bot files import into the standard shape', () => {
  const res = importLevelBots({
    source: 'test', seedsPerPolicy: 3,
    levels: [
      { id: 'l1', policies: [{ policy: 'novice', runs: 3, solvedPct: 100, movesP50: 4 }] },
      { id: 'l2', policies: [{ policy: 'novice', runs: 3, solvedPct: 50, movesP50: 10 }] },
    ],
  });
  assert.strictEqual(res.policies.novice.runs, 6);
  assert.strictEqual(res.policies.novice.metrics.solvedPct.mean, 75);
  assert.strictEqual(res.levels.length, 2);
});
