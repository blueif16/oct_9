-- One row per traced event: agent hooks, Semgrep scans, context injections, GitHub PR/CI/push.
CREATE DATABASE IF NOT EXISTS agent_traces;

CREATE TABLE IF NOT EXISTS agent_traces.events
(
    event_id           String,
    ts                 DateTime64(3, 'UTC'),
    agent              LowCardinality(String),   -- claude | codex | github
    session_id         String,
    event_type         LowCardinality(String),   -- session_start | user_prompt | tool_call | stop | session_end
                                                 -- semgrep_scan | semgrep_summary | context_injected
                                                 -- github_pr | github_ci | github_push
    hook_event         LowCardinality(String),
    tool_name          LowCardinality(String),
    tool_use_id        String,
    model              LowCardinality(String),
    turn_id            String,
    lesson_id          String,
    cwd                String,
    repo               LowCardinality(String),
    git_branch         String,
    git_sha            String,
    semgrep_outcome    LowCardinality(String),   -- findings | no_findings
    semgrep_findings   UInt32,
    semgrep_rules      Array(String),
    semgrep_severities Array(LowCardinality(String)),
    semgrep_files      Array(String),
    payload            String,                   -- redacted JSON
    inserted_at        DateTime64(3, 'UTC') DEFAULT now64(3)
)
-- Replacing + ORDER BY ending in event_id: re-sent rows (spool retries, transcript re-reads) collapse to one.
ENGINE = ReplacingMergeTree(inserted_at)
PARTITION BY toYYYYMM(ts)
ORDER BY (repo, session_id, ts, event_id);
