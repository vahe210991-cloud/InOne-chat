import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:inone_mobile/core/session/inone_session.dart';

void main() {
  test('recovery link confirmation is an explicit unauthenticated POST', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      return http.Response(jsonEncode({'ok': true}), 200);
    });
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: client,
    );

    await session.confirmRecoveryLink(
      userId: '@alice:inone.test',
      token: 'one-time-token',
    );

    expect(requests, hasLength(1));
    expect(requests.single.method, 'POST');
    expect(requests.single.url.path, '/recovery/confirm');
    expect(jsonDecode(requests.single.body), {
      'user': '@alice:inone.test',
      'token': 'one-time-token',
    });
    expect(requests.single.headers.containsKey('authorization'), isFalse);
    session.dispose();
  });

  test('recovery completion accepts userId for the confirmed-phone flow', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      return http.Response(
        jsonEncode({'ok': true, 'keyResetAt': '2026-11-17T12:00:00.000Z'}),
        200,
      );
    });
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: client,
    );

    await session.completeRecovery(
      userId: '@alice:inone.test',
      code: '123456',
      newPassword: 'new-secure-password',
      pin: '1234',
    );

    expect(requests, hasLength(1));
    expect(requests.single.url.path, '/recovery/complete');
    expect(jsonDecode(requests.single.body), {
      'userId': '@alice:inone.test',
      'code': '123456',
      'newPassword': 'new-secure-password',
      'pin': '1234',
    });
    session.dispose();
  });
}
