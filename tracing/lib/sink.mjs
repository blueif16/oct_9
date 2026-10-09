import { appendFileSync, readFileSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const toLines = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

// Atomically take ownership of the current queue so parallel hooks don't send the same rows twice.
function claimSpool(spoolPath) {
  const claimed = `${spoolPath}.${process.pid}.${Date.now()}`;
  try {
    renameSync(spoolPath, claimed);
  } catch {
    return [];
  }
  const rows = readFileSync(claimed, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  unlinkSync(claimed);
  return rows;
}

export function createSink({ config, spoolPath, fetch = globalThis.fetch }) {
  const spool = (rows) => {
    if (!rows.length) return;
    mkdirSync(dirname(spoolPath), { recursive: true });
    appendFileSync(spoolPath, toLines(rows), { mode: 0o600 });
  };

  return {
    async send(rows) {
      if (!config) {
        spool(rows);
        return { spooled: rows.length };
      }
      const all = [...claimSpool(spoolPath), ...rows];
      if (!all.length) return { sent: 0 };
      const url = new URL(`https://${config.host}:${config.port}/`);
      url.searchParams.set('query', `INSERT INTO ${config.database}.events FORMAT JSONEachRow`);
      url.searchParams.set('date_time_input_format', 'best_effort');
      url.searchParams.set('async_insert', '1');
      url.searchParams.set('wait_for_async_insert', '1');
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'X-ClickHouse-User': config.user, 'X-ClickHouse-Key': config.password, 'Content-Type': 'application/x-ndjson' },
          body: toLines(all),
        });
        if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${(await res.text()).slice(0, 300)}`);
        return { sent: all.length };
      } catch (err) {
        spool(all);
        return { spooled: all.length, error: err.message };
      }
    },
  };
}
