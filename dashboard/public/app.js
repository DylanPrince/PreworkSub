'use strict';

const POLL_MS = 5000;
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtInt = (n) => Math.round(n).toLocaleString();
const fmtK = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDateTime = (ts) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const STATE_LABEL = {
  todo: ['○', 'To do'], in_progress: ['◐', 'In progress'], done: ['✓', 'Done'], blocked: ['!', 'Blocked'],
  started: ['▶', 'Started'], progress: ['◐', 'Progress'], failed: ['✕', 'Failed'],
  pending: ['?', 'Pending'], approved: ['✓', 'Approved'], rejected: ['✕', 'Rejected'],
};
function badge(state) {
  const [ic, label] = STATE_LABEL[state] || ['•', state];
  return `<span class="state ${esc(state)}"><span class="ic" aria-hidden="true">${ic}</span>${esc(label)}</span>`;
}

let last = null;
let lastJson = '';
let logAgent = '';

// ---------- theme ----------
const themeSel = $('#theme');
try { themeSel.value = localStorage.getItem('aios-theme') || 'system'; } catch {}
themeSel.addEventListener('change', () => {
  const v = themeSel.value;
  if (v === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = v;
  try { localStorage.setItem('aios-theme', v); } catch {}
});

// ---------- tooltip ----------
const tip = $('#tooltip');
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - r.width - 8, x + 12);
  const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${top}px`;
}
const hideTip = () => { tip.hidden = true; };
function wireTips(root) {
  root.querySelectorAll('[data-tip]').forEach((el) => {
    const html = el.getAttribute('data-tip');
    el.addEventListener('pointermove', (e) => showTip(html, e.clientX, e.clientY));
    el.addEventListener('pointerleave', hideTip);
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); showTip(html, r.left + r.width / 2, r.top); });
    el.addEventListener('blur', hideTip);
  });
}

function sourceError(s) {
  return `<div class="panel-error" role="alert"><strong>Can't show this panel.</strong> ${esc(s.error)}</div>`;
}

// ---------- tiles ----------
function renderTiles(st) {
  const tiles = [];
  const goals = st.claude.data?.goals || [];
  const tasks = goals.flatMap((g) => g.tasks);
  const done = tasks.filter((t) => t.state === 'done').length;
  const blocked = tasks.filter((t) => t.state === 'blocked').length;
  tiles.push(['Tasks done', `${done} / ${tasks.length}`, `${goals.length} goals · ${blocked} blocked`]);
  const pending = (st.approvals.data?.items || []).filter((i) => i.status === 'pending').length;
  tiles.push(['Awaiting approval', String(pending), pending ? 'Needs a human decision' : 'Queue is clear']);
  const u = st.usage.data?.totals;
  if (u) {
    tiles.push(['Tokens used', fmtK(u.input_tokens + u.output_tokens), `${fmtK(u.input_tokens)} in · ${fmtK(u.output_tokens)} out`]);
    tiles.push(['Latency p95', fmtMs(u.p95_ms), `p50 ${fmtMs(u.p50_ms)} over ${u.calls} calls`]);
    tiles.push(['Failed calls', String(u.errors), u.calls ? `${((u.errors / u.calls) * 100).toFixed(1)}% of calls` : '']);
  }
  $('#tiles').innerHTML = tiles
    .map(([l, v, n]) => `<div class="tile"><p class="label">${esc(l)}</p><p class="value">${esc(v)}</p><p class="note">${esc(n)}</p></div>`)
    .join('');
}

// ---------- goals ----------
function renderGoals(s) {
  const el = $('#goals');
  if (s.error) return (el.innerHTML = sourceError(s));
  const { goals } = s.data;
  if (!goals.length) return (el.innerHTML = '<p class="empty">No goals in the Goals section of CLAUDE.md yet.</p>');
  el.innerHTML = goals.map((g) => {
    const n = g.tasks.length || 1;
    const seg = ['done', 'in_progress', 'blocked']
      .filter((k) => g.counts[k])
      .map((k) => `<span class="${k}" style="width:${(g.counts[k] / n) * 100}%"></span>`).join('');
    const meta = [g.meta.owner && `Owner ${g.meta.owner}`, g.meta.due && `Due ${g.meta.due}`].filter(Boolean).join(' · ');
    const summary = `${g.counts.done} of ${g.tasks.length} done` +
      (g.counts.in_progress ? `, ${g.counts.in_progress} in progress` : '') +
      (g.counts.blocked ? `, ${g.counts.blocked} blocked` : '');
    return `<article class="goal" aria-labelledby="goal-${esc(g.id)}">
      <h3 id="goal-${esc(g.id)}">${g.id ? `<span class="muted">${esc(g.id)}</span> ` : ''}${esc(g.title)}</h3>
      ${meta ? `<p class="goal-meta">${esc(meta)}</p>` : ''}
      <div class="bar" role="img" aria-label="${esc(summary)}">${seg}</div>
      <p class="bar-label">${g.percent}% · ${esc(summary)}</p>
      <ul class="tasks">${g.tasks.map((t) => `<li>${badge(t.state)}<span>${t.id ? `<span class="id">${esc(t.id)}</span>` : ''}${esc(t.title)}${t.agent ? ` <span class="who">@${esc(t.agent)}</span>` : ''}</span></li>`).join('')}</ul>
    </article>`;
  }).join('');
}

// ---------- approvals ----------
function renderApprovals(s) {
  const el = $('#approvals');
  if (s.error) return (el.innerHTML = sourceError(s));
  const pending = s.data.items.filter((i) => i.status === 'pending');
  const decided = s.data.items.filter((i) => i.status !== 'pending');
  const list = pending.length
    ? `<ul class="approvals">${pending.map((i) => `<li class="approval">
        <div class="row"><h3>${esc(i.title)}</h3>${i.risk ? `<span class="risk ${esc(i.risk)}">${esc(i.risk)} risk</span>` : ''}</div>
        <p class="meta">${esc(i.id)}${i.agent ? ` · @${esc(i.agent)}` : ''}${i.task ? ` · ${esc(i.task)}` : ''}${i.requested ? ` · asked ${esc(fmtDateTime(i.requested))}` : ''}</p>
        ${i.detail ? `<p class="detail">${esc(i.detail)}</p>` : ''}
        <div class="actions">
          <button type="button" class="btn primary" data-decide="approved" data-id="${esc(i.id)}" data-risk="${esc(i.risk || '')}" aria-label="Approve: ${esc(i.title)}">Approve</button>
          <button type="button" class="btn" data-decide="rejected" data-id="${esc(i.id)}" aria-label="Reject: ${esc(i.title)}">Reject</button>
        </div>
      </li>`).join('')}</ul>`
    : '<p class="empty">Nothing is waiting on you.</p>';
  const past = decided.length
    ? `<details class="decided"><summary>Decided (${decided.length})</summary><ul>${decided.map((i) => `<li>${badge(i.status)} ${esc(i.title)}${i.decided ? ` <span class="muted">· ${esc(fmtDateTime(i.decided))}</span>` : ''}</li>`).join('')}</ul></details>`
    : '';
  el.innerHTML = list + past;
}

$('#approvals').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-decide]');
  if (!btn) return;
  const { id, decide, risk } = btn.dataset;
  if (decide === 'approved' && risk === 'high' && !confirm(`${id} is high risk and may not be reversible. Approve it?`)) return;
  btn.closest('.actions').querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    const res = await fetch(`/api/approvals/${encodeURIComponent(id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: decide }),
    });
    const body = await res.json().catch(() => ({}));
    await load(true);
    setLive(res.ok ? `${id} ${decide}. Saved to notes/approvals.md.` : `Couldn't save ${id}: ${body.error || res.status}`, !res.ok);
  } catch (err) {
    setLive(`Couldn't save ${id}: ${err.message}`, true);
    load(true);
  }
});

// ---------- progress log ----------
function renderLog(s) {
  const el = $('#log');
  const sel = $('#log-agent');
  if (s.error) { sel.disabled = true; return (el.innerHTML = sourceError(s)); }
  sel.disabled = false;
  const agents = [...new Set(s.data.entries.map((e) => e.agent))].sort();
  sel.innerHTML = '<option value="">All agents</option>' + agents.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
  sel.value = agents.includes(logAgent) ? logAgent : '';
  const rows = s.data.entries.filter((e) => !sel.value || e.agent === sel.value);
  el.innerHTML = rows.length
    ? `<ol aria-label="Progress entries, newest first">${rows.map((e) => `<li>
        <time datetime="${esc(e.ts)}">${esc(fmtTime(e.ts))}</time>
        ${badge(e.status)}
        <div><span class="who">@${esc(e.agent)} · ${esc(e.task)}</span><br>${esc(e.message)}</div>
      </li>`).join('')}</ol>`
    : '<p class="empty">No entries yet.</p>';
  if (s.data.skipped) el.insertAdjacentHTML('beforeend', `<p class="src">${s.data.skipped} malformed line(s) skipped.</p>`);
}
$('#log-agent').addEventListener('change', (e) => { logAgent = e.target.value; if (last) renderLog(last.progress); });

// ---------- token chart: stacked horizontal bars, input + output ----------
function renderTokens(s) {
  const el = $('#tokens');
  if (s.error) return (el.innerHTML = sourceError(s));
  const agents = s.data.agents;
  if (!agents.length) return (el.innerHTML = '<p class="empty">No model calls logged yet.</p>');
  const W = 560, labelW = 96, valueW = 56, rowH = 30, barH = 16, top = 4;
  const plotW = W - labelW - valueW;
  const max = Math.max(...agents.map((a) => a.input_tokens + a.output_tokens));
  const H = top + agents.length * rowH + 22;
  const x = (v) => (v / max) * plotW;
  const ticks = niceTicks(max, 4);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tokens per agent, input and output stacked. Table view below.">`;
  for (const t of ticks) {
    const tx = labelW + x(t);
    svg += `<line class="gridline" x1="${tx}" x2="${tx}" y1="${top}" y2="${H - 20}"/><text x="${tx}" y="${H - 6}" text-anchor="middle">${fmtK(t)}</text>`;
  }
  agents.forEach((a, i) => {
    const y = top + i * rowH + (rowH - barH) / 2;
    const wi = x(a.input_tokens), wo = x(a.output_tokens);
    const tipBase = `<strong>${esc(a.agent)}</strong>`;
    svg += `<text x="${labelW - 8}" y="${y + barH / 2 + 4}" text-anchor="end">${esc(a.agent)}</text>`;
    svg += `<rect class="s1" x="${labelW}" y="${y}" width="${Math.max(0, wi - 1)}" height="${barH}" rx="0" data-tip="${esc(`${tipBase}Input ${fmtInt(a.input_tokens)} tokens<br>${a.calls} calls`)}"/>`;
    svg += roundedEnd('s2', labelW + wi + 1, y, Math.max(0, wo - 1), barH, `${tipBase}Output ${fmtInt(a.output_tokens)} tokens<br>${a.calls} calls`);
    svg += `<text class="val" x="${labelW + wi + wo + 6}" y="${y + barH / 2 + 4}">${fmtK(a.input_tokens + a.output_tokens)}</text>`;
  });
  svg += `<line class="baseline" x1="${labelW}" x2="${labelW}" y1="${top}" y2="${H - 20}"/></svg>`;
  const table = `<details class="table-view"><summary>Show as table</summary><table>
    <thead><tr><th scope="col">Agent</th><th scope="col">Calls</th><th scope="col">Input</th><th scope="col">Output</th><th scope="col">Total</th></tr></thead>
    <tbody>${agents.map((a) => `<tr><th scope="row">${esc(a.agent)}</th><td>${a.calls}</td><td>${fmtInt(a.input_tokens)}</td><td>${fmtInt(a.output_tokens)}</td><td>${fmtInt(a.input_tokens + a.output_tokens)}</td></tr>`).join('')}</tbody></table></details>`;
  el.innerHTML = `<div class="legend" aria-hidden="true"><span><span class="sw s1"></span>Input tokens</span><span><span class="sw s2"></span>Output tokens</span></div><div class="chart">${svg}</div>${table}`;
  wireTips(el);
}

// A rect with only its right (data) end rounded, anchored square at the left.
function roundedEnd(cls, x, y, w, h, tipHtml) {
  const r = Math.min(4, w, h / 2);
  const d = `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  return `<path class="${cls}" d="${d}" data-tip="${esc(tipHtml)}"/>`;
}

function niceTicks(max, count) {
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

// ---------- latency chart: column per recent call + p95 line ----------
function renderLatency(s) {
  const el = $('#latency');
  if (s.error) return (el.innerHTML = sourceError(s));
  const calls = s.data.recent;
  if (!calls.length) return (el.innerHTML = '<p class="empty">No model calls logged yet.</p>');
  const { p95_ms, p50_ms } = s.data.totals;
  const W = 560, H = 200, left = 44, bottom = 22, top = 8;
  const plotW = W - left - 4, plotH = H - top - bottom;
  const max = Math.max(...calls.map((c) => c.latency_ms), p95_ms) * 1.08;
  const ticks = niceTicks(max, 4);
  const yMax = ticks[ticks.length - 1] >= max ? ticks[ticks.length - 1] : max;
  const y = (v) => top + plotH - (v / yMax) * plotH;
  const slot = plotW / calls.length;
  const bw = Math.max(2, slot - 2);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Latency of the last ${calls.length} model calls. p95 is ${fmtMs(p95_ms)}. Table by agent below.">`;
  for (const t of ticks) svg += `<line class="gridline" x1="${left}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text x="${left - 6}" y="${y(t) + 4}" text-anchor="end">${fmtMs(t)}</text>`;
  calls.forEach((c, i) => {
    const x0 = left + i * slot + 1;
    const h = Math.max(1, top + plotH - y(c.latency_ms));
    const r = Math.min(4, bw / 2, h);
    const yt = top + plotH - h;
    const tipHtml = `<strong>${esc(c.agent)} · ${esc(c.task || '')}</strong>${fmtMs(c.latency_ms)}${c.ok ? '' : ' · failed'}<br>${esc(c.model || '')}<br>${c.ts ? esc(fmtDateTime(c.ts)) : ''}`;
    svg += `<g><rect class="hit" x="${left + i * slot}" y="${top}" width="${slot}" height="${plotH}" data-tip="${esc(tipHtml)}"/>`;
    svg += `<path class="mark ${c.ok ? 's1' : 'err'}" pointer-events="none" d="M${x0},${top + plotH}V${yt + r}Q${x0},${yt} ${x0 + r},${yt}H${x0 + bw - r}Q${x0 + bw},${yt} ${x0 + bw},${yt + r}V${top + plotH}Z"/></g>`;
  });
  svg += `<line class="ref" x1="${left}" x2="${W}" y1="${y(p95_ms)}" y2="${y(p95_ms)}"/><text class="val" x="${W - 2}" y="${y(p95_ms) - 5}" text-anchor="end">p95 ${fmtMs(p95_ms)}</text>`;
  svg += `<line class="baseline" x1="${left}" x2="${W}" y1="${top + plotH}" y2="${top + plotH}"/>`;
  svg += `<text x="${left}" y="${H - 6}">Older</text><text x="${W - 2}" y="${H - 6}" text-anchor="end">Latest</text></svg>`;
  const hasErr = calls.some((c) => !c.ok);
  const table = `<table><caption class="sr-only">Latency by agent</caption>
    <thead><tr><th scope="col">Agent</th><th scope="col">Calls</th><th scope="col">p50</th><th scope="col">p95</th><th scope="col">Failed</th></tr></thead>
    <tbody>${s.data.agents.map((a) => `<tr><th scope="row">${esc(a.agent)}</th><td>${a.calls}</td><td>${fmtMs(a.p50_ms)}</td><td>${fmtMs(a.p95_ms)}</td><td>${a.errors}</td></tr>`).join('')}
    <tr><th scope="row">All</th><td>${s.data.totals.calls}</td><td>${fmtMs(p50_ms)}</td><td>${fmtMs(p95_ms)}</td><td>${s.data.totals.errors}</td></tr></tbody></table>`;
  el.innerHTML = `<div class="legend" aria-hidden="true"><span><span class="sw s1"></span>Call latency</span>${hasErr ? '<span><span class="sw err"></span>Failed call</span>' : ''}<span><span class="sw ref"></span>p95 across all calls</span></div><div class="chart">${svg}</div>${table}`;
  wireTips(el);
}

// ---------- load loop ----------
// Announced messages (decisions, errors) go to the live region; the polling
// timestamp goes to a silent element so screen readers aren't spammed.
function setLive(msg, isError = false) {
  const live = $('#live');
  if (live.textContent === msg) return;
  live.textContent = msg;
  live.classList.toggle('error', isError);
}

function renderSources(st) {
  document.querySelectorAll('[data-src]').forEach((p) => {
    const s = st[p.dataset.src];
    p.textContent = s ? `Source: ${st.root}/${s.file}${s.modified ? ` · changed ${fmtTime(s.modified)}` : ''}` : '';
  });
  $('#source-root').textContent = `Reading ${st.root}/ · stores nothing of its own`;
}

async function load(force = false) {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const text = await res.text();
    const st = JSON.parse(text);
    const stamp = `Updated ${new Date(st.readAt).toLocaleTimeString()}`;
    // Only re-render when a file actually changed, so focus and open details survive polling.
    const sig = text.replace(/"readAt":"[^"]*"/, '');
    if (force || sig !== lastJson) {
      lastJson = sig;
      last = st;
      const openDetails = [...document.querySelectorAll('details[open]')].map((d) => d.closest('section')?.getAttribute('aria-labelledby'));
      renderTiles(st);
      renderGoals(st.claude);
      renderApprovals(st.approvals);
      renderLog(st.progress);
      renderTokens(st.usage);
      renderLatency(st.usage);
      renderSources(st);
      openDetails.forEach((id) => document.querySelector(`section[aria-labelledby="${id}"] details`)?.setAttribute('open', ''));
    }
    $('#stamp').textContent = stamp;
    if ($('#live').classList.contains('error')) setLive('Reconnected.');
  } catch (err) {
    setLive(`Can't reach the dashboard server (${err.message}). Showing the last data read.`, true);
  }
}

$('#refresh').addEventListener('click', () => load(true));
load(true);
setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
