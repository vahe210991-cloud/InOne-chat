// Права участников беседы (группы). Владелец имеет все права и не может их потерять.
// Администратор и участник получают права, которые владелец выдал явно. При назначении
// администратора добавляется набор DEFAULT_ADMIN_CAPABILITIES, при понижении права
// возвращаются к DEFAULT_MEMBER_CAPABILITIES.

/** Все права, которые владелец может выдавать. Новые права добавляются сюда и в тесты. */
export const CAPABILITIES = Object.freeze([
  'invite_members',        // приглашать участников
  'remove_members',        // удалять участников (администратор не удаляет администратора)
  'send_messages',         // отправлять сообщения
  'send_stickers_gifs',    // отправлять стикеры и GIF
  'forward_messages',      // пересылать сообщения
  'edit_own_messages',     // редактировать свои сообщения
  'delete_own_messages',   // удалять свои сообщения
  'delete_any_messages',   // удалять чужие сообщения
  'edit_group_name',       // менять название группы
  'edit_group_appearance', // менять оформление группы
  'edit_group_settings',   // менять настройки группы
]);

/** Права участника при вступлении. Совпадают с прежним поведением: писать могут все. */
export const DEFAULT_MEMBER_CAPABILITIES = Object.freeze([
  'send_messages',
  'send_stickers_gifs',
  'forward_messages',
  'edit_own_messages',
  'delete_own_messages',
]);

/** Права, которые добавляются при назначении администратора. Совпадают с прежним поведением. */
export const DEFAULT_ADMIN_CAPABILITIES = Object.freeze(['invite_members', 'remove_members']);

/** Виды сообщений, которые клиент объявляет в запросе. Сервер не видит содержимое шифротекста. */
export const MESSAGE_KINDS = Object.freeze(['text', 'sticker', 'gif']);

/** Список прав из запроса: массив известных названий без повторов, отсортированный. Иначе null. */
export function normalizeCapabilities(input) {
  if (!Array.isArray(input)) return null;
  if (!input.every((c) => typeof c === 'string' && CAPABILITIES.includes(c))) return null;
  return [...new Set(input)].sort();
}

/** Все права участника беседы. Не участник не имеет прав. Владелец имеет все права. */
export function effectiveCapabilities(room, userId) {
  if (!room || !room.members.includes(userId)) return new Set();
  if (room.owner === userId) return new Set(CAPABILITIES);
  return new Set(room.capabilities?.[userId] ?? []);
}

export function hasCapability(room, userId, capability) {
  return effectiveCapabilities(room, userId).has(capability);
}
