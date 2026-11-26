import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:inone_mobile/core/network/api_exception.dart';
import 'package:inone_mobile/core/session/inone_session.dart';

void main() {
  group('InOneSession recovery API', () {
    test('confirms the one-time link only through the explicit POST endpoint', () async {
      final client = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/recovery/confirm');
        expect(request.headers['authorization'], isNull);
        expect(jsonDecode(request.body), {
          'user': 'user-123',
          'token': 'A1_b2-C3',
        });
        return http.Response(jsonEncode({'ok': true}), 200);
      });
      final session = InOneSession(
        baseUrl: 'https://api.inone.test',
        httpClient: client,
        readDeviceId: () async => 'device-1',
        writeDeviceId: (_) async {},
        readMlsUserId: () async => null,
        writeMlsUserId: (_) async {},
        deleteMlsUserId: () async {},
      );

      final result = await session.confirmRecoveryLink(
        userId: 'user-123',
        token: 'A1_b2-C3',
      );

      expect(result['ok'], isTrue);
      session.dispose();
    });

    test('completes confirmed-phone recovery by user id and uses the saved locale', () async {
      final client = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/recovery/complete');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['userId'], 'user-123');
        expect(body.containsKey('email'), isFalse);
        expect(body['code'], 'test-code');
        expect(body['newPassword'], 'test-password');
        expect(body['pin'], 'test-pin');
        expect(body['locale'], 'ru');
        return http.Response(jsonEncode({'ok': true}), 200);
      });
      final session = InOneSession(
        baseUrl: 'https://api.inone.test',
        httpClient: client,
        readDeviceId: () async => 'device-1',
        writeDeviceId: (_) async {},
        readMlsUserId: () async => null,
        writeMlsUserId: (_) async {},
        deleteMlsUserId: () async {},
        readLocale: () async => 'ru',
        readLocaleSyncPending: () async => null,
        writeLocaleSyncPending: (_) async {},
      );

      final result = await session.completeRecovery(
        userId: 'user-123',
        code: 'test-code',
        newPassword: 'test-password',
        pin: 'test-pin',
      );

      expect(result['ok'], isTrue);
      session.dispose();
    });

    test('rejects a missing recovery identity and unsupported saved locale', () async {
      final session = InOneSession(
        baseUrl: 'https://api.inone.test',
        httpClient: MockClient((_) async => http.Response('{}', 200)),
        readDeviceId: () async => 'device-1',
        writeDeviceId: (_) async {},
        readMlsUserId: () async => null,
        writeMlsUserId: (_) async {},
        deleteMlsUserId: () async {},
        readLocale: () async => null,
        readLocaleSyncPending: () async => null,
        writeLocaleSyncPending: (_) async {},
      );

      await expectLater(
        session.completeRecovery(
          code: 'test-code',
          newPassword: 'test-password',
        ),
        throwsA(
          isA<ApiException>().having(
            (error) => error.code,
            'code',
            'recovery_identity_required',
          ),
        ),
      );
      await expectLater(session.setLocale('fr'), throwsArgumentError);
      session.dispose();
    });
    test('cancels pending device admission through its own unauthenticated endpoint', () async {
      final client = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/admission/cancel');
        expect(request.headers['authorization'], isNull);
        expect(jsonDecode(request.body), {
          'email': 'person@example.test',
          'code': '123456',
        });
        return http.Response(jsonEncode({'ok': true}), 200);
      });
      final session = InOneSession(
        baseUrl: 'https://api.inone.test',
        httpClient: client,
        readDeviceId: () async => 'device-1',
        writeDeviceId: (_) async {},
        readMlsUserId: () async => null,
        writeMlsUserId: (_) async {},
        deleteMlsUserId: () async {},
      );

      final result = await session.cancelAdmissionByCode(
        email: ' person@example.test ',
        code: ' 123456 ',
      );

      expect(result['ok'], isTrue);
      session.dispose();
    });

    test('rejects empty admission cancellation values before network access', () async {
      var calls = 0;
      final session = InOneSession(
        baseUrl: 'https://api.inone.test',
        httpClient: MockClient((_) async {
          calls++;
          return http.Response('{"ok":true}', 200);
        }),
        readDeviceId: () async => 'device-1',
        writeDeviceId: (_) async {},
        readMlsUserId: () async => null,
        writeMlsUserId: (_) async {},
        deleteMlsUserId: () async {},
      );

      await expectLater(
        session.cancelAdmissionByCode(email: '', code: '123456'),
        throwsA(isA<ApiException>()),
      );
      expect(calls, 0);
      session.dispose();
    });

    test('cancels recovery by code through the separate recovery endpoint', () async {
      final client = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/recovery/cancel-by-code');
        expect(request.headers['authorization'], isNull);
        expect(jsonDecode(request.body), {
          'email': 'person@example.test',
          'code': '123456',
        });
        return http.Response(jsonEncode({'ok': true}), 200);
      });
      final session = InOneSession(
        baseUrl: 'https://api.inone.test',
        httpClient: client,
        readDeviceId: () async => 'device-1',
        writeDeviceId: (_) async {},
        readMlsUserId: () async => null,
        writeMlsUserId: (_) async {},
        deleteMlsUserId: () async {},
      );

      final result = await session.cancelRecoveryByCode(
        email: ' person@example.test ',
        code: ' 123456 ',
      );

      expect(result['ok'], isTrue);
      session.dispose();
    });

  });
}
