const SUPPORTED_EMAIL_LOCALES = new Set(['hy', 'ru', 'en']);

const CATALOG = {
  registration_code: {
    hy: ['InOne հաշվի հաստատման կոդը', ({ code }) => `Ձեր հաստատման կոդն է՝ ${code}։ Կոդը վավեր է 10 րոպե։ Եթե դուք չեք սկսել գրանցումը, կարող եք անտեսել այս նամակը։`],
    ru: ['Код подтверждения InOne', ({ code }) => `Ваш код подтверждения: ${code}. Код действует 10 минут. Если вы не начинали регистрацию, проигнорируйте это письмо.`],
    en: ['Your InOne verification code', ({ code }) => `Your verification code is ${code}. It expires in 10 minutes. If you did not start registration, you can ignore this email.`],
  },
  backup_email_verification: {
    hy: ['Հաստատեք պահուստային էլ․ փոստը', ({ code }) => `Այս հասցեն նշվել է որպես ձեր InOne հաշվի պահուստային էլ․ փոստ։ Հաստատման կոդն է՝ ${code}։ Կոդը վավեր է 10 րոպե։ Եթե դա դուք չեք արել, անտեսեք այս նամակը։`],
    ru: ['Подтверждение резервной почты InOne', ({ code }) => `Этот адрес указан как резервная почта вашего аккаунта InOne. Код подтверждения: ${code}. Он действует 10 минут. Если это сделали не вы, проигнорируйте письмо.`],
    en: ['Verify your InOne backup email', ({ code }) => `This address was added as a backup email for your InOne account. Your verification code is ${code}. It expires in 10 minutes. If this was not you, ignore this email.`],
  },
  backup_email_changed: {
    hy: ['Փոխվել է պահուստային էլ․ փոստը', ({ action }) => `Ձեր InOne հաշվի պահուստային էլ․ փոստը ${action === 'added' ? 'ավելացվել է' : 'փոփոխվել է'}։ Եթե դա դուք չեք արել, ստուգեք ձեր հաշվի անվտանգությունը և միացված սարքերը։`],
    ru: ['Изменена резервная почта InOne', ({ action }) => `Резервная почта вашего аккаунта InOne ${action === 'added' ? 'добавлена' : 'изменена'}. Если это сделали не вы, проверьте безопасность аккаунта и подключённые устройства.`],
    en: ['Your InOne backup email changed', ({ action }) => `The backup email for your InOne account was ${action === 'added' ? 'added' : 'changed'}. If this was not you, review your account security and connected devices.`],
  },
  backup_email_removed: {
    hy: ['Հեռացվել է պահուստային էլ․ փոստը', () => 'Ձեր InOne հաշվից հեռացվել է պահուստային էլ․ փոստը։ Եթե դա դուք չեք արել, ստուգեք ձեր հաշվի անվտանգությունը և միացված սարքերը։'],
    ru: ['Резервная почта InOne удалена', () => 'Резервная почта удалена из вашего аккаунта InOne. Если это сделали не вы, проверьте безопасность аккаунта и подключённые устройства.'],
    en: ['Your InOne backup email was removed', () => 'The backup email was removed from your InOne account. If this was not you, review your account security and connected devices.'],
  },
  stepup_code: {
    hy: ['Հաստատեք գործողությունը InOne-ում', ({ code, action }) => `Դուք սկսել եք հետևյալ գործողությունը՝ ${action}։ Հաստատման կոդն է՝ ${code}։ Կոդը վավեր է 10 րոպե։ Եթե դա դուք չեք արել, մի՛ օգտագործեք կոդը և ստուգեք ձեր հաշվի անվտանգությունը։`],
    ru: ['Подтверждение действия в InOne', ({ code, action }) => `Вы запросили действие: ${action}. Код подтверждения: ${code}. Он действует 10 минут. Если это сделали не вы, не используйте код и проверьте безопасность аккаунта.`],
    en: ['Confirm an action in InOne', ({ code, action }) => `You requested this action: ${action}. Your confirmation code is ${code}. It expires in 10 minutes. If this was not you, do not use the code and review your account security.`],
  },
  pin_reset_code: {
    hy: ['Վերականգնման PIN-ի փոփոխություն', ({ code }) => `Դուք սկսել եք InOne-ի վերականգնման PIN-ի փոփոխությունը։ Հաստատման կոդը՝ ${code}։ Այն վավեր է 60 րոպե։ Եթե դա դուք չեք արել, մի՛ օգտագործեք կոդը և ստուգեք ձեր հաշվի անվտանգությունը։`],
    ru: ['Изменение PIN-кода восстановления', ({ code }) => `Вы начали изменение PIN-кода восстановления InOne. Код подтверждения: ${code}. Он действует 60 минут. Если это сделали не вы, не используйте код и проверьте безопасность аккаунта.`],
    en: ['Change recovery PIN', ({ code }) => `You started changing your InOne recovery PIN. Your confirmation code is ${code}. It expires in 60 minutes. If this was not you, do not use the code and review your account security.`],
  },
  pin_changed: {
    hy: ['Վերականգնման PIN-ը փոխվել է', () => 'Ձեր InOne հաշվի վերականգնման PIN-ը փոխվել է։ Եթե դա դուք չեք արել, անմիջապես ստուգեք ձեր հաշվի անվտանգությունը։'],
    ru: ['PIN-код восстановления изменён', () => 'PIN-код восстановления вашего аккаунта InOne был изменён. Если это сделали не вы, немедленно проверьте безопасность аккаунта.'],
    en: ['Recovery PIN changed', () => 'The recovery PIN for your InOne account has been changed. If this was not you, review your account security immediately.'],
  },
  old_devices_revoked: {
    hy: ['Հին սարքերն անջատվել են', () => 'Հաշվի վերականգնումից հետո 48-ժամյա սպասման ժամկետն ավարտվել է։ Մինչև վերականգնումը միացված սարքերն այժմ անջատված են։'],
    ru: ['Старые устройства отключены', () => 'После восстановления аккаунта завершился период ожидания в 48 часов. Устройства, подключённые до восстановления, теперь отключены.'],
    en: ['Previous devices have been disconnected', () => 'The 48-hour waiting period after account recovery has ended. Devices connected before recovery have now been disconnected.'],
  },
  recovery_login_code: {
    hy: ['Մուտքի հաստատում վերականգնումից հետո', ({ code }) => `Նոր սարքից մուտք գործելու հաստատման կոդն է՝ ${code}։ Եթե այս հարցումը դուք չեք կատարել, չեղարկեք վերականգնումը այն սարքից, որն օգտագործում էիք մինչև հարցումը։`],
    ru: ['Подтверждение входа после восстановления', ({ code }) => `Код для подтверждения входа с нового устройства: ${code}. Если вы не отправляли этот запрос, отмените восстановление с устройства, которым пользовались до запроса.`],
    en: ['Confirm sign-in after account recovery', ({ code }) => `Use this code to confirm sign-in on your new device: ${code}. If you did not make this request, cancel recovery from a device you used before the request.`],
  },
  new_device_wait: {
    hy: ['Նոր սարքից մուտք․ 48-ժամյա սպասում', ({ activateAt, code }) => `Նոր սարքից մուտքը հասանելի կլինի ${activateAt}։ Եթե դա դուք չեք նախաձեռնել, չեղարկեք մուտքը՝ չեղարկման էկրանին օգտագործելով այս կոդը՝ ${code}։`],
    ru: ['Вход с нового устройства: ожидание 48 часов', ({ activateAt, code }) => `Вход с нового устройства станет доступен ${activateAt}. Если это сделали не вы, отмените вход на экране отмены с помощью кода: ${code}.`],
    en: ['New device sign-in: 48-hour waiting period', ({ activateAt, code }) => `Sign-in on the new device will be available at ${activateAt}. If this was not you, cancel the sign-in from the cancellation screen using this code: ${code}.`],
  },
  recovery_code: {
    hy: ['InOne հաշվի վերականգնման կոդը', ({ code }) => `Ձեր հաշվի վերականգնման կոդն է՝ ${code}։ Կոդը վավեր է մեկ ժամ։ Մուտքը հասանելի կլինի միայն գաղտնաբառի փոփոխությունից 48 ժամ անց։ Եթե հարցումը դուք չեք կատարել, մի՛ օգտագործեք կոդը։`],
    ru: ['Код восстановления аккаунта InOne', ({ code }) => `Код восстановления вашего аккаунта: ${code}. Он действует один час. Вход станет доступен только через 48 часов после смены пароля. Если вы не запрашивали восстановление, не используйте код.`],
    en: ['Your InOne account recovery code', ({ code }) => `Your account recovery code is ${code}. It expires in one hour. Sign-in will be available only 48 hours after the password change. If you did not request recovery, do not use this code.`],
  },
  recovery_requested: {
    hy: ['Հարցում է ստացվել հաշիվը վերականգնելու համար', () => 'Ստացվել է ձեր InOne հաշվի հասանելիությունը վերականգնելու հարցում։ Մեկանգամյա կոդն ուղարկվել է միայն ձեր հաստատված հիմնական էլ․ փոստին։ Պահուստային հասցեին կարող է ուղարկվել միայն անվտանգության ծանուցում։ Եթե հարցումը դուք չեք կատարել, մի՛ տրամադրեք որևէ կոդ և ստուգեք ձեր սարքերը։'],
    ru: ['Запрошено восстановление аккаунта InOne', () => 'Получен запрос на восстановление доступа к вашему аккаунту InOne. Одноразовый код отправлен только на подтверждённую основную почту. На резервный адрес может прийти только уведомление безопасности. Если это сделали не вы, никому не сообщайте коды и проверьте свои устройства.'],
    en: ['An InOne account recovery was requested', () => 'A request to recover access to your InOne account was received. The one-time code was sent only to your verified primary email. A backup address may receive a security notice only. If this was not you, do not share any codes and review your devices.'],
  },
  recovery_confirmation_link: {
    hy: ['Հաստատեք հաշվի վերականգնումը', ({ url, appUrl }) => `Բջջային հավելվածում հաստատելու համար բացեք InOne հղումը՝ ${appUrl}։ Վեբ տարբերակը՝ ${url}։ Հղումը վավեր է մեկ ժամ։ Եթե հարցումը դուք չեք կատարել, մի՛ բացեք հղումը։`],
    ru: ['Подтвердите восстановление аккаунта', ({ url, appUrl }) => `Для подтверждения в приложении InOne откройте ссылку: ${appUrl}. Веб-версия: ${url}. Ссылка действует один час. Если вы не отправляли запрос, не открывайте её.`],
    en: ['Confirm your account recovery', ({ url, appUrl }) => `To confirm in the InOne app, open: ${appUrl}. Web fallback: ${url}. The link expires in one hour. If you did not make this request, do not open it.`],
  },
  recovery_cancelled: {
    hy: ['Հաշվի վերականգնումը չեղարկվել է', ({ method }) => method === 'code' ? 'Հաշվի վերականգնումը չեղարկվել է չեղարկման կոդով։ Ձեր նախկին գաղտնաբառը վերականգնվել է։' : 'Հաշվի վերականգնումը չեղարկվել է մինչև հարցումը օգտագործվող սարքից։ Ձեր նախկին գաղտնաբառը վերականգնվել է։'],
    ru: ['Восстановление аккаунта отменено', ({ method }) => method === 'code' ? 'Восстановление аккаунта отменено с помощью кода отмены. Прежний пароль восстановлен.' : 'Восстановление аккаунта отменено с устройства, которым пользовались до запроса. Прежний пароль восстановлен.'],
    en: ['Account recovery was cancelled', ({ method }) => method === 'code' ? 'Account recovery was cancelled using the cancellation code. Your previous password has been restored.' : 'Account recovery was cancelled from a device used before the request. Your previous password has been restored.'],
  },
  recovery_completed: {
    hy: ['Հաշվի վերականգնումն ավարտված է', ({ cancelCode }) => `Ձեր գաղտնաբառը փոխվել է։ Նոր սարքերից մուտքը հասանելի կլինի 48 ժամ անց։ Վերականգնումը կարող եք չեղարկել մինչև հարցումը օգտագործվող սարքից կամ այս կոդով՝ ${cancelCode}։`],
    ru: ['Восстановление аккаунта завершено', ({ cancelCode }) => `Ваш пароль изменён. Вход с новых устройств станет доступен через 48 часов. Вы можете отменить восстановление с устройства, которым пользовались до запроса, или с помощью кода: ${cancelCode}.`],
    en: ['Account recovery completed', ({ cancelCode }) => `Your password has been changed. Sign-in from new devices will be available in 48 hours. You can cancel recovery from a device used before the request or with this code: ${cancelCode}.`],
  },
};

const REQUIRED_VARIABLES = {
  registration_code: ['code'],
  backup_email_verification: ['code'],
  backup_email_changed: ['action'],
  backup_email_removed: [],
  stepup_code: ['code', 'action'],
  pin_reset_code: ['code'],
  pin_changed: [],
  old_devices_revoked: [],
  recovery_login_code: ['code'],
  new_device_wait: ['activateAt', 'code'],
  recovery_code: ['code'],
  recovery_requested: [],
  recovery_confirmation_link: ['url', 'appUrl'],
  recovery_cancelled: ['method'],
  recovery_completed: ['cancelCode'],
};

const STEPUP_ACTION_LABELS = {
  hy: {
    'link-provider': 'Google կամ Apple հաշվի միացում',
    'remove-provider': 'Google կամ Apple հաշվի անջատում',
    'set-backup-email': 'պահուստային էլ․ փոստի ավելացում կամ փոփոխություն',
    'remove-backup-email': 'պահուստային էլ․ փոստի հեռացում',
    'enable-biometric': 'Face ID կամ Touch ID հաստատման միացում',
    'disable-biometric': 'Face ID կամ Touch ID հաստատման անջատում',
  },
  ru: {
    'link-provider': 'подключение аккаунта Google или Apple',
    'remove-provider': 'отключение аккаунта Google или Apple',
    'set-backup-email': 'добавление или изменение резервной почты',
    'remove-backup-email': 'удаление резервной почты',
    'enable-biometric': 'включение подтверждения Face ID или Touch ID',
    'disable-biometric': 'отключение подтверждения Face ID или Touch ID',
  },
  en: {
    'link-provider': 'linking a Google or Apple account',
    'remove-provider': 'unlinking a Google or Apple account',
    'set-backup-email': 'adding or changing the backup email',
    'remove-backup-email': 'removing the backup email',
    'enable-biometric': 'enabling Face ID or Touch ID confirmation',
    'disable-biometric': 'disabling Face ID or Touch ID confirmation',
  },
};

const COPY = {
  hy: { preheader: 'Անվտանգության ծանուցում ձեր InOne հաշվից', brand: 'Ձեր թվային տարածքը', footer: 'Այս նամակն ուղարկվել է ավտոմատ կերպով։ Խնդրում ենք չպատասխանել դրան։', security: 'Անվտանգության ծանուցում', action: 'Հաստատել հաշվի վերականգնումը', codeLabel: 'Հաստատման կոդ', expiry: 'Մի՛ փոխանցեք այս կոդը որևէ մեկին։', ignore: 'Եթե այս գործողությունը դուք չեք նախաձեռնել, կարող եք անտեսել այս նամակը։' },
  ru: { preheader: 'Уведомление безопасности вашего аккаунта InOne', brand: 'Ваше цифровое пространство', footer: 'Это автоматическое письмо. Пожалуйста, не отвечайте на него.', security: 'Уведомление безопасности', action: 'Подтвердить восстановление', codeLabel: 'Код подтверждения', expiry: 'Никому не сообщайте этот код.', ignore: 'Это уведомление относится к вашему аккаунту InOne. Если действие вам незнакомо, проверьте безопасность аккаунта.' },
  en: { preheader: 'A security notification from your InOne account', brand: 'Your digital space', footer: 'This is an automated message. Please do not reply.', security: 'Security notification', action: 'Confirm account recovery', codeLabel: 'Verification code', expiry: 'Never share this code with anyone.', ignore: 'This notification relates to your InOne account. If the activity looks unfamiliar, review your account security.' },
};

function safeVariables(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('email template variables must be an object');
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`invalid email template variable: ${key}`);
    const text = String(value);
    if (text.length > 2048 || [...text].some((char) => char.charCodeAt(0) < 32 && char !== '\n' || char.charCodeAt(0) === 127)) throw new Error('unsafe email template variable: ' + key);
    result[key] = text;
  }
  return result;
}

function safeRecoveryAppUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('invalid recovery app URL'); }
  const keys = [...parsed.searchParams.keys()];
  const user = parsed.searchParams.get('user') ?? '';
  const token = parsed.searchParams.get('token') ?? '';
  const locale = parsed.searchParams.get('locale') ?? '';
  if (parsed.protocol !== 'inone:' || parsed.hostname !== 'recovery' || parsed.pathname !== '/confirm'
    || parsed.username || parsed.password || parsed.port || parsed.hash
    || keys.length !== 3 || new Set(keys).size !== 3
    || keys.some((key) => !['user', 'token', 'locale'].includes(key))
    || !user.trim() || user.length > 256 || /[\u0000-\u001f\u007f]/.test(user)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(token)
    || !['hy', 'ru', 'en'].includes(locale)) {
    throw new Error('recovery app URL must be a valid InOne recovery deep link');
  }
  return parsed.toString();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function renderHtml({ subject, text, locale, templateId, variables }) {
  const copy = COPY[locale];
  const code = ['registration_code', 'backup_email_verification', 'stepup_code', 'pin_reset_code', 'recovery_login_code', 'recovery_code'].includes(templateId)
    ? variables.code
    : null;
  const paragraphs = text.split('\n').map((line) => `<p style="margin:0 0 16px;color:#4A5147;font-size:15px;line-height:1.7;word-break:break-word;">${escapeHtml(line)}</p>`).join('');
  let content = paragraphs;
  if (code) {
    content = content.replace(
      paragraphs,
      `<p style="margin:0 0 12px;color:#4A5147;font-size:15px;line-height:1.7;">${escapeHtml(copy.codeLabel)}</p><div style="margin:0 0 20px;padding:18px 20px;background:#F1F8E3;border:1px solid #D8E9B8;border-radius:14px;color:#171A14;font-family:'Noto Sans Armenian','Noto Sans',Arial,sans-serif;font-size:30px;font-weight:700;letter-spacing:5px;text-align:center;">${escapeHtml(code)}</div>${paragraphs}`
    );
  }
  if (templateId === 'recovery_confirmation_link') {
    const safeAppUrl = safeRecoveryAppUrl(variables.appUrl);
    content += `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 8px;"><tr><td bgcolor="#C9F53F" style="border-radius:12px;"><a href="${escapeHtml(safeAppUrl)}" style="display:inline-block;padding:14px 22px;color:#171A14;text-decoration:none;font-family:'Noto Sans Armenian','Noto Sans',Arial,sans-serif;font-size:14px;font-weight:700;border-radius:12px;">${escapeHtml(copy.action)}</a></td></tr></table>`;
  }
  const preheader = escapeHtml(copy.preheader);
  const safeSubject = escapeHtml(subject);
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${safeSubject}</title></head><body style="margin:0;padding:0;background:#EEF1EA;font-family:'Noto Sans Armenian','Noto Sans',Arial,sans-serif;-webkit-font-smoothing:antialiased;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#EEF1EA" style="background:#EEF1EA;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;"><tr><td style="padding:0 0 18px 4px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:0 0 14px;color:#171A14;font-size:23px;font-weight:700;letter-spacing:-.6px;border-bottom:3px solid #C9F53F;">InOne</td></tr></table></td></tr><tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid #E4E7E0;border-radius:20px;padding:32px 30px 28px;"><div style="margin:0 0 20px;"><span style="display:inline-block;padding:6px 10px;border:1px solid #1B1F17;border-radius:999px;background:#1B1F17;color:#C9F53F;font-size:11px;font-weight:700;letter-spacing:.02em;">${escapeHtml(copy.security)}</span></div><h1 style="margin:0 0 18px;color:#171A14;font-family:'Noto Sans Armenian','Noto Sans',Arial,sans-serif;font-size:23px;font-weight:700;line-height:1.35;letter-spacing:-.3px;">${safeSubject}</h1>${content}<div style="margin-top:24px;padding-top:18px;border-top:1px solid #E4E7E0;color:#6B7268;font-size:12px;line-height:1.6;">${escapeHtml(copy.ignore)}</div></td></tr><tr><td align="center" style="padding:20px 12px 0;color:#8C9487;font-size:11px;line-height:1.6;">${escapeHtml(copy.brand)}<br>${escapeHtml(copy.footer)}</td></tr></table></td></tr></table></body></html>`;
}

export function renderEmailTemplate(templateId, variables = {}, locale = 'hy') {
  const template = CATALOG[templateId];
  if (!template) throw new Error('unknown email template');
  if (!SUPPORTED_EMAIL_LOCALES.has(locale)) throw new Error('unsupported email locale');
  const language = locale;
  const resolvedLocale = template[language] ? language : 'hy';
  const [subject, render] = template[resolvedLocale];
  const values = safeVariables(variables);
  for (const key of REQUIRED_VARIABLES[templateId] ?? []) if (!(key in values)) throw new Error('missing email template variable: ' + key);
  if (templateId === 'backup_email_changed' && !['added', 'changed'].includes(values.action)) throw new Error('invalid email action');
  if (templateId === 'stepup_code' && !Object.hasOwn(STEPUP_ACTION_LABELS.hy, values.action)) throw new Error('invalid step-up action');
  if (templateId === 'recovery_confirmation_link') {
    let parsed;
    try { parsed = new URL(values.url); } catch { throw new Error('invalid recovery URL'); }
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || /[\r\n]/.test(values.url)) throw new Error('recovery URL must be a safe HTTPS URL');
  }
  if (templateId === 'recovery_cancelled' && !['code', 'device'].includes(values.method)) throw new Error('invalid recovery cancellation method');
  let renderValues = templateId === 'stepup_code' ? { ...values, action: STEPUP_ACTION_LABELS[resolvedLocale][values.action] } : values;
  if (templateId === 'recovery_confirmation_link') {
    const appUrl = safeRecoveryAppUrl(values.appUrl);
    if (new URL(appUrl).searchParams.get('locale') !== resolvedLocale) throw new Error('recovery app URL locale must match email locale');
    renderValues = { ...values, appUrl };
  }
  const text = render(renderValues);
  const ttlMs = ['registration_code', 'backup_email_verification', 'stepup_code'].includes(templateId)
    ? 10 * 60_000
    : ['recovery_login_code', 'recovery_code', 'recovery_confirmation_link', 'pin_reset_code'].includes(templateId)
      ? 60 * 60_000
      : ['new_device_wait', 'recovery_completed'].includes(templateId) ? 48 * 60 * 60_000 : 7 * 24 * 60 * 60_000;
  const result = { subject, text, html: renderHtml({ subject, text, locale: resolvedLocale, templateId, variables: renderValues }), locale: resolvedLocale, templateId, templateVersion: 2, ttlMs };
  if (result.html.length > 128 * 1024) throw new Error('email HTML exceeds size limit');
  return result;
}

export function listEmailTemplates() {
  return Object.keys(CATALOG).sort();
}
