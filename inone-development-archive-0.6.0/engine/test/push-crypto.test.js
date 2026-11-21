import { randomBytes } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptPushFid, decryptPushPayload, encryptPushFid, encryptPushPayload, parsePushEncryptionKey,
} from '../src/push-crypto.js';

test('push encryption key accepts exactly 32 bytes in canonical hex or base64', () => {
  const key = randomBytes(32);
  assert.deepEqual(parsePushEncryptionKey(key.toString('hex')), key);
  assert.deepEqual(parsePushEncryptionKey(key.toString('base64')), key);
  assert.throws(() => parsePushEncryptionKey('too-short'), /valid base64/);
  assert.throws(() => parsePushEncryptionKey(Buffer.alloc(16).toString('base64')), /exactly 32 bytes/);
});

test('FID is AES-256-GCM encrypted with per-device AAD and fresh nonce', () => {
  const key = randomBytes(32);
  const fid = 'AbCdEf0123456789_-AbCd';
  const first = encryptPushFid(fid, 'user-1|device-1', key);
  const second = encryptPushFid(fid, 'user-1|device-1', key);
  assert.equal(first.identifierKind, 'fid');
  assert.equal(first.tokenCiphertext.equals(Buffer.from(fid)), false);
  assert.equal(first.tokenIv.equals(second.tokenIv), false);
  assert.equal(decryptPushFid({
    token_ciphertext: first.tokenCiphertext, token_iv: first.tokenIv, token_tag: first.tokenTag,
  }, 'user-1|device-1', key), fid);
  assert.throws(() => decryptPushFid({
    token_ciphertext: first.tokenCiphertext, token_iv: first.tokenIv, token_tag: first.tokenTag,
  }, 'user-1|other-device', key));
});

test('push payload is encrypted and authenticated to its idempotency key', () => {
  const key = randomBytes(32);
  const idempotencyKey = randomBytes(32).toString('hex');
  const payload = { type: 'message', event_id: '$17', path: '/rooms/room/events/%2417' };
  const encrypted = encryptPushPayload(payload, idempotencyKey, key);
  const stored = Buffer.concat([encrypted.payloadCiphertext, encrypted.payloadIv, encrypted.payloadTag]);
  assert.equal(stored.includes(Buffer.from(payload.path)), false);
  assert.deepEqual(decryptPushPayload({
    idempotency_key: idempotencyKey,
    payload_ciphertext: encrypted.payloadCiphertext,
    payload_iv: encrypted.payloadIv,
    payload_tag: encrypted.payloadTag,
  }, key), payload);
  assert.throws(() => decryptPushPayload({
    idempotency_key: randomBytes(32).toString('hex'),
    payload_ciphertext: encrypted.payloadCiphertext,
    payload_iv: encrypted.payloadIv,
    payload_tag: encrypted.payloadTag,
  }, key));
});
