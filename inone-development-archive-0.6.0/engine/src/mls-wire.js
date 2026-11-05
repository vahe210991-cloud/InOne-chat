// Разбор открытого заголовка сообщения MLS (RFC 9420). Сервер не расшифровывает сообщение:
// он проверяет группу и эпоху из заголовка PrivateMessage, которые в MLS передаются открытым текстом.

/** Переменная длина QUIC-стиля: два старших бита первого байта задают длину 1, 2, 4 или 8 байт. */
function readVarint(bytes, offset) {
  if (offset >= bytes.length) return { error: 'truncated' };
  const length = 1 << (bytes[offset] >> 6);
  if (offset + length > bytes.length) return { error: 'truncated' };
  let value = BigInt(bytes[offset] & 0x3f);
  for (let i = 1; i < length; i++) value = (value << 8n) | BigInt(bytes[offset + i]);
  return { value, next: offset + length };
}

function readVarBytes(bytes, offset) {
  const len = readVarint(bytes, offset);
  if (len.error) return len;
  const n = Number(len.value);
  const end = len.next + n;
  if (!Number.isSafeInteger(n) || end > bytes.length) return { error: 'truncated' };
  return { value: bytes.subarray(len.next, end), next: end };
}

/** Заголовок PrivateMessage: версия 1, формат «приватное сообщение», идентификатор группы, эпоха (uint64). */
export function readPrivateMessageHeader(bytes) {
  if (bytes.length < 4) return { error: 'message is too short' };
  if (bytes.readUInt16BE(0) !== 1) return { error: 'unsupported MLS version' };
  if (bytes.readUInt16BE(2) !== 2) return { error: 'message is not an MLS private message' };
  const group = readVarBytes(bytes, 4);
  if (group.error) return { error: group.error };
  if (group.next + 8 > bytes.length) return { error: 'truncated' };
  const epoch = bytes.readBigUInt64BE(group.next);
  if (epoch > BigInt(Number.MAX_SAFE_INTEGER)) return { error: 'epoch out of range' };
  return { value: { groupId: Buffer.from(group.value), epoch: Number(epoch) } };
}

/** Заголовок PrivateMessage для группы и эпохи: тот же формат, что проверяет сервер. */
export function buildPrivateMessageHeader(roomId, epoch) {
  const id = Buffer.from(roomId, 'utf8');
  const length = id.length < 64 ? Buffer.from([id.length]) : Buffer.from([0x40 | (id.length >> 8), id.length & 0xff]);
  const epochBytes = Buffer.alloc(8);
  epochBytes.writeBigUInt64BE(BigInt(epoch));
  return Buffer.concat([Buffer.from([0, 1, 0, 2]), length, id, epochBytes]);
}

/** Содержимое после заголовка: то, что клиент положил в сообщение. */
export function privateMessagePayload(bytes) {
  const group = readVarBytes(bytes, 4);
  if (group.error || group.next + 8 > bytes.length) throw new Error('not a private message header');
  return bytes.subarray(group.next + 8);
}


