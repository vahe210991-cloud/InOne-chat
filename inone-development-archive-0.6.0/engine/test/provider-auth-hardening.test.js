import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { createProviderVerifier, fetchProviderKeys } from '../src/provider-auth.js';

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'known-key', alg: 'RS256', use: 'sig' };
const keySet = { keys: [jwk] };
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(claims, kid = 'known-key') {
  const header = b64({ alg: 'RS256', kid, typ: 'JWT' });
  const payload = b64(claims);
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(pair.privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}
const claims = (nonce, extra = {}) => ({
  iss: 'https://accounts.google.com',
  aud: 'inone-client',
  sub: 'provider-user',
  email: 'user@example.test',
  email_verified: true,
  nonce,
  exp: Math.floor(Date.now() / 1000) + 600,
  ...extra,
});

test('JWKS fetch enforces provider URL, JSON content type, response size and shape', async () => {
  const response = new Response(JSON.stringify(keySet), { headers: { 'content-type': 'application/json' } });
  const result = await fetchProviderKeys('google', { fetchImpl: async () => response });
  assert.equal(result.keys[0].kid, 'known-key');
  await assert.rejects(
    fetchProviderKeys('google', { fetchImpl: async () => new Response('{}', { headers: { 'content-type': 'text/plain' } }) }),
    /content type/,
  );
  await assert.rejects(
    fetchProviderKeys('google', { fetchImpl: async () => new Response(JSON.stringify(keySet), { headers: { 'content-type': 'application/json' } }), maxBytes: 8 }),
    /too large/,
  );
  await assert.rejects(
    fetchProviderKeys('google', { fetchImpl: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }) }),
    /shape/,
  );
  await assert.rejects(fetchProviderKeys('unknown'), /not supported/);
});

test('JWKS fetch aborts a stalled provider request at the configured timeout', async () => {
  await assert.rejects(
    fetchProviderKeys('google', {
      timeoutMs: 10,
      fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    }),
    /timeout/,
  );
});

test('provider key refresh is coalesced and unknown kid refresh is cooldown-limited', async () => {
  let calls = 0;
  const verifier = createProviderVerifier({
    providers: { google: { clientIds: ['inone-client'] } },
    keysSource: async () => {
      calls += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return keySet;
    },
    nowMs: () => Date.now(),
  });
  const nonce = 'issued-nonce';
  assert.equal((await verifier('google', token(claims(nonce)), nonce)).ok, true);
  assert.equal(calls, 1, 'initial key load');

  const unknown = token(claims(nonce), 'unknown-key');
  const results = await Promise.all(Array.from({ length: 12 }, () => verifier('google', unknown, nonce)));
  assert.ok(results.every((result) => !result.ok && result.reason === 'kid'));
  assert.equal(calls, 2, 'parallel unknown-kid requests cause only one refresh');

  await verifier('google', unknown, nonce);
  assert.equal(calls, 2, 'unknown-kid refresh cooldown prevents repeated fetches');
});

test('provider token with a future nbf claim is rejected', async () => {
  const verifier = createProviderVerifier({
    providers: { google: { clientIds: ['inone-client'] } },
    keysSource: async () => keySet,
    nowMs: () => Date.now(),
  });
  const nonce = 'issued-nonce';
  const result = await verifier('google', token(claims(nonce, { nbf: Math.floor(Date.now() / 1000) + 120 })), nonce);
  assert.deepEqual(result, { ok: false, reason: 'not-yet-valid' });
});
