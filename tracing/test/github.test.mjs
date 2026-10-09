import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubRows } from '../lib/github.mjs';

const repository = { full_name: 'blueif16/oct_9' };

test('a merged pull_request becomes a github_pr row with head sha and merge info', () => {
  const [r] = githubRows('pull_request', { action: 'closed', number: 7, repository, pull_request: {
    title: 'feat: tracing', html_url: 'https://github.com/blueif16/oct_9/pull/7', merged: true,
    merged_at: '2026-10-09T21:00:00Z', merge_commit_sha: 'm123', updated_at: '2026-10-09T21:00:00Z',
    head: { sha: 'h456', ref: 'feat/tool-call-tracing' }, base: { ref: 'main' } } });
  assert.equal(r.event_type, 'github_pr');
  assert.equal(r.agent, 'github');
  assert.equal(r.repo, 'blueif16/oct_9');
  assert.equal(r.git_sha, 'h456');
  assert.equal(r.git_branch, 'feat/tool-call-tracing');
  const p = JSON.parse(r.payload);
  assert.deepEqual([p.action, p.number, p.merged, p.merge_commit_sha], ['closed', 7, true, 'm123']);
});

test('a completed workflow_run becomes a github_ci row with its conclusion', () => {
  const [r] = githubRows('workflow_run', { action: 'completed', repository, workflow_run: {
    id: 99, run_attempt: 1, name: 'Semgrep', conclusion: 'failure', status: 'completed', head_sha: 'h456',
    head_branch: 'feat/x', html_url: 'https://github.com/r/actions/runs/99', updated_at: '2026-10-09T21:05:00Z' } });
  assert.equal(r.event_type, 'github_ci');
  assert.equal(r.git_sha, 'h456');
  assert.equal(JSON.parse(r.payload).conclusion, 'failure');
});

test('each pushed commit becomes a github_push row linked to its agent session via the trailer', () => {
  const rows = githubRows('push', { ref: 'refs/heads/main', forced: false, repository, commits: [
    { id: 'c1', timestamp: '2026-10-09T21:10:00Z', url: 'u1', message: 'feat: a\n\nAgent-Session: claude:sess-1' },
    { id: 'c2', timestamp: '2026-10-09T21:11:00Z', url: 'u2', message: 'docs: by hand' } ] });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.event_type, r.git_sha, r.session_id, r.agent]), [
    ['github_push', 'c1', 'sess-1', 'claude'], ['github_push', 'c2', '', 'github']]);
  assert.equal(rows[0].git_branch, 'main');
});

test('re-delivered events produce the same event_id so they dedupe', () => {
  const payload = { ref: 'refs/heads/main', repository, commits: [{ id: 'c1', timestamp: 't', message: 'x' }] };
  assert.equal(githubRows('push', payload)[0].event_id, githubRows('push', payload)[0].event_id);
});

test('unrelated events produce no rows', () => {
  assert.deepEqual(githubRows('issues', { action: 'opened', repository }), []);
});
