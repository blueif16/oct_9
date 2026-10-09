import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toEvent, MAX_FIELD } from '../lib/events.mjs';

const ctx = { now: '2026-10-09T20:00:00.000Z', repo: 'blueif16/oct_9', git_branch: 'main', git_sha: 'abc123' };
const common = { session_id: 's-1', transcript_path: '/t.jsonl', cwd: '/Users/tk/Desktop/oct_9' };

test('PostToolUse becomes a tool_call row with ids, tool name and redacted input/response', () => {
  const secret = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
  const ev = toEvent('claude', { ...common, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'toolu_1',
    tool_input: { command: `GH=${secret} gh pr list` }, tool_response: { stdout: 'ok', stderr: '' }, duration_ms: 120 }, ctx);
  assert.equal(ev.event_type, 'tool_call');
  assert.equal(ev.tool_name, 'Bash');
  assert.equal(ev.tool_use_id, 'toolu_1');
  assert.equal(ev.session_id, 's-1');
  assert.equal(ev.agent, 'claude');
  const payload = JSON.parse(ev.payload);
  assert.equal(payload.tool_response.stdout, 'ok');
  assert.equal(payload.duration_ms, 120);
  assert.ok(!ev.payload.includes(secret));
});

test('PostToolUseFailure becomes a tool_call row marked by hook_event, with the redacted error', () => {
  const secret = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
  const ev = toEvent('claude', { ...common, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 'toolu_2',
    tool_input: { command: 'npm test' }, error: `Exit code 1 token=${secret}`, is_interrupt: false }, ctx);
  assert.equal(ev.event_type, 'tool_call');
  assert.equal(ev.hook_event, 'PostToolUseFailure');
  assert.equal(ev.tool_use_id, 'toolu_2');
  const payload = JSON.parse(ev.payload);
  assert.equal(payload.tool_input.command, 'npm test');
  assert.match(payload.error, /^Exit code 1/);
  assert.equal(payload.is_interrupt, false);
  assert.ok(!ev.payload.includes(secret));
});

test('maps each lifecycle hook to its event type', () => {
  const cases = { SessionStart: 'session_start', UserPromptSubmit: 'user_prompt', Stop: 'stop', SessionEnd: 'session_end' };
  for (const [hook, type] of Object.entries(cases)) {
    assert.equal(toEvent('claude', { ...common, hook_event_name: hook }, ctx).event_type, type, hook);
  }
});

test('keeps the event-specific fields in the payload', () => {
  assert.equal(JSON.parse(toEvent('claude', { ...common, hook_event_name: 'UserPromptSubmit', prompt: 'fix the bug' }, ctx).payload).prompt, 'fix the bug');
  assert.equal(JSON.parse(toEvent('claude', { ...common, hook_event_name: 'SessionStart', source: 'resume' }, ctx).payload).source, 'resume');
  assert.equal(JSON.parse(toEvent('claude', { ...common, hook_event_name: 'SessionEnd', reason: 'logout' }, ctx).payload).reason, 'logout');
  assert.equal(JSON.parse(toEvent('claude', { ...common, hook_event_name: 'Stop', last_assistant_message: 'done' }, ctx).payload).last_assistant_message, 'done');
});

test('returns null for hooks we do not trace', () => {
  assert.equal(toEvent('claude', { ...common, hook_event_name: 'PreCompact' }, ctx), null);
});

test('stamps repo, branch, commit and time from context', () => {
  const ev = toEvent('claude', { ...common, hook_event_name: 'Stop' }, ctx);
  assert.deepEqual([ev.ts, ev.repo, ev.git_branch, ev.git_sha], [ctx.now, ctx.repo, 'main', 'abc123']);
  assert.match(ev.event_id, /^[0-9a-f-]{36}$/);
});

test('captures Codex-only model and turn_id', () => {
  const ev = toEvent('codex', { ...common, hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_use_id: 'c1',
    tool_input: { command: '*** Begin Patch' }, tool_response: 'ok', model: 'gpt-5.5', turn_id: 't-9' }, ctx);
  assert.deepEqual([ev.agent, ev.model, ev.turn_id], ['codex', 'gpt-5.5', 't-9']);
});

test('truncates oversized strings in the payload and marks them', () => {
  const big = 'x'.repeat(MAX_FIELD + 500);
  const ev = toEvent('claude', { ...common, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 't',
    tool_input: { command: 'cat big' }, tool_response: { stdout: big } }, ctx);
  const out = JSON.parse(ev.payload).tool_response.stdout;
  assert.ok(out.length < big.length);
  assert.ok(out.endsWith('[truncated 500 chars]'));
});
