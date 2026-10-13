'use strict';

// Parsers for the AI OS files. Each one takes raw file text and returns plain
// data; nothing here touches the filesystem, so they are easy to test.

const TASK_STATES = { ' ': 'todo', x: 'done', X: 'done', '~': 'in_progress', '!': 'blocked' };

function section(md, heading) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

function parseClaudeMd(md) {
  const agents = [];
  for (const line of section(md, 'Agents')) {
    const m = line.match(/^\s*[-*]\s+\*\*(.+?)\*\*\s*(?:[—–-]\s*(.*))?$/);
    if (m) agents.push({ name: m[1].trim(), role: (m[2] || '').trim() });
  }

  const goals = [];
  let goal = null;
  for (const line of section(md, 'Goals')) {
    const h = line.match(/^###\s+(.*)$/);
    if (h) {
      const [id, ...rest] = h[1].split(/\s+·\s+/);
      goal = rest.length
        ? { id: id.trim(), title: rest.join(' · ').trim(), meta: {}, tasks: [] }
        : { id: '', title: h[1].trim(), meta: {}, tasks: [] };
      goals.push(goal);
      continue;
    }
    if (!goal) continue;
    const t = line.match(/^\s*[-*]\s+\[([ xX~!])\]\s+(.*)$/);
    if (t) {
      let text = t[2].trim();
      let agent = null;
      const a = text.match(/\s*\(@([\w-]+)\)\s*$/);
      if (a) {
        agent = a[1];
        text = text.slice(0, a.index).trim();
      }
      let id = null;
      const idm = text.match(/^(T[\w.]+)\s+(.*)$/);
      if (idm) {
        id = idm[1];
        text = idm[2];
      }
      goal.tasks.push({ id, title: text, agent, state: TASK_STATES[t[1]] });
      continue;
    }
    const kv = line.match(/^([a-z_]+):\s*(.+)$/i);
    if (kv && goal.tasks.length === 0) goal.meta[kv[1].toLowerCase()] = kv[2].trim();
  }

  for (const g of goals) {
    const counts = { todo: 0, in_progress: 0, done: 0, blocked: 0 };
    for (const t of g.tasks) counts[t.state]++;
    g.counts = counts;
    g.percent = g.tasks.length ? Math.round((counts.done / g.tasks.length) * 100) : 0;
  }
  return { agents, goals };
}

function parseProgressLog(text) {
  const entries = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+\|\s+/);
    if (parts.length < 5 || Number.isNaN(Date.parse(parts[0]))) {
      skipped++;
      continue;
    }
    const [ts, agent, task, status, ...msg] = parts;
    entries.push({ ts, agent, task, status: status.toLowerCase(), message: msg.join(' | ') });
  }
  entries.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  return { entries, skipped };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function parseUsage(text) {
  const calls = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    const input = Number(rec.input_tokens);
    const output = Number(rec.output_tokens);
    const latency = Number(rec.latency_ms);
    if (!rec.agent || !Number.isFinite(input) || !Number.isFinite(output) || !Number.isFinite(latency)) {
      skipped++;
      continue;
    }
    calls.push({
      ts: rec.ts || null,
      agent: String(rec.agent),
      task: rec.task || null,
      model: rec.model || null,
      input_tokens: input,
      output_tokens: output,
      latency_ms: latency,
      ok: rec.ok !== false,
    });
  }
  calls.sort((a, b) => Date.parse(a.ts || 0) - Date.parse(b.ts || 0));

  const byAgent = new Map();
  for (const c of calls) {
    if (!byAgent.has(c.agent)) byAgent.set(c.agent, { agent: c.agent, calls: 0, errors: 0, input_tokens: 0, output_tokens: 0, latencies: [] });
    const a = byAgent.get(c.agent);
    a.calls++;
    if (!c.ok) a.errors++;
    a.input_tokens += c.input_tokens;
    a.output_tokens += c.output_tokens;
    a.latencies.push(c.latency_ms);
  }
  const agents = [...byAgent.values()].map(({ latencies, ...a }) => {
    const s = [...latencies].sort((x, y) => x - y);
    return { ...a, p50_ms: percentile(s, 50), p95_ms: percentile(s, 95) };
  });
  agents.sort((a, b) => b.input_tokens + b.output_tokens - (a.input_tokens + a.output_tokens));

  const all = calls.map((c) => c.latency_ms).sort((x, y) => x - y);
  const totals = {
    calls: calls.length,
    errors: calls.filter((c) => !c.ok).length,
    input_tokens: calls.reduce((n, c) => n + c.input_tokens, 0),
    output_tokens: calls.reduce((n, c) => n + c.output_tokens, 0),
    p50_ms: percentile(all, 50),
    p95_ms: percentile(all, 95),
  };
  return { totals, agents, recent: calls.slice(-40), skipped };
}

function parseApprovals(md) {
  const items = [];
  const chunks = md.split(/^## /m).slice(1);
  for (const chunk of chunks) {
    const [headLine, ...rest] = chunk.split(/\r?\n/);
    const [id, ...titleParts] = headLine.split(/\s+·\s+/);
    const meta = {};
    const body = [];
    for (const line of rest) {
      const kv = line.match(/^\s*[-*]\s+([a-z_]+):\s*(.*)$/i);
      if (kv && body.length === 0) meta[kv[1].toLowerCase()] = kv[2].trim();
      else body.push(line);
    }
    items.push({
      id: id.trim(),
      title: titleParts.join(' · ').trim() || id.trim(),
      status: (meta.status || 'pending').toLowerCase(),
      agent: meta.agent || null,
      task: meta.task || null,
      requested: meta.requested || null,
      decided: meta.decided || null,
      risk: meta.risk || null,
      detail: body.join('\n').trim(),
    });
  }
  return { items };
}

// Rewrites the status line of one approval section and stamps `decided:`.
// Returns the new file text, or null if the id was not found or not pending.
function setApprovalStatus(md, id, status, decidedAt) {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => {
    const m = l.match(/^## (.*)$/);
    return m && m[1].split(/\s+·\s+/)[0].trim() === id;
  });
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  let statusIdx = -1;
  let decidedIdx = -1;
  for (let i = start + 1; i < end; i++) {
    if (/^\s*[-*]\s+status:/i.test(lines[i])) statusIdx = i;
    if (/^\s*[-*]\s+decided:/i.test(lines[i])) decidedIdx = i;
  }
  if (statusIdx === -1) return null;
  if (!/:\s*pending\s*$/i.test(lines[statusIdx])) return null;
  lines[statusIdx] = lines[statusIdx].replace(/:\s*.*$/, `: ${status}`);
  if (decidedIdx !== -1) lines[decidedIdx] = lines[decidedIdx].replace(/:\s*.*$/, `: ${decidedAt}`);
  else lines.splice(statusIdx + 1, 0, `- decided: ${decidedAt}`);
  return lines.join('\n');
}

module.exports = { parseClaudeMd, parseProgressLog, parseUsage, parseApprovals, setApprovalStatus, percentile };
