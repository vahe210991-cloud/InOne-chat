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
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
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


  test('pending UI locale is sent during login before server security notifications', () async {
    String? savedLocale;
    var pendingLocaleSync = false;
    Map<String, dynamic>? loginBody;
    final client = MockClient((request) async {
      if (request.url.path == '/login') {
        loginBody = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(
          '{"token":"x","refreshToken":"y"}',
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      if (request.url.path == '/profile') {
        return http.Response(
          '{"locale":"ru"}',
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: client,
      readDeviceId: () async => 'device-login-locale',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
      readLocale: () async => savedLocale,
      writeLocale: (value) async { savedLocale = value; },
      readLocaleSyncPending: () async => pendingLocaleSync ? 'true' : 'false',
      writeLocaleSyncPending: (value) async { pendingLocaleSync = value; },
    );
    try {
      await session.setLocale('ru');
      await session.login(email: 'user@example.test', password: 'long-password');
      expect(loginBody?['locale'], 'ru');
      expect(pendingLocaleSync, isFalse);
      expect(session.locale, 'ru');
    } finally {
      session.dispose();
    }
  });

  test('authenticated locale changes are persisted through the profile API', () async {
    String? savedLocale = 'ru';
    var pendingLocaleSync = false;
    Map<String, dynamic>? patchBody;
    final client = MockClient((request) async {
      if (request.url.path == '/login') {
        return http.Response(
          '{"token":"access","refreshToken":"refresh"}',
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      if (request.url.path == '/profile') {
        return http.Response(
          '{"locale":"ru"}',
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      if (request.url.path == '/profile/locale') {
        patchBody = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(
          jsonEncode({'locale': patchBody!['locale']}),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: client,
      readDeviceId: () async => 'device-authenticated-locale',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
      readLocale: () async => savedLocale,
      writeLocale: (value) async { savedLocale = value; },
      readLocaleSyncPending: () async => pendingLocaleSync ? 'true' : 'false',
      writeLocaleSyncPending: (value) async { pendingLocaleSync = value; },
    );
    try {
      await session.login(email: 'user@example.test', password: 'long-password');
      expect(session.locale, 'ru');
      await session.setLocale('hy');
      expect(patchBody, {'locale': 'hy'});
      expect(savedLocale, 'hy');
      expect(session.locale, 'hy');
      expect(pendingLocaleSync, isFalse);
    } finally {
      session.dispose();
    }
  });

  test('recovery operations carry the currently selected interface locale', () async {
    String? savedLocale;
    var pendingLocaleSync = false;
    final bodies = <String, Map<String, dynamic>>{};
    final client = MockClient((request) async {
      bodies[request.url.path] = jsonDecode(request.body) as Map<String, dynamic>;
      return http.Response(
        '{"ok":true}',
        202,
        headers: {'content-type': 'application/json'},
      );
    });
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: client,
      readDeviceId: () async => 'device-recovery-locale',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
      readLocale: () async => savedLocale,
      writeLocale: (value) async { savedLocale = value; },
      readLocaleSyncPending: () async => pendingLocaleSync ? 'true' : 'false',
      writeLocaleSyncPending: (value) async { pendingLocaleSync = value; },
    );
    try {
      await session.setLocale('hy');
      await session.startRecovery(email: 'user@example.test');
      await session.cancelRecoveryByCode(email: 'user@example.test', code: '123456');
      await session.completeRecovery(
        email: 'user@example.test',
        code: '654321',
        newPassword: 'new-long-password',
      );
      expect(bodies['/recovery/start']?['locale'], 'hy');
      expect(bodies['/recovery/cancel-by-code']?['locale'], 'hy');
      expect(bodies['/recovery/complete']?['locale'], 'hy');
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
