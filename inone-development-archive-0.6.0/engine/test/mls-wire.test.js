// Разбор открытого заголовка MLS: длины 1 и 2 байта, обрезанные и чужие сообщения.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPrivateMessageHeader } from '../src/mls-wire.js';

const epoch7 = Buffer.from([0, 0, 0, 0, 0, 0, 0, 7]);

test('заголовок с короткой и длинной длиной идентификатора группы читается', () => {
  const short = Buffer.concat([Buffer.from([0, 1, 0, 2, 0x07]), Buffer.from('!room:x'), epoch7, Buffer.from('rest')]);
  assert.deepEqual({ group: readPrivateMessageHeader(short).value.groupId.toString(), epoch: readPrivateMessageHeader(short).value.epoch }, { group: '!room:x', epoch: 7 });
  const id70 = Buffer.from('g'.repeat(70));
  const long = Buffer.concat([Buffer.from([0, 1, 0, 2, 0x40, 70]), id70, epoch7]);
  const parsed = readPrivateMessageHeader(long).value;
  assert.equal(parsed.groupId.length, 70);
  assert.equal(parsed.epoch, 7);
});

test('обрезанное сообщение, чужой формат и чужая версия отклоняются', () => {
  assert.equal(readPrivateMessageHeader(Buffer.from([0, 1])).error, 'message is too short');
  assert.equal(readPrivateMessageHeader(Buffer.from([0, 1, 0, 1, 0, 0])).error, 'message is not an MLS private message');
  assert.equal(readPrivateMessageHeader(Buffer.from([0, 2, 0, 2, 0, 0])).error, 'unsupported MLS version');
  assert.equal(readPrivateMessageHeader(Buffer.concat([Buffer.from([0, 1, 0, 2, 0x02]), Buffer.from('ab'), Buffer.from([0, 0, 1])])).error, 'truncated');
});
