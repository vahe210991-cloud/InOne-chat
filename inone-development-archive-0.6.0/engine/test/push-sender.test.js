import test from 'node:test';
import assert from 'node:assert/strict';
import { createFcmPushSender, FcmPushError, classifyFcmError } from '../src/fcm-push-sender.js';
import { createFirebaseAdminPushSender } from '../src/firebase-admin-push.js';

const target = 'AbCdEf0123456789_-AbCd';
const payload = { type: 'message', event_id: '$event-123', path: '/rooms/room_1/events/%24event-123' };

test('FCM sender targets the FID field and sends only allowlisted data', async () => {
  let sent;
  const sender = createFcmPushSender({ messaging: { send: async (message) => { sent = message; return 'projects/p/messages/1'; } } });
  const result = await sender.send({ fid: target, payload });
  assert.deepEqual(sent, { fid: target, notification: { title: 'InOne', body: 'New message' }, data: payload });
  assert.deepEqual(result, { provider: 'fcm', messageId: 'projects/p/messages/1' });
  assert.equal(Object.hasOwn(sent, 'token'), false);
});

test('FCM sender rejects invalid FID and unsafe payload before provider call', async () => {
  let calls = 0;
  const sender = createFcmPushSender({ messaging: { send: async () => { calls += 1; return 'id'; } } });
  await assert.rejects(sender.send({ fid: 'not-a-fid', payload }), (error) => error instanceof FcmPushError && error.code === 'invalid_target');
  await assert.rejects(sender.send({ fid: target, payload: { ...payload, preview: 'secret' } }), (error) => error.code === 'invalid_payload');
  assert.equal(calls, 0);
});

test('provider failures are reduced to safe retry classifications', async () => {
  const transient = createFcmPushSender({ messaging: { send: async () => { throw { code: 'messaging/server-unavailable', message: 'contains sensitive provider details' }; } } });
  await assert.rejects(transient.send({ fid: target, payload }), (error) => {
    assert.equal(error.code, 'provider_temporary');
    assert.equal(error.retryable, true);
    assert.equal(error.message.includes('sensitive'), false);
    return true;
  });
  assert.deepEqual(classifyFcmError({ code: 'messaging/registration-token-not-registered' }), { code: 'invalid_target', retryable: false });
});

test('production factory uses ADC and Admin SDK fid addressing', async () => {
  const calls = [];
  const fakeApp = { name: 'inone-push', options: { projectId: 'inone-messenger' } };
  const sender = await createFirebaseAdminPushSender({
    projectId: 'inone-messenger',
    sdk: {
      appApi: {
        getApps: () => [],
        applicationDefault: () => ({ kind: 'adc' }),
        initializeApp: (options, name) => { calls.push({ options, name }); return fakeApp; },
      },
      messagingApi: {
        getMessaging: () => ({ send: async (message) => { calls.push(message); return 'fcm-message-id'; } }),
      },
    },
  });
  const result = await sender.send({ fid: target, payload });
  assert.equal(result.messageId, 'fcm-message-id');
  assert.equal(calls[1].fid, target);
  assert.equal(Object.hasOwn(calls[1], 'token'), false);
});

test('production factory rejects mismatched service account project', async () => {
  await assert.rejects(createFirebaseAdminPushSender({
    projectId: 'inone-messenger',
    serviceAccountJson: JSON.stringify({ project_id: 'another-project', client_email: 'x@example.test', private_key: 'x' }),
    sdk: { appApi: { cert: () => { throw new Error('must not be reached'); } }, messagingApi: {} },
  }), /does not match configured project/);
});
