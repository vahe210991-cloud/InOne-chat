import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:inone_mobile/core/mls/mls_session_bridge.dart';
import 'package:inone_mobile/core/session/inone_session.dart';

class _FakeMlsSessionBridge implements MlsSessionBridge {
  String? openedRefreshToken;

  @override
  Future<void> open({
    required String baseUrl,
    required String userId,
    required String deviceId,
    required String accessToken,
    required String refreshToken,
  }) async {
    openedRefreshToken = refreshToken;
  }

  @override
  Future<void> resume({
    required String baseUrl,
    required String userId,
    required String deviceId,
  }) async {}

  @override
  Future<String> accessTokenSnapshot() async => 'native-access';

  @override
  Future<String> refreshSession() async => 'native-access';

  @override
  Future<void> logout() async {}

  @override
  Future<void> purgeLocalSession({
    required String userId,
    required String deviceId,
  }) async {}

  @override
  Future<void> close() async {}

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  test('login persists refresh token and restart rotates it from secure storage', () async {
    String? persistedRefreshToken;
    var writes = 0;
    var deletes = 0;
    http.Client clientForLaunch() => MockClient((request) async {
          if (request.url.path == '/login') {
            return http.Response(
              jsonEncode({'token': 'access-login', 'refreshToken': 'refresh-1'}),
              200,
            );
          }
          if (request.url.path == '/token/refresh') {
            expect(
              (jsonDecode(request.body) as Map<String, dynamic>)['refreshToken'],
              'refresh-1',
            );
            return http.Response(
              jsonEncode({'token': 'access-restored', 'refreshToken': 'refresh-2'}),
              200,
            );
          }
          if (request.url.path == '/logout') return http.Response('{}', 200);
          return http.Response('{}', 404);
        });

    InOneSession createSession() => InOneSession(
          baseUrl: 'https://api.inone.test',
          httpClient: clientForLaunch(),
          readDeviceId: () async => 'device-persist',
          writeDeviceId: (_) async {},
          readMlsUserId: () async => null,
          writeMlsUserId: (_) async {},
          deleteMlsUserId: () async {},
          readRefreshToken: () async => persistedRefreshToken,
          writeRefreshToken: (value) async {
            writes++;
            persistedRefreshToken = value;
          },
          deleteRefreshToken: () async {
            deletes++;
            persistedRefreshToken = null;
          },
        );

    final firstLaunch = createSession();
    await firstLaunch.login(
      email: 'alice@example.test',
      password: 'correct-password',
    );
    expect(persistedRefreshToken, 'refresh-1');
    expect(writes, 1);
    firstLaunch.dispose();

    final secondLaunch = createSession();
    await secondLaunch.initialize();
    expect(secondLaunch.isAuthenticated, isTrue);
    expect(persistedRefreshToken, 'refresh-2');
    expect(writes, 2);

    await secondLaunch.logout();
    expect(persistedRefreshToken, isNull);
    expect(deletes, 1);
    secondLaunch.dispose();
  });

  test('401 refresh rotation persists the replacement token before retrying', () async {
    String? persistedRefreshToken;
    final client = MockClient((request) async {
      if (request.url.path == '/login') {
        return http.Response(
          jsonEncode({'token': 'access-1', 'refreshToken': 'refresh-1'}),
          200,
        );
      }
      if (request.url.path == '/profile') {
        if (request.headers['authorization'] == 'Bearer access-1') {
          return http.Response('{"error":"expired"}', 401);
        }
        return http.Response('{"userId":"@alice:inone.test"}', 200);
      }
      if (request.url.path == '/token/refresh') {
        expect(
          (jsonDecode(request.body) as Map<String, dynamic>)['refreshToken'],
          'refresh-1',
        );
        return http.Response(
          jsonEncode({'token': 'access-2', 'refreshToken': 'refresh-2'}),
          200,
        );
      }
      if (request.url.path == '/logout') return http.Response('{}', 200);
      return http.Response('{}', 404);
    });
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: client,
      readDeviceId: () async => 'device-rotation',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readRefreshToken: () async => persistedRefreshToken,
      writeRefreshToken: (value) async { persistedRefreshToken = value; },
      deleteRefreshToken: () async { persistedRefreshToken = null; },
    );
    try {
      await session.login(
        email: 'alice@example.test',
        password: 'correct-password',
      );
      final profile = await session.request('GET', '/profile');
      expect(profile['userId'], '@alice:inone.test');
      expect(persistedRefreshToken, 'refresh-2');
    } finally {
      await session.logout();
      session.dispose();
    }
  });

  test('revoked refresh token is deleted and does not restore authentication', () async {
    String? persistedRefreshToken = 'revoked-refresh';
    final client = MockClient((request) async {
      if (request.url.path == '/token/refresh') {
        return http.Response('{"error":"revoked"}', 401);
      }
      return http.Response('{}', 404);
    });
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: client,
      readDeviceId: () async => 'device-revoked',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readRefreshToken: () async => persistedRefreshToken,
      writeRefreshToken: (value) async => persistedRefreshToken = value,
      deleteRefreshToken: () async => persistedRefreshToken = null,
    );
    try {
      await session.initialize();
      expect(session.isAuthenticated, isFalse);
      expect(persistedRefreshToken, isNull);
    } finally {
      session.dispose();
    }
  });

  test('native MLS handoff removes the temporary Dart refresh-token copy', () async {
    String? persistedRefreshToken;
    String? persistedMlsUserId;
    final bridge = _FakeMlsSessionBridge();
    final client = MockClient((request) async {
      if (request.url.path == '/login') {
        return http.Response(
          jsonEncode({'token': 'access-1', 'refreshToken': 'refresh-1'}),
          200,
        );
      }
      if (request.url.path == '/profile') {
        return http.Response('{"userId":"@alice:inone.test"}', 200);
      }
      return http.Response('{}', 404);
    });
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: client,
      nativeMlsBridge: bridge,
      readDeviceId: () async => 'device-native',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => persistedMlsUserId,
      writeMlsUserId: (value) async { persistedMlsUserId = value; },
      deleteMlsUserId: () async { persistedMlsUserId = null; },
      readRefreshToken: () async => persistedRefreshToken,
      writeRefreshToken: (value) async => persistedRefreshToken = value,
      deleteRefreshToken: () async => persistedRefreshToken = null,
    );
    try {
      await session.login(
        email: 'alice@example.test',
        password: 'correct-password',
      );
      expect(bridge.openedRefreshToken, 'refresh-1');
      expect(persistedRefreshToken, isNull);
      expect(persistedMlsUserId, '@alice:inone.test');
      expect(session.hasNativeMlsSession, isTrue);
    } finally {
      await session.logout();
      session.dispose();
    }
  });
}
