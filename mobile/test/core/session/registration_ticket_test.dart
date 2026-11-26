import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:inone_mobile/core/session/inone_session.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const secureStorageChannel =
      MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  final binaryMessenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  setUp(() {
    binaryMessenger.setMockMethodCallHandler(secureStorageChannel, (call) async {
    switch (call.method) {
      case 'containsKey':
        return false;
      case 'readAll':
        return <String, String>{};
      default:
        return null;
    }
    });
  });
  tearDown(() =>
      binaryMessenger.setMockMethodCallHandler(secureStorageChannel, null));

  test('registration ticket stays in host memory across confirm and register',
      () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      if (request.url.path == '/register/email/confirm') {
        return http.Response(
          jsonEncode({'registrationToken': 'one-time-secret-ticket'}),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      if (request.url.path == '/register') {
        return http.Response(
          jsonEncode({'userId': 'user-1', 'nickname': 'Person', 'verificationLevel': 1}),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      if (request.url.path == '/login') {
        return http.Response(
          jsonEncode({
            'userId': 'user-1',
            'token': 'access-token',
            'refreshToken': 'refresh-token',
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      return http.Response('{"error":"unexpected_route"}', 404);
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
      readLocale: () async => null,
      writeLocale: (_) async {},
      readLocaleSyncPending: () async => 'false',
      writeLocaleSyncPending: (_) async {},
    );

    final confirmation = await session.confirmEmailRegistration(
      email: 'person@example.test',
      code: '123456',
    );
    expect(confirmation, {'ok': true});
    expect(jsonEncode(confirmation), isNot(contains('one-time-secret-ticket')));

    final registration = await session.registerAccount(
      email: 'person@example.test',
      password: 'correct horse battery staple',
      nickname: 'Person',
    );

    expect(registration['userId'], 'user-1');
    expect(registration.containsKey('token'), isFalse);
    expect(requests.map((request) => request.url.path),
        ['/register/email/confirm', '/register', '/login', '/profile']);
    final registerBody =
        jsonDecode(requests[1].body) as Map<String, dynamic>;
    expect(registerBody['registrationToken'], 'one-time-secret-ticket');
    expect(requests.take(2).every((request) =>
        !request.headers.containsKey('authorization')), isTrue);
    expect(requests.last.url.path, '/profile');
    expect(requests.last.headers.containsKey('authorization'), isTrue);
    expect(session.isAuthenticated, isTrue);

    session.dispose();
    client.close();
  });

  test('registration does not create an authenticated session when login is pending',
      () async {
    final client = MockClient((request) async {
      if (request.url.path == '/register/email/confirm') {
        return http.Response('{"registrationToken":"ticket"}', 200);
      }
      if (request.url.path == '/register') {
        return http.Response('{"userId":"user-2","nickname":"Pending","verificationLevel":1}', 200);
      }
      if (request.url.path == '/login') {
        return http.Response('{"status":"approval_pending"}', 202);
      }
      return http.Response('{"error":"unexpected_route"}', 404);
    });
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: client,
      readDeviceId: () async => 'device-2',
      writeDeviceId: (_) async {},
    );

    await session.confirmEmailRegistration(
      email: 'pending@example.test',
      code: '123456',
    );
    final result = await session.registerAccount(
      email: 'pending@example.test',
      password: 'correct horse battery staple',
      nickname: 'Pending',
    );

    expect(result['userId'], 'user-2');
    expect(session.isAuthenticated, isFalse);

    session.dispose();
    client.close();
  });

  test('registration cannot proceed without a host-held confirmation ticket',
      () async {
    final client = MockClient((_) async =>
        http.Response('{"ok":true}', 200));
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: client,
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
    );

    await expectLater(
      session.registerAccount(
        email: 'person@example.test',
        password: 'correct horse battery staple',
        nickname: 'Person',
      ),
      throwsA(isA<Exception>()),
    );

    session.dispose();
    client.close();
  });
}
