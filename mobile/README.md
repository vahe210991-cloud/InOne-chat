# InOne Beta 1.0 — approved HTML screens host

This Flutter shell packages the approved InOne mobile design-system HTML as a local asset and renders it inside `webview_flutter`.

## Run
```sh
cd mobile
flutter pub get
flutter run
```

## Scope and security
- This is the first HTML-in-Flutter integration layer, not the completed Beta 1.0 product.
- The HTML remains a presentation prototype. Its demo actions are not server operations.
- No credentials, access tokens, refresh tokens, MLS keys, or database keys are passed into JavaScript.
- Top-level WebView navigation is restricted; the design export's required font/runtime hosts are allow-listed.
- Production API calls, durable message storage, and MLS remain in native Flutter/backend layers, never in the HTML.
- Next increment: extract each approved light/dark screen into stable screen IDs and route them through a typed Flutter host bridge; migrate high-value screens to native Flutter with screenshot parity tests.
