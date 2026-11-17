import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listEmailTemplates, renderEmailTemplate } from '../src/email-templates.js';

const fixtures = {
  registration_code: { code: '482913' },
  backup_email_verification: { code: '482913' },
  backup_email_changed: { action: 'added' },
  backup_email_removed: {},
  stepup_code: { code: '482913', action: 'remove-provider' },
  old_devices_revoked: {},
  recovery_login_code: { code: '482913' },
  new_device_wait: { activateAt: '2026-11-17T12:00:00.000Z', code: '482913' },
  recovery_code: { code: '482913' },
  recovery_requested: {},
  recovery_confirmation_link: { url: 'https://inone.example/recovery/confirm?token=opaque', appUrl: 'inone://recovery/confirm?user=user%40example.test&token=opaque_123&locale=hy' },
  recovery_cancelled: { method: 'code' },
  recovery_completed: { cancelCode: '482913' },
};

test('все почтовые шаблоны имеют HY/RU/EN варианты и ожидаемые сроки жизни', () => {
  const ids = listEmailTemplates();
  assert.equal(ids.length, 13);
  for (const id of ids) {
    for (const locale of ['hy', 'ru', 'en']) {
      const values = id === 'recovery_confirmation_link'
        ? { ...fixtures[id], appUrl: `inone://recovery/confirm?user=user%40example.test&token=opaque_123&locale=${locale}` }
        : fixtures[id];
      const rendered = renderEmailTemplate(id, values, locale);
      assert.equal(rendered.templateId, id);
      assert.equal(rendered.templateVersion, 2);
      assert.equal(rendered.locale, locale);
      assert.ok(rendered.subject.length > 0);
      assert.ok(rendered.text.length > 0);
      assert.ok(rendered.html.startsWith('<!doctype html>'));
      assert.ok(rendered.html.includes('InOne'));
      assert.ok(rendered.html.includes('Noto Sans Armenian'));
      assert.ok(!rendered.html.includes('undefined'));
      assert.ok(!rendered.subject.includes('\r') && !rendered.subject.includes('\n'));
    }
  }
  assert.equal(renderEmailTemplate('registration_code', fixtures.registration_code).locale, 'hy');
  assert.match(renderEmailTemplate('registration_code', fixtures.registration_code).subject, /հաստատման/);
  assert.equal(renderEmailTemplate('registration_code', fixtures.registration_code).ttlMs, 10 * 60_000);
  assert.equal(renderEmailTemplate('recovery_code', fixtures.recovery_code).ttlMs, 60 * 60_000);
  assert.equal(renderEmailTemplate('new_device_wait', fixtures.new_device_wait).ttlMs, 48 * 60 * 60_000);
  assert.equal(renderEmailTemplate('recovery_completed', fixtures.recovery_completed).ttlMs, 48 * 60 * 60_000);
});

test('неизвестный шаблон и недостающие переменные отклоняются', () => {
  assert.throws(() => renderEmailTemplate('unknown', {}), /unknown email template/);
  assert.throws(() => renderEmailTemplate('registration_code', fixtures.registration_code, 'de'), /unsupported email locale/);
  assert.throws(() => renderEmailTemplate('registration_code', {}), /missing email template variable/);
});

test('управляющие символы не допускаются в значениях шаблона', () => {
  assert.throws(() => renderEmailTemplate('recovery_confirmation_link', { url: 'https://example.test/\r\nBcc:x', appUrl: fixtures.recovery_confirmation_link.appUrl }), /unsafe email template variable/);
});

test('step-up action names are localized from stable action identifiers', () => {
  assert.match(renderEmailTemplate('stepup_code', fixtures.stepup_code, 'hy').text, /Google կամ Apple հաշվի անջատում/);
  assert.match(renderEmailTemplate('stepup_code', fixtures.stepup_code, 'ru').text, /отключение аккаунта Google или Apple/);
  assert.match(renderEmailTemplate('stepup_code', fixtures.stepup_code, 'en').text, /unlinking a Google or Apple account/);
  assert.throws(() => renderEmailTemplate('stepup_code', { code: '482913', action: 'untrusted text' }, 'hy'), /invalid step-up action/);
});

test('HTML templates escape untrusted variables and only render HTTPS recovery actions', () => {
  const injected = renderEmailTemplate('stepup_code', { code: '<img src=x onerror=alert(1)>', action: 'remove-provider' }, 'hy');
  assert.ok(!injected.html.includes('<img src=x'));
  assert.ok(injected.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(injected.html.includes('Google կամ Apple հաշվի անջատում'));
  const appUrl = 'inone://recovery/confirm?user=user%40example.test&token=opaque_123&locale=hy';
  assert.throws(() => renderEmailTemplate('recovery_confirmation_link', { url: 'javascript:alert(1)', appUrl }, 'hy'), /safe HTTPS URL/);
  assert.throws(() => renderEmailTemplate('recovery_confirmation_link', { url: 'https://user:pass@example.test/recovery', appUrl }, 'hy'), /safe HTTPS URL/);
  assert.throws(() => renderEmailTemplate('recovery_confirmation_link', { url: 'https://example.test/\nmalicious', appUrl }, 'hy'), /unsafe email template variable|safe HTTPS URL/);
  assert.throws(() => renderEmailTemplate('recovery_confirmation_link', { url: 'https://inone.example/confirm', appUrl: 'https://evil.example/recovery/confirm?user=alice&token=opaque_123&locale=hy' }, 'hy'), /InOne recovery deep link/);
  assert.throws(() => renderEmailTemplate('recovery_confirmation_link', { url: 'https://inone.example/confirm', appUrl: 'inone://recovery/confirm?user=alice%0Aadmin&token=opaque_123&locale=hy' }, 'hy'), /InOne recovery deep link/);
  assert.throws(() => renderEmailTemplate('recovery_confirmation_link', { url: 'https://inone.example/confirm', appUrl }, 'ru'), /locale must match email locale/);
  const safeUrl = renderEmailTemplate('recovery_confirmation_link', { url: 'https://inone.example/confirm?token=a%26b', appUrl }, 'hy');
  assert.ok(safeUrl.html.includes('href="inone://recovery/confirm?user=user%40example.test&amp;token=opaque_123&amp;locale=hy"'));
  assert.ok(safeUrl.html.includes('https://inone.example/confirm?token=a%26b'));
  assert.ok(safeUrl.html.includes('Հաստատել հաշվի վերականգնումը'));
});
