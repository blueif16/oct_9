// FIXTURE (synthetic, demo beat B2): deliberately violates .semgrep/rules/trace-payload-must-be-redacted.
// It sends a tool input to the trace row without redact(), so `semgrep/repo-rules` must fail this PR.
export function toTraceRow(input) {
  return { event_type: 'tool_call', payload: JSON.stringify(input) };
}
