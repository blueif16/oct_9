#!/usr/bin/env node
// One-time setup: create the agent_traces database and events table. Usage: npm run trace:schema
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = process.env.TRACE_CONFIG || join(homedir(), '.config', 'oct9', 'clickhouse.env');
const env = { ...process.env };
if (existsSync(file)) for (const l of readFileSync(file, 'utf8').split('\n')) { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m && !env[m[1]]) env[m[1]] = m[2]; }
if (!env.CLICKHOUSE_HOST || !env.CLICKHOUSE_PASSWORD) { console.error(`No ClickHouse credentials (looked in ${file}).`); process.exit(1); }

const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
  const res = await fetch(`https://${env.CLICKHOUSE_HOST}:${env.CLICKHOUSE_PORT || 8443}/`, {
    method: 'POST', body: stmt,
    headers: { 'X-ClickHouse-User': env.CLICKHOUSE_USER || 'default', 'X-ClickHouse-Key': env.CLICKHOUSE_PASSWORD },
  });
  if (!res.ok) { console.error(`Failed: ${stmt.slice(0, 60)}…\n${await res.text()}`); process.exit(1); }
  console.log(`ok: ${stmt.split('\n')[0].slice(0, 70)}`);
}
