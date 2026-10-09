import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../lib/redact.mjs';

// Fake secrets are assembled at runtime so secret scanners don't flag this file.
const jwt = ['eyJhbGciOiJSUzI1NiJ9', 'eyJzdWIiOiIxOTI4MjEifQ', 'qUZ8x889r7P6Ms9atsUEz_iv5lN1q'].join('.');
const ghToken = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
const anthropicKey = 'sk-' + 'ant-api03-' + 'Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2';
const awsKey = 'AKIA' + 'IOSFODNN7EXAMPLE';
const sensoKey = 'tgr_' + 'XrAq9fK2mP7wQ1zL';

test('replaces string values under secret-named keys', () => {
  const out = redact({ refresh_token: 'Vu5Geavf28SQ3sQP0wrEF5G2h', password: 'hunter2', user: 'tk' });
  assert.equal(out.refresh_token, '[REDACTED]');
  assert.equal(out.password, '[REDACTED]');
  assert.equal(out.user, 'tk');
});

test('keeps numeric token counts under keys like max_tokens', () => {
  assert.deepEqual(redact({ max_tokens: 4096, input_tokens: 12 }), { max_tokens: 4096, input_tokens: 12 });
});

test('redacts known token formats inside free text', () => {
  for (const secret of [jwt, ghToken, anthropicKey, awsKey, sensoKey]) {
    const out = redact(`output: ${secret} done`);
    assert.ok(!out.includes(secret), `leaked ${secret.slice(0, 6)}…`);
    assert.ok(out.startsWith('output: ') && out.endsWith(' done'), 'surrounding text must survive');
  }
});

test('redacts the value of KEY=value and key: value assignments but keeps the name', () => {
  const out = redact('export SEMGREP_APP_TOKEN=abc123secret\n    access_token: zzzsecretzzz');
  assert.ok(!out.includes('abc123secret') && !out.includes('zzzsecretzzz'));
  assert.ok(out.includes('SEMGREP_APP_TOKEN=') && out.includes('access_token:'));
});

test('redacts Bearer authorization headers', () => {
  const out = redact('curl -H "Authorization: Bearer abcdef0123456789xyz" https://x.dev');
  assert.ok(!out.includes('abcdef0123456789xyz'));
});

test('redacts passwords embedded in URLs', () => {
  const out = redact('git clone https://bob:s3cretpw@github.com/a/b.git');
  assert.ok(!out.includes('s3cretpw'));
  assert.ok(out.includes('github.com/a/b.git'));
});

test('redacts PEM private key blocks', () => {
  const pem = '-----BEGIN ' + 'PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END ' + 'PRIVATE KEY-----';
  assert.ok(!redact(`key:\n${pem}`).includes('MIIEvQIBADANBg'));
});

test('walks nested objects and arrays without mutating the input', () => {
  const input = { tool_input: { command: `echo ${ghToken}` }, list: [{ api_key: 'k-123' }] };
  const out = redact(input);
  assert.ok(!JSON.stringify(out).includes(ghToken));
  assert.equal(out.list[0].api_key, '[REDACTED]');
  assert.equal(input.list[0].api_key, 'k-123');
});

test('leaves ordinary code and text unchanged', () => {
  const code = 'const total = items.reduce((a, b) => a + b, 0);\nreturn subprocess.call(["ls", path])';
  assert.equal(redact(code), code);
});

test('redacts the password in curl basic-auth flags', () => {
  for (const cmd of ["curl --user 'default:ybC~fakePw0' https://h:8443", 'curl -u default:ybC~fakePw0 https://h', 'curl --user="admin:ybC~fakePw0" x']) {
    const out = redact(cmd);
    assert.ok(!out.includes('ybC~fakePw0'), cmd);
    assert.ok(out.includes('default:') || out.includes('admin:'), 'username stays readable');
  }
});

test('redacts values of key-bearing HTTP headers like X-ClickHouse-Key', () => {
  for (const h of ['-H "X-ClickHouse-Key: fakeKeyValue1"', "-H 'X-Api-Key: fakeKeyValue1'", 'x-auth-token: fakeKeyValue1']) {
    assert.ok(!redact(h).includes('fakeKeyValue1'), h);
  }
});

test('keeps ordinary "name: value" lines such as git author headers', () => {
  for (const s of ['Author: Bob <bob@x.dev>', 'sorted by key: name', 'monkey: banana']) assert.equal(redact(s), s);
});

test('redacts Guild API trigger keys', () => {
  const key = '01a12269-4dda-7499-0000-000000000000:' + 'gldt_' + 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
  const out = redact(`here is the key ${key} thanks`);
  assert.ok(!out.includes('gldt_AbCdEf'));
  assert.ok(out.endsWith(' thanks'));
});
