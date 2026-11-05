// Флаги функций и удалённая конфигурация. Умолчания — здесь, в коде: сервер работает и без связи с оператором.
// Переопределяет только оператор (scripts/set-flag.mjs); каждое изменение пишется в журнал с именем оператора и причиной.
export const FLAG_DEFAULTS = Object.freeze({
  'files.enabled': true,
  'push.enabled': true,
  'messages.editWindowMinutes': 15,
  'channels.enabled': true,
  'groups.maxMembers': 500,
  'maintenance.enabled': false,
  'app.minVersion': '0.0.0',
});

const RULES = Object.freeze({
  'files.enabled': { type: 'boolean' },
  'push.enabled': { type: 'boolean' },
  'messages.editWindowMinutes': { type: 'integer', min: 1, max: 1440 },
  'channels.enabled': { type: 'boolean' },
  'groups.maxMembers': { type: 'integer', min: 2, max: 500 },
  'maintenance.enabled': { type: 'boolean' },
  'app.minVersion': { type: 'version' },
});

/** То, что видно приложению без входа: статус обслуживания и минимальная версия. Остальное — только после входа. */
export const PUBLIC_FLAGS = Object.freeze(['maintenance.enabled', 'app.minVersion']);

/** Проверяет ключ и значение флага. Неизвестный ключ, не тот тип или выход за пределы — ошибка. */
export function validateFlag(key, value) {
  const rule = RULES[key];
  if (!rule) throw new Error(`unknown flag: ${key}`);
  if (rule.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${key} must be true or false`);
  if (rule.type === 'integer' && (!Number.isInteger(value) || value < rule.min || value > rule.max)) {
    throw new Error(`${key} must be an integer from ${rule.min} to ${rule.max}`);
  }
  if (rule.type === 'version' && (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value))) {
    throw new Error(`${key} must be a version like 1.2.3`);
  }
  return value;
}

/** Действующие значения: умолчания, перекрытые переопределениями оператора. Неизвестные ключи игнорируются. */
export function effectiveFlags(overrides = {}) {
  const out = { ...FLAG_DEFAULTS };
  for (const [key, value] of Object.entries(overrides)) if (key in RULES) out[key] = value;
  return out;
}

/** Публичная часть действующих значений. */
export function publicFlags(overrides = {}) {
  const all = effectiveFlags(overrides);
  return Object.fromEntries(PUBLIC_FLAGS.map((key) => [key, all[key]]));
}
