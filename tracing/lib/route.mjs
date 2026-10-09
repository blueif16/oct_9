// Decides who asks the human about a stuck PR (policies/pr-decision/POLICY.md §1):
// the coding session that pushed the head commit if it is still live, otherwise the Guild agent.
import { TRAILER } from './github.mjs';

const LIVE_WINDOW_MS = 10 * 60 * 1000;
const SESSION_ID = /^[\w-]+$/;

export const LIVENESS_SQL = "SELECT toString(max(ts)) AS last, countIf(event_type = 'session_end') AS ended, count() AS n FROM agent_traces.events FINAL WHERE session_id = {sid:String} AND event_type NOT IN ('github_push', 'github_pr', 'github_ci') LIMIT 1";

export function sessionFromCommit(message) {
  const t = TRAILER.exec(message ?? '');
  return t && SESSION_ID.test(t[2]) ? { agent: t[1], id: t[2] } : null;
}

// stats.last is ClickHouse's UTC 'YYYY-MM-DD HH:MM:SS', or null when the session has no events.
export function routeFor({ last, ended }, now = Date.now()) {
  if (!last || ended > 0) return 'guild';
  return now - Date.parse(`${last.replace(' ', 'T')}Z`) <= LIVE_WINDOW_MS ? 'session' : 'guild';
}

// Any failure routes to guild, so a stuck PR always gets a question.
export async function routeEscalation({ message, query, now = Date.now() }) {
  const session = sessionFromCommit(message);
  if (!session) return 'guild';
  try {
    return routeFor(await query(LIVENESS_SQL, { sid: session.id }), now) === 'session' ? `session:${session.id}` : 'guild';
  } catch {
    return 'guild';
  }
}
