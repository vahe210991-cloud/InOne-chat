# InOne Beta 1.0 — approved HTML screens host

This Flutter shell packages the owner-approved InOne mobile design export as a local asset and renders it inside `webview_flutter`.

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
- Next increment: identify and register all 22 approved light/dark screen variants, route them by stable IDs, and migrate high-value screens to native Flutter with screenshot parity tests.
