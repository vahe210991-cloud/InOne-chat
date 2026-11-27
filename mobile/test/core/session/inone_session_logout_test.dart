import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/mls/mls_session_bridge.dart';
import 'package:inone_mobile/core/session/inone_session.dart';

class _FakeMlsSessionBridge implements MlsSessionBridge {
  int resumeCalls = 0;

  @override
  Future<void> open({
    required String baseUrl,
    required String userId,
    required String deviceId,
    required String accessToken,
    required String refreshToken,
  }) async {}

  @override
  Future<void> resume({
    required String baseUrl,
    required String userId,
    required String deviceId,
  }) async {
    resumeCalls++;
  }

  @override
  Future<String> accessTokenSnapshot() async => 'access-token';

  @override
  Future<String> refreshSession() async => 'access-token';

  @override
  Future<void> logout() async {}

  @override
  Future<void> purgeLocalSession({
    required String userId,
    required String deviceId,
  }) async {
    throw StateError('protected store unavailable');
  }

  @override
  Future<void> close() async {}

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

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

  test('logout clears saved MLS identity when native purge fails', () async {
    String? savedDeviceId = 'device-1';
    String? savedUserId = 'user-1';
    var deleteCalls = 0;
    final bridge = _FakeMlsSessionBridge();

    InOneSession createSession() => InOneSession(
          baseUrl: 'https://api.inone.test',
          nativeMlsBridge: bridge,
          readDeviceId: () async => savedDeviceId,
          writeDeviceId: (value) async {
            savedDeviceId = value;
          },
          readMlsUserId: () async => savedUserId,
          writeMlsUserId: (value) async {
            savedUserId = value;
          },
          deleteMlsUserId: () async {
            deleteCalls++;
            savedUserId = null;
          },
          readRefreshToken: () async => null,
          writeRefreshToken: (_) async {},
          deleteRefreshToken: () async {},
        );

    final session = createSession();
    await session.initialize();
    expect(session.isAuthenticated, isTrue);
    expect(bridge.resumeCalls, 1);

    await expectLater(session.logout(), throwsA(isA<StateError>()));

    expect(deleteCalls, 1);
    expect(savedUserId, isNull);
    expect(session.isAuthenticated, isFalse);

    final nextLaunch = createSession();
    await nextLaunch.initialize();
    expect(
      bridge.resumeCalls,
      1,
      reason:
          'logout must not restore the previous MLS session',
    );
    expect(nextLaunch.isAuthenticated, isFalse);

    session.dispose();
    nextLaunch.dispose();
  });

  test(
    'logout clears saved MLS identity when native runtime is unavailable',
    () async {
      String? savedDeviceId = 'device-2';
      String? savedUserId = 'user-2';
      var deleteCalls = 0;

      InOneSession createSession({MlsSessionBridge? bridge}) => InOneSession(
            baseUrl: 'https://api.inone.test',
            nativeMlsBridge: bridge,
            readDeviceId: () async => savedDeviceId,
            writeDeviceId: (value) async {
              savedDeviceId = value;
            },
            readMlsUserId: () async => savedUserId,
            writeMlsUserId: (value) async {
              savedUserId = value;
            },
            deleteMlsUserId: () async {
              deleteCalls++;
              savedUserId = null;
            },
            readRefreshToken: () async => null,
            writeRefreshToken: (_) async {},
            deleteRefreshToken: () async {},
          );

      final session = createSession();
      await session.initialize();
      expect(session.isAuthenticated, isFalse);

      await expectLater(session.logout(), throwsA(isA<StateError>()));

      expect(deleteCalls, 1);
      expect(savedUserId, isNull);

      final bridge = _FakeMlsSessionBridge();
      final nextLaunch = createSession(bridge: bridge);
      await nextLaunch.initialize();
      expect(bridge.resumeCalls, 0);
      expect(nextLaunch.isAuthenticated, isFalse);

      session.dispose();
      nextLaunch.dispose();
    },
  );
}
