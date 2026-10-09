#!/usr/bin/env node
// Create the ClickHouse → Guild webhook objects. Usage: npm run trace:webhook
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const loadEnv = (file) => Object.fromEntries(existsSync(file)
  ? readFileSync(file, 'utf8').split('\n').map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2]])
  : []);
const cfg = join(homedir(), '.config', 'oct9');
const env = { ...loadEnv(join(cfg, 'clickhouse.env')), ...loadEnv(join(cfg, 'guild.env')), ...process.env };
for (const k of ['CLICKHOUSE_HOST', 'CLICKHOUSE_PASSWORD', 'GUILD_TRIGGER_KEY', 'GUILD_WORKSPACE_PATH']) {
  if (!env[k]) { console.error(`Missing ${k} (looked in ${cfg}).`); process.exit(1); }
}
const fill = {
  GUILD_URL: `https://api.guild.ai/v1/workspaces/${env.GUILD_WORKSPACE_PATH}/sessions`,
  GUILD_AUTH: Buffer.from(env.GUILD_TRIGGER_KEY).toString('base64'),
};
// Per-agent keys: GUILD_TRIGGER_KEY_<AGENT> fills {{GUILD_AUTH_<AGENT>}}.
for (const [k, v] of Object.entries(env)) {
  const m = /^GUILD_TRIGGER_KEY_(\w+)$/.exec(k);
  if (m && v) fill[`GUILD_AUTH_${m[1]}`] = Buffer.from(v).toString('base64');
}
const secrets = Object.entries(fill).filter(([k]) => k.startsWith('GUILD_AUTH')).map(([, v]) => v);
const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'webhook.sql'), 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
// An agent without a key is skipped whole: its URL table and every view that writes to it. A view whose
// target table is missing would make every INSERT into trigger_requests fail.
const skippedTables = [];
for (const tmpl of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
  const missing = [...tmpl.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).filter((k) => !fill[k]);
  if (missing.length) skippedTables.push(/TABLE(?: IF NOT EXISTS)? (\S+)/.exec(tmpl)?.[1]);
  if (missing.length || skippedTables.some((t) => t && new RegExp(`\\b${t.replace('.', '\\.')}\\b`).test(tmpl.replace(/TABLE(?: IF NOT EXISTS)? \S+/, '')))) {
    console.log(`skipped (no ${missing.join(', ') || 'key for its webhook'}): ${tmpl.split('\n')[0].slice(0, 70)}`); continue;
  }
  const stmt = tmpl.replace(/\{\{(\w+)\}\}/g, (_, k) => fill[k]);
  const res = await fetch(`https://${env.CLICKHOUSE_HOST}:${env.CLICKHOUSE_PORT || 8443}/`, {
    method: 'POST', body: stmt,
    headers: { 'X-ClickHouse-User': env.CLICKHOUSE_USER || 'default', 'X-ClickHouse-Key': env.CLICKHOUSE_PASSWORD },
  });
  const name = /(TABLE|VIEW)(?: IF (?:NOT )?EXISTS)? (\S+)/.exec(stmt)?.[2];
  if (!res.ok) { console.error(`Failed on ${name}:\n${secrets.reduce((s, v) => s.replaceAll(v, '[REDACTED]'), await res.text())}`); process.exit(1); }
  console.log(`ok: ${name}`);
}
