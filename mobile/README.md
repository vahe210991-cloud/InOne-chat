# InOne Beta 1.0 — approved HTML screens host

This Flutter shell packages the owner-approved 22-screen design export as a local asset and renders it inside `webview_flutter`. The 11 light and 11 dark outer device frames are rectangularized for consistent iOS/Android presentation; internal component radii, colors, spacing and typography are preserved.

## Run
```sh
cd mobile
flutter pub get
flutter run
```

## Scope and security
- This is the first HTML-in-Flutter integration layer, not the completed Beta 1.0 product.
- The HTML remains a presentation prototype. Demo actions do not perform server operations.
- No credentials, access tokens, refresh tokens, MLS keys, or database keys are passed into JavaScript.
- Top-level WebView navigation is restricted; the design export's required font/runtime hosts are allow-listed.
- Production API calls, durable message storage, and MLS remain in native Flutter/backend layers, never in the HTML.
- CI runs a structural check that verifies exactly 22 variants (11 light + 11 dark) and confirms every outer device frame is rectangular.
- The rounded 42px outer iPhone frame was changed to 0px only on the 22 screen shells. Internal buttons, cards, inputs, avatars and other component radii remain unchanged.
- Next increment: register all 22 variants by stable screen IDs, route them independently, and migrate high-value screens to native Flutter with screenshot parity tests.
