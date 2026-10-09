-- Trigger detectors: refreshable materialized views that look at agent_traces.events on a schedule and
-- APPEND one row per new trigger into trigger_requests. The insert-time MVs in webhook.sql then POST each
-- row to its agent's Guild webhook. Usage: npm run trace:triggers
-- Why refreshable, not insert-time: spool retries re-send rows (an insert-time MV would fire twice), and
-- an insert-time MV only sees the rows of one INSERT, so it cannot count across a session.
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
   AND dedup_key NOT IN (SELECT dedup_key FROM agent_traces.trigger_requests WHERE source = 'session_end');
