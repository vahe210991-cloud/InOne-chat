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
  recovery_confirmation_link: { url: 'https://inone.example/recovery/confirm?token=opaque' },
  recovery_cancelled: { method: 'code' },
  recovery_completed: { cancelCode: '482913' },
};

test('все почтовые шаблоны имеют RU/EN варианты и ожидаемые сроки жизни', () => {
  const ids = listEmailTemplates();
  assert.equal(ids.length, 13);
  for (const id of ids) {
    for (const locale of ['ru', 'en']) {
      const rendered = renderEmailTemplate(id, fixtures[id], locale);
      assert.equal(rendered.templateId, id);
      assert.equal(rendered.templateVersion, 1);
      assert.equal(rendered.locale, locale);
      assert.ok(rendered.subject.length > 0);
      assert.ok(rendered.text.length > 0);
      assert.ok(!rendered.subject.includes('\r') && !rendered.subject.includes('\n'));
    }
  }
  assert.equal(renderEmailTemplate('registration_code', fixtures.registration_code).ttlMs, 10 * 60_000);
  assert.equal(renderEmailTemplate('recovery_code', fixtures.recovery_code).ttlMs, 60 * 60_000);
  assert.equal(renderEmailTemplate('new_device_wait', fixtures.new_device_wait).ttlMs, 48 * 60 * 60_000);
  assert.equal(renderEmailTemplate('recovery_completed', fixtures.recovery_completed).ttlMs, 48 * 60 * 60_000);
});

test('неизвестный шаблон и недостающие переменные отклоняются', () => {
  assert.throws(() => renderEmailTemplate('unknown', {}), /unknown email template/);
  assert.throws(() => renderEmailTemplate('registration_code', {}), /missing email template variable/);
});

test('управляющие символы не допускаются в значениях шаблона', () => {
  assert.throws(() => renderEmailTemplate('recovery_confirmation_link', { url: 'https://example.test/\r\nBcc:x' }), /unsafe email template variable/);
});
