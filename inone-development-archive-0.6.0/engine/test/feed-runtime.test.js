import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createFeedObjectStore } from '../src/feed-runtime.js';

const KEYRING = JSON.stringify({ feed_k1: '11'.repeat(32) });

test('Feed runtime stores only encrypted bytes in a private directory separate from chat files', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inone-feed-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const chatDirectory = path.join(root, 'chat');
  const feedDirectory = path.join(root, 'feed-private');
  await mkdir(chatDirectory, { recursive: true });

  const runtime = await createFeedObjectStore({
    feedDirectory,
    chatFilesDirectory: chatDirectory,
    keyringJson: KEYRING,
    activeKeyId: 'feed_k1',
  });
  t.after(() => runtime.dispose());

  const objectKey = 'a'.repeat(32);
  const plaintext = Buffer.from('private Feed media bytes');
  await runtime.objectStore.put(objectKey, plaintext);

  const stored = await readFile(path.join(feedDirectory, objectKey));
  assert.notDeepEqual(stored, plaintext);
  assert.deepEqual(await runtime.objectStore.get(objectKey), plaintext);
  assert.equal((await stat(feedDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(feedDirectory, objectKey))).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(chatDirectory), []);

  runtime.dispose();
  await assert.rejects(() => runtime.objectStore.get(objectKey), /disposed/u);
});

test('Feed runtime rejects overlapping chat and Feed directories before initialization', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inone-feed-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const chatDirectory = path.join(root, 'chat');
  const feedDirectory = path.join(chatDirectory, 'feed');
  await mkdir(chatDirectory, { recursive: true });

  await assert.rejects(
    () => createFeedObjectStore({
      feedDirectory,
      chatFilesDirectory: chatDirectory,
      keyringJson: KEYRING,
      activeKeyId: 'feed_k1',
    }),
    /non-overlapping directories/u,
  );
});

test('Feed runtime rejects relative paths and invalid key configuration', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inone-feed-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const chatDirectory = path.join(root, 'chat');
  await mkdir(chatDirectory, { recursive: true });

  await assert.rejects(
    () => createFeedObjectStore({
      feedDirectory: 'relative/feed',
      chatFilesDirectory: chatDirectory,
      keyringJson: KEYRING,
      activeKeyId: 'feed_k1',
    }),
    /absolute path/u,
  );
  await assert.rejects(
    () => createFeedObjectStore({
      feedDirectory: path.join(root, 'feed'),
      chatFilesDirectory: chatDirectory,
      keyringJson: '{}',
      activeKeyId: 'feed_k1',
    }),
    /1..16 keys/u,
  );
  await assert.rejects(
    () => stat(path.join(root, 'feed')),
    { code: 'ENOENT' },
  );
});
