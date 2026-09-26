/*
 * host.js — persona session host for engine builds (Unity now).
 * Launches the game WITH graphics via the adapter's `personaBridge` config, keeps the bridge connection
 * open, and exposes a tiny localhost HTTP API that `lab.js play ...` calls. The game is frozen between
 * persona turns (bridge semantics); every action runs a fixed number of frames, then returns what is on screen.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createBridgeAdapter } = require('./bridge.js');
const { mulberry32 } = require('./bots.js');

function formatObs(obs) {
  if (!obs || typeof obs !== 'object') return String(obs);
  const lines = [];
  if (obs.screen) lines.push(`screen: ${obs.screen}`);
  if (obs.text && obs.text.length) lines.push(`text on screen: ${obs.text.map((t) => `"${t}"`).join(' · ')}`);
  if (obs.buttons && obs.buttons.length) lines.push(`buttons: ${obs.buttons.map((t) => `[${t}]`).join(' ')}`);
  if (obs.board) lines.push(obs.board.trim());
  for (const [k, v] of Object.entries(obs)) if (!['screen', 'text', 'buttons', 'board'].includes(k)) lines.push(`${k}: ${JSON.stringify(v)}`);
  return lines.join('\n');
}

async function host({ lab, runId, port, record }) {
  const mod = await import(require('url').pathToFileURL(path.resolve(lab.root, lab.config().adapter)).href);
  if (!mod.personaBridge) throw new Error('adapter has no personaBridge config (game build launched with graphics)');
  const runDir = lab.p('runs', runId);
  const cfg = { ...mod.personaBridge, args: (mod.personaBridge.args || []).map((a) => String(a).replace('{RUN}', runDir)) };
  const game = createBridgeAdapter({ ...mod, bridge: cfg }, lab.root);
  const sim = await game.create(1);
  const defaultFrames = mod.meta?.personaFrames || 40;
  let shot = 0; let turn = 0;
  const logFile = path.join(runDir, 'sessions.jsonl');
  fs.mkdirSync(path.join(runDir, 'shots'), { recursive: true });

  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', async () => {
      const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      try {
        const body = b ? JSON.parse(b) : {};
        const url = req.url.split('?')[0];
        if (url === '/act') {
          const frames = Math.max(1, Math.min(Number(body.frames) || defaultFrames, 3600));
          await game.stepMany(sim, body.action || {}, frames);
          turn++;
          const text = formatObs(sim.obs);
          fs.appendFileSync(logFile, JSON.stringify({ ts: Date.now(), turn, persona: body.persona || '', action: body.action || {}, frames, obs: sim.obs }) + '\n');
          return reply(200, { ok: true, turn, text });
        }
        if (url === '/shot') {
          // Name by persona and never reuse a number: several hosts (one per persona) can share a run,
          // and a restarted host must not overwrite earlier evidence.
          const who = String(body.persona || 'shot').replace(/[^\w-]+/g, '_');
          let file;
          do file = path.join(runDir, 'shots', `${who}-${String(++shot).padStart(3, '0')}.png`); while (fs.existsSync(file));
          const r = await game.request({ cmd: 'screenshot', path: file, scale: body.scale || 0.5 }, 30000);
          return reply(200, { ok: true, path: r.path });
        }
        const rec = url.match(/^\/record\/(note|issue|done)$/);
        if (rec) return reply(200, { ok: true, saved: record(rec[1], body) });
        if (url === '/bot') {
          // Hand control to one of the adapter's bot policies for a while (e.g. to reach a late-game state).
          const all = Object.assign({ idle: game.idleAction, random: game.randomAction }, game.policies || {});
          const policy = all[body.policy];
          if (!policy) throw new Error(`unknown policy "${body.policy}"; available: ${Object.keys(all).filter((k) => all[k]).join(', ')}`);
          const every = Math.max(1, (mod.meta && mod.meta.decisionEvery) || 6);
          const rng = mulberry32(Number(body.seed) || 1); const memo = {};
          let left = Math.max(1, Math.min(Number(body.frames) || 600, 36000));
          while (left > 0 && !sim.done) { const n = Math.min(every, left); await game.stepMany(sim, await policy(sim.obs, rng, memo, sim), n); left -= n; }
          turn++;
          const text = formatObs(sim.obs);
          fs.appendFileSync(logFile, JSON.stringify({ ts: Date.now(), turn, persona: body.persona || '', action: { bot: body.policy }, frames: Number(body.frames) || 600, obs: sim.obs }) + '\n');
          return reply(200, { ok: true, turn, text });
        }
        if (url === '/quit') { reply(200, { ok: true }); await game.close(); server.close(); return process.exit(0); }
        reply(404, { ok: false, error: 'unknown endpoint' });
      } catch (e) { reply(200, { ok: false, error: e.message }); }
    });
  });
  server.listen(port, '127.0.0.1');
  process.on('SIGINT', async () => { await game.close(); process.exit(0); });
  return { server, first: formatObs(sim.obs) };
}

/** Client used by personas: node lab.js play <verb> ... (talks to a running host). */
async function play(port, pos, o) {
  const call = async (url, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${url}`, { method: 'POST', body: JSON.stringify(body || {}) }).then((x) => x.json());
    if (!r.ok) throw new Error(r.error);
    return r;
  };
  const persona = o.persona || process.env.PLAYTEST_PERSONA || '';
  const frames = o.frames ? Number(o.frames) : undefined;
  const verb = pos[1];
  const act = async (action, f) => (await call('/act', { action, frames: f ?? frames, persona })).text;
  switch (verb) {
    case 'look': return act({}, frames ?? 1);
    case 'wait': return act({}, Number(pos[2]) || 60);
    case 'tap': return act({ tap: pos.slice(2).join(' ') });
    case 'tapat': return act({ tapAt: [Number(pos[2]), Number(pos[3])] });
    case 'piece': return act({ tapPiece: pos[2] });
    case 'drag': { const [c, r] = String(o.to || '').split(',').map(Number); return act({ drag: pos[2], to: [c, r] }); }
    case 'out': return act({ dragOut: pos[2] });
    // Real-time games: hold a game-defined action for --frames (e.g. `play input turn=1 flare=false --frames 30`).
    case 'input': {
      const action = {};
      for (const kv of pos.slice(2)) {
        const i = kv.indexOf('=');
        if (i < 1) throw new Error(`input takes key=value pairs, got "${kv}"`);
        const v = kv.slice(i + 1);
        action[kv.slice(0, i)] = v === 'true' ? true : v === 'false' ? false : v !== '' && Number.isFinite(Number(v)) ? Number(v) : v;
      }
      return act(action);
    }
    case 'bot': return (await call('/bot', { policy: pos[2], frames, persona })).text;
    case 'shot': return `screenshot saved: ${(await call('/shot', { scale: o.scale ? Number(o.scale) : 0.5, persona })).path}  (open it with the Read tool)`;
    case 'note': await call('/record/note', { persona, text: pos.slice(2).join(' ') }); return 'noted';
    case 'issue': { const r = (await call('/record/issue', { persona, title: o.title, severity: o.severity, category: o.category, evidence: o.evidence, repro: o.repro })).saved; return `issue logged [${r.severity}] ${r.title}`; }
    case 'done': {
      const scores = {};
      for (const kv of String(o.scores || '').split(',')) { const [k, v] = kv.split('='); if (k && v) scores[k.trim()] = Number(v); }
      const r = (await call('/record/done', { persona, rating: o.rating, replay: o.replay, summary: o.summary, unsure: o.unsure ? String(o.unsure).split('|') : [], scores, noIssues: o.noIssues === true || o.noIssues === 'true' })).saved;
      return `verdict recorded: ${r.rating}/5`;
    }
    case 'quit': await call('/quit'); return 'host stopped';
    default: throw new Error('play verbs: look | wait <frames> | tap <button label> | tapat <x0..1> <y0..1> | piece <letter> | drag <letter> --to col,row | out <letter> | input key=value ... [--frames N] | bot <policy> [--frames 600] | shot [--scale 0.5] | note "..." | issue --title .. --severity P2 --category clarity --evidence .. | done --rating N --replay yes|no --summary .. --unsure "a|b|c" --scores k=v,... [--noIssues true] | quit');
  }
}

module.exports = { host, play, formatObs };
