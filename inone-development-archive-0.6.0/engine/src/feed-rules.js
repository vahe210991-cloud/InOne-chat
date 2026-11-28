import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const POST_ID_PATTERN = /^[0-9a-f]{32}$/u;
export const POST_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function normalizePostCaption(value) {
  if (value === undefined || value === null) {
    return { ok: true, caption: null, codePoints: 0, utf8Bytes: 0 };
  }
  if (typeof value !== 'string') return { ok: false, error: 'invalid_caption' };

  const caption = value.normalize('NFC').replace(/\r\n?/gu, '\n').trim();
  if (!caption) return { ok: true, caption: null, codePoints: 0, utf8Bytes: 0 };
  if (caption.includes('\0')) return { ok: false, error: 'invalid_caption' };
  if (hasUnpairedSurrogate(caption)) return { ok: false, error: 'invalid_unicode' };

  return {
    ok: true,
    caption,
    codePoints: [...caption].length,
    utf8Bytes: Buffer.byteLength(caption, 'utf8'),
  };
}

export function isValidPostId(value) {
  return typeof value === 'string' && POST_ID_PATTERN.test(value);
}

export function isValidPostIdempotencyKey(value) {
  return typeof value === 'string' && POST_IDEMPOTENCY_KEY_PATTERN.test(value);
}

export function validatePublishableMedia(media, authorId) {
  if (!Array.isArray(media) || media.length === 0) {
    return { ok: false, error: 'media_required' };
  }
  if (typeof authorId !== 'string' || !authorId) {
    return { ok: false, error: 'invalid_author' };
  }

  const seen = new Set();
  for (const item of media) {
    if (!item || typeof item !== 'object'
      || !isValidPostId(item.mediaId)
      || !['image', 'video'].includes(item.kind)
      || item.status !== 'ready'
      || item.scope !== 'feed'
      || item.ownerId !== authorId
      || seen.has(item.mediaId)) {
      return { ok: false, error: 'media_not_publishable' };
    }
    seen.add(item.mediaId);
  }
  return { ok: true, mediaCount: seen.size };
}

export function hashPostRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'invalid_post_request' };
  }
  const { caption, mediaIds } = input;
  const normalized = normalizePostCaption(caption);
  if (!normalized.ok) return normalized;
  if (!Array.isArray(mediaIds) || mediaIds.length === 0) {
    return { ok: false, error: 'media_required_or_invalid' };
  }
  const uniqueMediaIds = new Set();
  for (const mediaId of mediaIds) {
    if (!isValidPostId(mediaId) || uniqueMediaIds.has(mediaId)) {
      return { ok: false, error: 'media_required_or_invalid' };
    }
    uniqueMediaIds.add(mediaId);
  }
  const canonical = JSON.stringify({ v: 1, caption: normalized.caption, mediaIds });
  return {
    ok: true,
    caption: normalized.caption,
    requestHash: createHash('sha256').update(canonical, 'utf8').digest('hex'),
  };
}

function cursorKeyBytes(secret) {
  if (typeof secret !== 'string' && !Buffer.isBuffer(secret) && !(secret instanceof Uint8Array)) {
    throw new TypeError('feed cursor key must be a string or byte array');
  }
  const key = Buffer.from(secret);
  if (key.length < 32) {
    key.fill(0);
    throw new TypeError('feed cursor key must contain at least 256 bits');
  }
  return key;
}

function withCursorKey(secret, operation) {
  const key = cursorKeyBytes(secret);
  try {
    return operation(key);
  } finally {
    key.fill(0);
  }
}

export function encodeSignedFeedCursor({ createdAt, postId, scope = 'global' }, key) {
  if (!Number.isSafeInteger(createdAt) || createdAt < 0
    || !isValidPostId(postId) || !['global', 'own'].includes(scope)
    || !key || typeof key.keyId !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/u.test(key.keyId)) {
    throw new TypeError('invalid signed feed cursor input');
  }
  const payload = Buffer.from(JSON.stringify({
    v: 1, kid: key.keyId, createdAt, postId, scope,
  }), 'utf8').toString('base64url');
  const signature = withCursorKey(key.secret, (secret) => createHmac('sha256', secret)
    .update(payload, 'ascii').digest('base64url'));
  return payload + '.' + signature;
}

export function parseSignedFeedCursor(value, keyring, expectedScope = 'global') {
  if (value === undefined || value === null || value === '') {
    return { ok: true, cursor: null };
  }
  if (typeof value !== 'string' || value.length > 768
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value)) {
    return { ok: false, error: 'invalid_cursor' };
  }

  try {
    const [payload, signature] = value.split('.');
    const bytes = Buffer.from(payload, 'base64url');
    if (bytes.toString('base64url') !== payload) return { ok: false, error: 'invalid_cursor' };
    const decoded = JSON.parse(bytes.toString('utf8'));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)
      || Object.keys(decoded).sort().join(',') !== 'createdAt,kid,postId,scope,v'
      || decoded.v !== 1
      || !Number.isSafeInteger(decoded.createdAt) || decoded.createdAt < 0
      || !isValidPostId(decoded.postId)
      || !['global', 'own'].includes(decoded.scope)
      || decoded.scope !== expectedScope
      || typeof decoded.kid !== 'string'
      || !/^[A-Za-z0-9_-]{1,32}$/u.test(decoded.kid)) {
      return { ok: false, error: 'invalid_cursor' };
    }
    if (!keyring || !Object.hasOwn(keyring, decoded.kid)) {
      return { ok: false, error: 'invalid_cursor' };
    }
    const secret = keyring[decoded.kid];
    if (!secret) return { ok: false, error: 'invalid_cursor' };
    const expected = withCursorKey(secret, (keyBytes) => createHmac('sha256', keyBytes)
      .update(payload, 'ascii').digest());
    const supplied = Buffer.from(signature, 'base64url');
    if (supplied.toString('base64url') !== signature
      || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return { ok: false, error: 'invalid_cursor' };
    }
    return {
      ok: true,
      cursor: { createdAt: decoded.createdAt, postId: decoded.postId, scope: decoded.scope },
    };
  } catch {
    return { ok: false, error: 'invalid_cursor' };
  }
}

export function comparePostsNewestFirst(left, right) {
  if (!isValidPostId(left.postId) || !isValidPostId(right.postId)) {
    throw new TypeError('post id is invalid');
  }
  const leftTime = Number(left.createdAt);
  const rightTime = Number(right.createdAt);
  if (!Number.isSafeInteger(leftTime) || !Number.isSafeInteger(rightTime)) {
    throw new TypeError('post createdAt must be a safe integer');
  }
  if (leftTime !== rightTime) return rightTime > leftTime ? 1 : -1;
  if (left.postId === right.postId) return 0;
  return right.postId > left.postId ? 1 : -1;
}

export function isFeedRowAfterCursor(post, cursor) {
  if (!cursor) return true;
  if (!Number.isSafeInteger(cursor.createdAt) || cursor.createdAt < 0
    || !isValidPostId(cursor.postId)) {
    throw new TypeError('feed cursor boundary is invalid');
  }
  if (!Number.isSafeInteger(Number(post.createdAt)) || !isValidPostId(post.postId)) {
    throw new TypeError('post cursor boundary is invalid');
  }
  const createdAt = Number(post.createdAt);
  return createdAt < cursor.createdAt
    || (createdAt === cursor.createdAt && post.postId < cursor.postId);
}

export function paginateFeedRows(rows, limit, cursorKey, scope = 'global') {
  if (!Array.isArray(rows)) throw new TypeError('feed rows must be an array');
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new RangeError('feed limit must be between 1 and 50');
  }
  if (!['global', 'own'].includes(scope)) throw new TypeError('invalid feed scope');

  const ordered = [...rows].sort(comparePostsNewestFirst);
  const hasMore = ordered.length > limit;
  const items = ordered.slice(0, limit);
  const last = items.at(-1);

  return {
    items,
    hasMore,
    nextCursor: hasMore && last
      ? encodeSignedFeedCursor({
        createdAt: Number(last.createdAt), postId: last.postId, scope,
      }, cursorKey)
      : null,
  };
}
