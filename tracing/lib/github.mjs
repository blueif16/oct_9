import { row } from './events.mjs';
import { redact } from './redact.mjs';

const TRAILER = /^Agent-Session:\s*(\w+):(\S+)\s*$/m;

const ghRow = (fields, payload) => row({ agent: 'github', ...fields, payload: JSON.stringify(redact(payload)) });

// Turn one GitHub Actions event payload into trace rows. event_ids are deterministic so re-runs dedupe.
export function githubRows(eventName, e) {
  const repo = e.repository?.full_name ?? '';

  if (eventName === 'pull_request') {
    const pr = e.pull_request;
    return [ghRow({
      event_id: `gh-pr:${repo}:${e.number}:${e.action}:${pr.updated_at}`,
      ts: pr.updated_at, repo, event_type: 'github_pr', git_sha: pr.head.sha, git_branch: pr.head.ref,
    }, {
      action: e.action, number: e.number, title: pr.title, url: pr.html_url, base: pr.base?.ref,
      merged: Boolean(pr.merged), merged_at: pr.merged_at ?? null, merge_commit_sha: pr.merge_commit_sha ?? null,
    })];
  }

  if (eventName === 'workflow_run') {
    const run = e.workflow_run;
    return [ghRow({
      event_id: `gh-ci:${repo}:${run.id}:${run.run_attempt}:${run.status}`,
      ts: run.updated_at, repo, event_type: 'github_ci', git_sha: run.head_sha, git_branch: run.head_branch,
    }, { action: e.action, workflow: run.name, status: run.status, conclusion: run.conclusion, run_id: run.id, attempt: run.run_attempt, url: run.html_url })];
  }

  if (eventName === 'push') {
    const branch = (e.ref ?? '').replace(/^refs\/heads\//, '');
    return (e.commits ?? []).map((c) => {
      const t = TRAILER.exec(c.message ?? '');
      return ghRow({
        event_id: `gh-push:${repo}:${branch}:${c.id}`,
        ts: c.timestamp, repo, event_type: 'github_push', git_sha: c.id, git_branch: branch,
        agent: t ? t[1] : 'github', session_id: t ? t[2] : '',
      }, { subject: (c.message ?? '').split('\n')[0], ref: e.ref, forced: Boolean(e.forced), url: c.url });
    });
  }

  return [];
}
