// Fixture for trace-payload-must-be-redacted (synthetic; run with `semgrep --test .semgrep/rules`).
import { redact } from '../../tracing/lib/redact.mjs';

const input = { tool_input: { command: 'echo $CLICKHOUSE_PASSWORD' } };

// ruleid: trace-payload-must-be-redacted
const leaked = { event_type: 'tool_call', payload: JSON.stringify(input) };

// ruleid: trace-payload-must-be-redacted
push({ ...base, payload: JSON.stringify({ report: input.tool_input }) });

// ok: trace-payload-must-be-redacted
const safe = { event_type: 'tool_call', payload: JSON.stringify(redact(input)) };

// ok: trace-payload-must-be-redacted
const truncated = { payload: JSON.stringify(truncate(redact(input))) };

// ok: trace-payload-must-be-redacted
const empty = { payload: '{}' };

// ok: trace-payload-must-be-redacted
const unrelated = { body: JSON.stringify(input) };
