'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = require('../lib/sources');

const AI_OS = path.join(__dirname, '..', '..', 'ai-os');
const read = (rel) => fs.readFileSync(path.join(AI_OS, rel), 'utf8');

test('parses agents, goals and task states from CLAUDE.md', () => {
  const { agents, goals } = src.parseClaudeMd(read('CLAUDE.md'));
  assert.ok(agents.some((a) => a.name === 'orchestrator'));
  assert.equal(goals.length, 3);
  const g1 = goals[0];
  assert.equal(g1.id, 'G1');
  assert.equal(g1.meta.owner, 'orchestrator');
  assert.deepEqual(g1.tasks[0], { id: 'T1.1', title: 'Audit current onboarding drop-off points', agent: 'researcher', state: 'done' });
  assert.equal(goals[1].counts.blocked, 1);
  assert.equal(g1.percent, 40);
});

test('handles a CLAUDE.md with no goals section', () => {
  assert.deepEqual(src.parseClaudeMd('# Nothing here'), { agents: [], goals: [] });
});

test('parses the progress log newest first and skips junk lines', () => {
  const { entries, skipped } = src.parseProgressLog('# header\n2026-10-13T08:00:00Z | a | T1 | done | first\nnot a line\n2026-10-13T09:00:00Z | b | T2 | blocked | second | with pipe\n');
  assert.equal(skipped, 1);
  assert.equal(entries[0].agent, 'b');
  assert.equal(entries[0].message, 'second | with pipe');
});

test('aggregates usage per agent with percentiles', () => {
  const lines = [
    { ts: '2026-10-13T08:00:00Z', agent: 'a', input_tokens: 100, output_tokens: 10, latency_ms: 100 },
    { ts: '2026-10-13T08:01:00Z', agent: 'a', input_tokens: 200, output_tokens: 20, latency_ms: 300, ok: false },
    { ts: '2026-10-13T08:02:00Z', agent: 'b', input_tokens: 50, output_tokens: 5, latency_ms: 200 },
  ].map((l) => JSON.stringify(l));
  const u = src.parseUsage(lines.join('\n') + '\n{broken\n');
  assert.equal(u.skipped, 1);
  assert.equal(u.totals.input_tokens, 350);
  assert.equal(u.totals.errors, 1);
  assert.equal(u.agents[0].agent, 'a');
  assert.equal(u.agents[0].p95_ms, 300);
  assert.equal(u.totals.p50_ms, 200);
});

test('reads the seeded approvals queue', () => {
  const { items } = src.parseApprovals(read('notes/approvals.md'));
  assert.equal(items.filter((i) => i.status === 'pending').length, 3);
  assert.equal(items.find((i) => i.id === 'APR-003').risk, 'high');
});

test('setApprovalStatus rewrites only the matching pending section', () => {
  const md = read('notes/approvals.md');
  const next = src.setApprovalStatus(md, 'APR-002', 'approved', '2026-10-13T15:00:00Z');
  const items = src.parseApprovals(next).items;
  const a2 = items.find((i) => i.id === 'APR-002');
  assert.equal(a2.status, 'approved');
  assert.equal(a2.decided, '2026-10-13T15:00:00Z');
  assert.equal(items.find((i) => i.id === 'APR-001').status, 'pending');
  assert.equal(src.setApprovalStatus(next, 'APR-002', 'rejected', 'x'), null, 'already decided');
  assert.equal(src.setApprovalStatus(md, 'APR-999', 'approved', 'x'), null, 'unknown id');
  assert.equal(src.setApprovalStatus(md, 'APR-000', 'rejected', 'x'), null, 'not pending');
});
