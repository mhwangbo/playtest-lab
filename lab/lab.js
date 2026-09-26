#!/usr/bin/env node
/*
 * lab.js — Playtest Lab CLI (zero dependencies, Node 18+).
 * Per-game state lives in <game>/.playtest/ :
 *   config.json            game name, build url/path, adapter path, integrations
 *   baseline.json          bot aggregates that `check` compares against (commit it with the game)
 *   runs/<RUN>/            bots.json, notes.jsonl, issues.jsonl, personas.jsonl, check.json, traces/, playtest-report.json, report.md
 * Run `node lab.js help`.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { runBots, replayTrace } = require('./bots.js');
const { makeBaseline, compare, renderCheck } = require('./check.js');
const { classifyText } = require('./classify.js');

const LAB_DIR = path.resolve(__dirname, '..');
const CONTRACT = 'playtest-report/1';
const SEVERITIES = ['P0', 'P1', 'P2', 'P3'];
const CATEGORIES = ['bug', 'crash', 'softlock', 'balance', 'clarity', 'feel', 'ux', 'perf', 'accessibility', 'audio', 'other'];

// ---------------------------------------------------------------- helpers
const now = () => Date.now();
function parseArgs(argv) {
  const pos = []; const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const nx = argv[i + 1]; if (nx === undefined || nx.startsWith('--')) o[a.slice(2)] = true; else { o[a.slice(2)] = nx; i++; } } else pos.push(a);
  }
  return { pos, o };
}
function findGame(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.PLAYTEST_GAME) return path.resolve(process.env.PLAYTEST_GAME);
  let d = process.cwd();
  for (;;) { if (fs.existsSync(path.join(d, '.playtest', 'config.json'))) return d; const p = path.dirname(d); if (p === d) break; d = p; }
  return process.cwd();
}

class Lab {
  constructor(root) { this.root = root; this.dir = path.join(root, '.playtest'); }
  p(...a) { return path.join(this.dir, ...a); }
  exists() { return fs.existsSync(this.p('config.json')); }
  read(rel, def) { try { return JSON.parse(fs.readFileSync(this.p(rel), 'utf8')); } catch { return def; } }
  write(rel, obj) { const f = this.p(rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj, null, 2)); }
  config() { return this.read('config.json', {}); }
  setConfig(patch) { const c = Object.assign(this.config(), patch); this.write('config.json', c); return c; }

  init(o) {
    fs.mkdirSync(this.p('runs'), { recursive: true });
    if (!this.exists()) {
      this.write('config.json', {
        name: o.name || path.basename(this.root), build: o.build || '', adapter: o.adapter || '.playtest/adapter.mjs',
        created: now(), current: '', nextRun: 1,
        integrations: { gameStudio: 'auto' }, // auto | off — mirror summaries into an ai-game-studio chat when one exists
      });
    }
    const adapter = path.join(this.root, this.config().adapter);
    if (!fs.existsSync(adapter)) fs.copyFileSync(path.join(LAB_DIR, 'templates', 'adapter.template.mjs'), adapter);
    return this.config();
  }

  newRun(label = '') {
    const c = this.config();
    const id = `R${c.nextRun || 1}`;
    fs.mkdirSync(this.p('runs', id), { recursive: true });
    this.write(path.join('runs', id, 'run.json'), { id, label, build: c.build, created: now() });
    this.setConfig({ current: id, nextRun: (c.nextRun || 1) + 1 });
    return id;
  }
  run(o) {
    const id = (o && o.run) || this.config().current;
    if (!id) throw new Error('no run yet — `lab.js run new`');
    return id;
  }
  append(runId, file, obj) { fs.appendFileSync(this.p('runs', runId, file), JSON.stringify(obj) + '\n'); return obj; }
  readLines(runId, file) {
    try { return fs.readFileSync(this.p('runs', runId, file), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
  }

  async adapter() {
    const f = path.resolve(this.root, this.config().adapter);
    if (!fs.existsSync(f)) throw new Error(`adapter missing: ${f}`);
    const mod = await import(pathToFileURL(f).href + `?t=${now()}`);
    // Engine games (Unity/Godot/Unreal): adapter exports `bridge` config → out-of-process adapter.
    if (mod.bridge) return require('./bridge.js').createBridgeAdapter(mod, this.root);
    return mod;
  }

  /** Runs the adapter's bots into a run: bots.json, failing-run traces, findings → issues. */
  async runBotsInto(runId, opts) {
    const adapter = await this.adapter();
    const traceDir = this.p('runs', runId, 'traces');
    const saveTrace = (t) => {
      fs.mkdirSync(traceDir, { recursive: true });
      const file = path.join(traceDir, `${t.policy}-s${t.seed}-${t.outcome.kind}.json`.replace(/[^\w.-]+/g, '_'));
      fs.writeFileSync(file, JSON.stringify(t));
      return path.relative(this.root, file).split(path.sep).join('/');
    };
    const res = await runBots(adapter, { ...opts, saveTrace });
    this.write(path.join('runs', runId, 'bots.json'), res);
    for (const f of res.findings) this.append(runId, 'issues.jsonl', { ts: now(), ...f });
    return res;
  }

  /**
   * Optional integration with ai-game-studio (https://github.com/mhwangbo/ai-game-studio): mirror lab
   * activity into the studio's #qa chat. config.integrations.gameStudio = 'auto' (default: only when the game
   * folder or its parent has a .studio/ and the studio skill is installed) | 'off' | '<path to studio.js>'.
   * PLAYTEST_STUDIO_CLI overrides the path. The lab never depends on it: reports are the real interface.
   */
  studioPost(channel, text) {
    const setting = (this.config().integrations || {}).gameStudio ?? 'auto';
    if (setting === 'off' || setting === false) return false;
    const studioCli = process.env.PLAYTEST_STUDIO_CLI
      || (setting !== 'auto' ? path.resolve(this.root, String(setting)) : path.join(require('os').homedir(), '.claude', 'skills', 'game-studio', 'server', 'studio.js'));
    if (!fs.existsSync(path.join(this.root, '.studio', 'config.json')) && !fs.existsSync(path.join(path.dirname(this.root), '.studio', 'config.json'))) return false;
    if (!fs.existsSync(studioCli)) return false;
    try {
      const { Studio, findProject } = require(studioCli);
      const s = new Studio(findProject(fs.existsSync(path.join(this.root, '.studio')) ? this.root : path.dirname(this.root)));
      s.post('playtest-lab', channel, text, { role: 'lab' });
      return true;
    } catch { return false; }
  }

  /** Validates and records a persona's final verdict. Rubric: forced criticism keeps cheap models from rubber-stamping. */
  personaDone(runId, d) {
    const unsure = (d.unsure || []).map((s) => String(s).trim()).filter(Boolean);
    if (unsure.length < 3) throw new Error('needs unsure: the 3 moments you were most unsure what to do or what had just happened');
    const need = ['clarity10s', 'clarity60s', 'agency', 'tension', 'reward', 'replay'];
    const scores = d.scores || {};
    const missing = need.filter((k) => !(Number(scores[k]) >= 1 && Number(scores[k]) <= 5));
    if (missing.length) throw new Error(`needs scores 1-5 for ${need.join(', ')} (missing: ${missing.join(', ')})`);
    return this.append(runId, 'personas.jsonl', { ts: now(), persona: d.persona || 'unknown', rating: Number(d.rating) || null, summary: d.summary || '', wouldReplay: d.replay, unsure, scores });
  }

  addNote(runId, source, text) {
    const c = classifyText(text);
    return this.append(runId, 'notes.jsonl', { ts: now(), source, text, category: c.category, sentiment: c.sentiment, engine: 'heuristic' });
  }

  addIssue(runId, i) {
    if (!i.title) throw new Error('issue needs a title');
    const sev = SEVERITIES.includes(i.severity) ? i.severity : 'P2';
    const cat = CATEGORIES.includes(i.category) ? i.category : classifyText(i.title).category;
    return this.append(runId, 'issues.jsonl', { ts: now(), title: i.title, severity: sev, category: cat, source: i.source || 'unknown', evidence: i.evidence || '', repro: i.repro || '', seeds: i.seeds || [], accept: i.accept });
  }

  /** One logging path for all persona harnesses (web page or engine host). */
  record(runId, kind, body) {
    const src = `persona:${body.persona || 'unknown'}`;
    if (kind === 'note') return this.addNote(runId, src, String(body.text || ''));
    if (kind === 'issue') {
      const r = this.addIssue(runId, { ...body, source: src });
      if (r.severity === 'P0' || r.severity === 'P1') this.studioPost('qa', `🧪 [${r.severity}] ${r.title} (${r.category}, ${src})`);
      return r;
    }
    if (kind === 'done') {
      // A persona cannot claim issues it never recorded: issues come inside the verdict, were recorded
      // earlier (counted from the file), or the persona states noIssues explicitly.
      const inline = Array.isArray(body.issues) ? body.issues : [];
      for (const i of inline) if (!i || !i.title) throw new Error('every issue needs a title');
      const earlier = this.readLines(runId, 'issues.jsonl').filter((i) => i.source === src).length;
      if (!inline.length && !earlier && body.noIssues !== true) throw new Error('done needs issues (inside done, or recorded before) — or noIssues: true if you truly found none');
      const r = this.personaDone(runId, body);
      for (const i of inline) this.addIssue(runId, { ...i, source: src });
      this.studioPost('qa', `🎭 persona ${r.persona} finished: ${r.rating ?? '?'}/5 — ${r.summary}`);
      return r;
    }
    throw new Error(`unknown record kind ${kind}`);
  }

  buildReport(runId) {
    const c = this.config();
    const run = this.read(path.join('runs', runId, 'run.json'), {});
    const bots = this.read(path.join('runs', runId, 'bots.json'), null);
    const notes = this.readLines(runId, 'notes.jsonl');
    const personas = this.readLines(runId, 'personas.jsonl');
    const issues = this.readLines(runId, 'issues.jsonl').sort((a, b) => a.severity.localeCompare(b.severity));
    const check = this.read(path.join('runs', runId, 'check.json'), null);
    const teamOf = { bug: 'engineering', crash: 'engineering', softlock: 'engineering', perf: 'engineering', balance: 'design', clarity: 'design', feel: 'design', ux: 'engineering', accessibility: 'engineering', audio: 'audio', other: 'design' };
    const report = {
      contract: CONTRACT, game: c.name, build: run.build || c.build, runId, created: now(), label: run.label || '',
      bots: bots ? { runsPerPolicy: bots.runsPerPolicy, seconds: bots.seconds, policies: bots.policies, levels: bots.levels } : null,
      check: check ? { status: check.status, baselineRun: check.baselineRun, regressions: check.regressions, improved: check.improved, rows: check.rows.filter((r) => r.status !== 'ok') } : null,
      personas: personas.map((p) => ({ name: p.persona, rating: p.rating, summary: p.summary, wouldReplay: p.wouldReplay, scores: p.scores || {}, unsure: p.unsure || [] })),
      notes: notes.map((n) => ({ source: n.source, text: n.text, category: n.category, sentiment: n.sentiment })),
      issues: issues.map((i, k) => ({
        id: `${runId}-I${k + 1}`, title: i.title, severity: i.severity, category: i.category, source: i.source,
        evidence: i.evidence || '', repro: i.repro || '', seeds: i.seeds || [], ...(i.traces ? { traces: i.traces } : {}),
        // Persona reports can be artifacts of how an agent drives the UI; bot findings are reproducible by seed.
        verified: !!i.verified || String(i.source).startsWith('bot:'),
        suggestedTicket: {
          title: i.title, team: teamOf[i.category] || 'design', type: ['bug', 'crash', 'softlock'].includes(i.category) ? 'bug' : 'design',
          priority: i.severity, accept: i.accept || [i.repro ? `Repro no longer occurs: ${i.repro}` : `Resolved: ${i.title}`],
        },
      })),
    };
    const sev = (s) => report.issues.filter((i) => i.severity === s && i.verified).length;
    report.summary = { unverified: report.issues.filter((i) => !i.verified).length };
    const ratings = report.personas.map((p) => Number(p.rating)).filter((n) => n > 0);
    report.summary = {
      ...report.summary,
      issues: { P0: sev('P0'), P1: sev('P1'), P2: sev('P2'), P3: sev('P3') },
      personaRating: ratings.length ? +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2) : null,
      verdict: sev('P0') ? 'blocked' : sev('P1') ? 'needs-work' : 'playable',
    };
    this.write(path.join('runs', runId, 'playtest-report.json'), report);
    fs.writeFileSync(this.p('runs', runId, 'report.md'), renderMd(report));
    return report;
  }
}

/**
 * Converts an engine-side per-level bot file ({levels:[{id, ..., policies:[{policy, runs, solvedPct, movesMean, ...}]}]})
 * into the lab's bots.json: policy aggregates across levels + the per-level table kept for the report.
 */
function importLevelBots(ext) {
  const { stats } = require('./bots.js');
  const byPolicy = {};
  for (const lv of ext.levels) for (const p of lv.policies) (byPolicy[p.policy] ||= []).push(p);
  const policies = {};
  for (const [name, rows] of Object.entries(byPolicy)) {
    const keys = Object.keys(rows[0]).filter((k) => typeof rows[0][k] === 'number' && k !== 'runs');
    policies[name] = { runs: rows.reduce((a, r) => a + r.runs, 0), failures: 0, metrics: Object.fromEntries(keys.map((k) => [k, stats(rows.map((r) => r[k]))])) };
  }
  return { runsPerPolicy: ext.seedsPerPolicy, seconds: null, source: ext.source, policies, levels: ext.levels, rows: [], findings: [] };
}

function botLines(res) {
  const lines = [`bots done (${res.runsPerPolicy} runs × ${Object.keys(res.policies).length} policies, ${res.ms} ms)`];
  for (const [name, p] of Object.entries(res.policies)) {
    const kinds = Object.entries(p.failureKinds || {}).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ');
    lines.push(`  ${name.padEnd(14)} ${Object.entries(p.metrics).map(([k, v]) => `${k} ${fmt(v && v.mean)}`).join('  ')}  failures ${p.failures}${kinds ? ` (${kinds})` : ''}`);
  }
  if (res.findings.length) lines.push(`  findings → issues: ${res.findings.map((f) => `[${f.severity}] ${f.title}`).join('; ')}`);
  return lines;
}

function fmt(n) { return typeof n === 'number' ? (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2)) : String(n); }
function renderMd(r) {
  const L = [`# Playtest report — ${r.game} (${r.runId})`, '', `Build: ${r.build || '-'}  ·  verdict: **${r.summary.verdict}**  ·  issues P0 ${r.summary.issues.P0} / P1 ${r.summary.issues.P1} / P2 ${r.summary.issues.P2} / P3 ${r.summary.issues.P3}${r.summary.personaRating ? `  ·  persona rating ${r.summary.personaRating}/5` : ''}`, ''];
  if (r.bots) {
    L.push(`## Bots (${r.bots.runsPerPolicy} runs per policy)`, '');
    const metrics = [...new Set(Object.values(r.bots.policies).flatMap((p) => Object.keys(p.metrics)))];
    L.push(`| policy | ${metrics.join(' | ')} | failures |`, `|---|${metrics.map(() => '---').join('|')}|---|`);
    for (const [name, p] of Object.entries(r.bots.policies)) L.push(`| ${name} | ${metrics.map((m) => (p.metrics[m] ? `${fmt(p.metrics[m].mean)} (p10 ${fmt(p.metrics[m].p10)}–p90 ${fmt(p.metrics[m].p90)})` : '-')).join(' | ')} | ${p.failures} |`);
    L.push('');
  }
  if (r.check) {
    L.push(`## Regression check (vs ${r.check.baselineRun}): ${r.check.status.toUpperCase()}`, '');
    if (!r.check.rows.length) L.push('- no changes beyond tolerance');
    for (const x of r.check.rows) L.push(`- ${x.status}: ${x.policy}.${x.metric} ${x.base !== undefined ? fmt(x.base) : '-'} → ${x.cur !== undefined ? fmt(x.cur) : '-'}${x.note ? ` (${x.note})` : ''}`);
    L.push('');
  }
  if (r.bots && r.bots.levels) {
    const pols = [...new Set(r.bots.levels.flatMap((lv) => lv.policies.map((p) => p.policy)))];
    L.push('### Per level (solved % · median moves)', '', `| level | tier | target time | ${pols.join(' | ')} |`, `|---|---|---|${pols.map(() => '---').join('|')}|`);
    for (const lv of r.bots.levels) {
      L.push(`| ${lv.id}${lv.comfortRules ? ' ♥' : ''} | ${lv.tier || ''} ${lv.rating || ''} | ${lv.solveTime || ''} | ${pols.map((n) => { const p = lv.policies.find((x) => x.policy === n); return p ? `${Math.round(p.solvedPct)}% · ${Math.round(p.movesP50)}` : '-'; }).join(' | ')} |`);
    }
    L.push('', '♥ = level has comfort rules', '');
  }
  if (r.personas.length) {
    L.push('## Personas', '');
    for (const p of r.personas) {
      L.push(`- **${p.name}** — ${p.rating ?? '?'}/5${p.wouldReplay !== undefined ? `, would replay: ${p.wouldReplay}` : ''}: ${p.summary || ''}`);
      if (p.scores && Object.keys(p.scores).length) L.push(`  - rubric: ${Object.entries(p.scores).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
      for (const u of p.unsure || []) L.push(`  - unsure: ${u}`);
    }
    L.push('');
  }
  L.push('## Issues', '');
  if (r.summary.unverified) L.push(`_${r.summary.unverified} persona issue(s) unverified — reproduce (\`issue verify\`) before ticketing; they are excluded from the verdict._`, '');
  for (const i of r.issues) L.push(`- ${i.verified ? '' : '⚠ UNVERIFIED '}**[${i.severity}] ${i.title}** (${i.category}, ${i.source})${i.evidence ? `\n  - evidence: ${i.evidence}` : ''}${i.repro ? `\n  - repro: ${i.repro}` : ''}`);
  if (!r.issues.length) L.push('- none');
  if (r.notes.length) {
    L.push('', '## Feedback notes', '');
    for (const n of r.notes) L.push(`- (${n.category || '?'}, ${n.sentiment || '?'}) ${n.source}: ${n.text}`);
  }
  return L.join('\n') + '\n';
}

const HELP = `lab.js — Playtest Lab   (global: --game <dir>  --run <RUN>  --json)

  init --game <dir> [--build <url|path> --name N --adapter .playtest/adapter.mjs]
  run new [--label "M2 polish"]         start a playtest run (becomes current)
  status                                current run summary
  bots [--runs 30 --policies idle,random,<adapter policies> --seed 1 --seconds <max>]
                                        headless bot runs via the game adapter → bots.json
                                        failing runs are saved as traces in runs/<RUN>/traces/
  replay <trace.json> [--expect fixed|reproduced]
                                        re-run a saved failing run exactly; --expect sets the exit code
  baseline set [--run R3] | show        save that run's bot results as the regression baseline
  check [--label ..] [--import file]    new run: bots on the baseline's seeds, compare, exit 1 on regression
  note add --source persona:casual "text"        free-text feedback (auto-classified)
  issue add --title T --severity P0-P3 --category ${CATEGORIES.join('|')}
            --source persona:x|bot:x [--evidence .. --repro .. --seeds 1,2 --accept "a|b"]
  persona done --persona casual --rating 1-5 --summary "..." [--replay yes|no]
  classify                              (re)classify notes (built-in keyword classifier)
  report [--post]                       build playtest-report.json + report.md; --post mirrors to game-studio #qa
  serve [--root Builds/Web/1.0 --port 8120 --fidelity human|full --vision-first 60]
                                        web build + live persona harness (/__lab/*), logs to sessions.jsonl
  host [--port 8130]                    launch the engine build with graphics for personas (adapter.personaBridge)
  play <verb> ... [--port 8130 --persona NAME]   persona actions on a running host (play help)
`;

async function main() {
  const { pos, o } = parseArgs(process.argv.slice(2));
  const cmd = pos[0];
  if (!cmd || cmd === 'help') return console.log(HELP);
  const lab = new Lab(findGame(o.game));
  const out = (x, t) => console.log(o.json ? JSON.stringify(x, null, 2) : (t ?? JSON.stringify(x, null, 2)));
  // `play` only talks to a running host; it must never depend on (or suggest creating) a game folder.
  if (cmd === 'play') { const { play } = require('./host.js'); return console.log(await play(Number(o.port) || 8130, pos, o)); }
  if (cmd === 'init') { const c = lab.init(o); return out(c, `lab ready: ${lab.dir}\nadapter: ${path.resolve(lab.root, c.adapter)} (fill it in if it is the template)`); }
  if (!lab.exists()) throw new Error(`no .playtest in ${lab.root} — run: lab.js init --game <dir>`);

  switch (cmd) {
    case 'run': { if (pos[1] !== 'new') throw new Error('usage: run new'); const id = lab.newRun(o.label || ''); lab.studioPost('qa', `🧪 Playtest run ${id} started${o.label ? ` (${o.label})` : ''}.`); return out({ id }, `run ${id} started`); }
    case 'status': {
      const id = lab.run(o);
      const n = (f) => lab.readLines(id, f).length;
      const bots = lab.read(path.join('runs', id, 'bots.json'), null);
      return out({ id }, `run ${id}: bots ${bots ? Object.keys(bots.policies).join(',') : '-'} · notes ${n('notes.jsonl')} · issues ${n('issues.jsonl')} · personas ${lab.readLines(id, 'personas.jsonl').map((p) => p.persona).join(',') || '-'}`);
    }
    case 'bots': {
      const id = lab.run(o);
      if (o.import) {
        // Engine-side bot runs (e.g. Unity batchmode on the pure puzzle core) → standard bots.json.
        const ext = JSON.parse(fs.readFileSync(path.resolve(lab.root, o.import), 'utf8'));
        const res = importLevelBots(ext);
        let mod = {};
        try { mod = await import(pathToFileURL(path.resolve(lab.root, lab.config().adapter)).href + `?t=${now()}`); } catch {}
        if (mod.findingsFromLevels) for (const f of mod.findingsFromLevels(ext.levels) || []) res.findings.push({ severity: 'P2', category: 'balance', source: 'bot:analysis', ...f });
        lab.write(path.join('runs', id, 'bots.json'), res);
        for (const f of res.findings) lab.append(id, 'issues.jsonl', { ts: now(), ...f });
        const lines = [`imported ${ext.levels.length} levels × ${Object.keys(res.policies).length} policies from ${ext.source || o.import}`];
        for (const [name, p] of Object.entries(res.policies)) lines.push(`  ${name.padEnd(12)} ${Object.entries(p.metrics).map(([k, v]) => `${k} ${fmt(v.mean)}`).join('  ')}`);
        if (res.findings.length) lines.push(`  findings: ${res.findings.map((f) => `[${f.severity}] ${f.title}`).join('; ')}`);
        lab.studioPost('qa', `🤖 ${lines.join('\n')}`);
        return out(res, lines.join('\n'));
      }
      const res = await lab.runBotsInto(id, {
        runs: Number(o.runs) || 30, seed: Number(o.seed) || 1, seconds: o.seconds ? Number(o.seconds) : undefined,
        policies: o.policies ? String(o.policies).split(',') : undefined,
      });
      const lines = botLines(res);
      lab.studioPost('qa', `🤖 ${lines.join('\n')}`);
      return out(res, lines.join('\n'));
    }
    case 'replay': {
      if (!pos[1]) throw new Error('usage: replay <trace.json> [--expect fixed|reproduced]');
      const trace = JSON.parse(fs.readFileSync(path.resolve(lab.root, pos[1]), 'utf8'));
      const r = await replayTrace(await lab.adapter(), trace);
      const want = o.expect === 'fixed' ? false : o.expect === 'reproduced' ? true : null;
      if (want !== null && r.reproduced !== want) process.exitCode = 1;
      const got = r.outcome ? `${r.outcome.kind}: ${r.outcome.message}` : 'no failure';
      return out(r, `${r.reproduced ? 'REPRODUCED' : 'NOT reproduced'}: expected ${trace.outcome.kind}: ${trace.outcome.message}\n  got ${got} (step ${r.steps}, ${r.seconds}s)${want === null ? '' : `\n  --expect ${o.expect}: ${process.exitCode ? 'FAIL' : 'pass'}`}`);
    }
    case 'baseline': {
      if (pos[1] === 'show') {
        const b = lab.read('baseline.json', null);
        if (!b) throw new Error('no baseline yet — `lab.js baseline set`');
        return out(b, `baseline from ${b.runId} (${new Date(b.created).toISOString()}), ${b.opts.runs} runs from seed ${b.opts.seed}, policies ${Object.keys(b.policies).join(', ')}`);
      }
      if (pos[1] !== 'set') throw new Error('usage: baseline set [--run R3] | baseline show');
      const id = lab.run(o);
      const b = makeBaseline(lab.read(path.join('runs', id, 'bots.json'), null), id);
      lab.write('baseline.json', b);
      return out(b, `baseline set from ${id}: ${Object.keys(b.policies).join(', ')} (${b.opts.runs} runs from seed ${b.opts.seed}) → ${lab.p('baseline.json')}`);
    }
    case 'check': {
      const b = lab.read('baseline.json', null);
      if (!b) throw new Error('no baseline yet — run bots on a good build, then `lab.js baseline set`');
      const id = lab.newRun(o.label || `check vs ${b.runId}`);
      let res;
      if (o.import) {
        res = importLevelBots(JSON.parse(fs.readFileSync(path.resolve(lab.root, o.import), 'utf8')));
        lab.write(path.join('runs', id, 'bots.json'), res);
      } else {
        res = await lab.runBotsInto(id, { runs: b.opts.runs, seed: b.opts.seed, seconds: b.opts.seconds || undefined, policies: b.opts.policies });
      }
      const c = { ...compare(b, res, lab.config().check || {}), baselineRun: b.runId, runId: id, created: now() };
      lab.write(path.join('runs', id, 'check.json'), c);
      lab.buildReport(id);
      if (c.status === 'fail') process.exitCode = 1;
      const text = renderCheck(c);
      lab.studioPost('qa', `${c.status === 'pass' ? '✅' : '❌'} Playtest ${id} ${text}`);
      return out(c, `${text}\nrun ${id}; report: ${lab.p('runs', id, 'report.md')}`);
    }
    case 'note': {
      const id = lab.run(o); const text = pos.slice(2).join(' ');
      if (!text) throw new Error('note text required');
      const n = lab.addNote(id, o.source || 'unknown', text);
      return out(n, `noted (${n.category}, ${n.sentiment})`);
    }
    case 'issue': {
      const id = lab.run(o);
      if (pos[1] === 'verify' || pos[1] === 'reject') {
        const all = lab.readLines(id, 'issues.jsonl'); const k = Number(String(pos[2] || '').replace(/^.*I/, '')) - 1;
        if (!all[k]) throw new Error(`no issue ${pos[2]} (use the I-number from the report)`);
        if (pos[1] === 'verify') Object.assign(all[k], { verified: true, verifiedNote: o.note || '' }); else all.splice(k, 1);
        fs.writeFileSync(lab.p('runs', id, 'issues.jsonl'), all.map((x) => JSON.stringify(x)).join('\n') + (all.length ? '\n' : ''));
        return out(all, `${pos[1] === 'verify' ? 'verified' : 'rejected'} ${pos[2]}`);
      }
      if (!o.title) throw new Error('--title required');
      const i = lab.addIssue(id, { title: o.title, severity: o.severity, category: o.category, source: o.source, evidence: o.evidence, repro: o.repro, seeds: o.seeds ? String(o.seeds).split(',').map(Number) : [], accept: o.accept ? String(o.accept).split('|') : undefined });
      if (i.severity === 'P0' || i.severity === 'P1') lab.studioPost('qa', `🧪 [${i.severity}] ${i.title} (${i.category}, ${i.source})`);
      return out(i, `issue logged [${i.severity}] ${i.title}`);
    }
    case 'persona': {
      const id = lab.run(o);
      const scores = {};
      for (const kv of String(o.scores || '').split(',')) { const [k, v] = kv.split('='); if (k && v) scores[k.trim()] = Number(v); }
      const p = lab.personaDone(id, { persona: o.persona, rating: o.rating, summary: o.summary, replay: o.replay, unsure: o.unsure ? String(o.unsure).split('|') : [], scores });
      lab.studioPost('qa', `🎭 persona ${p.persona} finished: ${p.rating ?? '?'}/5 — ${p.summary}`);
      return out(p, 'persona recorded');
    }
    case 'classify': {
      const id = lab.run(o);
      const notes = lab.readLines(id, 'notes.jsonl').map((n) => Object.assign(n, classifyText(n.text), { engine: 'heuristic' }));
      fs.writeFileSync(lab.p('runs', id, 'notes.jsonl'), notes.map((n) => JSON.stringify(n)).join('\n') + (notes.length ? '\n' : ''));
      return out(notes, `classified ${notes.length} notes (heuristic)`);
    }
    case 'report': {
      const id = lab.run(o);
      const r = lab.buildReport(id);
      const file = lab.p('runs', id, 'playtest-report.json');
      if (o.post) lab.studioPost('qa', `📋 Playtest ${id} report: verdict **${r.summary.verdict}**, issues P0 ${r.summary.issues.P0}/P1 ${r.summary.issues.P1}/P2 ${r.summary.issues.P2}/P3 ${r.summary.issues.P3}${r.summary.personaRating ? `, persona avg ${r.summary.personaRating}/5` : ''}. File: ${file}`);
      return out(r, `report: ${file}\n${fs.readFileSync(lab.p('runs', id, 'report.md'), 'utf8')}`);
    }
    case 'serve': {
      const id = lab.run(o);
      const root = path.resolve(lab.root, o.root || lab.config().webRoot || '.');
      const port = Number(o.port) || 8120;
      const config = { fidelity: o.fidelity === 'full' ? 'full' : 'human', visionFirstSeconds: Number(o['vision-first'] ?? 60) };
      const record = (kind, body) => lab.record(id, kind, body);
      require('./serve.js').serve({ root, port, perceptionFile: lab.p('perception.js'), logFile: lab.p('runs', id, 'sessions.jsonl'), config, record });
      console.log(`live harness: http://127.0.0.1:${port}/  (root ${root}, run ${id}, ${JSON.stringify(config)}; Ctrl+C to stop)`);
      return new Promise(() => {});
    }
    case 'host': {
      const id = lab.run(o);
      const port = Number(o.port) || 8130;
      const { host } = require('./host.js');
      const h = await host({ lab, runId: id, port, record: (kind, body) => lab.record(id, kind, body) });
      console.log(`persona host on 127.0.0.1:${port} (run ${id}). First look:
${h.first}`);
      return new Promise(() => {});
    }
    case 'play': {
      const { play } = require('./host.js');
      return console.log(await play(Number(o.port) || 8130, pos, o));
    }
    default: throw new Error(`unknown command ${cmd}\n${HELP}`);
  }
}

module.exports = { Lab, CONTRACT, importLevelBots };
if (require.main === module) main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
