#!/usr/bin/env node
// Trace hook entry. Usage:
//   node tracing/hook.mjs claude|codex            (hook; reads the hook JSON on stdin)
//   node tracing/hook.mjs context-injected --lesson-id ID [--session ID] [--agent claude]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toEvent, row } from './lib/events.mjs';
import { extractSemgrep } from './lib/semgrep.mjs';
import { createSink } from './lib/sink.mjs';

const ROOT = process.env.CLAUDE_PROJECT_DIR || join(dirname(fileURLToPath(import.meta.url)), '..');
const TRACE_DIR = process.env.TRACE_DIR || join(ROOT, '.trace');
const CONFIG_FILE = process.env.TRACE_CONFIG || join(homedir(), '.config', 'oct9', 'clickhouse.env');

function loadConfig() {
  const env = { ...process.env };
  if (existsSync(CONFIG_FILE)) {
    for (const line of readFileSync(CONFIG_FILE, 'utf8').split('\n')) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !env[m[1]]) env[m[1]] = m[2];
    }
  }
  if (!env.CLICKHOUSE_HOST || !env.CLICKHOUSE_PASSWORD) return null;
  return {
    host: env.CLICKHOUSE_HOST, port: env.CLICKHOUSE_PORT || '8443', user: env.CLICKHOUSE_USER || 'default',
    password: env.CLICKHOUSE_PASSWORD, database: env.CLICKHOUSE_DATABASE || 'agent_traces',
  };
}

function git(args, cwd) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
}

function gitContext(cwd) {
  const remote = git(['remote', 'get-url', 'origin'], cwd);
  return {
    repo: /[:/]([^/:]+\/[^/]+?)(\.git)?$/.exec(remote)?.[1] ?? '',
    git_branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
    git_sha: git(['rev-parse', 'HEAD'], cwd),
  };
}

// Read only the transcript bytes added since the last hook for this session.
function newTranscriptRecords(sessionId, transcriptPath) {
  if (!sessionId || !transcriptPath || !existsSync(transcriptPath)) return [];
  const offsetFile = join(TRACE_DIR, 'offsets', sessionId.replace(/[^\w-]/g, '_'));
  const start = existsSync(offsetFile) ? Number(readFileSync(offsetFile, 'utf8')) || 0 : 0;
  const size = statSync(transcriptPath).size;
  if (size <= start) return [];
  const buf = Buffer.alloc(size - start);
  const fd = openSync(transcriptPath, 'r');
  readSync(fd, buf, 0, buf.length, start);
  closeSync(fd);
  const text = buf.toString('utf8');
  const complete = text.slice(0, text.lastIndexOf('\n') + 1); // leave a half-written last line for next time
  mkdirSync(dirname(offsetFile), { recursive: true });
  writeFileSync(offsetFile, String(start + Buffer.byteLength(complete)));
  return complete.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const mode = process.argv[2];
  const sink = createSink({ config: loadConfig(), spoolPath: join(TRACE_DIR, 'spool.jsonl') });

  if (mode === 'context-injected') {
    const agent = arg('--agent') || 'claude';
    const session = arg('--session') || process.env.CLAUDE_CODE_SESSION_ID || '';
    const ctx = gitContext(process.cwd());
    await sink.send([row({ agent, session_id: session, event_type: 'context_injected', lesson_id: arg('--lesson-id') || '' }, ctx)]);
    return;
  }

  if (mode !== 'claude' && mode !== 'codex') return;
  const input = JSON.parse(readStdin() || '{}');
  const ctx = gitContext(input.cwd || ROOT);
  const rows = [];
  const ev = toEvent(mode, input, ctx);
  if (ev) rows.push(ev);
  // Guardian's result lands in the Claude transcript after its hook finishes, so each hook collects what's new.
  if (mode === 'claude') rows.push(...extractSemgrep(newTranscriptRecords(input.session_id, input.transcript_path), ctx));
  if (rows.length) await sink.send(rows);
}

// A tracing failure must never block or fail the agent.
main().catch((err) => {
  try {
    mkdirSync(TRACE_DIR, { recursive: true });
    writeFileSync(join(TRACE_DIR, 'last-error.txt'), `${new Date().toISOString()} ${err.stack}\n`);
  } catch {}
}).finally(() => process.exit(0));
