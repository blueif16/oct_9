import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSink } from '../lib/sink.mjs';

const config = { host: 'abc.us-west-2.aws.clickhouse.cloud', port: '8443', user: 'default', password: 'pw', database: 'agent_traces' };
const spoolIn = () => join(mkdtempSync(join(tmpdir(), 'sink-')), 'spool.jsonl');
const spooled = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []);

function fakeFetch(status = 200) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url: new URL(url), init }); return { ok: status < 300, status, text: async () => '' }; };
  fn.calls = calls;
  return fn;
}

test('without ClickHouse config, rows are queued locally and nothing is sent', async () => {
  const spoolPath = spoolIn();
  const fetch = fakeFetch();
  await createSink({ config: null, spoolPath, fetch }).send([{ event_id: 'a' }]);
  assert.equal(fetch.calls.length, 0);
  assert.deepEqual(spooled(spoolPath), [{ event_id: 'a' }]);
});

test('sends rows as JSONEachRow to the events table over HTTPS with auth headers', async () => {
  const fetch = fakeFetch();
  await createSink({ config, spoolPath: spoolIn(), fetch }).send([{ event_id: 'a' }, { event_id: 'b' }]);
  const { url, init } = fetch.calls[0];
  assert.equal(url.origin, 'https://abc.us-west-2.aws.clickhouse.cloud:8443');
  assert.equal(url.searchParams.get('query'), 'INSERT INTO agent_traces.events FORMAT JSONEachRow');
  assert.equal(url.searchParams.get('date_time_input_format'), 'best_effort');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['X-ClickHouse-User'], 'default');
  assert.equal(init.headers['X-ClickHouse-Key'], 'pw');
  assert.deepEqual(init.body.split('\n').filter(Boolean).map(JSON.parse), [{ event_id: 'a' }, { event_id: 'b' }]);
  assert.ok(!url.toString().includes('pw'), 'password must not be in the URL');
});

test('a successful send also flushes previously queued rows and empties the queue', async () => {
  const spoolPath = spoolIn();
  await createSink({ config: null, spoolPath, fetch: fakeFetch() }).send([{ event_id: 'old' }]);
  const fetch = fakeFetch();
  await createSink({ config, spoolPath, fetch }).send([{ event_id: 'new' }]);
  assert.deepEqual(fetch.calls[0].init.body.split('\n').filter(Boolean).map(JSON.parse).map((r) => r.event_id).sort(), ['new', 'old']);
  assert.deepEqual(spooled(spoolPath), []);
});

test('an HTTP error keeps every row (old and new) in the queue', async () => {
  const spoolPath = spoolIn();
  await createSink({ config: null, spoolPath, fetch: fakeFetch() }).send([{ event_id: 'old' }]);
  await createSink({ config, spoolPath, fetch: fakeFetch(500) }).send([{ event_id: 'new' }]);
  assert.deepEqual(spooled(spoolPath).map((r) => r.event_id).sort(), ['new', 'old']);
});

test('a network failure keeps the rows in the queue instead of throwing', async () => {
  const spoolPath = spoolIn();
  const fetch = async () => { throw new Error('ENOTFOUND'); };
  await createSink({ config, spoolPath, fetch }).send([{ event_id: 'x' }]);
  assert.deepEqual(spooled(spoolPath), [{ event_id: 'x' }]);
});
