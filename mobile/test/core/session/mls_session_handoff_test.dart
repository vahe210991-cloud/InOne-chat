import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:inone_mobile/core/mls/mls_session_bridge.dart';
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

  test('pending outbox parser preserves text, opaque and attachment operations', () {
    final text = MlsPendingOutboxItem.fromJson({
      'local_id': 'operation-text-1',
      'room_id': '!room:inone.test',
      'kind': 'text',
      'text': 'retry me',
      'payload_bytes': 8,
    });
    expect(text.localId, 'operation-text-1');
    expect(text.text, 'retry me');
    expect(text.payloadBytes, 8);

    final opaque = MlsPendingOutboxItem.fromJson({
      'local_id': 'operation-opaque-1',
      'room_id': '!room:inone.test',
      'kind': 'opaque',
      'text': null,
      'payload_bytes': 3,
    });
    expect(opaque.kind, 'opaque');
    expect(opaque.text, isNull);

    final attachment = MlsPendingOutboxItem.fromJson({
      'local_id': 'operation-file-1',
      'room_id': '!room:inone.test',
      'kind': 'attachment',
      'file_id': 'file-1',
      'name': 'report.pdf',
      'mime_type': 'application/pdf',
      'size': 1024,
      'uploaded': true,
    });
    expect(attachment.fileId, 'file-1');
    expect(attachment.uploaded, isTrue);
    expect(attachment.size, 1024);
  });

  test('durable text enqueue and pending outbox use the native SQLCipher bridge', () async {
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
    final bridge = _FakeMlsSessionBridge()
      ..pendingOutboxItems = [
        const MlsPendingOutboxItem(
          localId: 'stable-local-id',
          roomId: '!room:inone.test',
          kind: 'text',
          text: 'queued message',
        ),
      ];
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: httpClient,
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
    );

    await session.login(email: 'alice@example.test', password: 'not-used-in-test');
    await session.adoptMlsSession(bridge);

    final localId = await session.enqueueMlsText('!room:inone.test', 'queued message');
    final pending = await session.pendingMlsOutbox('!room:inone.test');
    final flushed = await session.flushMlsOutbox();

    expect(localId, 'local-1');
    expect(pending.single.localId, 'stable-local-id');
    expect(pending.single.text, 'queued message');
    expect(flushed, 0);
    expect(bridge.flushCalls, 1);
    session.dispose();
  });

  test('room history is read before readable inbox events are acknowledged', () async {
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
    final bridge = _FakeMlsSessionBridge()
      ..historyMessages = const [
        MlsIncomingMessage(
          roomId: '!room:inone.test',
          eventId: 'event-readable',
          text: 'persisted text',
        ),
      ]
      ..pendingIncomingMessages = const [
        MlsIncomingMessage(
          roomId: '!room:inone.test',
          eventId: 'event-readable',
          text: 'persisted text',
        ),
        MlsIncomingMessage(
          roomId: '!room:inone.test',
          eventId: 'event-unreadable',
        ),
        MlsIncomingMessage(
          roomId: '!room:inone.test',
          eventId: 'event-not-in-history',
          text: 'not yet durable',
        ),
        MlsIncomingMessage(
          roomId: '!other:inone.test',
          eventId: 'event-other-room',
          text: 'other room',
        ),
      ];
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: httpClient,
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
    );

    await session.login(email: 'alice@example.test', password: 'not-used-in-test');
    await session.adoptMlsSession(bridge);
    final history = await session.loadMlsRoomHistory('!room:inone.test');

    expect(history.single.text, 'persisted text');
    expect(bridge.inboxCalls, ['history', 'pending', 'ack']);
    expect(bridge.acknowledgedEventIds, ['event-readable']);
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
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
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
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
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
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
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
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
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

  test('adopted session exposes validated persistent MLS operations', () async {
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
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
    );

    await session.login(email: 'alice@example.test', password: 'not-used-in-test');
    expect(session.hasNativeMlsSession, isTrue);

    await session.createMlsRoom('room-1');
    await session.ensureMlsKeyPackages(10);
    await session.inviteMlsMember('room-1', '@bob:inone.test');
    await session.approveMlsJoinRequest('room-1', '@carol:inone.test');
    expect(bridge.approvedJoinRequestRoomId, 'room-1');
    expect(bridge.approvedJoinRequestUserId, '@carol:inone.test');
    expect(await session.sendMlsText('room-1', 'hello'), 'event-1');
    expect(await session.enqueueMlsText('room-1', 'queued'), 'local-1');
    expect(
      await session.sendMlsAttachment(
        'room-1',
        'proof.txt',
        'text/plain',
        Uint8List.fromList([1, 2]),
        'attachment-operation-1',
      ),
      'attachment-event-1',
    );
    expect(bridge.attachmentClientMessageId, 'attachment-operation-1');
    expect(await session.downloadMlsAttachment('file-1'), isEmpty);
    expect(await session.pendingMlsMessages(), isEmpty);
    expect(await session.pendingMlsOutbox('room-1'), isEmpty);
    await session.acknowledgeMlsMessages(['event-1']);
    expect(await session.flushMlsOutbox(), 0);
    expect(await session.mlsOutboxLength(), 0);
    expect(await session.mlsLocalEpoch('room-1'), isNull);
    expect(await session.mlsMembersOf('room-1'), isEmpty);
    expect(await session.localMlsRoomIds(), ['room-1']);
    await session.revokeMlsDevice('device-2');
    expect(await session.removeRevokedMlsDevices(), 0);

    expect(() => session.sendMlsText('', 'invalid'), throwsArgumentError);
    expect(() => session.sendMlsText('room-1', '  '), throwsArgumentError);
    expect(() => session.ensureMlsKeyPackages(0), throwsRangeError);
    expect(() => session.downloadMlsAttachment(''), throwsArgumentError);
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
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
    );

    await expectLater(
      session.login(email: 'alice@example.test', password: 'not-used-in-test'),
      throwsStateError,
    );

    // A failed native handoff must not leave a Dart-owned refresh-token session.
    expect(session.isAuthenticated, isFalse);
    expect(session.hasNativeMlsSession, isFalse);
    expect(session.mlsError, contains('MLS runtime could not be opened'));
    expect(session.userId, isNull);
    expect(bridge.closeCalls, 1);
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
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
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
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
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
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
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

  test('failed adoption invalidates the session without Flutter refresh fallback', () async {
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
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
    );

    await expectLater(
      session.login(email: 'alice@example.test', password: 'not-used-in-test'),
      throwsStateError,
    );
    expect(session.isAuthenticated, isFalse);
    expect(session.hasNativeMlsSession, isFalse);
    expect(session.mlsError, contains('MLS runtime could not be opened'));
    expect(bridge.closeCalls, 1);
    expect(bridge.refreshCalls, 0);

    // No authenticated request may fall back to the Dart refresh token after
    // Rust rejects ownership of the session.
    await expectLater(
      session.request('GET', '/protected'),
      throwsA(isA<Exception>()),
    );
    session.dispose();
  });

  test('revoked native refresh purges local MLS identity and invalidates the session', () async {
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
      if (request.url.path == '/protected') {
        return http.Response('{"error":"token_expired"}', 401);
      }
      return http.Response('{}', 404);
    });
    String? savedUserId;
    var deleteIdentityCalls = 0;
    final bridge = _FakeMlsSessionBridge()
      ..refreshError = StateError('HTTP 401 unauthorized: refresh token revoked');
    final session = InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: httpClient,
      nativeMlsBridge: bridge,
      readDeviceId: () async => 'device-1',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => savedUserId,
      writeMlsUserId: (value) async { savedUserId = value; },
      deleteMlsUserId: () async {
        deleteIdentityCalls++;
        savedUserId = null;
      },
      readRefreshToken: () async => null,
      writeRefreshToken: (_) async {},
      deleteRefreshToken: () async {},
    );

    await session.login(email: 'alice@example.test', password: 'not-used-in-test');
    expect(session.hasNativeMlsSession, isTrue);
    expect(savedUserId, '@alice:inone.test');

    await expectLater(
      session.request('GET', '/protected'),
      throwsA(isA<StateError>()),
    );

    expect(session.isAuthenticated, isFalse);
    expect(session.hasNativeMlsSession, isFalse);
    expect(session.userId, isNull);
    expect(savedUserId, isNull);
    expect(deleteIdentityCalls, 1);
    expect(bridge.logoutCalls, 1);
    expect(bridge.purgeCalls, 1);
    expect(bridge.closeCalls, 1);
    session.dispose();
  });

}

class _FakeMlsSessionBridge implements MlsSessionBridge {
  Map<String, String>? openArguments;
  Map<String, String>? resumeArguments;
  String accessToken = 'access-1';
  String? attachmentClientMessageId;
  String? approvedJoinRequestRoomId;
  String? approvedJoinRequestUserId;
  List<MlsPendingOutboxItem> pendingOutboxItems = const [];
  List<MlsIncomingMessage> historyMessages = const [];
  List<MlsIncomingMessage> pendingIncomingMessages = const [];
  List<String> inboxCalls = [];
  List<String> acknowledgedEventIds = [];
  int flushCalls = 0;
  bool failOpen = false;
  bool failResume = false;
  Map<String, String>? purgeArguments;
  int refreshCalls = 0;
  int logoutCalls = 0;
  int purgeCalls = 0;
  int closeCalls = 0;
  Object? refreshError;
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
  Future<void> approveJoinRequest(String roomId, String userId) async {
    approvedJoinRequestRoomId = roomId;
    approvedJoinRequestUserId = userId;
  }
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
  Future<String> sendTextWithId(
    String roomId,
    String plaintext,
    String clientMessageId,
  ) async => clientMessageId;

  @override
  Future<List<MlsPendingOutboxItem>> pendingOutbox(String roomId) async => pendingOutboxItems;

  @override
  Future<String> sendAttachment({
    required String roomId,
    required String name,
    required String mimeType,
    required Uint8List plaintext,
  }) async => 'attachment-event-1';

  @override
  Future<String> sendAttachmentWithId({
    required String roomId,
    required String name,
    required String mimeType,
    required Uint8List plaintext,
    required String clientMessageId,
  }) async {
    attachmentClientMessageId = clientMessageId;
    return 'attachment-event-1';
  }

  @override
  Future<Uint8List> downloadAttachment(String fileId) async => Uint8List(0);

  @override
  Future<String> enqueueText(String roomId, String plaintext) async => 'local-1';

  @override
  Future<List<MlsIncomingMessage>> sync() async => const [];

  @override
  Future<List<MlsIncomingMessage>> pendingIncoming() async {
    inboxCalls.add('pending');
    return pendingIncomingMessages;
  }

  @override
  Future<List<MlsIncomingMessage>> messagesForRoom(String roomId) async {
    inboxCalls.add('history');
    return historyMessages;
  }

  @override
  Future<List<String>> localRoomIds() async => const ['room-1'];

  @override
  Future<void> acknowledgeIncoming(List<String> eventIds) async {
    inboxCalls.add('ack');
    acknowledgedEventIds = List<String>.of(eventIds);
  }

  @override
  Future<int> flushOutbox() async {
    flushCalls++;
    return 0;
  }

  @override
  Future<int> outboxLength() async => 0;

  @override
  Future<int?> localEpoch(String roomId) async => null;

  @override
  Future<List<String>> membersOf(String roomId) async => const [];

  @override
  Future<void> removeMember(String roomId, String userId) async {}

  @override
  Future<void> revokeDevice(String deviceId) async {}

  @override
  Future<int> removeRevokedDevices() async => 0;

  @override
  Future<String> accessTokenSnapshot() async => accessToken;

  @override
  Future<String> refreshSession() async {
    refreshCalls++;
    if (refreshError != null) throw refreshError!;
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