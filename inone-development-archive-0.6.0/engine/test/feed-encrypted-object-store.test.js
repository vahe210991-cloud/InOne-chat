import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { createMemoryObjectStore } from '../src/object-store.js';
import { createEncryptedFeedObjectStore } from '../src/feed-encrypted-object-store.js';

const OBJECT_A = 'a'.repeat(32);
const OBJECT_B = 'b'.repeat(32);
const OLD_KEY = Buffer.alloc(32, 0x11);
const NEW_KEY = Buffer.alloc(32, 0x22);

function provider(activeKeyId = 'k1', keys = { k1: OLD_KEY }) {
  return {
    activeKeyId,
    getKey(keyId) {
      return keys[keyId] ? Buffer.from(keys[keyId]) : null;
    },
  };
}

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test('Feed object store encrypts at rest and streams authenticated plaintext on read', async () => {
  const rawStore = createMemoryObjectStore();
  const encrypted = createEncryptedFeedObjectStore(rawStore, provider(), { chunkBytes: 16 * 1024 });
  const plain = Buffer.from('visual-media-payload-'.repeat(5000));
  await encrypted.putStream(OBJECT_A, Readable.from([
    plain.subarray(0, 7777),
    plain.subarray(7777, 33000),
    plain.subarray(33000),
  ]));

  const stored = await rawStore.get(OBJECT_A);
  assert.ok(stored);
  assert.notDeepEqual(stored, plain);
  assert.equal(stored.subarray(0, 8).toString('ascii'), 'INONEF01');
  assert.deepEqual(await collect(await encrypted.getStream(OBJECT_A)), plain);
  assert.deepEqual(await encrypted.get(OBJECT_A), plain);
});

test('Feed object encryption authenticates object key, wrapped DEK and every chunk', async () => {
  const rawStore = createMemoryObjectStore();
  const encrypted = createEncryptedFeedObjectStore(rawStore, provider(), { chunkBytes: 16 * 1024 });
  const plain = Buffer.alloc(40_000, 0x5a);
  await encrypted.put(OBJECT_A, plain);
  const original = await rawStore.get(OBJECT_A);

  await rawStore.put(OBJECT_B, original);
  await assert.rejects(() => encrypted.get(OBJECT_B));

  const corrupted = Buffer.from(original);
  corrupted[100] ^= 0x01;
  await rawStore.put(OBJECT_A, corrupted);
  await assert.rejects(() => encrypted.get(OBJECT_A));

  await rawStore.put(OBJECT_A, original.subarray(0, original.length - 3));
  await assert.rejects(() => encrypted.get(OBJECT_A));
});

test('Feed object key rotation reads old objects and writes new objects with the active key ID', async () => {
  const rawStore = createMemoryObjectStore();
  const oldProvider = provider('old', { old: OLD_KEY });
  const oldStore = createEncryptedFeedObjectStore(rawStore, oldProvider);
  const plain = Buffer.from('rotation-safe-feed-object');
  await oldStore.put(OBJECT_A, plain);

  const rotatingProvider = provider('new', { old: OLD_KEY, new: NEW_KEY });
  const rotatingStore = createEncryptedFeedObjectStore(rawStore, rotatingProvider);
  assert.deepEqual(await rotatingStore.get(OBJECT_A), plain);
  await rotatingStore.put(OBJECT_B, plain);

  const storedNew = await rawStore.get(OBJECT_B);
  assert.ok(storedNew.includes(Buffer.from('new', 'ascii')));
  assert.deepEqual(await rotatingStore.get(OBJECT_B), plain);
  await assert.rejects(() => createEncryptedFeedObjectStore(
    rawStore, provider('new', { new: NEW_KEY }),
  ).get(OBJECT_A));
});

test('Feed object store rejects invalid object keys, key providers and chunk bounds', async () => {
  const rawStore = createMemoryObjectStore();
  assert.throws(() => createEncryptedFeedObjectStore(rawStore, null), TypeError);
  assert.throws(() => createEncryptedFeedObjectStore(rawStore, provider(), { chunkBytes: 1024 }), RangeError);
  const encrypted = createEncryptedFeedObjectStore(rawStore, provider());
  await assert.rejects(() => encrypted.put('../escape', Buffer.from('x')), TypeError);
});
