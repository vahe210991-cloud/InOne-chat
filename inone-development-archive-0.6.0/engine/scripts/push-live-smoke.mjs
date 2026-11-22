import pg from 'pg';
import { createFirebaseAdminPushSender } from '../src/firebase-admin-push.js';
import { decryptPushFid, parsePushEncryptionKey } from '../src/push-crypto.js';

const required = ['DATABASE_URL', 'INONE_FIREBASE_PROJECT_ID', 'INONE_PUSH_ENCRYPTION_KEY', 'INONE_PUSH_SMOKE_DEVICE_KEY'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required for a live push smoke test`);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
let key;
try {
  key = parsePushEncryptionKey(process.env.INONE_PUSH_ENCRYPTION_KEY);
  const deviceKey = process.env.INONE_PUSH_SMOKE_DEVICE_KEY;
  const { rows } = await pool.query(
    `SELECT p.device_key, p.token_ciphertext, p.token_iv, p.token_tag
     FROM push_tokens p JOIN devices d ON d.device_key = p.device_key
     WHERE p.device_key = $1 AND d.revoked = FALSE
       AND p.provider = 'fcm' AND p.identifier_kind = 'fid'`,
    [deviceKey],
  );
  if (rows.length !== 1) throw new Error('No active FCM FID registration exists for the selected device');

  const fid = decryptPushFid(rows[0], deviceKey, key);
  const sender = await createFirebaseAdminPushSender({
    projectId: process.env.INONE_FIREBASE_PROJECT_ID,
    serviceAccountJson: process.env.INONE_FIREBASE_SERVICE_ACCOUNT_JSON ?? '',
  });
  const eventId = '$smoke';
  await sender.send({
    fid,
    payload: { type: 'message', event_id: eventId, path: '/rooms/smoke/events/%24smoke' },
  });
  process.stdout.write('FCM accepted the generic smoke notification. Confirm display on the physical device.\n');
} catch (error) {
  process.stderr.write(`Push smoke test failed: ${error?.message ?? 'unknown error'}\n`);
  process.exitCode = 1;
} finally {
  key?.fill(0);
  await pool.end();
}
