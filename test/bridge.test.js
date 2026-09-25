'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const { createBridgeAdapter, PROTOCOL } = require('../lab/bridge.js');
const { runBots } = require('../lab/bots.js');

/** Fake engine speaking playtest-bridge/1: a counter game that ends after 30 frames. */
function fakeEngine({ slowStep = false } = {}) {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      let buf = ''; let frames = 0; let score = 0; let seed = 0;
      sock.setEncoding('utf8');
      sock.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
          const send = (o, delay = 0) => setTimeout(() => sock.write(JSON.stringify(o) + '\n'), delay);
          if (msg.cmd === 'hello') send({ ok: true, protocol: PROTOCOL, game: 'Fake', engine: 'node' });
          else if (msg.cmd === 'reset') { seed = msg.seed; frames = 0; score = 0; send({ ok: true, done: false, obs: { frames, seed } }); }
          else if (msg.cmd === 'step') {
            const a = JSON.parse(msg.action);
            frames += msg.n; if (a.push) score += msg.n;
            send({ ok: true, done: frames >= 30, obs: { frames, seed } }, slowStep && frames === msg.n ? 300 : 0);
          } else if (msg.cmd === 'metrics') send({ ok: true, metrics: { score, seed } });
          else if (msg.cmd === 'quit') { send({ ok: true }); }
          else send({ ok: false, error: `unknown ${msg.cmd}` });
        }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('bots drive an engine over the bridge', async () => {
  const { server, port } = await fakeEngine();
  const adapter = createBridgeAdapter({
    meta: { dt: 1 / 60, decisionEvery: 6, maxSeconds: 5 },
    bridge: { port },
    idleAction: () => ({}),
    policies: { pusher: () => ({ push: true }) },
  }, process.cwd());
  const res = await runBots(adapter, { runs: 3, policies: ['idle', 'pusher'] });
  server.close();
  assert.strictEqual(res.policies.pusher.metrics.score.mean, 30);
  assert.strictEqual(res.policies.idle.metrics.score.mean, 0);
  assert.strictEqual(res.findings.length, 0);
});

test('a timed-out reply is swallowed instead of answering the next request', async () => {
  const { server, port } = await fakeEngine({ slowStep: true });
  const adapter = createBridgeAdapter({ bridge: { port, stepTimeoutMs: 100 } }, process.cwd());
  const sim = await adapter.create(1);
  await assert.rejects(adapter.stepMany(sim, {}, 6), /timeout/);
  await new Promise((r) => setTimeout(r, 400)); // the late reply arrives and must be discarded
  const m = await adapter.metrics();
  assert.deepStrictEqual(m, { score: 0, seed: 1 });
  await adapter.close();
  server.close();
});
