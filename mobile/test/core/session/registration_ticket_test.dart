import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:inone_mobile/core/session/inone_session.dart';

void main() {
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
          jsonEncode({'ok': true, 'userId': 'user-1'}),
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
    expect(requests.map((request) => request.url.path),
        ['/register/email/confirm', '/register']);
    final registerBody =
        jsonDecode(requests.last.body) as Map<String, dynamic>;
    expect(registerBody['registrationToken'], 'one-time-secret-ticket');
    expect(requests.every((request) =>
        !request.headers.containsKey('authorization')), isTrue);

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
