// Названия комнат. Канал должен иметь уникальное название (без учёта регистра и лишних пробелов).
// Название группы может повторяться: это не уникальный признак.
export const ROOM_NAME_MAX = 64;

export function normalizeRoomName(input) {
  if (typeof input !== 'string') return { error: 'name must be a string' };
  const name = input.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > ROOM_NAME_MAX) return { error: `name must be 1 to ${ROOM_NAME_MAX} characters` };
  return { value: name };
}

export function channelNameKey(name) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
