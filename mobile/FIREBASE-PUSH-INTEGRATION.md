# Firebase Core and Messaging integration

## Runtime lifecycle

1. `lib/main.dart` initializes Firebase Core from the generated Android/iOS native configuration.
2. Firebase Messaging auto-init is disabled in generated native projects. The app does not register an installation or expose its Firebase Installation ID (FID) until the current InOne device has an authenticated session and notification permission.
3. `InOnePushLifecycle` observes `InOneSession`. After permission is granted, it waits for the APNs device token on iOS, calls `FirebaseMessaging.register()`, receives the FID through `onRegistered`, and registers it through the existing authenticated `PUT /devices/me/push` endpoint.
4. FID changes from `onRegistered` are synchronized to the same current-device endpoint. The FID is held in memory only; it is not written to local storage or logs.
5. Denied or permanently denied notification permission removes the server association and unregisters the FCM app instance. Explicit logout does the same before logout while the bearer token is valid; backend logout and device revocation remain authoritative cleanup paths.
6. On app resume, registration is retried. This covers cases where APNs registration was not ready during the first authenticated startup.
7. An unexpected `onUnregistered` event removes a stale server association.

## FID API and server contract

Firebase Messaging 17 uses Firebase Installation IDs for app-instance targeting. The authenticated device API retains its `token` field for compatibility, but accepts a 22-character base64url FID for provider `fcm`; legacy FCM tokens and APNs tokens (32–512 characters) remain accepted for existing clients. The future sender must target FIDs using Firebase's FID-capable direct-send API. A push sender is not implemented by this client change.

## Native project generation

`tool/generate_flutter_platforms.sh` runs both Firebase configuration steps:

- `prepare_firebase_platforms.mjs` validates the checked-in client identifiers and copies the Android JSON / iOS plist into generated projects.
- `configure_firebase_native.mjs` installs the Google Services Gradle plugin, sets Android minSdk to 24, adds Android network/notification permissions, enables FID registration while disabling auto-init/Analytics collection until consent, embeds the iOS plist, adds the APNs entitlement, enables FID registration, disables auto-init and configures fetch/remote-notification background modes.

These changes are reapplied on every clean CI generation rather than relying on untracked local platform folders.

## External Apple setup and delivery boundary

For actual iOS APNs registration, the Apple Developer App ID for `com.inone.app` must have Push Notifications enabled, a matching provisioning profile must be used for signed builds, and the APNs authentication key must be uploaded in Firebase Console. The source repository does not contain Apple signing credentials or APNs keys.

The push sender, invalid-FID cleanup on provider responses, and end-to-end notification delivery are separate unfinished work. Payloads must remain minimal and must not include message text, sender identity, or other private content.

## Validation

`mobile/test/core/session/inone_push_lifecycle_test.dart` covers authenticated FID registration, FID refresh, denied permissions, APNs readiness, Firebase unregister and authenticated logout. The Android emulator integration smoke initializes Firebase and obtains a real FID without logging it. Flutter Android/iOS workflows compile generated native integrations on the exact PR head.
