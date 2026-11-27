const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/u;
const MAX_KEYRING_BYTES = 16 * 1024;
const MAX_KEY_COUNT = 16;

function decodeKey(value, keyId) {
  let key;
  if (typeof value !== 'string') {
    throw new Error('Feed encryption key ' + keyId + ' must be encoded as hex or base64');
  }
  if (/^[a-f0-9]{64}$/iu.test(value)) {
    key = Buffer.from(value, 'hex');
  } else if (/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    key = Buffer.from(value, 'base64');
    if (key.toString('base64') !== value) {
      key.fill(0);
      throw new Error('Feed encryption key ' + keyId + ' must use canonical base64');
    }
  } else {
    throw new Error('Feed encryption key ' + keyId + ' must be 64 hex characters or canonical base64');
  }
  if (key.length !== 32) {
    key.fill(0);
    throw new Error('Feed encryption key ' + keyId + ' must decode to exactly 32 bytes');
  }
  return key;
}

/**
 * Parses a JSON key ring injected by the deployment secret manager.
 * Example shape: {"feed-2026-11":"<64 hex chars>"}.
 * Keep old key IDs until all objects encrypted with them are re-encrypted or deleted.
 */
export function createFeedEncryptionKeyProvider({ keyringJson, activeKeyId }) {
  if (typeof keyringJson !== 'string' || keyringJson.length === 0
    || Buffer.byteLength(keyringJson, 'utf8') > MAX_KEYRING_BYTES) {
    throw new Error('INONE_FEED_ENCRYPTION_KEYS must be a non-empty bounded JSON key ring');
  }
  if (typeof activeKeyId !== 'string' || !KEY_ID_PATTERN.test(activeKeyId)) {
    throw new Error('INONE_FEED_ENCRYPTION_ACTIVE_KEY_ID is invalid');
  }

  let parsed;
  try {
    parsed = JSON.parse(keyringJson);
  } catch {
    throw new Error('INONE_FEED_ENCRYPTION_KEYS must contain valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || Object.getPrototypeOf(parsed) !== Object.prototype) {
    throw new Error('INONE_FEED_ENCRYPTION_KEYS must be a JSON object');
  }
  const keyIds = Object.keys(parsed);
  if (keyIds.length < 1 || keyIds.length > MAX_KEY_COUNT) {
    throw new Error('Feed encryption key ring must contain 1..16 keys');
  }
  for (const keyId of keyIds) {
    if (!KEY_ID_PATTERN.test(keyId)) throw new Error('Feed encryption key ID is invalid');
  }
  if (!Object.hasOwn(parsed, activeKeyId)) {
    throw new Error('Active Feed encryption key ID is missing from the key ring');
  }

  const keys = new Map();
  try {
    for (const keyId of keyIds) keys.set(keyId, decodeKey(parsed[keyId], keyId));
  } catch (error) {
    for (const key of keys.values()) key.fill(0);
    throw error;
  }

  let disposed = false;
  return {
    activeKeyId,
    getKey(keyId) {
      if (disposed) throw new Error('Feed encryption key provider is disposed');
      const key = keys.get(keyId);
      return key ? Buffer.from(key) : null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const key of keys.values()) key.fill(0);
      keys.clear();
    },
  };
}
