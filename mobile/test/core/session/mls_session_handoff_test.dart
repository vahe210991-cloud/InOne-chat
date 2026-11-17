import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:inone_mobile/core/mls/mls_session_bridge.dart';
import 'package:inone_mobile/core/network/api_exception.dart';
import 'package:inone_mobile/core/session/inone_session.dart';

void main() {
  test('login forwards an identity verification code to the backend', () async {
    final httpClient = MockClient((request) async {
      expect(request.method, 'POST');
      expect(request.url.path, '/login');
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      expect(body['identityCode'], '123456');
      return http.Response(
        jsonEncode({'status': 'identity_check_required'}),
        202,
        headers: {'content-type': 'application/json'},
      );
    });
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: httpClient,
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
    );

    final result = await session.login(
      email: 'alice@example.test',
      password: 'not-used-in-test',
      identityCode: ' 123456 ',
    );

    expect(result['status'], 'identity_check_required');
    session.dispose();
  });

  test('concurrent initialize calls share one device identity creation', () async {
    final readGate = Completer<String?>();
    var readCalls = 0;
    var writeCalls = 0;
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      readDeviceId: () async {
        readCalls++;
        return readGate.future;
      },
      writeDeviceId: (_) async {
        writeCalls++;
      },
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readLocale: () async => null,
      writeLocale: (_) async {},
      readLocaleSyncPending: () async => 'false',
      writeLocaleSyncPending: (_) async {},
    );

    final first = session.initialize();
    final second = session.initialize();
    expect(readCalls, 1);

    readGate.complete(null);
    await Future.wait([first, second]);

    expect(writeCalls, 1);
    expect(session.deviceId, isNotEmpty);
    session.dispose();
  });

  test('concurrent MLS handoff calls open the native session only once', () async {
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
      return http.Response('{}', 404);
    });
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: httpClient,
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readLocale: () async => null,
      writeLocale: (_) async {},
      readLocaleSyncPending: () async => 'false',
      writeLocaleSyncPending: (_) async {},
    );
    final bridge = _FakeMlsSessionBridge()
      ..openStarted = Completer<void>()
      ..openGate = Completer<void>();

    await session.login(email: 'alice@example.test', password: 'not-used-in-test');
    final first = session.adoptMlsSession(bridge);
    final second = session.adoptMlsSession(bridge);
    await bridge.openStarted!.future;

    expect(bridge.openCalls, 1);
    bridge.openGate!.complete();
    await Future.wait([first, second]);

    expect(session.hasNativeMlsSession, isTrue);
    expect(bridge.openCalls, 1);
    session.dispose();
  });

  test('logout waits for an in-flight login and native MLS handoff', () async {
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
      return http.Response('{}', 404);
    });
    var deletedUserId = false;
    final bridge = _FakeMlsSessionBridge()
      ..openStarted = Completer<void>()
      ..openGate = Completer<void>();
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: httpClient,
      nativeMlsBridge: bridge,
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {
        deletedUserId = true;
      },
      readLocale: () async => null,
      writeLocale: (_) async {},
      readLocaleSyncPending: () async => 'false',
      writeLocaleSyncPending: (_) async {},
    );

    final login = session.login(
      email: 'alice@example.test',
      password: 'not-used-in-test',
    );
    await bridge.openStarted!.future;
    final logout = session.logout();

    expect(bridge.logoutCalls, 0);
    expect(bridge.purgeCalls, 0);

    bridge.openGate!.complete();
    await login;
    await logout;

    expect(bridge.logoutCalls, 1);
    expect(bridge.purgeCalls, 1);
    expect(deletedUserId, isTrue);
    expect(session.isAuthenticated, isFalse);
    expect(session.hasNativeMlsSession, isFalse);
    session.dispose();
  });

  test('login automatically adopts the native MLS session when configured', () async {
    final httpClient = MockClient((request) async {
      if (request.url.path == '/login') {
        return http.Response(
          jsonEncode({'token': 'access-1', 'refreshToken': 'refresh-1'}),
          200,
        );
      }
      if (request.url.path == '/profile') {
        expect(request.headers['authorization'], 'Bearer access-1');
        return http.Response(jsonEncode({'userId': '@alice:inone.test'}), 200);
      }
      return http.Response('{}', 404);
    });
    final bridge = _FakeMlsSessionBridge();
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: httpClient,
      nativeMlsBridge: bridge,
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readLocale: () async => null,
      writeLocale: (_) async {},
      readLocaleSyncPending: () async => 'false',
      writeLocaleSyncPending: (_) async {},
    );

    final loginResult = await session.login(email: 'alice@example.test', password: 'not-used-in-test');

    expect(loginResult.containsKey('token'), isFalse);
    expect(loginResult.containsKey('refreshToken'), isFalse);
    expect(loginResult.containsKey('code'), isFalse);
    expect(loginResult.containsKey('pollSecret'), isFalse);
    expect(loginResult.containsKey('approvalId'), isFalse);
    expect(session.isAuthenticated, isTrue);
    expect(session.hasNativeMlsSession, isTrue);
    expect(session.mlsError, isNull);
    expect(bridge.openArguments?['refreshToken'], 'refresh-1');
    session.dispose();
  });

  test('failed automatic MLS adoption is visible and does not enable fallback messaging', () async {
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
      return http.Response('{}', 404);
    });
    final bridge = _FakeMlsSessionBridge()..failOpen = true;
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: httpClient,
      nativeMlsBridge: bridge,
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readLocale: () async => null,
      writeLocale: (_) async {},
      readLocaleSyncPending: () async => 'false',
      writeLocaleSyncPending: (_) async {},
    );

    await session.login(email: 'alice@example.test', password: 'not-used-in-test');

    expect(session.isAuthenticated, isTrue);
    expect(session.hasNativeMlsSession, isFalse);
    expect(session.mlsError, contains('MLS runtime could not be opened'));
    expect(session.userId, isNull);
    session.dispose();
  });

  test('logout purges saved native data even when session resume fails', () async {
    var deletedUserId = false;
    final bridge = _FakeMlsSessionBridge()..failResume = true;
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      nativeMlsBridge: bridge,
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => '@alice:inone.test',
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async { deletedUserId = true; },
      readLocale: () async => null,
      writeLocale: (_) async {},
      readLocaleSyncPending: () async => 'false',
      writeLocaleSyncPending: (_) async {},
    );

    await session.initialize();
    expect(session.hasNativeMlsSession, isFalse);
    expect(session.mlsError, contains('could not be restored'));

    await session.logout();

    expect(bridge.purgeArguments, {
      'userId': '@alice:inone.test',
      'deviceId': 'device-1',
    });
    expect(deletedUserId, isTrue);
    session.dispose();
  });

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
      deleteMlsUserId: () async { deletedUserId = true; },
      readLocale: () async => null,
      writeLocale: (_) async {},
      readLocaleSyncPending: () async => 'false',
      writeLocaleSyncPending: (_) async {},
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
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readLocale: () async => null,
      writeLocale: (_) async {},
      readLocaleSyncPending: () async => 'false',
      writeLocaleSyncPending: (_) async {},
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
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readLocale: () async => null,
      writeLocale: (_) async {},
      readLocaleSyncPending: () async => 'false',
      writeLocaleSyncPending: (_) async {},
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

  test('MLS message sending fails closed when the native bridge is unavailable', () async {
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readLocale: () async => null,
      writeLocale: (_) async {},
      readLocaleSyncPending: () async => 'false',
      writeLocaleSyncPending: (_) async {},
    );

    await expectLater(
      session.sendMlsText('room-1', 'must-not-be-sent-as-plaintext'),
      throwsA(isA<ApiException>()),
    );
    session.dispose();
  });

  test('MLS message sending is delegated to the native bridge', () async {
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
      return http.Response('{}', 404);
    });
    final bridge = _FakeMlsSessionBridge();
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: httpClient,
      nativeMlsBridge: bridge,
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readLocale: () async => null,
      writeLocale: (_) async {},
      readLocaleSyncPending: () async => 'false',
      writeLocaleSyncPending: (_) async {},
    );

    await session.login(email: 'alice@example.test', password: 'not-used-in-test');
    expect(await session.sendMlsText('room-1', 'hello'), 'event-1');
    session.dispose();
  });

  test('invalid native access-token snapshot rolls back the handoff and clears local ownership', () async {
    var deletedUserId = false;
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
      return http.Response('{}', 404);
    });
    final bridge = _FakeMlsSessionBridge()..forceEmptySnapshot = true;
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: httpClient,
      nativeMlsBridge: bridge,
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async { deletedUserId = true; },
      readLocale: () async => null,
      writeLocale: (_) async {},
      readLocaleSyncPending: () async => 'false',
      writeLocaleSyncPending: (_) async {},
    );

    await session.login(email: 'alice@example.test', password: 'not-used-in-test');

    expect(session.isAuthenticated, isFalse);
    expect(session.hasNativeMlsSession, isFalse);
    expect(bridge.logoutCalls, 1);
    expect(bridge.closeCalls, 1);
    expect(deletedUserId, isTrue);
    session.dispose();
  });

  test('transient refresh failure does not discard the Flutter refresh token', () async {
    var refreshCalls = 0;
    final httpClient = MockClient((request) async {
      if (request.url.path == '/login') {
        return http.Response(
          jsonEncode({'token': 'access-1', 'refreshToken': 'refresh-1'}),
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
      if (request.url.path == '/token/refresh') {
        refreshCalls++;
        if (refreshCalls == 1) {
          return http.Response('{"error":"temporarily_unavailable"}', 503);
        }
        expect(jsonDecode(request.body)['refreshToken'], 'refresh-1');
        return http.Response(
          jsonEncode({'token': 'access-2', 'refreshToken': 'refresh-2'}),
          200,
        );
      }
      return http.Response('{}', 404);
    });
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: httpClient,
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readLocale: () async => null,
      writeLocale: (_) async {},
      readLocaleSyncPending: () async => 'false',
      writeLocaleSyncPending: (_) async {},
    );

    await session.login(email: 'alice@example.test', password: 'not-used-in-test');
    await expectLater(
      session.request('GET', '/protected'),
      throwsA(isA<ApiException>()),
    );
    expect(session.isAuthenticated, isTrue);

    final response = await session.request('GET', '/protected');
    expect(response['status'], 'ok');
    expect(refreshCalls, 2);
    session.dispose();
  });

}

class _FakeMlsSessionBridge implements MlsSessionBridge {
  Map<String, String>? openArguments;
  Map<String, String>? resumeArguments;
  String accessToken = 'access-1';
  bool failOpen = false;
  bool failResume = false;
  bool forceEmptySnapshot = false;
  Map<String, String>? purgeArguments;
  int refreshCalls = 0;
  int logoutCalls = 0;
  int purgeCalls = 0;
  int closeCalls = 0;
  int openCalls = 0;
  Completer<void>? openStarted;
  Completer<void>? openGate;

  @override
  Future<void> open({
    required String baseUrl,
    required String userId,
    required String deviceId,
    required String accessToken,
    required String refreshToken,
  }) async {
    openCalls++;
    openArguments = {
      'baseUrl': baseUrl,
      'userId': userId,
      'deviceId': deviceId,
      'accessToken': accessToken,
      'refreshToken': refreshToken,
    };
    final started = openStarted;
    if (started != null && !started.isCompleted) started.complete();
    final gate = openGate;
    if (gate != null) await gate.future;
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
    if (failResume) throw StateError('native resume failed');
  }

  @override
  Future<void> purgeLocalSession({
    required String userId,
    required String deviceId,
  }) async {
    purgeCalls++;
    purgeArguments = {'userId': userId, 'deviceId': deviceId};
  }

  @override
  Future<void> ensureKeyPackages(int target) async {}

  @override
  Future<void> createRoom(String roomId) async {}

  @override
  Future<void> invite(String roomId, String userId) async {}
  @override
  Future<void> cancelInvite(String roomId, String userId) async {}

  @override
  Future<String?> roomRecoveryStatus(String roomId) async => null;

  @override
  Future<List<MlsUndecryptableEvent>> undecryptable() async => const [];

  @override
  Future<String?> quarantinedCommitReason(String roomId, int epoch) async => null;

  @override
  Future<String> sendText(String roomId, String plaintext) async => 'event-1';

  @override
  Future<String> enqueueText(String roomId, String plaintext) async => 'local-1';

  @override
  Future<List<MlsIncomingMessage>> sync() async => const [];

  @override
  Future<List<MlsIncomingMessage>> pendingIncoming() async => const [];

  @override
  Future<List<MlsIncomingMessage>> messagesForRoom(String roomId) async => const [];

  @override
  Future<void> acknowledgeIncoming(List<String> eventIds) async {}

  @override
  Future<int> flushOutbox() async => 0;

  @override
  Future<int> outboxLength() async => 0;

  @override
  Future<int?> localEpoch(String roomId) async => null;

  @override
  Future<List<String>> membersOf(String roomId) async => const [];

  @override
  Future<void> revokeDevice(String deviceId) async {}

  @override
  Future<int> removeRevokedDevices() async => 0;

  @override
  Future<String> accessTokenSnapshot() async => forceEmptySnapshot ? '' : accessToken;

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
