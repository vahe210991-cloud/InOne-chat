import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const POST_CONTENT_MAX_CODE_POINTS = 5_000;
export const POST_CONTENT_MAX_UTF8_BYTES = 16_384;
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

export function normalizePostContent(value) {
  if (typeof value !== 'string') return { ok: false, error: 'content_required' };

  const content = value.normalize('NFC').replace(/\r\n?/gu, '\n').trim();
  if (!content || content.includes('\0')) return { ok: false, error: 'content_required' };
  if (hasUnpairedSurrogate(content)) return { ok: false, error: 'invalid_unicode' };

  const codePoints = [...content].length;
  if (codePoints > POST_CONTENT_MAX_CODE_POINTS) {
    return { ok: false, error: 'content_too_long' };
  }

  const utf8Bytes = Buffer.byteLength(content, 'utf8');
  if (utf8Bytes > POST_CONTENT_MAX_UTF8_BYTES) {
    return { ok: false, error: 'content_too_large' };
  }

  return {
    ok: true,
    content,
    codePoints,
    utf8Bytes,
    contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
  };
}


export function normalizePostCaption(value) {
  if (value === undefined || value === null) {
    return { ok: true, caption: null, codePoints: 0, utf8Bytes: 0 };
  }
  if (typeof value !== 'string') return { ok: false, error: 'invalid_caption' };

  const caption = value.normalize('NFC').replace(/\\r\\n?/gu, '\\n').trim();
  if (!caption) return { ok: true, caption: null, codePoints: 0, utf8Bytes: 0 };
  if (caption.includes('\\0')) return { ok: false, error: 'invalid_caption' };
  if (hasUnpairedSurrogate(caption)) return { ok: false, error: 'invalid_unicode' };

  return {
    ok: true,
    caption,
    codePoints: [...caption].length,
    utf8Bytes: Buffer.byteLength(caption, 'utf8'),
  };
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

function cursorKeyBytes(secret) {
  const key = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret ?? ''), 'utf8');
  if (key.length < 32) throw new TypeError('feed cursor key must contain at least 256 bits');
  return key;
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
  const signature = createHmac('sha256', cursorKeyBytes(key.secret))
    .update(payload, 'ascii').digest('base64url');
  return `${payload}.${signature}`;
}

export function parseSignedFeedCursor(value, keyring, expectedScope = 'global') {
  if (value === undefined || value === null || value === '') {
    return { ok: true, cursor: null };
  }
  if (typeof value !== 'string' || value.length > 768
    || !/^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/u.test(value)) {
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
    const secret = keyring?.[decoded.kid];
    if (!secret) return { ok: false, error: 'invalid_cursor' };
    const expected = createHmac('sha256', cursorKeyBytes(secret))
      .update(payload, 'ascii').digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
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

export function isValidPostId(value) {
  return typeof value === 'string' && POST_ID_PATTERN.test(value);
}

export function isValidPostIdempotencyKey(value) {
  return typeof value === 'string' && POST_IDEMPOTENCY_KEY_PATTERN.test(value);
}

export function encodeFeedCursor({ createdAt, postId }) {
  if (!Number.isSafeInteger(createdAt) || createdAt < 0 || !isValidPostId(postId)) {
    throw new TypeError('invalid feed cursor boundary');
  }
  return Buffer.from(JSON.stringify({ v: 1, createdAt, postId }), 'utf8').toString('base64url');
}

export function parseFeedCursor(value) {
  if (value === undefined || value === null || value === '') {
    return { ok: true, cursor: null };
  }
  if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    return { ok: false, error: 'invalid_cursor' };
  }

  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) return { ok: false, error: 'invalid_cursor' };
    const decoded = JSON.parse(bytes.toString('utf8'));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      return { ok: false, error: 'invalid_cursor' };
    }
    const keys = Object.keys(decoded).sort().join(',');
    if (keys !== 'createdAt,postId,v'
      || decoded.v !== 1
      || !Number.isSafeInteger(decoded.createdAt)
      || decoded.createdAt < 0
      || !isValidPostId(decoded.postId)) {
      return { ok: false, error: 'invalid_cursor' };
    }
    return {
      ok: true,
      cursor: { createdAt: decoded.createdAt, postId: decoded.postId },
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
  if (!Number.isSafeInteger(cursor.createdAt) || cursor.createdAt < 0 || !isValidPostId(cursor.postId)) {
    throw new TypeError('feed cursor boundary is invalid');
  }
  if (!Number.isSafeInteger(Number(post.createdAt)) || !isValidPostId(post.postId)) {
    throw new TypeError('post cursor boundary is invalid');
  }
  const createdAt = Number(post.createdAt);
  return createdAt < cursor.createdAt
    || (createdAt === cursor.createdAt && post.postId < cursor.postId);
}

export function paginateFeedRows(rows, limit) {
  if (!Array.isArray(rows)) throw new TypeError('feed rows must be an array');
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new RangeError('feed limit must be between 1 and 50');
  }

  const ordered = [...rows].sort(comparePostsNewestFirst);
  const hasMore = ordered.length > limit;
  const items = ordered.slice(0, limit);
  const last = items.at(-1);

  return {
    items,
    hasMore,
    nextCursor: hasMore && last
      ? encodeFeedCursor({ createdAt: Number(last.createdAt), postId: last.postId })
      : null,
  };
}
