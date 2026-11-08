# InOne Beta 1.0 — approved cross-platform screen preview

The Flutter shell packages the owner-approved 22-screen HTML export as a local asset and displays one approved screen at a time inside `webview_flutter`.

## Included
- 11 light and 11 dark approved screen variants.
- Native Flutter menu to select each of the 22 variants individually.
- Stable screen IDs in `lib/approved_screens.dart`.
- Only the 22 outer iPhone frame corners changed from 42px to 0px. Internal component radii remain unchanged.
- Flutter waits for the bundled HTML to unpack and mount all 22 screen nodes before applying the selected route.
- CI structural validation for screen count, theme split and frame geometry.

## Run
```sh
cd mobile
flutter pub get
flutter run
```

## Scope and security
- This is an owner-reviewable screen preview, not the completed production Beta 1.0 application.
- HTML demo actions do not perform server operations.
- No credentials, access tokens, refresh tokens, MLS keys or database keys are passed into JavaScript.
- Flutter owns API calls, session handling, secure storage and MLS. The WebView is limited to presentation and local screen selection.
- Top-level navigation is restricted; only the design export's required font/runtime hosts are allow-listed.
- Next increment: native Flutter implementation of the highest-priority screens with screenshot parity tests against this approved reference.
