import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSemgrep } from '../lib/semgrep.mjs';

// Record shapes copied from a real Claude Code transcript (Semgrep Guardian 2.6.0).
const GUARDIAN = (event) => `"\${CLAUDE_PLUGIN_ROOT}/scripts/hook" auto ${event}`;
const REPORT = 'Semgrep Guardian found 2 issues in 2 files\n\napp.py\n  [ERROR] python.lang.security.audit.subprocess-shell-true.subprocess-shell-true\n    Found \'subprocess\' function \'call\' with \'shell=True\'.\n  5:54-5:58\n    return subprocess.call("ls " + user_input, shell=True)\n\nweb/db.js\n  [WARNING] javascript.lang.security.audit.sqli.node-sqli\n    Possible SQL injection.\n  3:1-3:40\n    db.query("SELECT * FROM t WHERE id=" + id)\n';

const record = (attachment, timestamp = '2026-10-09T18:52:52.200Z') => ({
  type: 'attachment', attachment, timestamp, sessionId: 's-1', uuid: 'u-' + Math.random(),
});
const blocking = (toolUseID, text = REPORT) => record({
  type: 'hook_blocking_error', hookName: 'PostToolUse:Write', toolUseID, hookEvent: 'PostToolUse',
  blockingError: { blockingError: text, command: GUARDIAN('PostToolUse') },
});
const success = (toolUseID, command = GUARDIAN('PostToolUse'), extra = {}) => record({
  type: 'hook_success', hookName: 'PostToolUse:Bash', toolUseID, hookEvent: 'PostToolUse',
  content: '', stdout: '{}', stderr: '', exitCode: 0, command, durationMs: 42, ...extra,
});

test('a blocking Guardian record becomes a findings scan tied to its tool call', () => {
  const [scan] = extractSemgrep([blocking('toolu_A')]);
  assert.equal(scan.event_type, 'semgrep_scan');
  assert.equal(scan.tool_use_id, 'toolu_A');
  assert.equal(scan.semgrep_outcome, 'findings');
  assert.equal(scan.semgrep_findings, 2);
});

test('parses rule ids, severities and files from the report', () => {
  const [scan] = extractSemgrep([blocking('toolu_A')]);
  assert.deepEqual(scan.semgrep_rules, [
    'python.lang.security.audit.subprocess-shell-true.subprocess-shell-true',
    'javascript.lang.security.audit.sqli.node-sqli',
  ]);
  assert.deepEqual(scan.semgrep_severities, ['ERROR', 'WARNING']);
  assert.deepEqual(scan.semgrep_files, ['app.py', 'web/db.js']);
});

test('keeps the full report text in the payload', () => {
  const [scan] = extractSemgrep([blocking('toolu_A')]);
  assert.equal(JSON.parse(scan.payload).report, REPORT);
});

test('a successful Guardian PostToolUse record is a no_findings scan', () => {
  const [scan] = extractSemgrep([success('toolu_B')]);
  assert.equal(scan.semgrep_outcome, 'no_findings');
  assert.equal(scan.semgrep_findings, 0);
  assert.equal(scan.tool_use_id, 'toolu_B');
});

test('ignores hooks from other plugins and Guardian PreToolUse records', () => {
  const other = success('toolu_C', 'node "$CLAUDE_PROJECT_DIR/tracing/hook.mjs" claude');
  const pre = record({ type: 'hook_success', hookName: 'PreToolUse:Bash', toolUseID: 'toolu_D',
    hookEvent: 'PreToolUse', stdout: '{}', exitCode: 0, command: GUARDIAN('PreToolUse'), durationMs: 3 });
  assert.deepEqual(extractSemgrep([other, pre, { type: 'user', message: {} }]), []);
});

test('the Guardian Stop summary becomes a semgrep_summary event with parsed totals', () => {
  const stop = record({ type: 'hook_success', hookName: 'Stop', toolUseID: 'x', hookEvent: 'Stop',
    stdout: '{"systemMessage":"○○○ Semgrep Guardian: 3 scans this session across 2 files, 1 finding."}',
    exitCode: 0, command: GUARDIAN('Stop'), durationMs: 70 });
  const [ev] = extractSemgrep([stop]);
  assert.equal(ev.event_type, 'semgrep_summary');
  assert.deepEqual(JSON.parse(ev.payload).totals, { scans: 3, files: 2, findings: 1 });
});

test('uses the transcript timestamp and session of the record', () => {
  const [scan] = extractSemgrep([blocking('toolu_A')]);
  assert.equal(scan.ts, '2026-10-09T18:52:52.200Z');
  assert.equal(scan.session_id, 's-1');
});

test('redacts secrets that appear in a finding report', () => {
  const secret = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
  const report = `Semgrep Guardian found 1 issue in 1 file\n\nx.py\n  [ERROR] generic.secrets.github-token\n    token\n  1:1-1:40\n    T = "${secret}"\n`;
  const [scan] = extractSemgrep([blocking('toolu_E', report)]);
  assert.ok(!scan.payload.includes(secret));
});
