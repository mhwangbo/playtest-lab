// A separate "game process" speaking playtest-bridge/1, so tests cover spawning, log capture and crashes.
//   seed 2: engine reports a violation   seed 3: prints a Godot-style ERROR to stderr
//   seed 4: the process dies mid-run (native crash)
'use strict';
const net = require('net');
const port = Number(process.argv[2]);
let seed = 0; let frames = 0;
const server = net.createServer((sock) => {
  let buf = '';
  sock.setEncoding('utf8');
  const send = (o) => sock.write(JSON.stringify(o) + '\n');
  sock.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (msg.cmd === 'hello') send({ ok: true, protocol: 'playtest-bridge/1', game: 'FakeEngine', engine: 'node' });
      else if (msg.cmd === 'reset') { seed = msg.seed; frames = 0; send({ ok: true, done: false, obs: { frames } }); }
      else if (msg.cmd === 'step') {
        frames += msg.n;
        if (seed === 3 && frames === 12) process.stderr.write(`ERROR: Node not found: "Player/Sprite${seed}"\n   at: get_node (scene/main/node.cpp:1792)\n`);
        if (seed === 4 && frames >= 18) process.exit(3);
        send({ ok: true, done: frames >= 30, obs: { frames }, ...(seed === 2 && frames >= 24 ? { violations: [{ id: 'coins-conserved', message: 'coin count went up by 2' }] } : {}) });
      } else if (msg.cmd === 'metrics') send({ ok: true, metrics: { frames } });
      else if (msg.cmd === 'quit') { send({ ok: true }); setTimeout(() => process.exit(0), 10); }
    }
  });
});
// `node --test` also loads this file; only listen when launched with a port.
if (port) server.listen(port, '127.0.0.1');
