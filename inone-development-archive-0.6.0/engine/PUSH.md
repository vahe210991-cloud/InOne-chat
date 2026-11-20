# Push notifications — FCM FID + PostgreSQL outbox

## Device registration

- `PUT /devices/me/push` accepts only `{ "provider": "fcm", "token": "<22-char FID>" }` for the authenticated current device.
- Android and iOS both register through Firebase Messaging. On iOS, Firebase routes FCM delivery through APNs; there is no parallel direct-APNs sender in this iteration.
- `DELETE /devices/me/push`, logout and device revocation remove the registration and cancel queued/failed/processing deliveries for that device.
- `GET /devices/mine` exposes only whether push is registered, never the identifier.
- Existing FCM/APNs legacy identifiers are retained during migration and encrypted, but marked `identifier_kind='legacy'`; they are not sent by the FID-only sender. The client must re-register its current FID.

## FCM production sender

- `firebase-admin` 14.5.1 targets the FID using the Admin SDK `fid` property, not deprecated `token`.
- Production bootstrap prefers ADC/workload identity. A service-account JSON may be injected through `INONE_FIREBASE_SERVICE_ACCOUNT_JSON`; never commit it or log it.
- Provider acceptance is recorded as `provider_accepted`; it is not a device-delivery or display receipt.
- Invalid FID errors remove only the exact encrypted registration snapshot that was rejected, so a concurrent FID rotation is not deleted.

## Durable queue and transaction boundary

- `push_deliveries` is a dedicated PostgreSQL outbox. It is separate from `email_deliveries`; only the worker operational pattern is shared.
- `POST /mls/groups/:id/messages` writes the MLS room event and push outbox rows inside the same PostgreSQL transaction. This applies both to ordinary sends and `clientMessageId` idempotent sends. A repeated completed `clientMessageId` does not enqueue a second notification.
- Worker claims use `FOR UPDATE SKIP LOCKED`, leases/worker ownership, lease renewal, restart recovery, bounded exponential backoff with jitter, expiry and dead-letter statuses.
- Queue statuses: `queued`, `processing`, `failed`, `provider_accepted`, `dead`, `cancelled`.
- Delivery is at-least-once to provider acceptance. A crash after FCM acceptance but before status commit can cause a retry; clients must deduplicate by `event_id`.

## Encryption and privacy

- `INONE_PUSH_ENCRYPTION_KEY` is an independent 32-byte key (64 hex or canonical base64). Do not reuse `INONE_PIN_PEPPER` or `INONE_EMAIL_ENCRYPTION_KEY`.
- FID records use AES-256-GCM, fresh 12-byte nonce, authentication tag and device-key AAD. Legacy plaintext identifiers are backfilled at startup in a transaction; startup fails if any plaintext registration remains.
- Queue payloads are separately AES-256-GCM encrypted and authenticated to their idempotency key.
- The only send payload is `type`, `event_id`, `path`. No message preview, sender name, MLS plaintext/ciphertext, attachments, access token, recovery data or keys.
- Worker fetches the current active device registration immediately before sending. Revoked/logged-out devices are cancelled and cannot be used as a target.

## Configuration

- `INONE_FIREBASE_PROJECT_ID` — required in production.
- `INONE_FIREBASE_SERVICE_ACCOUNT_JSON` — optional when ADC/workload identity is configured.
- `INONE_PUSH_ENCRYPTION_KEY` — required in production.
- `INONE_PUSH_WORKER_POLL_MS` — 250–60000 ms, default 1000.
- `INONE_PUSH_MAX_ATTEMPTS` — 1–20, default 8.
- iOS requires the APNs authentication key (.p8), Key ID, Apple Team ID, Bundle ID, Push Notifications capability, matching provisioning profile and Firebase Console APNs configuration. Keep all Apple/Firebase secrets outside Git.

## Validation status

- Unit coverage: FID addressing, allowlisted payload, safe provider error classes, encryption/AAD and Admin SDK bootstrap.
- PostgreSQL coverage: outbox durability across worker restart, encrypted legacy FID backfill, idempotency and provider acceptance.
- Still required: full Node + PostgreSQL suite on the exact PR SHA, Flutter receive/tap routing tests, native builds, and physical Android/iOS delivery tests. No real-device delivery is claimed until those tests pass.
