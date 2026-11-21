import { createFcmPushSender } from './fcm-push-sender.js';

/**
 * Creates the production Firebase Admin sender. Credentials are loaded from
 * Application Default Credentials unless a JSON secret is supplied explicitly.
 * The secret is parsed in memory and is never logged or written to disk.
 */
export async function createFirebaseAdminPushSender({
  projectId,
  serviceAccountJson = '',
  sdk = null,
} = {}) {
  if (typeof projectId !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new Error('INONE_FIREBASE_PROJECT_ID is required and must be a valid project ID');
  }

  const appApi = sdk?.appApi ?? await import('firebase-admin/app');
  const messagingApi = sdk?.messagingApi ?? await import('firebase-admin/messaging');
  const appName = 'inone-push';
  let credential;
  if (serviceAccountJson) {
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(serviceAccountJson);
    } catch {
      throw new Error('INONE_FIREBASE_SERVICE_ACCOUNT_JSON must contain valid JSON');
    }
    if (serviceAccount.project_id !== projectId
        || typeof serviceAccount.client_email !== 'string'
        || typeof serviceAccount.private_key !== 'string') {
      throw new Error('Firebase service account does not match configured project');
    }
    credential = appApi.cert(serviceAccount);
  } else {
    credential = appApi.applicationDefault();
  }

  const existing = appApi.getApps().find((app) => app.name === appName);
  const app = existing ?? appApi.initializeApp({ credential, projectId }, appName);
  if (app.options?.projectId && app.options.projectId !== projectId) {
    throw new Error('existing Firebase Admin app uses a different project');
  }
  const messaging = messagingApi.getMessaging(app);
  return createFcmPushSender({ messaging });
}
