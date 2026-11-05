// Оформление группы: описание, фон, аватар, обложка и собственные стикеры.
// Приватная группа хранит только зашифрованные файлы, публичная — только открытые изображения.
import { randomBytes } from 'crypto';

export const ASSET_KINDS = Object.freeze(['avatar', 'cover', 'background', 'sticker']);
export const ASSET_LIMITS_BYTES = Object.freeze({
  avatar: 512 * 1024,
  cover: 2 * 1024 * 1024,
  background: 2 * 1024 * 1024,
  sticker: 256 * 1024,
});
export const ALLOWED_CONTENT_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_STICKERS_PER_GROUP = 50;
export const SHORTCODE_PATTERN = /^[a-z0-9_]{2,32}$/;

const SIGNATURES = [
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
];

/** Тип изображения по первым байтам файла. Заявленный клиентом тип сам по себе не принимается. */
export function detectImageType(data) {
  for (const sig of SIGNATURES) {
    if (sig.bytes.every((b, i) => data[i] === b)) return sig.type;
  }
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function createAssetId() {
  return `ast_${randomBytes(9).toString('hex')}`;
}

/** Значения оформления из запроса. Передаётся только то, что меняется; null сбрасывает значение. */
export function validateAppearance(input) {
  if (!input || typeof input !== 'object') return { error: 'appearance must be an object' };
  const value = {};
  if (input.description !== undefined) {
    if (typeof input.description !== 'string') return { error: 'description must be a string' };
    const text = input.description.trim();
    if (text.length > MAX_DESCRIPTION_LENGTH) return { error: `description must be at most ${MAX_DESCRIPTION_LENGTH} characters` };
    value.description = text;
  }
  if (input.backgroundColor !== undefined) {
    const ok = input.backgroundColor === null || (typeof input.backgroundColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.backgroundColor));
    if (!ok) return { error: 'backgroundColor must be #RRGGBB or null' };
    value.backgroundColor = input.backgroundColor;
  }
  for (const key of ['avatarAssetId', 'coverAssetId', 'backgroundAssetId']) {
    if (input[key] === undefined) continue;
    if (input[key] !== null && typeof input[key] !== 'string') return { error: `${key} must be a string or null` };
    value[key] = input[key];
  }
  if (Object.keys(value).length === 0) return { error: 'nothing to change' };
  return { value };
}

/** Проверка загрузки файла. Возвращает { value } или { error, status }. */
export function validateAssetUpload(input, room) {
  if (!input || typeof input !== 'object') return { error: 'upload must be an object' };
  if (!ASSET_KINDS.includes(input.kind)) return { error: `kind must be one of ${ASSET_KINDS.join(', ')}` };
  if (typeof input.encrypted !== 'boolean') return { error: 'encrypted must be a boolean' };
  if (typeof input.dataBase64 !== 'string' || input.dataBase64.length === 0) return { error: 'dataBase64 is required' };
  const limit = ASSET_LIMITS_BYTES[input.kind];
  // Длину проверяем до декодирования: base64 занимает около четырёх третей размера файла.
  if (input.dataBase64.length > Math.ceil(limit / 3) * 4 + 4) return { error: 'file is too large', status: 413 };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.dataBase64)) return { error: 'dataBase64 must be base64' };
  const data = Buffer.from(input.dataBase64, 'base64');
  if (data.length === 0) return { error: 'file is empty' };
  if (data.length > limit) return { error: 'file is too large', status: 413 };
  let contentType;
  if (input.encrypted) {
    if (room.visibility !== 'private') return { error: 'public group files must be plain images' };
    if (input.contentType !== 'application/octet-stream') return { error: 'encrypted files must have contentType application/octet-stream' };
    contentType = 'application/octet-stream';
  } else {
    if (room.visibility !== 'public') return { error: 'private group files must be encrypted' };
    const detected = detectImageType(data);
    if (!detected || input.contentType !== detected) return { error: 'file is not a supported image' };
    contentType = detected;
  }
  let shortcode = null;
  if (input.kind === 'sticker') {
    if (typeof input.shortcode !== 'string' || !SHORTCODE_PATTERN.test(input.shortcode)) {
      return { error: 'shortcode must be 2 to 32 characters: a-z, 0-9, underscore' };
    }
    shortcode = input.shortcode;
  }
  return { value: { kind: input.kind, encrypted: input.encrypted, contentType, data, shortcode } };
}

/** Файл соответствует виду группы: в приватной — зашифрован, в публичной — открыт.
 *  Файл, который не соответствует, ждёт замены: его не отдают, пока его не заменят тем же идентификатором. */
export function assetMatchesVisibility(asset, room) {
  return asset.encrypted === (room.visibility === 'private');
}

/** Файл видит любой вошедший, если группа публичная; иначе только участник. */
export function assetVisibleTo(room, userId) {
  return room.visibility === 'public' || room.members.includes(userId);
}
