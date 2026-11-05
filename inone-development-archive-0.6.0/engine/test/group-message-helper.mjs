// Помощник тестов: сообщение группы теперь идёт только через маршрут MLS. Заголовок строится по RFC 9420;
// шифротекст случайный: сервер его не расшифровывает, он проверяет группу и эпоху в заголовке.
const enc = encodeURIComponent;

function varint(n) {
  if (n < 64) return Buffer.from([n]);
  if (n < 16384) return Buffer.from([0x40 | (n >> 8), n & 0xff]);
  throw new Error('test group ids are shorter than 16 KB');
}

export function mlsHeader(roomId, epoch) {
  const id = Buffer.from(roomId, 'utf8');
  const epochBytes = Buffer.alloc(8);
  epochBytes.writeBigUInt64BE(BigInt(epoch));
  return Buffer.concat([Buffer.from([0, 1, 0, 2]), varint(id.length), id, epochBytes]);
}

/** Группа получает первую эпоху, если её ещё нет: тот же шаг, что делает первый коммит клиента. */
export async function ensureEpoch(client, roomId) {
  const current = (await client.raw('GET', `/mls/groups/${enc(roomId)}/epoch`)).epoch;
  if (current > 0) return current;
  await client.raw('POST', `/mls/groups/${enc(roomId)}/commits`, {
    epoch: 0, commit: Buffer.from('test-commit').toString('base64'), changes: { adds: [], removes: [] },
  });
  return 1;
}

/** Замена прежнего POST /rooms/:id/events: тот же ответ { event_id }. */
export async function postGroupEvent(client, roomId, body = {}) {
  // Не зашифрованное событие идёт на старый маршрут: сервер отклоняет его сам.
  if (body.type !== undefined && body.type !== 'm.room.encrypted') return client.raw('POST', `/rooms/${enc(roomId)}/events`, body);
  const epoch = await ensureEpoch(client, roomId);
  const payload = Buffer.from(`payload-${Math.random().toString(16).slice(2)}`);
  const message = Buffer.concat([mlsHeader(roomId, epoch), payload]).toString('base64');
  const response = await client.raw('POST', `/mls/groups/${enc(roomId)}/messages`, { message, kind: body.kind ?? 'text', forwarded: body.forwarded ?? false });
  return { ...response, message };
}

/** Сообщение в заданной эпохе: нужно, чтобы проверить отказ по устаревшей эпохе. */
export function mlsMessageAt(roomId, epoch, text) {
  return Buffer.concat([mlsHeader(roomId, epoch), Buffer.from(text, 'utf8')]).toString('base64');
}

/** Сообщение в текущей эпохе группы: для правки сообщения. */
export async function mlsMessageBase64(client, roomId, text) {
  return mlsMessageAt(roomId, await ensureEpoch(client, roomId), text);
}

