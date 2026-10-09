// FIXTURE (synthetic, demo beat B6): the B2 violation of .semgrep/rules/trace-payload-must-be-redacted, fixed.
// The tool input now passes through redact() before it reaches the trace row.
import { redact } from '../../tracing/lib/redact.mjs';

export function toTraceRow(input) {
  return { event_type: 'tool_call', payload: JSON.stringify(redact(input)) };
}
