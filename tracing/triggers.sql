-- Trigger detectors: refreshable materialized views that look at agent_traces.events on a schedule and
-- APPEND one row per new trigger into trigger_requests. The insert-time MVs in webhook.sql then POST each
-- row to its agent's Guild webhook. Usage: npm run trace:triggers
-- Why refreshable, not insert-time: spool retries re-send rows (an insert-time MV would fire twice), and
-- an insert-time MV only sees the rows of one INSERT, so it cannot count across a session.
-- SELECT aliases are visible in WHERE: `'loop-breaker' AS agent` would shadow events.agent, so qualify
-- source columns (ev.agent) whenever an output alias reuses a column name.
-- ONE ROW PER REFRESH (LIMIT 1): the URL engine POSTs a whole insert block as one body, and Guild rejects a
-- multi-row body with HTTP 400 (measured 2026-10-09; max_block_size=1 settings did not split it). A backlog
-- drains one row per detector per 5 minutes.
-- Every detector: reads events FINAL (collapses re-sent rows), skips dedup_keys already in trigger_requests,
-- and precomputes `context` so the agent spends fewer queries.

-- Detector 1: session end → session-retro (writes PLAYBOOK docs).
-- One row per session_end event. The window runs from the previous session_end of the same session (a
-- resumed session ends again) to this one. Waits 2 minutes so async hook rows land first. Skips sessions
-- with fewer than 5 tool calls (guessed floor).
CREATE MATERIALIZED VIEW IF NOT EXISTS agent_traces.detect_session_end_mv
REFRESH EVERY 5 MINUTE APPEND TO agent_traces.trigger_requests AS
WITH ends AS (
  SELECT session_id, event_id AS end_id, ts AS end_ts,
         lagInFrame(ts, 1, toDateTime64(0, 3, 'UTC')) OVER (PARTITION BY session_id ORDER BY ts ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS prev_end_ts
  FROM agent_traces.events FINAL
  WHERE event_type = 'session_end' AND session_id != ''
    AND inserted_at > now64(3) - INTERVAL 7 DAY
    AND inserted_at < now64(3) - INTERVAL 2 MINUTE
)
SELECT
  now64(3) AS requested_at,
  'session_end' AS source,
  'session-retro' AS agent,
  concat('session_end:', s.session_id, ':', s.end_id) AS dedup_key,
  countIf(e.event_type = 'tool_call') AS tool_call_count,
  min(e.ts) AS window_start,
  any(s.end_ts) AS window_end,
  format('Run session-retro for session {}, window {} to {} UTC.', s.session_id, toString(window_start), toString(window_end)) AS text,
  toJSONString(map(
    'agent', any(e.agent), 'repo', any(e.repo), 'branch', anyLast(e.git_branch),
    'tool_calls', toString(tool_call_count),
    'failed_tool_calls', toString(countIf(e.hook_event = 'PostToolUseFailure')),
    'prompts', toString(countIf(e.event_type = 'user_prompt')),
    'edits', toString(countIf(e.tool_name IN ('Edit', 'Write', 'apply_patch'))),
    'semgrep_findings', toString(sumIf(e.semgrep_findings, e.event_type = 'semgrep_scan')),
    'pushes', toString(countIf(e.event_type = 'github_push')),
    'minutes', toString(dateDiff('minute', window_start, window_end)))) AS context
FROM ends AS s
INNER JOIN (SELECT * FROM agent_traces.events FINAL WHERE session_id IN (SELECT session_id FROM ends)) AS e ON e.session_id = s.session_id
WHERE e.ts > s.prev_end_ts AND e.ts <= s.end_ts
GROUP BY s.session_id, s.end_id
HAVING tool_call_count >= 5
   AND dedup_key NOT IN (SELECT dedup_key FROM agent_traces.trigger_requests WHERE source = 'session_end')
ORDER BY window_end
LIMIT 1;

-- Detector 2: PR merged → workflow-canonizer (writes RUNBOOK docs with status: proposed).
-- A PR's sessions are the agent events recorded on its head branch (hooks stamp git_branch). The window
-- runs from this branch's previous canonizer run (or its first event) to the merge, so a reused branch only
-- contributes its new tool calls. Skips PRs with fewer than 5 traced tool calls (guessed floor).
-- Runs at most one PR per refresh (oldest first), so canonizer runs never overlap.
CREATE MATERIALIZED VIEW IF NOT EXISTS agent_traces.detect_pr_merged_mv
REFRESH EVERY 5 MINUTE APPEND TO agent_traces.trigger_requests AS
WITH merged AS (
  SELECT event_id, ts AS merged_ts, git_branch AS branch, JSONExtractUInt(payload, 'number') AS pr,
         JSONExtractString(payload, 'title') AS title, JSONExtractString(payload, 'url') AS url
  FROM agent_traces.events FINAL
  WHERE event_type = 'github_pr' AND JSONExtractString(payload, 'action') = 'closed' AND JSONExtractBool(payload, 'merged')
    AND inserted_at > now64(3) - INTERVAL 7 DAY AND inserted_at < now64(3) - INTERVAL 2 MINUTE
),
prev AS (
  SELECT JSONExtractString(context, 'branch') AS branch, max(window_end) AS prev_end
  FROM agent_traces.trigger_requests WHERE source = 'pr_merged' GROUP BY branch
)
SELECT
  now64(3) AS requested_at,
  'pr_merged' AS source,
  'workflow-canonizer' AS agent,
  concat('pr_merged:#', toString(m.pr), ':', m.event_id) AS dedup_key,
  countIf(e.event_type = 'tool_call') AS tool_call_count,
  min(e.ts) AS window_start,
  any(m.merged_ts) AS window_end,
  format('Run workflow-canonizer for PR #{} on branch {}, window {} to {} UTC.', toString(m.pr), m.branch, toString(window_start), toString(window_end)) AS text,
  toJSONString(map(
    'pr', toString(m.pr), 'branch', m.branch, 'title', any(m.title), 'url', any(m.url),
    'sessions', arrayStringConcat(groupUniqArrayIf(e.session_id, e.session_id != ''), ','),
    'tool_calls', toString(tool_call_count),
    'failed_tool_calls', toString(countIf(e.hook_event = 'PostToolUseFailure')),
    'edits', toString(countIf(e.tool_name IN ('Edit', 'Write', 'apply_patch'))),
    'semgrep_findings', toString(sumIf(e.semgrep_findings, e.event_type = 'semgrep_scan')),
    'ci_failures', toString(countIf(e.event_type = 'github_ci' AND JSONExtractString(e.payload, 'conclusion') IN ('failure', 'timed_out'))))) AS context
FROM merged AS m
LEFT JOIN prev AS p ON p.branch = m.branch
INNER JOIN (SELECT * FROM agent_traces.events FINAL WHERE git_branch IN (SELECT branch FROM merged) AND (agent IN ('claude', 'codex') OR event_type = 'github_ci')) AS e ON e.git_branch = m.branch
WHERE e.ts > p.prev_end AND e.ts <= m.merged_ts
GROUP BY m.pr, m.branch, m.event_id
HAVING tool_call_count >= 5
   AND dedup_key NOT IN (SELECT dedup_key FROM agent_traces.trigger_requests WHERE source = 'pr_merged')
-- One PR per refresh: two concurrent runs would both see no RUNBOOK-<workflow>-V1 and both create it.
ORDER BY window_end
LIMIT 1;

-- Detector 3: thrash → loop-breaker (writes efficiency LESSON docs).
-- ≥ 3 failed tool calls by one session within a 10-minute bucket. Failures, not exact repeats: agents rewrite
-- a failing command each retry, so identical repeats rarely fail (measured 2026-10-09). Same limit of 3 as
-- the senso-lessons skill, which counts rewritten calls. No settle delay: the lesson is wanted while it helps.
CREATE MATERIALIZED VIEW IF NOT EXISTS agent_traces.detect_thrash_mv
REFRESH EVERY 5 MINUTE APPEND TO agent_traces.trigger_requests AS
SELECT
  now64(3) AS requested_at,
  'thrash' AS source,
  'loop-breaker' AS agent,
  concat('thrash:', session_id, ':', toString(bucket)) AS dedup_key,
  count() AS tool_call_count,
  bucket AS window_start,
  bucket + INTERVAL 10 MINUTE AS window_end,
  format('Run loop-breaker mode thrash for session {}, window {} to {} UTC.', session_id, toString(window_start), toString(window_end)) AS text,
  toJSONString(map(
    'session', session_id, 'branch', any(git_branch), 'failed_tool_calls', toString(count()),
    'tools', arrayStringConcat(groupUniqArray(5)(tool_name), ','))) AS context
FROM agent_traces.events AS ev FINAL
WHERE ev.event_type = 'tool_call' AND ev.hook_event = 'PostToolUseFailure' AND ev.agent IN ('claude', 'codex')
  AND inserted_at > now64(3) - INTERVAL 1 DAY
GROUP BY session_id, toStartOfInterval(ts, INTERVAL 10 MINUTE) AS bucket
HAVING count() >= 3
   AND dedup_key NOT IN (SELECT dedup_key FROM agent_traces.trigger_requests WHERE source = 'thrash')
ORDER BY window_start
LIMIT 1;

-- Detector 4: volume → loop-breaker checkpoint of a live session.
-- Fires each time a session passes another 40 tool calls (guessed step). Live = active in the last 30 min
-- and no session_end after its last event; ended sessions go to session-retro instead. The window starts at
-- this session's previous checkpoint, so each run only reviews the new calls.
CREATE MATERIALIZED VIEW IF NOT EXISTS agent_traces.detect_volume_mv
REFRESH EVERY 5 MINUTE APPEND TO agent_traces.trigger_requests AS
WITH live AS (
  SELECT session_id, countIf(event_type = 'tool_call') AS calls, max(ts) AS last_ts, any(git_branch) AS branch,
         maxIf(ts, event_type = 'session_end') AS ended_at, min(ts) AS first_ts
  FROM agent_traces.events FINAL
  WHERE agent IN ('claude', 'codex') AND session_id != '' AND inserted_at > now64(3) - INTERVAL 1 DAY
  GROUP BY session_id
  HAVING calls >= 40 AND ended_at < last_ts AND last_ts > now64(3) - INTERVAL 30 MINUTE
),
prev AS (
  SELECT JSONExtractString(context, 'session') AS session_id, max(window_end) AS prev_end
  FROM agent_traces.trigger_requests WHERE source = 'volume' GROUP BY session_id
)
SELECT
  now64(3) AS requested_at,
  'volume' AS source,
  'loop-breaker' AS agent,
  concat('volume:', l.session_id, ':', toString(intDiv(l.calls, 40))) AS dedup_key,
  l.calls AS tool_call_count,
  if(p.prev_end > l.first_ts, p.prev_end, l.first_ts) AS window_start,
  l.last_ts AS window_end,
  format('Run loop-breaker mode checkpoint for session {}, window {} to {} UTC.', l.session_id, toString(window_start), toString(window_end)) AS text,
  toJSONString(map('session', l.session_id, 'branch', l.branch, 'session_tool_calls', toString(l.calls))) AS context
FROM live AS l
LEFT JOIN prev AS p ON p.session_id = l.session_id
WHERE dedup_key NOT IN (SELECT dedup_key FROM agent_traces.trigger_requests WHERE source = 'volume')
ORDER BY window_end
LIMIT 1;

-- Detector 5: guardrail signals → trace-to-memory (LESSON docs + the CURRENT.md index).
-- New Semgrep findings, failed CI runs, or force-pushes since the last guardrail run, batched to at most one
-- run per 30-minute bucket. Watermark on inserted_at (late rows still count); the agent is told to look back
-- to the earliest new signal's ts.
CREATE MATERIALIZED VIEW IF NOT EXISTS agent_traces.detect_guardrail_mv
REFRESH EVERY 5 MINUTE APPEND TO agent_traces.trigger_requests AS
SELECT
  now64(3) AS requested_at,
  'guardrail' AS source,
  'trace-to-memory' AS agent,
  concat('guardrail:', toString(toStartOfInterval(now(), INTERVAL 30 MINUTE))) AS dedup_key,
  toUInt64(0) AS tool_call_count,
  min(ts) AS window_start,
  max(inserted_at) AS window_end,
  format('Run rule lessons-from-failures since {}.', formatDateTime(window_start, '%Y-%m-%dT%H:%i:%SZ')) AS text,
  toJSONString(map(
    'semgrep_findings', toString(countIf(event_type = 'semgrep_scan')),
    'ci_failures', toString(countIf(event_type = 'github_ci')),
    'force_pushes', toString(countIf(event_type = 'github_push')))) AS context
FROM agent_traces.events FINAL
WHERE inserted_at > (SELECT max(window_end) FROM agent_traces.trigger_requests WHERE source = 'guardrail')
  AND inserted_at > now64(3) - INTERVAL 7 DAY AND inserted_at < now64(3) - INTERVAL 2 MINUTE
  AND ((event_type = 'semgrep_scan' AND semgrep_outcome = 'findings')
    OR (event_type = 'github_ci' AND JSONExtractString(payload, 'conclusion') IN ('failure', 'timed_out'))
    OR (event_type = 'github_push' AND JSONExtractBool(payload, 'forced')))
HAVING count() > 0
   AND dedup_key NOT IN (SELECT dedup_key FROM agent_traces.trigger_requests WHERE source = 'guardrail');
