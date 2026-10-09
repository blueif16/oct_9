import { randomUUID } from 'node:crypto';
import { redact } from './redact.mjs';

export const MAX_FIELD = 65536;

const EVENT_TYPES = {
  SessionStart: 'session_start',
  UserPromptSubmit: 'user_prompt',
  PostToolUse: 'tool_call',
  Stop: 'stop',
  SessionEnd: 'session_end',
};

// Fields kept in the payload per hook; everything else in the hook input is dropped.
const PAYLOAD_FIELDS = {
  SessionStart: ['source', 'model'],
  UserPromptSubmit: ['prompt'],
  PostToolUse: ['tool_input', 'tool_response', 'duration_ms'],
  Stop: ['last_assistant_message', 'stop_hook_active'],
  SessionEnd: ['reason'],
};

function truncate(value) {
  if (typeof value === 'string') {
    return value.length > MAX_FIELD ? `${value.slice(0, MAX_FIELD)}[truncated ${value.length - MAX_FIELD} chars]` : value;
  }
  if (Array.isArray(value)) return value.map(truncate);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncate(v)]));
  return value;
}

export function emptySemgrep() {
  return { semgrep_outcome: '', semgrep_findings: 0, semgrep_rules: [], semgrep_severities: [], semgrep_files: [] };
}

// Shared row shape for every event_type, so all sources insert into one table.
export function row(fields, ctx = {}) {
  return {
    event_id: randomUUID(),
    ts: ctx.now ?? new Date().toISOString(),
    agent: '', session_id: '', event_type: '', hook_event: '', tool_name: '', tool_use_id: '',
    model: '', turn_id: '', lesson_id: '', cwd: '',
    repo: ctx.repo ?? '', git_branch: ctx.git_branch ?? '', git_sha: ctx.git_sha ?? '',
    ...emptySemgrep(),
    payload: '{}',
    ...fields,
  };
}

export function toEvent(agent, input, ctx = {}) {
  const hook = input.hook_event_name;
  const eventType = EVENT_TYPES[hook];
  if (!eventType) return null;
  const payload = Object.fromEntries(PAYLOAD_FIELDS[hook].filter((k) => k in input).map((k) => [k, input[k]]));
  return row({
    agent,
    session_id: input.session_id ?? '',
    event_type: eventType,
    hook_event: hook,
    tool_name: input.tool_name ?? '',
    tool_use_id: input.tool_use_id ?? '',
    model: typeof input.model === 'string' ? input.model : '',
    turn_id: input.turn_id ?? '',
    cwd: input.cwd ?? '',
    payload: JSON.stringify(truncate(redact(payload))),
  }, ctx);
}
