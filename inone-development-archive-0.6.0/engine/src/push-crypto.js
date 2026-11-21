import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

const FID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function parsePushEncryptionKey(value) {
  if (typeof value !== 'string' || value.length === 0) throw new Error('INONE_PUSH_ENCRYPTION_KEY is required');
  let key;
  if (/^[a-f0-9]{64}$/i.test(value)) key = Buffer.from(value, 'hex');
  else {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('INONE_PUSH_ENCRYPTION_KEY must be valid base64');
    key = Buffer.from(value, 'base64');
    if (key.toString('base64') !== value) {
      key.fill(0);
      throw new Error('INONE_PUSH_ENCRYPTION_KEY must use canonical base64');
    }
  }
  if (key.length !== 32) {
    key.fill(0);
    throw new Error('INONE_PUSH_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return key;
}

export function derivePushKey(masterKey, purpose) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) throw new Error('push encryption key must be 32 bytes');
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.from('inone-push-v1'), Buffer.from(purpose), 32));
}

function encryptBytes(plain, key, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function decryptBytes(row, key, aad, ciphertextField, ivField, tagField) {
  const decipher = createDecipheriv('aes-256-gcm', key, row[ivField]);
  decipher.setAAD(aad);
  decipher.setAuthTag(row[tagField]);
  return Buffer.concat([decipher.update(row[ciphertextField]), decipher.final()]);
}

export function encryptPushRegistrationId(value, deviceKey, encryptionKey, identifierKind = 'legacy') {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) throw new Error('invalid push registration identifier');
  if (typeof deviceKey !== 'string' || deviceKey.length < 1) throw new Error('invalid push device key');
  const key = derivePushKey(encryptionKey, 'fid-encryption');
  const plain = Buffer.from(value, 'utf8');
  try {
    const encrypted = encryptBytes(plain, key, Buffer.from(`inone-push-fid-v1|${deviceKey}`));
    return { tokenCiphertext: encrypted.ciphertext, tokenIv: encrypted.iv, tokenTag: encrypted.tag, identifierKind };
  } finally {
    plain.fill(0);
    key.fill(0);
  }
}

export function encryptPushFid(fid, deviceKey, encryptionKey) {
  if (typeof fid !== 'string' || !FID_PATTERN.test(fid)) throw new Error('invalid Firebase Installation ID');
  return encryptPushRegistrationId(fid, deviceKey, encryptionKey, 'fid');
}

export function decryptPushRegistrationId(row, deviceKey, encryptionKey) {
  const key = derivePushKey(encryptionKey, 'fid-encryption');
  const aad = Buffer.from(`inone-push-fid-v1|${deviceKey}`);
  let plain;
  try {
    plain = decryptBytes({
      ciphertext: row.token_ciphertext ?? row.tokenCiphertext,
      iv: row.token_iv ?? row.tokenIv,
      tag: row.token_tag ?? row.tokenTag,
    }, key, aad, 'ciphertext', 'iv', 'tag');
    return plain.toString('utf8');
  } finally {
    plain?.fill(0);
    key.fill(0);
  }
}

export function decryptPushFid(row, deviceKey, encryptionKey) {
  const fid = decryptPushRegistrationId(row, deviceKey, encryptionKey);
  if (!FID_PATTERN.test(fid)) throw new Error('decrypted push registration is not a Firebase Installation ID');
  return fid;
}

export function encryptPushPayload(payload, idempotencyHash, encryptionKey) {
  const key = derivePushKey(encryptionKey, 'delivery-payload-encryption');
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  try {
    const encrypted = encryptBytes(plain, key, Buffer.from(idempotencyHash, 'hex'));
    return { payloadCiphertext: encrypted.ciphertext, payloadIv: encrypted.iv, payloadTag: encrypted.tag };
  } finally {
    plain.fill(0);
    key.fill(0);
  }
}

export function decryptPushPayload(row, encryptionKey) {
  const key = derivePushKey(encryptionKey, 'delivery-payload-encryption');
  let plain;
  try {
    plain = decryptBytes({
      ciphertext: row.payload_ciphertext,
      iv: row.payload_iv,
      tag: row.payload_tag,
    }, key, Buffer.from(String(row.idempotency_key).trim(), 'hex'), 'ciphertext', 'iv', 'tag');
    const payload = JSON.parse(plain.toString('utf8'));
    if (!payload || payload.type !== 'message' || typeof payload.event_id !== 'string' || typeof payload.path !== 'string') {
      throw new Error('invalid encrypted push payload');
    }
    return payload;
  } finally {
    plain?.fill(0);
    key.fill(0);
  }
}

export function pushIdempotencyHash(key, roomId, eventId, deviceKey) {
  const hmacKey = derivePushKey(key, 'idempotency-key-hash');
  try {
    return createHmac('sha256', hmacKey)
      .update(`message|\0${roomId}\0${eventId}\0${deviceKey}`)
      .digest('hex');
  } finally {
    hmacKey.fill(0);
  }
}
