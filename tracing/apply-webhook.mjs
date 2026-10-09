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
  GUILD_OWNER: env.GUILD_WORKSPACE_PATH.split('/')[0],
};
const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'webhook.sql'), 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  .replace(/\{\{(\w+)\}\}/g, (_, k) => fill[k]);
for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
  const res = await fetch(`https://${env.CLICKHOUSE_HOST}:${env.CLICKHOUSE_PORT || 8443}/`, {
    method: 'POST', body: stmt,
    headers: { 'X-ClickHouse-User': env.CLICKHOUSE_USER || 'default', 'X-ClickHouse-Key': env.CLICKHOUSE_PASSWORD },
  });
  const name = /(TABLE|VIEW)(?: IF (?:NOT )?EXISTS)? (\S+)/.exec(stmt)?.[2];
  if (!res.ok) { console.error(`Failed on ${name}:\n${(await res.text()).replaceAll(fill.GUILD_AUTH, '[REDACTED]')}`); process.exit(1); }
  console.log(`ok: ${name}`);
}
