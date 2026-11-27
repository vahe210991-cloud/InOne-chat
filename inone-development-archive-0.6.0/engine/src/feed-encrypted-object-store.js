import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';

const MAGIC = Buffer.from('INONEF01', 'ascii');
const FORMAT_VERSION = 1;
const DEFAULT_CHUNK_BYTES = 64 * 1024;
const MAX_KEY_ID_BYTES = 32;
const OBJECT_KEY_PATTERN = /^[a-f0-9]{32}$/u;

function validateObjectKey(value) {
  if (typeof value !== 'string' || !OBJECT_KEY_PATTERN.test(value)) {
    throw new TypeError('Feed object key must be a 32-character lowercase hex identifier');
  }
}

function validateKeyId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/u.test(value)) {
    throw new TypeError('Feed encryption key ID is invalid');
  }
  return Buffer.from(value, 'ascii');
}

async function loadKey(keyProvider, keyId) {
  if (!keyProvider || typeof keyProvider.getKey !== 'function') {
    throw new TypeError('Feed encryption key provider is required');
  }
  const value = await keyProvider.getKey(keyId);
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new Error('Feed encryption key provider must return 32 key bytes');
  }
  const key = Buffer.from(value);
  if (key.length !== 32) {
    key.fill(0);
    throw new Error('Feed encryption keys must be exactly 32 bytes');
  }
  return key;
}

function wrapAad(objectKey, keyId) {
  return Buffer.from('inone-feed-wrap-v1|' + objectKey + '|' + keyId, 'utf8');
}

function chunkAad(objectKey, keyId, counter, length) {
  return Buffer.from(
    'inone-feed-chunk-v1|' + objectKey + '|' + keyId + '|' + counter + '|' + length,
    'utf8',
  );
}

function finalAad(objectKey, keyId, counter, totalBytes) {
  return Buffer.from(
    'inone-feed-final-v1|' + objectKey + '|' + keyId + '|' + counter + '|' + totalBytes,
    'utf8',
  );
}

function nonceFor(prefix, counter) {
  const nonce = Buffer.alloc(12);
  prefix.copy(nonce, 0);
  nonce.writeUInt32BE(counter, 8);
  return nonce;
}

async function* encryptedRecords(source, objectKey, keyProvider, chunkBytes) {
  const keyId = keyProvider?.activeKeyId;
  const keyIdBytes = validateKeyId(keyId);
  const kek = await loadKey(keyProvider, keyId);
  const dek = randomBytes(32);
  const noncePrefix = randomBytes(8);
  const wrapNonce = randomBytes(12);
  try {
    const wrapper = createCipheriv('aes-256-gcm', kek, wrapNonce);
    wrapper.setAAD(wrapAad(objectKey, keyId));
    const wrappedDek = Buffer.concat([wrapper.update(dek), wrapper.final()]);
    const wrapTag = wrapper.getAuthTag();
    yield Buffer.concat([
      MAGIC,
      Buffer.from([FORMAT_VERSION, keyIdBytes.length]),
      keyIdBytes,
      noncePrefix,
      wrapNonce,
      wrappedDek,
      wrapTag,
    ]);

    let pending = Buffer.alloc(0);
    let counter = 0;
    let totalBytes = 0;
    const emitChunk = (plain) => {
      if (counter >= 0xffffffff) throw new RangeError('Feed object contains too many encrypted chunks');
      const nonce = nonceFor(noncePrefix, counter);
      const cipher = createCipheriv('aes-256-gcm', dek, nonce);
      cipher.setAAD(chunkAad(objectKey, keyId, counter, plain.length));
      const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
      const tag = cipher.getAuthTag();
      const frame = Buffer.alloc(4);
      frame.writeUInt32BE(plain.length, 0);
      counter += 1;
      totalBytes += plain.length;
      if (!Number.isSafeInteger(totalBytes)) throw new RangeError('Feed object size exceeds safe accounting range');
      return [frame, encrypted, tag];
    };

    for await (const input of source) {
      const chunk = Buffer.from(input);
      let combined = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let offset = 0;
      while (combined.length - offset >= chunkBytes) {
        const plain = combined.subarray(offset, offset + chunkBytes);
        for (const record of emitChunk(plain)) yield record;
        offset += chunkBytes;
      }
      pending = Buffer.from(combined.subarray(offset));
      combined = null;
    }
    if (pending.length) {
      for (const record of emitChunk(pending)) yield record;
      pending.fill(0);
    }
    const finalizer = createCipheriv('aes-256-gcm', dek, nonceFor(noncePrefix, counter));
    finalizer.setAAD(finalAad(objectKey, keyId, counter, totalBytes));
    finalizer.final();
    const finalTag = finalizer.getAuthTag();
    const end = Buffer.alloc(4);
    yield end;
    yield finalTag;
  } finally {
    dek.fill(0);
    kek.fill(0);
    noncePrefix.fill(0);
    wrapNonce.fill(0);
  }
}

async function* decryptedRecords(source, objectKey, keyProvider, chunkBytes) {
  const iterator = source[Symbol.asyncIterator]();
  let buffered = Buffer.alloc(0);
  const take = async (length) => {
    while (buffered.length < length) {
      const next = await iterator.next();
      if (next.done) return null;
      const chunk = Buffer.from(next.value);
      buffered = buffered.length ? Buffer.concat([buffered, chunk]) : chunk;
    }
    const result = buffered.subarray(0, length);
    buffered = buffered.subarray(length);
    return result;
  };

  let dek;
  let kek;
  try {
    const magic = await take(MAGIC.length);
    const fixed = await take(2);
    if (!magic || !fixed || !magic.equals(MAGIC) || fixed[0] !== FORMAT_VERSION) {
      throw new Error('Feed encrypted object header is invalid');
    }
    const keyIdLength = fixed[1];
    if (keyIdLength < 1 || keyIdLength > MAX_KEY_ID_BYTES) {
      throw new Error('Feed encrypted object key ID length is invalid');
    }
    const keyIdBytes = await take(keyIdLength);
    const noncePrefix = await take(8);
    const wrapNonce = await take(12);
    const wrappedDek = await take(32);
    const wrapTag = await take(16);
    if (!keyIdBytes || !noncePrefix || !wrapNonce || !wrappedDek || !wrapTag) {
      throw new Error('Feed encrypted object header is truncated');
    }
    const keyId = keyIdBytes.toString('ascii');
    validateKeyId(keyId);
    kek = await loadKey(keyProvider, keyId);
    const unwrapper = createDecipheriv('aes-256-gcm', kek, wrapNonce);
    unwrapper.setAAD(wrapAad(objectKey, keyId));
    unwrapper.setAuthTag(wrapTag);
    dek = Buffer.concat([unwrapper.update(wrappedDek), unwrapper.final()]);
    if (dek.length !== 32) throw new Error('Feed data key is invalid');

    let counter = 0;
    let totalBytes = 0;
    while (true) {
      const frame = await take(4);
      if (!frame) throw new Error('Feed encrypted object is truncated before end marker');
      const length = frame.readUInt32BE(0);
      if (length === 0) {
        const finalTag = await take(16);
        if (!finalTag) throw new Error('Feed encrypted object final authentication tag is missing');
        const finalizer = createDecipheriv('aes-256-gcm', dek, nonceFor(noncePrefix, counter));
        finalizer.setAAD(finalAad(objectKey, keyId, counter, totalBytes));
        finalizer.setAuthTag(finalTag);
        finalizer.final();
        break;
      }
      if (length > chunkBytes) throw new Error('Feed encrypted object chunk length exceeds limit');
      const encrypted = await take(length);
      const tag = await take(16);
      if (!encrypted || !tag) throw new Error('Feed encrypted object chunk is truncated');
      if (counter >= 0xffffffff) throw new RangeError('Feed encrypted object has too many chunks');
      const decipher = createDecipheriv('aes-256-gcm', dek, nonceFor(noncePrefix, counter));
      decipher.setAAD(chunkAad(objectKey, keyId, counter, length));
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      counter += 1;
      totalBytes += plain.length;
      if (!Number.isSafeInteger(totalBytes)) throw new RangeError('Feed encrypted object size exceeds safe accounting range');
      yield plain;
    }
    if (await take(1)) throw new Error('Feed encrypted object has trailing bytes');
    noncePrefix.fill(0);
    wrapNonce.fill(0);
    wrappedDek.fill(0);
    wrapTag.fill(0);
  } finally {
    dek?.fill(0);
    kek?.fill(0);
    buffered.fill(0);
    try {
      await iterator.return?.();
    } catch {
      // Preserve the original authentication/stream error.
    }
  }
}

/**
 * Wraps an existing private object store with chunked AES-256-GCM encryption.
 * keyProvider contract: { activeKeyId, getKey(keyId) -> 32-byte Buffer/Uint8Array }.
 * The provider should be backed by the deployment secret manager or KMS adapter.
 */
export function createEncryptedFeedObjectStore(innerStore, keyProvider, {
  chunkBytes = DEFAULT_CHUNK_BYTES,
} = {}) {
  if (!innerStore || typeof innerStore.putStream !== 'function'
    || typeof innerStore.getStream !== 'function'
    || typeof innerStore.remove !== 'function') {
    throw new TypeError('Feed inner object store must support streaming put/get and remove');
  }
  if (!Number.isInteger(chunkBytes) || chunkBytes < 16 * 1024 || chunkBytes > 1024 * 1024) {
    throw new RangeError('Feed encryption chunk size must be 16 KiB..1 MiB');
  }
  validateKeyId(keyProvider?.activeKeyId);
  if (typeof keyProvider.getKey !== 'function') {
    throw new TypeError('Feed encryption key provider must implement getKey(keyId)');
  }

  const putStream = async (key, source) => {
    validateObjectKey(key);
    const encrypted = Readable.from(encryptedRecords(source, key, keyProvider, chunkBytes));
    return innerStore.putStream(key, encrypted);
  };
  const getStream = async (key) => {
    validateObjectKey(key);
    const encrypted = await innerStore.getStream(key);
    if (!encrypted) return null;
    return Readable.from(decryptedRecords(encrypted, key, keyProvider, chunkBytes));
  };

  return {
    async put(key, bytes) {
      return putStream(key, Readable.from([Buffer.from(bytes)]));
    },
    putStream,
    async get(key) {
      const stream = await getStream(key);
      if (!stream) return null;
      const chunks = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    },
    getStream,
    async remove(key) {
      validateObjectKey(key);
      return innerStore.remove(key);
    },
  };
}
