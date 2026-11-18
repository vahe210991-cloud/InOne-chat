# InOne Beta 1.0 mobile application

The production Flutter entry point is `lib/main.dart`, which launches
`InOneMobileApp` from `lib/app/inone_mobile_app.dart`.

The approved native Dart design system and screen components live under
`lib/ui_dart_source/`. The app shell connects only to the current
`InOneSession` and repository contracts. Provider authentication, identity-code
login, messaging history/sending, file transfer, and other gated capabilities
must remain visibly unavailable until their backend/security gates are met.

The approved HTML design package is retained outside this Flutter package in
`../мусорный ящик/HTML-архив/mobile-assets/`. It is a reference/archive only:
it is not bundled as a Flutter asset and is never loaded by the production app.

Run `flutter pub get`, `flutter analyze`, and `flutter test` from this
directory. The CI workflow separately verifies the archived HTML geometry and
the native-only runtime boundary.
