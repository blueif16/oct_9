#!/usr/bin/env node
// GitHub Actions entry: send the triggering event to ClickHouse. Fails the job if the insert fails.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { githubRows, ciSemgrepRow } from './lib/github.mjs';
import { createSink } from './lib/sink.mjs';

const { GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, CLICKHOUSE_HOST, CLICKHOUSE_PASSWORD } = process.env;
if (!CLICKHOUSE_HOST || !CLICKHOUSE_PASSWORD) {
  console.log('::notice::ClickHouse secrets not available (e.g. fork PR); skipping trace ingest.');
  process.exit(0);
}
const event = JSON.parse(readFileSync(GITHUB_EVENT_PATH, 'utf8'));
const rows = githubRows(GITHUB_EVENT_NAME, event);
// SEMGREP_RESULTS_DIR/<artifact>/*.json: the finished run's Semgrep results, downloaded by trace-github.yml.
const dir = process.env.SEMGREP_RESULTS_DIR;
if (GITHUB_EVENT_NAME === 'workflow_run' && dir && existsSync(dir)) {
  for (const artifact of readdirSync(dir)) {
    for (const f of readdirSync(join(dir, artifact)).filter((n) => n.endsWith('.json'))) {
      try {
        rows.push(ciSemgrepRow(event.repository?.full_name ?? '', event.workflow_run, artifact, JSON.parse(readFileSync(join(dir, artifact, f), 'utf8'))));
      } catch (err) { console.log(`::warning::skipped ${artifact}/${f}: ${err.message}`); }
    }
  }
}
const sink = createSink({
  config: {
    host: CLICKHOUSE_HOST, port: process.env.CLICKHOUSE_PORT || '8443', user: process.env.CLICKHOUSE_USER || 'default',
    password: CLICKHOUSE_PASSWORD, database: process.env.CLICKHOUSE_DATABASE || 'agent_traces',
  },
  spoolPath: join(tmpdir(), 'trace-spool.jsonl'),
});
const result = await sink.send(rows);
if (result.error) {
  console.error(`::error::trace ingest failed: ${result.error}`);
  process.exit(1);
}
console.log(`sent ${result.sent} ${GITHUB_EVENT_NAME} row(s)`);
