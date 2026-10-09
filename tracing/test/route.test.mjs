import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFromCommit, routeFor, routeEscalation } from '../lib/route.mjs';

const NOW = Date.parse('2026-10-09T21:00:00Z');

test('reads the agent and session from the Agent-Session trailer', () => {
  assert.deepEqual(sessionFromCommit('fix: x\n\nAgent-Session: claude:abc-123\n'), { agent: 'claude', id: 'abc-123' });
});

test('a commit without a trailer has no session', () => {
  assert.equal(sessionFromCommit('fix: x'), null);
});

test('a session id that is not a plain id is rejected', () => {
  assert.equal(sessionFromCommit("Agent-Session: claude:x';DROP"), null);
});

test('a session with a recent event and no session_end is live', () => {
  assert.equal(routeFor({ last: '2026-10-09 20:55:00', ended: 0 }, NOW), 'session');
});

test('a session whose last event is older than 10 minutes is not live', () => {
  assert.equal(routeFor({ last: '2026-10-09 20:49:59', ended: 0 }, NOW), 'guild');
});

test('a session that ended is not live even if its last event is recent', () => {
  assert.equal(routeFor({ last: '2026-10-09 20:59:00', ended: 1 }, NOW), 'guild');
});

test('a session with no events is not live', () => {
  assert.equal(routeFor({ last: null, ended: 0 }, NOW), 'guild');
});

test('routes to the live session, querying ClickHouse by parameter', async () => {
  let seen;
  const query = async (sql, params) => { seen = { sql, params }; return { last: '2026-10-09 20:58:00', ended: 0 }; };
  const owner = await routeEscalation({ message: 'Agent-Session: claude:abc-123', query, now: NOW });
  assert.equal(owner, 'session:abc-123');
  assert.equal(seen.params.sid, 'abc-123');
  assert.doesNotMatch(seen.sql, /abc-123/);
});

test('routes to guild when the commit has no session, without querying', async () => {
  const query = async () => { throw new Error('should not query'); };
  assert.equal(await routeEscalation({ message: 'fix: x', query, now: NOW }), 'guild');
});

test('routes to guild when ClickHouse fails, so someone always asks', async () => {
  const query = async () => { throw new Error('ClickHouse 500'); };
  assert.equal(await routeEscalation({ message: 'Agent-Session: claude:abc-123', query, now: NOW }), 'guild');
});
