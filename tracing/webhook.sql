-- ClickHouse → Guild webhook. Any row inserted into trigger_requests is POSTed to the
-- trace-to-memory agent's API trigger (one row per INSERT = one agent run).
-- {{GUILD_URL}} / {{GUILD_AUTH}} are filled from ~/.config/oct9/guild.env by `npm run trace:webhook`.

CREATE TABLE IF NOT EXISTS agent_traces.trigger_requests
(
    requested_at    DateTime64(3, 'UTC') DEFAULT now64(3),
    source          LowCardinality(String),   -- manual | tool_calls
    text            String,                   -- agent input, e.g. "Run rule lessons-from-failures since …"
    tool_call_count UInt64 DEFAULT 0
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

-- Insert trigger: each trigger_requests row fires one POST.
CREATE MATERIALIZED VIEW IF NOT EXISTS agent_traces.trigger_requests_mv TO agent_traces.guild_webhook AS
SELECT 'api_trigger' AS session_type, CAST(tuple(text), 'Tuple(text String)') AS agent_input
FROM agent_traces.trigger_requests;
