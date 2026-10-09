import { redact } from './redact.mjs';

// Guardian registers `"${CLAUDE_PLUGIN_ROOT}/scripts/hook" auto <Event>`; our own hooks never match this.
const GUARDIAN_CMD = /\/scripts\/hook"? auto (\w+)/;
const RULE_LINE = /^\s+\[(ERROR|WARNING|INFO)\] (\S+)/;
const FILE_LINE = /^\S.*$/;

function parseReport(text) {
  const findings = Number(/found (\d+) issues?/i.exec(text)?.[1] ?? 0);
  const rules = [], severities = [], files = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const rule = RULE_LINE.exec(line);
    if (rule) { severities.push(rule[1]); rules.push(rule[2]); return; }
    // A file name is an unindented line that follows a blank line (the header is line 0).
    if (i > 0 && lines[i - 1] === '' && FILE_LINE.test(line)) files.push(line.trim());
  });
  return { findings, rules, severities, files };
}

function parseSummary(stdout) {
  let msg = '';
  try { msg = JSON.parse(stdout).systemMessage ?? ''; } catch { return null; }
  const m = /(\d+) scans? .*?(\d+) files?, (\d+) findings?/.exec(msg);
  return m ? { message: msg, totals: { scans: +m[1], files: +m[2], findings: +m[3] } } : null;
}

function base(rec, a, eventType) {
  return {
    ts: rec.timestamp,
    session_id: rec.sessionId ?? '',
    event_type: eventType,
    tool_use_id: a.toolUseID ?? '',
    hook_event: a.hookEvent ?? '',
  };
}

export function extractSemgrep(records) {
  const out = [];
  for (const rec of records) {
    const a = rec?.type === 'attachment' ? rec.attachment : null;
    if (!a) continue;
    const command = a.command ?? a.blockingError?.command ?? '';
    const event = GUARDIAN_CMD.exec(command)?.[1];
    if (!event) continue;

    if (event === 'PostToolUse' && a.type === 'hook_blocking_error') {
      const report = a.blockingError.blockingError ?? '';
      const p = parseReport(report);
      out.push({
        ...base(rec, a, 'semgrep_scan'),
        semgrep_outcome: 'findings', semgrep_findings: p.findings,
        semgrep_rules: p.rules, semgrep_severities: p.severities, semgrep_files: p.files,
        payload: JSON.stringify(redact({ report, hook_name: a.hookName })),
      });
    } else if (event === 'PostToolUse' && a.type === 'hook_success') {
      out.push({
        ...base(rec, a, 'semgrep_scan'),
        semgrep_outcome: 'no_findings', semgrep_findings: 0,
        semgrep_rules: [], semgrep_severities: [], semgrep_files: [],
        payload: JSON.stringify({ hook_name: a.hookName, duration_ms: a.durationMs ?? null }),
      });
    } else if (event === 'Stop' && a.type === 'hook_success') {
      const s = parseSummary(a.stdout ?? '');
      if (s) out.push({ ...base(rec, a, 'semgrep_summary'), payload: JSON.stringify(s) });
    }
  }
  return out;
}
