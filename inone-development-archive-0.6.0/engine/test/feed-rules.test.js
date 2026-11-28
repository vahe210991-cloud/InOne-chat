import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  comparePostsNewestFirst,
  encodeSignedFeedCursor,
  hashPostRequest,
  isValidPostId,
  isFeedRowAfterCursor,
  isValidPostIdempotencyKey,
  normalizePostCaption,
  paginateFeedRows,
  parseSignedFeedCursor,
  validatePublishableMedia,
} from '../src/feed-rules.js';

const id = (value) => value.toString(16).padStart(32, '0');
const cursorKey = { keyId: 'k1', secret: 'x'.repeat(32) };

test('caption is optional, normalized and rejects malformed values', () => {
  assert.deepEqual(normalizePostCaption(undefined), {
    ok: true, caption: null, codePoints: 0, utf8Bytes: 0,
  });
  assert.equal(normalizePostCaption('  \r\n  ').caption, null);
  const caption = normalizePostCaption('  Cafe\u0301\r\nPhoto 😀  ');
  assert.equal(caption.ok, true);
  assert.equal(caption.caption, 'Café\nPhoto 😀');
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

test('idempotency request hash covers normalized optional caption and ordered media IDs', () => {
  const first = hashPostRequest({ caption: ' Cafe\u0301 ', mediaIds: [id(1), id(2)] });
  const retry = hashPostRequest({ caption: 'Café', mediaIds: [id(1), id(2)] });
  const reordered = hashPostRequest({ caption: 'Café', mediaIds: [id(2), id(1)] });
  const noCaption = hashPostRequest({ mediaIds: [id(1)] });
  assert.equal(first.ok, true);
  assert.equal(first.caption, 'Café');
  assert.equal(first.requestHash, retry.requestHash);
  assert.notEqual(first.requestHash, reordered.requestHash);
  assert.equal(noCaption.ok, true);
  assert.equal(hashPostRequest(undefined).error, 'invalid_post_request');
  assert.equal(hashPostRequest({ caption: 'caption', mediaIds: [] }).error, 'media_required_or_invalid');
  assert.equal(hashPostRequest({ caption: 'caption', mediaIds: [id(1), id(1)] }).error, 'media_required_or_invalid');
  assert.equal(hashPostRequest({ caption: 'caption', mediaIds: Array(1) }).error, 'media_required_or_invalid');
});

test('post IDs and idempotency keys use bounded opaque formats', () => {
  assert.equal(isValidPostId(id(12)), true);
  assert.equal(isValidPostId('A'.repeat(32)), false);
  assert.equal(isValidPostId('f'.repeat(31)), false);
  assert.equal(isValidPostIdempotencyKey('0123456789abcdef'), true);
  assert.equal(isValidPostIdempotencyKey('short'), false);
  assert.equal(isValidPostIdempotencyKey('x'.repeat(129)), false);
  assert.equal(isValidPostIdempotencyKey('contains space 123'), false);
});

test('signed feed cursor round-trips with scope and key ID', () => {
  const boundary = { createdAt: 1_795_000_000_123, postId: id(42), scope: 'global' };
  const token = encodeSignedFeedCursor(boundary, cursorKey);
  assert.deepEqual(parseSignedFeedCursor(token, { k1: cursorKey.secret }), {
    ok: true, cursor: boundary,
  });
  assert.deepEqual(parseSignedFeedCursor(undefined, { k1: cursorKey.secret }), {
    ok: true, cursor: null,
  });
});

test('signed feed cursor rejects tampering, wrong scope, unknown key and non-canonical signature', () => {
  const token = encodeSignedFeedCursor({
    createdAt: 1_795_000_000_123, postId: id(42), scope: 'global',
  }, cursorKey);
  const [payload, signature] = token.split('.');
  const alteredPayload = payload.slice(0, -1) + (payload.endsWith('A') ? 'B' : 'A');
  assert.equal(parseSignedFeedCursor(alteredPayload + '.' + signature, { k1: cursorKey.secret }).error, 'invalid_cursor');
  assert.equal(parseSignedFeedCursor(token, { k1: cursorKey.secret }, 'own').error, 'invalid_cursor');
  assert.equal(parseSignedFeedCursor(token, {}).error, 'invalid_cursor');
  assert.equal(parseSignedFeedCursor(token, Object.create({ k1: cursorKey.secret })).error, 'invalid_cursor');
  assert.equal(parseSignedFeedCursor(payload + '.' + signature + '=', { k1: cursorKey.secret }).error, 'invalid_cursor');
  assert.throws(() => encodeSignedFeedCursor({
    createdAt: 1, postId: id(1),
  }, { keyId: 'k1', secret: 'short' }), TypeError);
});

test('feed ordering is deterministic for equal timestamps and stable IDs', () => {
  const rows = [
    { postId: id(2), createdAt: 100 },
    { postId: id(9), createdAt: 100 },
    { postId: id(4), createdAt: 101 },
    { postId: id(1), createdAt: 100 },
  ];
  assert.deepEqual([...rows].sort(comparePostsNewestFirst).map((row) => row.postId), [
    id(4), id(9), id(2), id(1),
  ]);
  assert.throws(() => comparePostsNewestFirst({
    postId: 'bad', createdAt: 1,
  }, { postId: id(1), createdAt: 1 }), TypeError);
});

test('keyset boundary includes only older rows and lower IDs at equal timestamps', () => {
  const cursor = { createdAt: 100, postId: id(9) };
  assert.equal(isFeedRowAfterCursor({ createdAt: 101, postId: id(1) }, cursor), false);
  assert.equal(isFeedRowAfterCursor({ createdAt: 100, postId: id(10) }, cursor), false);
  assert.equal(isFeedRowAfterCursor({ createdAt: 100, postId: id(9) }, cursor), false);
  assert.equal(isFeedRowAfterCursor({ createdAt: 100, postId: id(8) }, cursor), true);
  assert.equal(isFeedRowAfterCursor({ createdAt: 99, postId: id(1) }, cursor), true);
  assert.equal(isFeedRowAfterCursor({ createdAt: 99, postId: id(1) }, null), true);
  assert.throws(() => isFeedRowAfterCursor({
    createdAt: 100, postId: 'bad',
  }, cursor), TypeError);
});

test('pagination emits signed scope-bound cursor and validates limits', () => {
  const rows = [
    { postId: id(2), createdAt: 100 },
    { postId: id(9), createdAt: 100 },
    { postId: id(4), createdAt: 101 },
    { postId: id(1), createdAt: 100 },
  ];
  const page = paginateFeedRows(rows, 2, cursorKey, 'global');
  assert.deepEqual(page.items.map((row) => row.postId), [id(4), id(9)]);
  assert.equal(page.hasMore, true);
  assert.deepEqual(parseSignedFeedCursor(page.nextCursor, { k1: cursorKey.secret }), {
    ok: true,
    cursor: { createdAt: 100, postId: id(9), scope: 'global' },
  });
  assert.equal(paginateFeedRows(rows.slice(0, 1), 2, cursorKey).nextCursor, null);
  assert.throws(() => paginateFeedRows(rows, 2), TypeError);
  assert.throws(() => paginateFeedRows([], 0, cursorKey), RangeError);
  assert.throws(() => paginateFeedRows([], 51, cursorKey), RangeError);
});
