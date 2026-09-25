/*
 * bridge.js — lab side of the engine bridge (protocol "playtest-bridge/1").
 *
 * For games whose simulation can't be imported into Node (Unity, Godot, Unreal, native builds).
 * The lab launches the game build headless (or connects to one already running), then talks
 * newline-delimited JSON over TCP on 127.0.0.1. One request → one response, strictly in order.
 *
 *   → {"cmd":"hello"}                          ← {"ok":true,"protocol":"playtest-bridge/1","game":"..","engine":".."}
 *   → {"cmd":"reset","seed":7}                 ← {"ok":true,"done":false,"obs":{...}}
 *   → {"cmd":"step","n":6,"action":"<json>"}   ← {"ok":true,"done":false,"obs":{...}}   (action is a JSON *string*)
 *   → {"cmd":"metrics"}                        ← {"ok":true,"metrics":{...}}
 *   → {"cmd":"quit"}                           ← {"ok":true}
 *   errors                                     ← {"ok":false,"error":".."}
 *
 * The engine side runs `n` real frames with a fixed timestep between replies, so results are
 * deterministic per seed as long as the game seeds its own randomness from `reset`.
 */
'use strict';
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const PROTOCOL = 'playtest-bridge/1';

class BridgeClient {
  constructor(sock) {
    this.sock = sock; this.buf = ''; this.queue = [];
    sock.setEncoding('utf8');
    sock.on('data', (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        const w = this.queue.shift();
        if (!w) continue;
        try { const msg = JSON.parse(line); msg.ok === false ? w.reject(new Error(`bridge: ${msg.error}`)) : w.resolve(msg); } catch (e) { w.reject(new Error(`bridge: bad JSON: ${line.slice(0, 200)}`)); }
      }
    });
    const fail = (e) => { for (const w of this.queue.splice(0)) w.reject(e); };
    sock.on('error', fail);
    sock.on('close', () => fail(new Error('bridge: connection closed')));
  }
  request(obj, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      // On timeout the waiter keeps its queue slot (so a late reply is swallowed, not handed to the next request).
      const w = { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } };
      const t = setTimeout(() => { w.resolve = () => {}; w.reject = () => {}; reject(new Error(`bridge: timeout on ${obj.cmd}`)); }, timeoutMs);
      this.queue.push(w);
      this.sock.write(JSON.stringify(obj) + '\n');
    });
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer(); s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function connectWithRetry(port, timeoutMs, proc) {
  const start = Date.now();
  for (;;) {
    if (proc && proc.exitCode !== null) throw new Error(`bridge: game process exited (${proc.exitCode}) before listening`);
    try {
      return await new Promise((resolve, reject) => {
        const s = net.connect(port, '127.0.0.1');
        s.once('connect', () => resolve(s)); s.once('error', reject);
      });
    } catch {
      if (Date.now() - start > timeoutMs) throw new Error(`bridge: could not connect to 127.0.0.1:${port} within ${timeoutMs} ms`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

/**
 * Wraps a game adapter module that exports `bridge = { command, args, port, cwd, startupTimeoutMs, stepTimeoutMs }`
 * into the standard adapter shape the bot runner uses. Policies/findings/meta come from the module.
 * `{PORT}` in args is replaced with the chosen port. Omit `command` to connect to an already-running game.
 */
function createBridgeAdapter(mod, gameRoot) {
  const cfg = mod.bridge;
  let client = null; let proc = null; let log = '';
  const meta = Object.assign({ dt: 1 / 60, decisionEvery: 6, maxSeconds: 300 }, mod.meta || {});

  async function ensure() {
    if (client) return client;
    const port = cfg.port || await freePort();
    if (cfg.command) {
      // Bare names ("godot") are looked up on PATH; anything with a separator is relative to the game folder.
      const cmd = path.isAbsolute(cfg.command) || !/[\\/]/.test(cfg.command) ? cfg.command : path.resolve(gameRoot, cfg.command);
      const args = (cfg.args || ['-batchmode', '-nographics', '-playtestPort', '{PORT}']).map((a) => String(a).replace('{PORT}', port));
      proc = spawn(cmd, args, { cwd: cfg.cwd ? path.resolve(gameRoot, cfg.cwd) : path.dirname(cmd), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: cfg.hideWindow !== false });
      const keep = (d) => { log = (log + d).slice(-4000); };
      proc.stdout.on('data', keep); proc.stderr.on('data', keep);
    }
    let sock;
    try { sock = await connectWithRetry(port, cfg.startupTimeoutMs || 60000, proc); } catch (e) { throw new Error(`${e.message}\n--- game output tail ---\n${log}`); }
    client = new BridgeClient(sock);
    const hello = await client.request({ cmd: 'hello' });
    if (hello.protocol !== PROTOCOL) throw new Error(`bridge: protocol mismatch ${hello.protocol} ≠ ${PROTOCOL}`);
    meta.name = meta.name || hello.game;
    return client;
  }

  const stepTimeout = cfg.stepTimeoutMs || 30000;
  const adapter = {
    meta,
    policies: mod.policies || {},
    findings: mod.findings,
    idleAction: mod.idleAction,
    randomAction: mod.randomAction,
    actionMenu: mod.actionMenu,
    async create(seed) {
      const c = await ensure();
      const r = await c.request({ cmd: 'reset', seed }, stepTimeout);
      return { obs: r.obs, done: !!r.done };
    },
    observe: (sim) => sim.obs,
    done: (sim) => sim.done,
    async stepMany(sim, action, n) {
      const r = await client.request({ cmd: 'step', n, action: JSON.stringify(action ?? {}) }, stepTimeout);
      sim.obs = r.obs; sim.done = !!r.done;
      return sim.done;
    },
    async metrics() { return (await client.request({ cmd: 'metrics' })).metrics || {}; },
    async close() {
      if (client) { try { await client.request({ cmd: 'quit' }, 5000); } catch {} client.sock.destroy(); client = null; }
      if (proc && proc.exitCode === null) { setTimeout(() => { try { proc.kill(); } catch {} }, 3000).unref(); }
    },
    gameLog: () => log,
    /** Raw protocol request (e.g. screenshot) on the live connection. */
    async request(obj, timeoutMs) { await ensure(); return client.request(obj, timeoutMs || stepTimeout); },
  };
  if (!adapter.idleAction) adapter.idleAction = () => ({});
  return adapter;
}

module.exports = { createBridgeAdapter, PROTOCOL, BridgeClient };
