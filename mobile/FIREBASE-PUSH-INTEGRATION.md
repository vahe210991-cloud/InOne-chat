# Firebase Core, FID registration and push receive pipeline

## Registration lifecycle

1. `lib/main.dart` initializes Firebase Core from generated Android/iOS native configuration.
2. Firebase Messaging auto-init remains disabled until an authenticated InOne session and notification permission exist.
3. `InOnePushLifecycle` waits for APNs readiness on iOS, calls `FirebaseMessaging.register()`, receives the Firebase Installation ID (FID) from `onRegistered`, and registers it through the authenticated current-device endpoint.
4. Both platforms register with provider `fcm`. iOS notifications are routed by Firebase through APNs; the backend does not accept new direct APNs-token registrations.
5. FID changes are synchronized. The FID is held in memory only and is never written to local storage or logs.
6. Denied permission, explicit logout and device revocation remove the server association. Backend logout/revocation cancels queued push deliveries.
7. Existing legacy APNs/FCM registration identifiers are encrypted during server backfill but are not deliverable by the FID-only sender; clients refresh registration to a current FID.

## Server delivery

- The canonical engine uses Firebase Admin SDK FID targeting via `fid`, not the deprecated `token` property.
- Message events and push outbox rows are committed in one PostgreSQL transaction. A dedicated push worker sends asynchronously.
- Push data contains only an event type, opaque event ID and safe relative route. It never contains message text, sender identity, MLS plaintext/ciphertext, file content or credentials.
- FCM provider acceptance does not prove that the OS displayed the notification or that a user opened it.

## APNs setup

For actual iOS delivery, enable Push Notifications for App ID `com.inone.app`, use a matching signed provisioning profile, upload the APNs authentication key (.p8) to Firebase Console with its Key ID and Apple Team ID, and verify the correct Firebase project/bundle ID mapping. Do not commit signing material or APNs keys.

## Receive and navigation

The registration lifecycle above is not the receive/tap pipeline. Foreground/background/terminated handlers, `onMessageOpenedApp`, `getInitialMessage()`, authenticated event fetch, session restoration, deduplication and safe navigation remain to be implemented and tested before the receive stage is accepted. A push must never bypass room ACLs, session checks or MLS processing.

## Validation

- Existing tests cover authenticated FID registration, refresh, permission denial, APNs readiness, unregister and logout.
- Backend unit/PostgreSQL tests cover FID sender, encryption and durable queue.
- Real Android and iOS physical-device delivery is a separate final acceptance gate; no such delivery is claimed by this document.
