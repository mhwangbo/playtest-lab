/*
 * serve.js — static server for a web build with the live persona harness injected.
 *   /__lab/harness.js     lab/live-harness.js
 *   /__lab/perception.js  <game>/.playtest/perception.js (game-specific "what is on screen")
 *   POST /__lab/log       appends to <game>/.playtest/runs/<RUN>/sessions.jsonl
 * index.html gets both scripts inserted at the top of <head>, before the game boots.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };

function serve({ root, port, perceptionFile, logFile, config = {}, record }) {
  const harness = path.join(__dirname, 'live-harness.js');
  const inject = `<script>window.__labConfig=${JSON.stringify(config)};</script><script src="/__lab/harness.js"></script><script src="/__lab/perception.js"></script>`;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/__lab/log') {
      let b = '';
      req.on('data', (c) => { b += c; if (b.length > 2e6) req.destroy(); });
      req.on('end', () => { try { fs.appendFileSync(logFile, JSON.stringify({ ts: Date.now(), ...JSON.parse(b) }) + '\n'); } catch {} res.end('ok'); });
      return;
    }
    const rec = url.pathname.match(/^\/__lab\/record\/(note|issue|done)$/);
    if (req.method === 'POST' && rec) {
      let b = '';
      req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
      req.on('end', () => {
        let out;
        try { out = { ok: true, saved: record ? record(rec[1], JSON.parse(b)) : null }; } catch (e) { out = { ok: false, error: e.message }; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      });
      return;
    }
    if (url.pathname === '/__lab/harness.js') return send(res, harness);
    if (url.pathname === '/__lab/perception.js') return fs.existsSync(perceptionFile) ? send(res, perceptionFile) : (res.writeHead(200, { 'Content-Type': 'text/javascript' }), res.end('/* no perception module */'));
    let p = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!p.startsWith(path.normalize(root))) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { res.writeHead(404); return res.end('not found'); }
    if (p.endsWith('.html')) {
      const html = fs.readFileSync(p, 'utf8');
      const out = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + inject) : inject + html;
      res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
      return res.end(out);
    }
    send(res, p);
  });
  server.listen(port, '127.0.0.1');
  return server;
}

function send(res, file) {
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

module.exports = { serve };
