import { appendFileSync, readFileSync, renameSync, unlinkSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';

const ORPHAN_AGE_MS = 2 * 60 * 1000;

const toLines = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

// Atomically take ownership of the queue so parallel hooks don't send the same rows twice.
// Claimed files are deleted only after a successful send; ones left by a killed process are re-claimed later.
function claimSpool(spoolPath) {
  const files = [];
  const claimed = `${spoolPath}.${process.pid}.${Date.now()}`;
  try { renameSync(spoolPath, claimed); files.push(claimed); } catch {}
  const dir = dirname(spoolPath), prefix = `${basename(spoolPath)}.`;
  let names = [];
  try { names = readdirSync(dir); } catch {}
  for (const name of names) {
    const path = join(dir, name);
    if (!name.startsWith(prefix) || path === claimed) continue;
    try {
      if (Date.now() - statSync(path).mtimeMs < ORPHAN_AGE_MS) continue;
      const mine = `${path}.${process.pid}`;
      renameSync(path, mine);
      files.push(mine);
    } catch {}
  }
  const rows = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  return { rows, release: () => files.forEach((f) => { try { unlinkSync(f); } catch {} }) };
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
      const claim = claimSpool(spoolPath);
      const all = [...claim.rows, ...rows];
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
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${(await res.text()).slice(0, 300)}`);
        claim.release();
        return { sent: all.length };
      } catch (err) {
        spool(all);
        claim.release();
        return { spooled: all.length, error: err.message };
      }
    },
  };
}
