import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:inone_mobile/core/mls/mls_session_bridge.dart';
import 'package:inone_mobile/core/session/inone_session.dart';

void main() {
  test('restores the native session after app restart without Flutter tokens', () async {
    var deletedUserId = false;
    final bridge = _FakeMlsSessionBridge()..accessToken = 'restored-access';
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      nativeMlsBridge: bridge,
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => '@alice:inone.test',
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async => deletedUserId = true,
    );

    await session.initialize();

    expect(bridge.resumeArguments, {
      'baseUrl': 'https://api.inone.test',
      'userId': '@alice:inone.test',
      'deviceId': 'device-1',
    });
    expect(session.isAuthenticated, isTrue);
    expect(session.userId, '@alice:inone.test');
    expect(session.hasNativeMlsSession, isTrue);

    await session.logout();
    expect(deletedUserId, isTrue);
    session.dispose();
  });

  test('adopts the authenticated session and delegates refresh to Rust', () async {
    var protectedCalls = 0;
    final httpClient = MockClient((request) async {
      switch (request.url.path) {
        case '/login':
          return http.Response(
            jsonEncode({'token': 'access-1', 'refreshToken': 'refresh-1'}),
            200,
          );
        case '/profile':
          expect(request.headers['authorization'], 'Bearer access-1');
          return http.Response(
            jsonEncode({'userId': '@alice:inone.test'}),
            200,
          );
        case '/protected':
          protectedCalls++;
          if (request.headers['authorization'] == 'Bearer access-1') {
            return http.Response('{"error":"token_expired"}', 401);
          }
          expect(request.headers['authorization'], 'Bearer access-2');
          return http.Response('{"status":"ok"}', 200);
        default:
          return http.Response('{"error":"unexpected_route"}', 404);
      }
    });

    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: httpClient,
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
    );
    final bridge = _FakeMlsSessionBridge();

    await session.login(email: 'alice@example.test', password: 'not-used-in-test');
    await session.adoptMlsSession(bridge);

    expect(session.hasNativeMlsSession, isTrue);
    expect(session.userId, '@alice:inone.test');
    expect(bridge.openArguments, {
      'baseUrl': 'https://api.inone.test',
      'userId': '@alice:inone.test',
      'deviceId': 'device-1',
      'accessToken': 'access-1',
      'refreshToken': 'refresh-1',
    });

    final response = await session.request('GET', '/protected');
    expect(response['status'], 'ok');
    expect(protectedCalls, 2);
    expect(bridge.refreshCalls, 1);

    await session.logout();
    expect(bridge.logoutCalls, 1);
    expect(bridge.closeCalls, 1);
    expect(session.isAuthenticated, isFalse);
    expect(session.hasNativeMlsSession, isFalse);
    session.dispose();
  });

  test('failed adoption keeps the Flutter session usable', () async {
    final httpClient = MockClient((request) async {
      if (request.url.path == '/login') {
        return http.Response(
          jsonEncode({'token': 'access-1', 'refreshToken': 'refresh-1'}),
          200,
        );
      }
      if (request.url.path == '/profile') {
        return http.Response(jsonEncode({'userId': '@alice:inone.test'}), 200);
      }
      if (request.url.path == '/token/refresh') {
        expect(jsonDecode(request.body)['refreshToken'], 'refresh-1');
        return http.Response(
          jsonEncode({'token': 'access-2', 'refreshToken': 'refresh-2'}),
          200,
        );
      }
      if (request.url.path == '/protected') {
        if (request.headers['authorization'] == 'Bearer access-1') {
          return http.Response('{"error":"token_expired"}', 401);
        }
        expect(request.headers['authorization'], 'Bearer access-2');
        return http.Response('{"status":"ok"}', 200);
      }
      return http.Response('{}', 404);
    });
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: httpClient,
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
    );
    final bridge = _FakeMlsSessionBridge()..failOpen = true;

    await session.login(email: 'alice@example.test', password: 'not-used-in-test');
    await expectLater(session.adoptMlsSession(bridge), throwsStateError);
    expect(session.hasNativeMlsSession, isFalse);

    final response = await session.request('GET', '/protected');
    expect(response['status'], 'ok');
    expect(bridge.closeCalls, 0);
    session.dispose();
  });
}

class _FakeMlsSessionBridge implements MlsSessionBridge {
  Map<String, String>? openArguments;
  Map<String, String>? resumeArguments;
  String accessToken = 'access-1';
  bool failOpen = false;
  int refreshCalls = 0;
  int logoutCalls = 0;
  int closeCalls = 0;

  @override
  Future<void> open({
    required String baseUrl,
    required String userId,
    required String deviceId,
    required String accessToken,
    required String refreshToken,
  }) async {
    openArguments = {
      'baseUrl': baseUrl,
      'userId': userId,
      'deviceId': deviceId,
      'accessToken': accessToken,
      'refreshToken': refreshToken,
    };
    if (failOpen) throw StateError('native open failed');
    this.accessToken = accessToken;
  }

  @override
  Future<void> resume({
    required String baseUrl,
    required String userId,
    required String deviceId,
  }) async {
    resumeArguments = {
      'baseUrl': baseUrl,
      'userId': userId,
      'deviceId': deviceId,
    };
  }

  @override
  Future<String> accessTokenSnapshot() async => accessToken;

  @override
  Future<String> refreshSession() async {
    refreshCalls++;
    accessToken = 'access-2';
    return accessToken;
  }

  @override
  Future<void> logout() async {
    logoutCalls++;
  }

  @override
  Future<void> close() async {
    closeCalls++;
  }
}
