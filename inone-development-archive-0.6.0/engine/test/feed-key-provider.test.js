import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFeedEncryptionKeyProvider } from '../src/feed-key-provider.js';

const KEY = '11'.repeat(32);
const OTHER_KEY = Buffer.alloc(32, 0x22).toString('base64');

test('Feed key provider loads a versioned key ring and returns isolated key copies', () => {
  const provider = createFeedEncryptionKeyProvider({
    keyringJson: JSON.stringify({ old: KEY, active: OTHER_KEY }),
    activeKeyId: 'active',
  });
  assert.equal(provider.activeKeyId, 'active');
  const first = provider.getKey('old');
  assert.equal(first.length, 32);
  first.fill(0);
  assert.deepEqual(provider.getKey('old'), Buffer.from(KEY, 'hex'));
  assert.equal(provider.getKey('missing'), null);
  provider.dispose();
  assert.throws(() => provider.getKey('old'), /disposed/u);
  provider.dispose();
});

test('Feed key provider rejects malformed key rings and missing active keys', () => {
  assert.throws(() => createFeedEncryptionKeyProvider({
    keyringJson: '{', activeKeyId: 'active',
  }), /valid JSON/u);
  assert.throws(() => createFeedEncryptionKeyProvider({
    keyringJson: '[]', activeKeyId: 'active',
  }), /JSON object/u);
  assert.throws(() => createFeedEncryptionKeyProvider({
    keyringJson: JSON.stringify({ old: KEY }), activeKeyId: 'active',
  }), /missing from the key ring/u);
  assert.throws(() => createFeedEncryptionKeyProvider({
    keyringJson: JSON.stringify({ active: 'short' }), activeKeyId: 'active',
  }), /64 hex characters or canonical base64/u);
  assert.throws(() => createFeedEncryptionKeyProvider({
    keyringJson: JSON.stringify({ active: '00'.repeat(31) }), activeKeyId: 'active',
  }), /exactly 32 bytes/u);
  assert.throws(() => createFeedEncryptionKeyProvider({
    keyringJson: JSON.stringify({ active: KEY }), activeKeyId: 'bad key',
  }), /ACTIVE_KEY_ID is invalid/u);
});
