import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hook.mjs');

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'hook-'));
  const env = { ...process.env, TRACE_DIR: dir, TRACE_CONFIG: join(dir, 'missing.env'), CLAUDE_CODE_SESSION_ID: '' };
  for (const k of Object.keys(env)) if (k.startsWith('CLICKHOUSE_')) delete env[k];
  return { dir, env, transcript: join(dir, 't.jsonl') };
}
const run = (args, input, env) => execFileSync('node', [HOOK, ...args], { input: input ? JSON.stringify(input) : '', env, encoding: 'utf8' });
const rows = (dir) => (existsSync(join(dir, 'spool.jsonl')) ? readFileSync(join(dir, 'spool.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []);

const guardianFinding = (uuid) => JSON.stringify({
  type: 'attachment', uuid, timestamp: '2026-10-09T20:00:01.000Z', sessionId: 's-1',
  attachment: { type: 'hook_blocking_error', hookName: 'PostToolUse:Write', toolUseID: 'toolu_1', hookEvent: 'PostToolUse',
    blockingError: { blockingError: 'Semgrep Guardian found 1 issue in 1 file\n\na.py\n  [ERROR] r.one\n    msg\n', command: '"${CLAUDE_PLUGIN_ROOT}/scripts/hook" auto PostToolUse' } },
}) + '\n';

test('a Claude PostToolUse hook queues a tool_call row', () => {
  const { dir, env, transcript } = setup();
  writeFileSync(transcript, '');
  run(['claude'], { hook_event_name: 'PostToolUse', session_id: 's-1', transcript_path: transcript, cwd: dir,
    tool_name: 'Write', tool_use_id: 'toolu_1', tool_input: { file_path: 'a.py' }, tool_response: { type: 'create' } }, env);
  const [ev] = rows(dir);
  assert.equal(ev.event_type, 'tool_call');
  assert.equal(ev.tool_use_id, 'toolu_1');
});

test('Semgrep results in the transcript are emitted once, even across repeated hooks', () => {
  const { dir, env, transcript } = setup();
  writeFileSync(transcript, guardianFinding('11111111-1111-1111-1111-111111111111'));
  const stop = { hook_event_name: 'Stop', session_id: 's-1', transcript_path: transcript, cwd: dir };
  run(['claude'], stop, env);
  run(['claude'], stop, env);
  appendFileSync(transcript, guardianFinding('22222222-2222-2222-2222-222222222222'));
  run(['claude'], stop, env);
  const scans = rows(dir).filter((r) => r.event_type === 'semgrep_scan');
  assert.deepEqual(scans.map((s) => s.event_id), ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222']);
  assert.deepEqual(scans[0].semgrep_rules, ['r.one']);
});

test('the hook never fails the agent, even on garbage input', () => {
  const { env } = setup();
  assert.doesNotThrow(() => execFileSync('node', [HOOK, 'claude'], { input: 'not json', env }));
});

test('context-injected records the lesson id against the current session', () => {
  const { dir, env } = setup();
  run(['context-injected', '--lesson-id', 'lesson-42'], null, { ...env, CLAUDE_CODE_SESSION_ID: 'sess-9' });
  const [ev] = rows(dir);
  assert.equal(ev.event_type, 'context_injected');
  assert.equal(ev.lesson_id, 'lesson-42');
  assert.equal(ev.session_id, 'sess-9');
});
