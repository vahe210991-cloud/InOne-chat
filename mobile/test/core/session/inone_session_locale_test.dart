import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:inone_mobile/core/session/inone_session.dart';

void main() {
  test('selected in-app locale is persisted and sent with registration code request', () async {
    String? savedLocale;
    var pendingLocaleSync = false;
    Map<String, dynamic>? sentBody;
    final client = MockClient((request) async {
      sentBody = jsonDecode(request.body) as Map<String, dynamic>;
      return http.Response('{"ok":true}', 202, headers: {'content-type': 'application/json'});
    });
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: client,
      readDeviceId: () async => 'device-locale-test',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readLocale: () async => savedLocale,
      writeLocale: (value) async { savedLocale = value; },
      readLocaleSyncPending: () async => pendingLocaleSync ? 'true' : 'false',
      writeLocaleSyncPending: (value) async { pendingLocaleSync = value; },
    );
    try {
      await session.setLocale('ru');
      expect(session.locale, 'ru');
      expect(savedLocale, 'ru');
      expect(pendingLocaleSync, isTrue);

      final response = await session.startEmailRegistration('user@example.test');
      expect(response['ok'], isTrue);
      expect(sentBody, {'email': 'user@example.test', 'locale': 'ru'});
    } finally {
      session.dispose();
    }
  });

  test('rejects unsupported in-app locale values', () async {
    final session = InOneSession(baseUrl: 'https://api.inone.test');
    try {
      await expectLater(session.setLocale('de'), throwsArgumentError);
    } finally {
      session.dispose();
    }
  });
}
