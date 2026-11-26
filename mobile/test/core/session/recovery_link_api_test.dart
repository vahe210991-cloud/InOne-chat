import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:inone_mobile/core/network/api_exception.dart';
import 'package:inone_mobile/core/session/inone_session.dart';

void main() {
  test('confirmRecoveryLink posts an unauthenticated one-time confirmation', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      return http.Response(
        jsonEncode({'ok': true}),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: client,
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
    );

    final result = await session.confirmRecoveryLink(
      userId: '@alice:inone.test',
      token: 'one-time-token',
    );

    expect(result['ok'], isTrue);
    expect(requests, hasLength(1));
    expect(requests.single.method, 'POST');
    expect(requests.single.url.path, '/recovery/confirm');
    expect(requests.single.headers.containsKey('authorization'), isFalse);
    expect(jsonDecode(requests.single.body), {
      'user': '@alice:inone.test',
      'token': 'one-time-token',
    });
    session.dispose();
  });

  test('completeRecovery uses the account ID from a confirmed deep link', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      return http.Response(
        jsonEncode({'ok': true}),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: client,
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
      readLocale: () async => 'hy',
      writeLocale: (_) async {},
      readLocaleSyncPending: () async => null,
      writeLocaleSyncPending: (_) async {},
    );

    final result = await session.completeRecovery(
      userId: '@alice:inone.test',
      code: '123456',
      newPassword: 'new-password',
      pin: '1234',
    );

    expect(result['ok'], isTrue);
    expect(requests, hasLength(1));
    expect(requests.single.method, 'POST');
    expect(requests.single.url.path, '/recovery/complete');
    expect(requests.single.headers.containsKey('authorization'), isFalse);
    expect(jsonDecode(requests.single.body), {
      'userId': '@alice:inone.test',
      'code': '123456',
      'newPassword': 'new-password',
      'pin': '1234',
      'locale': 'hy',
    });
    session.dispose();
  });

  test('completeRecovery requires either an email or an account ID', () async {
    var calls = 0;
    final client = MockClient((_) async {
      calls++;
      return http.Response('{"ok":true}', 200);
    });
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: client,
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
      readLocale: () async => 'hy',
      writeLocale: (_) async {},
      readLocaleSyncPending: () async => null,
      writeLocaleSyncPending: (_) async {},
    );

    await expectLater(
      session.completeRecovery(
        code: '123456',
        newPassword: 'new-password',
      ),
      throwsA(isA<ApiException>()),
    );
    expect(calls, 0);
    session.dispose();
  });

  test('confirmRecoveryLink rejects empty or oversized values before network access', () async {
    var calls = 0;
    final client = MockClient((_) async {
      calls++;
      return http.Response('{"ok":true}', 200);
    });
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: client,
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
    );

    await expectLater(
      session.confirmRecoveryLink(userId: '', token: 'token'),
      throwsA(isA<ApiException>()),
    );
    await expectLater(
      session.confirmRecoveryLink(userId: '@alice:inone.test', token: 'x' * 1025),
      throwsA(isA<ApiException>()),
    );
    expect(calls, 0);
    session.dispose();
  });
}
