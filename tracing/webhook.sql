-- ClickHouse → Guild webhook. A row inserted into trigger_requests is POSTed to the Guild API trigger of the
-- agent named in its `agent` column (one row = one agent run). Rows come from hand-written INSERTs or from
-- the detectors in triggers.sql.
-- {{GUILD_URL}} / {{GUILD_AUTH}} are filled from ~/.config/oct9/guild.env by `npm run trace:webhook`.

CREATE TABLE IF NOT EXISTS agent_traces.trigger_requests
(
    requested_at    DateTime64(3, 'UTC') DEFAULT now64(3),
    source          LowCardinality(String),   -- manual | session_end | …
    text            String,                   -- agent input, e.g. "Run rule lessons-from-failures since …"
    tool_call_count UInt64 DEFAULT 0,
    agent           LowCardinality(String) DEFAULT 'trace-to-memory',  -- routes the row to that agent's webhook
    dedup_key       String DEFAULT '',        -- detectors never insert a key that already exists
    window_start    DateTime64(3, 'UTC') DEFAULT 0,   -- trace window the run should analyze
    window_end      DateTime64(3, 'UTC') DEFAULT 0,
    context         String DEFAULT '{}'       -- JSON precomputed by the detector
)
ENGINE = MergeTree
ORDER BY requested_at;

-- URL engine: an INSERT becomes an HTTP POST. Header values are masked in SHOW CREATE.
CREATE TABLE IF NOT EXISTS agent_traces.guild_webhook
(
    session_type String,
    agent_input  Tuple(text String)
)
ENGINE = URL('{{GUILD_URL}}', JSONEachRow,
             headers('Authorization' = 'Basic {{GUILD_AUTH}}', 'Content-Type' = 'application/json'));

-- Insert trigger: each trace-to-memory row fires one POST. Recreated so the routing filter stays current.
DROP VIEW IF EXISTS agent_traces.trigger_requests_mv;
CREATE MATERIALIZED VIEW agent_traces.trigger_requests_mv TO agent_traces.guild_webhook AS
SELECT 'api_trigger' AS session_type, CAST(tuple(text), 'Tuple(text String)') AS agent_input
FROM agent_traces.trigger_requests
WHERE agent = 'trace-to-memory';

-- session-retro: same pattern, its own Guild API trigger key (GUILD_TRIGGER_KEY_SESSION_RETRO in guild.env).
-- The detector's context JSON is appended to the text so the agent starts with the precomputed counts.
-- Skipped by `npm run trace:webhook` until that key exists.
CREATE TABLE IF NOT EXISTS agent_traces.guild_webhook_session_retro
(
    session_type String,
    agent_input  Tuple(text String)
)
ENGINE = URL('{{GUILD_URL}}', JSONEachRow,
             headers('Authorization' = 'Basic {{GUILD_AUTH_SESSION_RETRO}}', 'Content-Type' = 'application/json'));

DROP VIEW IF EXISTS agent_traces.trigger_requests_session_retro_mv;
CREATE MATERIALIZED VIEW agent_traces.trigger_requests_session_retro_mv TO agent_traces.guild_webhook_session_retro AS
SELECT 'api_trigger' AS session_type, CAST(tuple(concat(text, ' Context: ', context)), 'Tuple(text String)') AS agent_input
FROM agent_traces.trigger_requests
WHERE agent = 'session-retro';
