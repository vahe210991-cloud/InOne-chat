// Номера телефона любой страны: проверка по правилам страны, приведение к виду E.164.
// Сейчас SMS не подключены, поэтому принимаются только номера, на которые SMS вообще может прийти.
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

export const SMS_CAPABLE_TYPES = ['MOBILE', 'FIXED_LINE_OR_MOBILE'];

// Список стран по группам, в порядке подключения (решения владельца, 2026-10-25).
// СНГ — первыми. Грузия (вышла из СНГ в 2009) и Украина включены по решению владельца.
export const CIS_COUNTRIES = ['AM', 'AZ', 'BY', 'KZ', 'KG', 'RU', 'TJ', 'UZ', 'MD', 'TM'];
export const EU_COUNTRIES = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];
export const EEA_EXTRA_COUNTRIES = ['IS', 'LI', 'NO'];
// Остальная Европа. Британские владения (GG, JE, IM) входят, потому что библиотека относит часть британских мобильных номеров к ним.
export const OTHER_EUROPE_COUNTRIES = ['CH', 'GB', 'GG', 'JE', 'IM', 'GI', 'FO', 'AX', 'AL', 'AD', 'BA', 'MK', 'ME', 'RS', 'XK', 'MC', 'SM', 'VA', 'UA', 'GE'];
export const NORTH_AMERICA_COUNTRIES = ['US', 'CA'];
// Закрыто до юридической проверки (решение владельца, 2026-10-25). Номера поддерживаются технически;
// открытие — добавлением страны в INONE_PHONE_ALLOWED_COUNTRIES после проверки.
export const GATED_PHONE_COUNTRIES = ['CN'];
export const DEFAULT_PHONE_COUNTRIES = [
  ...CIS_COUNTRIES, ...EU_COUNTRIES, ...EEA_EXTRA_COUNTRIES, ...OTHER_EUROPE_COUNTRIES, ...NORTH_AMERICA_COUNTRIES,
];

/** Возвращает { value: { e164, country, callingCode, type } } или { error }. */
export function normalizePhone(input, { blockedCountries = [], allowedCountries = [] } = {}) {
  if (typeof input !== 'string') return { error: 'phone must be a string in international format, e.g. +37410123456' };
  const cleaned = input.trim().replace(/[\s\-().]/g, '').replace(/^00/, '+');
  if (!cleaned.startsWith('+')) return { error: 'phone must start with the country code, e.g. +37410123456' };
  const parsed = parsePhoneNumberFromString(cleaned);
  if (!parsed || !parsed.isValid()) return { error: 'phone number is not valid' };
  const type = parsed.getType() ?? 'UNKNOWN';
  if (!SMS_CAPABLE_TYPES.includes(type)) return { error: 'phone must be a mobile number that can receive SMS' };
  const country = parsed.country ?? null;
  if (country && blockedCountries.includes(country)) return { error: 'phone numbers from this country are not accepted yet' };
  // Пустой список разрешённых стран — без ограничения. Иначе страна должна быть в списке.
  if (allowedCountries.length > 0 && !(country && allowedCountries.includes(country))) {
    return { error: 'phone numbers from this country are not supported yet' };
  }
  return { value: { e164: parsed.number, country, callingCode: parsed.countryCallingCode, type } };
}
