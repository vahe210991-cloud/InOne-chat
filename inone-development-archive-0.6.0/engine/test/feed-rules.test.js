import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  POST_CONTENT_MAX_CODE_POINTS,
  POST_CONTENT_MAX_UTF8_BYTES,
  comparePostsNewestFirst,
  encodeFeedCursor,
  encodeSignedFeedCursor,
  parseSignedFeedCursor,
  normalizePostCaption,
  validatePublishableMedia,
  isValidPostId,
  isFeedRowAfterCursor,
  isValidPostIdempotencyKey,
  normalizePostContent,
  paginateFeedRows,
  parseFeedCursor,
} from '../src/feed-rules.js';

const id = (value) => value.toString(16).padStart(32, '0');

test('post content is normalized as bounded plain text and hashed deterministically', () => {
  const result = normalizePostContent('  Cafe\u0301\r\nSecond line 😀  ');
  assert.equal(result.ok, true);
  assert.equal(result.content, 'Café\nSecond line 😀');
  assert.equal(result.codePoints, [...result.content].length);
  assert.match(result.contentHash, /^[0-9a-f]{64}$/u);
  assert.equal(normalizePostContent('Café').contentHash, normalizePostContent('Cafe\u0301').contentHash);
});

test('post content rejects missing, blank, NUL, excessive code points and excessive UTF-8 bytes', () => {
  assert.equal(normalizePostContent(null).error, 'content_required');
  assert.equal(normalizePostContent(' \n\t ').error, 'content_required');
  assert.equal(normalizePostContent('bad\0content').error, 'content_required');
  assert.equal(normalizePostContent('\ud800').error, 'invalid_unicode');
  assert.equal(normalizePostContent('x'.repeat(POST_CONTENT_MAX_CODE_POINTS + 1)).error, 'content_too_long');
  const bytesLimited = normalizePostContent('😀'.repeat(Math.floor(POST_CONTENT_MAX_UTF8_BYTES / 4) + 1));
  assert.equal(bytesLimited.error, 'content_too_large');
});

test('post ids and idempotency keys use bounded opaque formats', () => {
  assert.equal(isValidPostId(id(12)), true);
  assert.equal(isValidPostId('A'.repeat(32)), false);
  assert.equal(isValidPostId('f'.repeat(31)), false);
  assert.equal(isValidPostIdempotencyKey('0123456789abcdef'), true);
  assert.equal(isValidPostIdempotencyKey('short'), false);
  assert.equal(isValidPostIdempotencyKey('x'.repeat(129)), false);
  assert.equal(isValidPostIdempotencyKey('contains space 123'), false);
});

test('feed cursor round-trips a strict versioned boundary', () => {
  const boundary = { createdAt: 1_795_000_000_123, postId: id(42) };
  const encoded = encodeFeedCursor(boundary);
  assert.deepEqual(parseFeedCursor(encoded), { ok: true, cursor: boundary });
  assert.deepEqual(parseFeedCursor(undefined), { ok: true, cursor: null });
  assert.equal(parseFeedCursor('not a cursor').ok, false);
  assert.equal(parseFeedCursor('eyJ2IjoyLCJjcmVhdGVkQXQiOjEsInBvc3RJZCI6IjAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMCJ9').ok, false);
  assert.equal(parseFeedCursor(Buffer.from(JSON.stringify({ v: 1, createdAt: -1, postId: id(1) })).toString('base64url')).ok, false);
  assert.equal(parseFeedCursor(Buffer.from(JSON.stringify({ v: 1, createdAt: 1, postId: id(1), userId: 'attacker' })).toString('base64url')).ok, false);
  assert.equal(parseFeedCursor('A'.repeat(513)).ok, false);
});

test('feed pagination is deterministic for equal timestamps and produces a continuation cursor', () => {
  const rows = [
    { postId: id(2), createdAt: 100 },
    { postId: id(9), createdAt: 100 },
    { postId: id(4), createdAt: 101 },
    { postId: id(1), createdAt: 100 },
  ];
  const page = paginateFeedRows(rows, 2);
  assert.deepEqual(page.items.map((row) => row.postId), [id(4), id(9)]);
  assert.equal(page.hasMore, true);
  assert.deepEqual(parseFeedCursor(page.nextCursor), {
    ok: true,
    cursor: { createdAt: 100, postId: id(9) },
  });
  assert.deepEqual(paginateFeedRows(page.items, 2).items.map((row) => row.postId), [id(4), id(9)]);
});

test('keyset cursor includes only older rows and lower IDs at equal timestamps', () => {
  const cursor = { createdAt: 100, postId: id(9) };
  assert.equal(isFeedRowAfterCursor({ createdAt: 101, postId: id(1) }, cursor), false);
  assert.equal(isFeedRowAfterCursor({ createdAt: 100, postId: id(10) }, cursor), false);
  assert.equal(isFeedRowAfterCursor({ createdAt: 100, postId: id(9) }, cursor), false);
  assert.equal(isFeedRowAfterCursor({ createdAt: 100, postId: id(8) }, cursor), true);
  assert.equal(isFeedRowAfterCursor({ createdAt: 99, postId: id(1) }, cursor), true);
  assert.equal(isFeedRowAfterCursor({ createdAt: 99, postId: id(1) }, null), true);
  assert.throws(() => isFeedRowAfterCursor({ createdAt: 100, postId: 'bad' }, cursor), TypeError);
});

test('feed pagination returns no cursor for the final page and validates limits', () => {
  assert.equal(paginateFeedRows([{ postId: id(1), createdAt: 1 }], 20).nextCursor, null);
  assert.equal(paginateFeedRows([], 20).hasMore, false);
  assert.throws(() => paginateFeedRows([], 0), RangeError);
  assert.throws(() => paginateFeedRows([], 51), RangeError);
  assert.throws(() => comparePostsNewestFirst({ postId: 'bad', createdAt: 1 }, { postId: id(1), createdAt: 1 }), TypeError);
});


test('caption is optional, normalized and rejects malformed values', () => {
  assert.deepEqual(normalizePostCaption(undefined), {
    ok: true, caption: null, codePoints: 0, utf8Bytes: 0,
  });
  assert.equal(normalizePostCaption('  \r\n  ').caption, null);
  const caption = normalizePostCaption('  Cafe\u0301\r\nPhoto  ');
  assert.equal(caption.ok, true);
  assert.equal(caption.caption, 'Café\nPhoto');
  assert.equal(caption.codePoints, [...caption.caption].length);
  assert.equal(normalizePostCaption(42).error, 'invalid_caption');
  assert.equal(normalizePostCaption('bad\0caption').error, 'invalid_caption');
  assert.equal(normalizePostCaption('\ud800').error, 'invalid_unicode');
});

test('publication requires at least one unique ready Feed media item owned by the author', () => {
  const authorId = 'account-internal-1';
  const media = {
    mediaId: id(10), kind: 'image', status: 'ready',
    scope: 'feed', ownerId: authorId,
  };
  assert.equal(validatePublishableMedia([], authorId).error, 'media_required');
  assert.equal(validatePublishableMedia([media], authorId).ok, true);
  assert.equal(validatePublishableMedia([media, media], authorId).error, 'media_not_publishable');
  assert.equal(validatePublishableMedia([{ ...media, status: 'processing' }], authorId).error, 'media_not_publishable');
  assert.equal(validatePublishableMedia([{ ...media, scope: 'chat' }], authorId).error, 'media_not_publishable');
  assert.equal(validatePublishableMedia([{ ...media, ownerId: 'other-account' }], authorId).error, 'media_not_publishable');
  assert.equal(validatePublishableMedia([{ ...media, kind: 'document' }], authorId).error, 'media_not_publishable');
  assert.equal(validatePublishableMedia([media], '').error, 'invalid_author');
});

test('signed feed cursor is scope-bound, key-versioned and rejects tampering', () => {
  const key = { keyId: 'k1', secret: 'x'.repeat(32) };
  const boundary = { createdAt: 1_795_000_000_123, postId: id(42), scope: 'global' };
  const token = encodeSignedFeedCursor(boundary, key);
  assert.deepEqual(parseSignedFeedCursor(token, { k1: key.secret }), {
    ok: true, cursor: boundary,
  });
  assert.equal(parseSignedFeedCursor(token, { k1: 'y'.repeat(32) }).error, 'invalid_cursor');
  assert.equal(parseSignedFeedCursor(token, { k1: key.secret }, 'own').error, 'invalid_cursor');
  const [payload, signature] = token.split('.');
  const altered = `${payload.slice(0, -1)}A.${signature}`;
  assert.equal(parseSignedFeedCursor(altered, { k1: key.secret }).error, 'invalid_cursor');
  assert.equal(parseSignedFeedCursor(token, {}).error, 'invalid_cursor');
  assert.throws(() => encodeSignedFeedCursor(boundary, { keyId: 'k1', secret: 'short' }), TypeError);
});
