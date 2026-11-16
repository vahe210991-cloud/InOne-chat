// Генерирует переносимые тестовые векторы подписи для Dart, Swift, Kotlin и C#.
// Приватная часть используется только в памяти процесса и никогда не записывается в fixture.
import { writeFileSync } from 'node:fs';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { signingMessage } from './biometric-client.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pub = publicKey.export({ format: 'jwk' });
const input = {
  userId: 'u0123456789abcdef01234567',
  deviceId: 'BORIS_PHONE',
  action: 'set-backup-email',
  nonce: 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg',
};
const message = signingMessage(input);
const signature = createSign('SHA256').update(message).sign({ key: privateKey, dsaEncoding: 'der' }).toString('base64url');
const vectors = {
  note: 'Тестовый вектор. Приватный ключ намеренно не включается.',
  algorithm: 'ECDSA P-256, SHA-256, подпись DER, base64url',
  publicKey: { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y },
  positive: [{ name: 'подпись сообщения действия', input, message, signature }],
  negative: [
    { name: 'другое действие: подпись не подходит', input: { ...input, action: 'remove-backup-email' }, signature },
    { name: 'другой nonce: подпись не подходит', input: { ...input, nonce: 'Другой-nonce' }, signature },
  ],
};
writeFileSync(new URL('./vectors/biometric-vectors.json', import.meta.url), JSON.stringify(vectors, null, 2) + '\n');
console.log('vectors written (public key and signatures only)');
