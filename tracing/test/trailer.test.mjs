import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.githooks');

function commit(env, message = 'feat: x') {
  const dir = mkdtempSync(join(tmpdir(), 'trailer-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_SESSION_ID: '', ...env } });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'core.hooksPath', HOOKS);
  git('commit', '-q', '--allow-empty', '-m', message);
  return git('log', '-1', '--format=%B');
}

test('commits made inside a Claude session get an Agent-Session trailer', () => {
  assert.match(commit({ CLAUDE_CODE_SESSION_ID: 'abc-123' }), /^Agent-Session: claude:abc-123$/m);
});

test('commits made outside an agent session get no trailer', () => {
  assert.doesNotMatch(commit({}), /Agent-Session/);
});

test('an existing Agent-Session trailer is not duplicated', () => {
  const msg = commit({ CLAUDE_CODE_SESSION_ID: 'abc-123' }, 'feat: x\n\nAgent-Session: claude:abc-123');
  assert.equal(msg.match(/Agent-Session/g).length, 1);
});
