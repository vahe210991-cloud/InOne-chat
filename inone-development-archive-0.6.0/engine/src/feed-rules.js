import { createHash } from 'node:crypto';

export const POST_CONTENT_MAX_CODE_POINTS = 5_000;
export const POST_CONTENT_MAX_UTF8_BYTES = 16_384;
export const POST_ID_PATTERN = /^[0-9a-f]{32}$/u;
export const POST_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;

export function normalizePostContent(value) {
  if (typeof value !== 'string') return { ok: false, error: 'content_required' };

  const content = value.normalize('NFC').replace(/\r\n?/gu, '\n').trim();
  if (!content || content.includes('\0')) return { ok: false, error: 'content_required' };

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
  const leftTime = Number(left.createdAt);
  const rightTime = Number(right.createdAt);
  if (!Number.isSafeInteger(leftTime) || !Number.isSafeInteger(rightTime)) {
    throw new TypeError('post createdAt must be a safe integer');
  }
  if (leftTime !== rightTime) return rightTime > leftTime ? 1 : -1;
  if (!isValidPostId(left.postId) || !isValidPostId(right.postId)) {
    throw new TypeError('post id is invalid');
  }
  if (left.postId === right.postId) return 0;
  return right.postId > left.postId ? 1 : -1;
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
