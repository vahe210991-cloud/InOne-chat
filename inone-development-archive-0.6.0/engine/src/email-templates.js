const CATALOG = {
  registration_code: {
    ru: ['Код подтверждения InOne', ({ code }) => `Код: ${code}. Код действует 10 минут. Если вы не регистрировались в InOne, проигнорируйте письмо.`],
    en: ['InOne verification code', ({ code }) => `Your verification code is: ${code}. It expires in 10 minutes. If you did not request registration, ignore this email.`],
  },
  backup_email_verification: {
    ru: ['Подтверждение запасной почты InOne', ({ code }) => `Код: ${code}. Этот адрес указан запасной почтой аккаунта InOne. Код действует 10 минут. Если это не вы, просто проигнорируйте письмо.`],
    en: ['Verify your InOne backup email', ({ code }) => `Your code is: ${code}. This address is being added as a backup email to your InOne account. It expires in 10 minutes. If this was not you, ignore this email.`],
  },
  backup_email_changed: {
    ru: ['Запасная почта InOne изменена', ({ action }) => `Запасная почта аккаунта ${action === 'added' ? 'добавлена' : 'изменена'}. Если это не вы, войдите в аккаунт и проверьте привязки и устройства.`],
    en: ['InOne backup email changed', ({ action }) => `Your account backup email was ${action === 'added' ? 'added' : 'changed'}. If this was not you, sign in and review your linked accounts and devices.`],
  },
  backup_email_removed: {
    ru: ['Запасная почта InOne удалена', () => 'Запасная почта удалена из аккаунта InOne. Если это не вы, войдите в аккаунт и проверьте привязки и устройства.'],
    en: ['InOne backup email removed', () => 'The backup email was removed from your InOne account. If this was not you, sign in and review your linked accounts and devices.'],
  },
  stepup_code: {
    ru: ['Подтверждение действия в InOne', ({ code, action }) => `Код: ${code}. Действие: ${action}. Код действует 10 минут. Если это не вы, войдите в аккаунт и проверьте привязки и устройства.`],
    en: ['Confirm an action in InOne', ({ code, action }) => `Your code is: ${code}. Action: ${action}. It expires in 10 minutes. If this was not you, sign in and review your linked accounts and devices.`],
  },
  old_devices_revoked: {
    ru: ['Старые устройства отключены', () => 'Прошло 48 часов после восстановления. Устройства, существовавшие до восстановления, отключены.'],
    en: ['Previous devices have been revoked', () => 'The 48-hour recovery period has ended. Devices that existed before the recovery were revoked.'],
  },
  recovery_login_code: {
    ru: ['Подтверждение входа после восстановления', ({ code }) => `Код: ${code}. Введите его, чтобы войти с нового устройства. Если это не вы — отмените восстановление с устройства, которое существовало до запроса.`],
    en: ['Confirm sign-in after account recovery', ({ code }) => `Your code is: ${code}. Enter it to sign in on the new device. If this was not you, cancel recovery from a device that existed before the request.`],
  },
  new_device_wait: {
    ru: ['Вход с нового устройства: ожидание 48 часов', ({ activateAt, code }) => `Вход с нового устройства откроется ${activateAt}. Если это не вы, отмените вход кодом ${code} через экран отмены входа.`],
    en: ['New device sign-in: 48-hour waiting period', ({ activateAt, code }) => `Sign-in on the new device will be available at ${activateAt}. If this was not you, cancel the sign-in using code ${code} in the sign-in cancellation screen.`],
  },
  recovery_code: {
    ru: ['Код восстановления InOne', ({ code }) => `Код: ${code}. Код действует час. Вход откроется только через 48 часов после смены пароля. Если это не вы, ничего не вводите.`],
    en: ['InOne account recovery code', ({ code }) => `Your recovery code is: ${code}. It expires in one hour. Sign-in is available only 48 hours after the password change. If this was not you, do not enter the code.`],
  },
  recovery_requested: {
    ru: ['Запрошено восстановление InOne', () => 'Кто-то запросил восстановление доступа. Код отправлен на запасную или основную почту. Если это не вы, ничего не делайте и проверьте устройства.'],
    en: ['InOne account recovery requested', () => 'A request to recover your account was received. A code was sent to your backup or primary email. If this was not you, take no action and review your devices.'],
  },
  recovery_confirmation_link: {
    ru: ['Подтверждение восстановления', ({ url }) => `Чтобы подтвердить восстановление, откройте ссылку: ${url}. Ссылка действует час. Если это не вы — не открывайте её.`],
    en: ['Confirm account recovery', ({ url }) => `To confirm account recovery, open this link: ${url}. The link expires in one hour. If this was not you, do not open it.`],
  },
  recovery_cancelled: {
    ru: ['Восстановление отменено', ({ method }) => method === 'code' ? 'Восстановление отменено кодом отмены. Прежний пароль возвращён.' : 'Восстановление отменено с устройства, которое существовало до запроса. Прежний пароль возвращён.'],
    en: ['Account recovery cancelled', ({ method }) => method === 'code' ? 'Account recovery was cancelled using the cancellation code. Your previous password was restored.' : 'Account recovery was cancelled from a device that existed before the request. Your previous password was restored.'],
  },
  recovery_completed: {
    ru: ['Восстановление выполнено', ({ cancelCode }) => `Пароль изменён. Вход с новых устройств откроется через 48 часов. Отменить можно с устройства, существовавшего до запроса, или кодом отмены: ${cancelCode}.`],
    en: ['Account recovery completed', ({ cancelCode }) => `Your password was changed. Sign-in on new devices will be available after 48 hours. You can cancel from a device that existed before the request or by using this cancellation code: ${cancelCode}.`],
  },
};

const REQUIRED_VARIABLES = {
  registration_code: ['code'],
  backup_email_verification: ['code'],
  backup_email_changed: ['action'],
  backup_email_removed: [],
  stepup_code: ['code', 'action'],
  old_devices_revoked: [],
  recovery_login_code: ['code'],
  new_device_wait: ['activateAt', 'code'],
  recovery_code: ['code'],
  recovery_requested: [],
  recovery_confirmation_link: ['url'],
  recovery_cancelled: ['method'],
  recovery_completed: ['cancelCode'],
};

function safeVariables(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('email template variables must be an object');
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`invalid email template variable: ${key}`);
    const text = String(value);
    if (text.length > 2048 || [...text].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error('unsafe email template variable: ' + key);
    result[key] = text;
  }
  return result;
}

export function renderEmailTemplate(templateId, variables = {}, locale = 'ru') {
  const template = CATALOG[templateId];
  if (!template) throw new Error('unknown email template');
  const language = locale === 'en' ? 'en' : 'ru';
  const [subject, render] = template[language];
  const values = safeVariables(variables);
  for (const key of REQUIRED_VARIABLES[templateId] ?? []) if (!(key in values)) throw new Error('missing email template variable: ' + key);
  for (const key of required) if (!(key in values)) throw new Error(`missing email template variable: ${key}`);
  const ttlMs = ['registration_code', 'backup_email_verification', 'stepup_code'].includes(templateId)
    ? 10 * 60_000
    : ['recovery_login_code', 'recovery_code', 'recovery_confirmation_link'].includes(templateId)
      ? 60 * 60_000
      : templateId === 'new_device_wait' ? 48 * 60 * 60_000 : 7 * 24 * 60 * 60_000;
  return { subject, text: render(values), locale: language, templateId, templateVersion: 1, ttlMs };
}

export function listEmailTemplates() {
  return Object.keys(CATALOG).sort();
}
