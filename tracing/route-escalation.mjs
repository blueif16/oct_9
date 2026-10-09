#!/usr/bin/env node
// GitHub Actions entry: print who asks the human about a stuck PR (`owner=session:<id>` or `owner=guild`)
// and write it to $GITHUB_OUTPUT. Reads the head commit message from HEAD_COMMIT_MESSAGE.
import { appendFileSync } from 'node:fs';
import { routeEscalation } from './lib/route.mjs';

const { HEAD_COMMIT_MESSAGE, CLICKHOUSE_HOST, CLICKHOUSE_PASSWORD, GITHUB_OUTPUT } = process.env;

async function query(sql, params) {
  if (!CLICKHOUSE_HOST || !CLICKHOUSE_PASSWORD) throw new Error('ClickHouse secrets not available');
  const url = new URL(`https://${CLICKHOUSE_HOST}:${process.env.CLICKHOUSE_PORT || '8443'}/`);
  url.searchParams.set('default_format', 'JSONEachRow');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(`param_${k}`, v);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-ClickHouse-User': process.env.CLICKHOUSE_USER || 'default', 'X-ClickHouse-Key': CLICKHOUSE_PASSWORD },
    body: sql,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`ClickHouse ${res.status}`);
  const row = JSON.parse((await res.text()).trim() || '{}');
  return { last: Number(row.n) > 0 ? row.last : null, ended: Number(row.ended) || 0 };
}

const owner = await routeEscalation({ message: HEAD_COMMIT_MESSAGE, query });
console.log(`owner=${owner}`);
if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `owner=${owner}\n`);
