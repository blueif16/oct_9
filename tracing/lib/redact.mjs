const MASK = '[REDACTED]';

// Keys whose string values are always secrets. Anchored so `max_tokens` (a count) is not caught.
const SECRET_KEY = /(^|[_-])(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|authorization|cookie|credentials?)$/i;

const TEXT_RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, MASK],
  [/\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g, MASK],                                  // JWT
  [/\b(?:sk-ant-|sk-)[\w-]{16,}/g, MASK],                                      // Anthropic / OpenAI
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_\w{20,}/g, MASK],  // GitHub
  [/\bAKIA[0-9A-Z]{16}\b/g, MASK],                                             // AWS access key
  [/\bxox[abprs]-[\w-]{10,}/g, MASK],                                          // Slack
  [/\btgr_[A-Za-z0-9]{8,}/g, MASK],                                            // Senso
  [/\b(Bearer|Basic)\s+[\w\-.~+/=]{8,}/gi, `$1 ${MASK}`],
  [/(\b[a-z][\w+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${MASK}@`],               // scheme://user:pass@
  [/((?:^|\s)(?:-u|--user)(?:\s+|=)(["']?)[^\s:"']+:)[^\s"']+/g, `$1${MASK}`],  // curl -u/--user name:pass
  // Header names ending in a secret segment: X-ClickHouse-Key, X-Api-Key, x-auth-token (not Author:, key:).
  [/(\b(?:[\w-]*[-_](?:key|token|secret)|token|secret)\s*:\s*)[^\s"']+/gi, `$1${MASK}`],
  // NAME=value or name: value where the name looks secret-bearing.
  [/(\b\w*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY)\w*\s*[=:]\s*)(["']?)[^\s"']+\2/gi, `$1$2${MASK}$2`],
];

function redactText(s) {
  return TEXT_RULES.reduce((acc, [re, rep]) => acc.replace(re, rep), s);
}

export function redact(value, key = '') {
  if (typeof value === 'string') return SECRET_KEY.test(key) ? MASK : redactText(value);
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  }
  return value;
}
