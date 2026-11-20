const FID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const ALLOWED_TYPES = new Set(['message']);

export class FcmPushError extends Error {
  constructor(code, retryable, message = 'FCM push send failed') {
    super(message);
    this.name = 'FcmPushError';
    this.code = code;
    this.retryable = retryable;
  }
}

function validateMessage({ fid, payload }) {
  if (typeof fid !== 'string' || !FID_PATTERN.test(fid)) {
    throw new FcmPushError('invalid_target', false, 'invalid Firebase Installation ID');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new FcmPushError('invalid_payload', false, 'invalid push payload');
  }
  const keys = Object.keys(payload);
  if (keys.some((key) => !['type', 'event_id', 'path'].includes(key))
      || payload.type !== 'message'
      || !ALLOWED_TYPES.has(payload.type)
      || typeof payload.event_id !== 'string'
      || payload.event_id.length < 1 || payload.event_id.length > 128
      || typeof payload.path !== 'string'
      || !/^\/rooms\/[A-Za-z0-9._~!$&'()*+,;=:@%-]{1,512}\/events\/[A-Za-z0-9._~!$&'()*+,;=:@%-]{1,128}$/.test(payload.path)) {
    throw new FcmPushError('invalid_payload', false, 'push payload is not allowlisted');
  }
  return {
    type: payload.type,
    event_id: payload.event_id,
    path: payload.path,
  };
}

export function classifyFcmError(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if ([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
  ].includes(code)) return { code: 'invalid_target', retryable: false };
  if (['messaging/invalid-argument', 'messaging/invalid-payload'].includes(code)) {
    return { code: 'provider_permanent', retryable: false };
  }
  if ([
    'messaging/authentication-error',
    'app/invalid-credential',
    'messaging/mismatched-credential',
  ].includes(code)) return { code: 'provider_configuration', retryable: false };
  if ([
    'messaging/quota-exceeded',
    'messaging/server-unavailable',
    'messaging/internal-error',
    'app/network-error',
  ].includes(code)) return { code: 'provider_temporary', retryable: true };
  return { code: 'provider_unknown', retryable: true };
}

/**
 * FCM sender for Firebase Installation IDs. The injected Messaging instance makes
 * transport behavior testable without credentials or network access.
 */
export function createFcmPushSender({ messaging } = {}) {
  if (!messaging || typeof messaging.send !== 'function') {
    throw new Error('FCM sender requires a Firebase Admin Messaging instance');
  }
  return {
    async send({ fid, payload }) {
      const data = validateMessage({ fid, payload });
      try {
        const messageId = await messaging.send({
          fid,
          notification: { title: 'InOne', body: 'New message' },
          data,
        });
        if (typeof messageId !== 'string' || messageId.length === 0) {
          throw new FcmPushError('provider_invalid_response', true, 'FCM returned an invalid response');
        }
        return { provider: 'fcm', messageId };
      } catch (error) {
        if (error instanceof FcmPushError) throw error;
        const classified = classifyFcmError(error);
        throw new FcmPushError(classified.code, classified.retryable);
      }
    },
  };
}
