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
 *                                              optional in reset/step replies: "violations":["rule id", {"id","message","severity"}]
 *   → {"cmd":"metrics"}                        ← {"ok":true,"metrics":{...}}
 *   → {"cmd":"quit"}                           ← {"ok":true}
 *   errors                                     ← {"ok":false,"error":".."}
 *
 * The engine side runs `n` real frames with a fixed timestep between replies, so results are
 * deterministic per seed as long as the game seeds its own randomness from `reset`.
 *
 * The game's stdout/stderr is kept so each bot run can be checked for logged errors (Unity exceptions
 * with `-logFile -`, Godot `ERROR:` / `SCRIPT ERROR:`). Output can arrive a moment after the reply that
 * ends a run, so the lab waits `logSettleMs` before reading it.
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
    // A game that dies shows up as ECONNRESET on Windows and as a plain close elsewhere.
    sock.on('error', (e) => { this.closed = true; fail(e); });
    sock.on('close', () => { this.closed = true; fail(new Error('bridge: connection closed')); });
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

// Crash dumps are mostly native frames and symbol-lookup noise; keep the reason and the game's own frames.
const CRASH_KEEP = /Exception|ERROR:|SCRIPT ERROR|signal \d|\(Mono JIT Code\)|res:\/\/|\.(cs|gd):\d+/i;
const CRASH_NOISE = /SymGetSymFromAddr64|no debug info|crash report generated|^\s*\*\s|^0x[0-9a-f]+ \((?!Mono JIT)/i;
function crashSummary(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const keep = [...new Set(lines.filter((l) => CRASH_KEEP.test(l) && !CRASH_NOISE.test(l)))].slice(0, 4);
  return (keep.length ? keep : lines.slice(-5)).map((l) => l.slice(0, 200)).join(' | ');
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
        // No Nagle: every request is one small line that the game should see at once.
        s.once('connect', () => { s.setNoDelay(true); resolve(s); }); s.once('error', reject);
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
  let client = null; let proc = null;
  // Rolling game output: `tail` for startup errors, `buf` (with absolute offsets) for per-run error checks.
  let tail = ''; let buf = ''; let bufStart = 0; let total = 0;
  const LOG_KEEP = 256 * 1024;
  const meta = Object.assign({ dt: 1 / 60, decisionEvery: 6, maxSeconds: 300 }, mod.meta || {});

  async function ensure() {
    if (client && !client.closed) return client;
    // The game died mid-run (a real crash): drop the dead process and start a fresh one for the next seed.
    if (client) { client = null; if (proc && proc.exitCode === null) try { proc.kill(); } catch {} }
    const port = cfg.port || await freePort();
    if (cfg.command) {
      // Bare names ("godot") are looked up on PATH; anything with a separator is relative to the game folder.
      const cmd = path.isAbsolute(cfg.command) || !/[\\/]/.test(cfg.command) ? cfg.command : path.resolve(gameRoot, cfg.command);
      const args = (cfg.args || ['-batchmode', '-nographics', '-playtestPort', '{PORT}']).map((a) => String(a).replace('{PORT}', port));
      // Default cwd: a built player inside the game folder runs from its own folder (Unity needs its _Data);
      // anything else (an engine binary like godot, found on PATH or installed elsewhere) runs from the game root.
      const inGame = path.isAbsolute(cmd) && !path.relative(path.resolve(gameRoot), cmd).startsWith('..');
      const cwd = cfg.cwd ? path.resolve(gameRoot, cfg.cwd) : inGame ? path.dirname(cmd) : path.resolve(gameRoot);
      proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: cfg.hideWindow !== false });
      const keep = (d) => {
        d = String(d); total += d.length; tail = (tail + d).slice(-4000); buf += d;
        if (buf.length > LOG_KEEP) { bufStart += buf.length - LOG_KEEP; buf = buf.slice(-LOG_KEEP); }
      };
      proc.stdout.on('data', keep); proc.stderr.on('data', keep);
    }
    let sock;
    try { sock = await connectWithRetry(port, cfg.startupTimeoutMs || 60000, proc); } catch (e) { throw new Error(`${e.message}\n--- game output tail ---\n${tail}`); }
    client = new BridgeClient(sock);
    const hello = await client.request({ cmd: 'hello' });
    if (hello.protocol !== PROTOCOL) throw new Error(`bridge: protocol mismatch ${hello.protocol} ≠ ${PROTOCOL}`);
    meta.name = meta.name || hello.game;
    return client;
  }

  const stepTimeout = cfg.stepTimeoutMs || 30000;
  const toRegex = (list) => (list || []).map((x) => (x instanceof RegExp ? x : new RegExp(x)));
  // A lost connection usually means the game crashed: put the crash reason from its output into the error.
  const req = async (obj, timeoutMs) => {
    try { return await client.request(obj, timeoutMs); } catch (e) {
      if (client && client.closed && proc) {
        await new Promise((r) => setTimeout(r, 200));
        throw new Error(`${e.message} (game exit code ${proc.exitCode}); game output: ${crashSummary(buf.slice(-65536))}`);
      }
      throw e;
    }
  };
  const setState = (sim, r) => { sim.obs = r.obs; sim.done = !!r.done; sim.violations = r.violations || []; };
  const adapter = {
    meta,
    policies: mod.policies || {},
    findings: mod.findings,
    idleAction: mod.idleAction,
    randomAction: mod.randomAction,
    actionMenu: mod.actionMenu,
    tension: mod.tension,
    // Adapter-side rules see what the bots see (the observation); engine-side rules arrive as `violations`.
    invariants: mod.invariants ? (sim) => mod.invariants(sim.obs) : undefined,
    errorPatterns: toRegex(cfg.errorPatterns),
    ignoreErrors: toRegex(cfg.ignoreErrors),
    async create(seed) {
      await ensure();
      const sim = {};
      setState(sim, await req({ cmd: 'reset', seed }, stepTimeout));
      return sim;
    },
    observe: (sim) => sim.obs,
    done: (sim) => sim.done,
    async stepMany(sim, action, n) {
      setState(sim, await req({ cmd: 'step', n, action: JSON.stringify(action ?? {}) }, stepTimeout));
      return sim.done;
    },
    async metrics() { return (await req({ cmd: 'metrics' })).metrics || {}; },
    async close() {
      if (client) { try { await client.request({ cmd: 'quit' }, 5000); } catch {} client.sock.destroy(); client = null; }
      if (proc && proc.exitCode === null) { setTimeout(() => { try { proc.kill(); } catch {} }, 3000).unref(); }
    },
    gameLog: () => tail,
    /** Offset into the game's output; pair with logSince to get what one run printed. */
    logMark: () => total,
    async logSince(mark) {
      if (!proc) return '';
      await new Promise((r) => setTimeout(r, cfg.logSettleMs ?? 15));
      return buf.slice(Math.max(0, (mark ?? 0) - bufStart));
    },
    /** Raw protocol request (e.g. screenshot) on the live connection. */
    async request(obj, timeoutMs) { await ensure(); return client.request(obj, timeoutMs || stepTimeout); },
  };
  if (!adapter.idleAction) adapter.idleAction = () => ({});
  return adapter;
}

module.exports = { createBridgeAdapter, PROTOCOL, BridgeClient };
