import { chmod, lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { createFsObjectStore } from './object-store.js';
import { createEncryptedFeedObjectStore } from './feed-encrypted-object-store.js';
import { createFeedEncryptionKeyProvider } from './feed-key-provider.js';

function isSameOrWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith('..' + path.sep)
    && !path.isAbsolute(relative)
  );
}

function validateDirectories(feedDirectory, chatFilesDirectory) {
  if (typeof feedDirectory !== 'string' || !path.isAbsolute(feedDirectory)) {
    throw new TypeError('INONE_FEED_FILES_DIR must be an absolute path');
  }
  if (typeof chatFilesDirectory !== 'string' || !path.isAbsolute(chatFilesDirectory)) {
    throw new TypeError('INONE_FILES_DIR must be an absolute path');
  }

  const feedRoot = path.resolve(feedDirectory);
  const chatRoot = path.resolve(chatFilesDirectory);
  if (isSameOrWithin(feedRoot, chatRoot) || isSameOrWithin(chatRoot, feedRoot)) {
    throw new Error('Feed and chat object stores must use non-overlapping directories');
  }
  return feedRoot;
}

/**
 * Creates the isolated, encrypted Feed object store.
 *
 * Configuration is injected by the caller so this primitive can be reviewed
 * independently from shared server startup/configuration changes. The caller
 * must invoke dispose() during graceful shutdown.
 */
export async function createFeedObjectStore({
  feedDirectory,
  chatFilesDirectory,
  keyringJson,
  activeKeyId,
  chunkBytes,
}) {
  const root = validateDirectories(feedDirectory, chatFilesDirectory);

  // Parse and validate all key material before touching the filesystem.
  const keyProvider = createFeedEncryptionKeyProvider({ keyringJson, activeKeyId });
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Feed object-store root must be a real directory, not a symlink');
    }
    await chmod(root, 0o700);

    const privateStore = createFsObjectStore(root);
    const objectStore = createEncryptedFeedObjectStore(
      privateStore,
      keyProvider,
      chunkBytes === undefined ? {} : { chunkBytes },
    );
    return {
      objectStore,
      dispose() {
        keyProvider.dispose();
      },
    };
  } catch (error) {
    keyProvider.dispose();
    throw error;
  }
}
