'use strict';

// AI OS dashboard server. Stores nothing of its own: every request re-reads
// the files under AI_OS_DIR (default: ../ai-os), so a crash or restart loses
// nothing. Zero dependencies; run with `node dashboard/server.js`.

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const src = require('./lib/sources');

const ROOT = path.resolve(process.env.AI_OS_DIR || path.join(__dirname, '..', 'ai-os'));
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';

const FILES = {
  claude: 'CLAUDE.md',
  progress: 'notes/progress.log',
  approvals: 'notes/approvals.md',
  usage: 'logs/usage.jsonl',
};

async function readSource(rel, parse) {
  const file = path.join(ROOT, rel);
  try {
    const [text, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
    return { file: rel, modified: stat.mtime.toISOString(), data: parse(text) };
  } catch (err) {
    return { file: rel, error: err.code === 'ENOENT' ? `File not found: ${rel}` : `Could not read ${rel}: ${err.message}` };
  }
}

// Show the data folder relative to the repo when it lives inside it.
function displayRoot() {
  const rel = path.relative(path.join(__dirname, '..'), ROOT);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : ROOT;
}

async function state() {
  const [claude, progress, approvals, usage] = await Promise.all([
    readSource(FILES.claude, src.parseClaudeMd),
    readSource(FILES.progress, src.parseProgressLog),
    readSource(FILES.approvals, src.parseApprovals),
    readSource(FILES.usage, src.parseUsage),
  ]);
  return { root: displayRoot(), readAt: new Date().toISOString(), claude, progress, approvals, usage };
}

// Serialise writes so two quick clicks can't interleave read-modify-write.
let writeChain = Promise.resolve();
function decide(id, decision) {
  const run = async () => {
    const file = path.join(ROOT, FILES.approvals);
    const text = await fs.readFile(file, 'utf8');
    const next = src.setApprovalStatus(text, id, decision, new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
    if (next === null) return false;
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, next, 'utf8');
    await fs.rename(tmp, file);
    return true;
  };
  const p = writeChain.then(run, run);
  writeChain = p.catch(() => {});
  return p;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 10_000) reject(new Error('Body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, await state());

    const m = url.pathname.match(/^\/api\/approvals\/([\w.-]+)$/);
    if (m && req.method === 'POST') {
      const { decision } = JSON.parse((await readBody(req)) || '{}');
      if (decision !== 'approved' && decision !== 'rejected') return send(res, 400, { error: 'decision must be approved or rejected' });
      const ok = await decide(m[1], decision);
      return ok ? send(res, 200, { ok: true }) : send(res, 409, { error: `${m[1]} is not a pending approval` });
    }

    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, 'Not found', 'text/plain');
    const body = await fs.readFile(file).catch(() => null);
    if (!body) return send(res, 404, 'Not found', 'text/plain');
    return send(res, 200, body, TYPES[path.extname(file)] || 'application/octet-stream');
  } catch (err) {
    return send(res, 500, { error: err.message });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`AI OS dashboard on http://${HOST}:${PORT} reading ${ROOT}`);
  });
}

module.exports = { server, state };
