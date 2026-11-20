import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/data/inone_push_repository.dart';
import 'package:inone_mobile/core/session/inone_push_lifecycle.dart';
import 'package:inone_mobile/core/session/inone_session.dart';

void main() {
  late _PushTestSession session;
  late _FakeMessaging messaging;
  late InOnePushLifecycle lifecycle;

  setUp(() {
    session = _PushTestSession();
    messaging = _FakeMessaging();
    lifecycle = InOnePushLifecycle(
      session: session,
      repository: InOnePushRepository(session),
      messaging: messaging,
      isApplePlatform: false,
    )..start();
  });

  tearDown(() async {
    lifecycle.dispose();
    await messaging.dispose();
    session.dispose();
  });

  test('registers the current FCM token only after authentication', () async {
    expect(session.requests, isEmpty);
    session.setAuthenticated(true);
    await lifecycle.waitForPendingOperations();

    expect(messaging.permissionRequests, 1);
    expect(messaging.tokenRequests, 1);
    expect(session.requests, [
      {
        'method': 'PUT',
        'path': '/devices/me/push',
        'body': {
          'provider': 'fcm',
          'token': 'fcm-token-123456789012345678901234567890',
        },
        'authenticated': true,
      },
    ]);
  });

  test('re-registers a refreshed FCM token for the authenticated device', () async {
    session.setAuthenticated(true);
    await lifecycle.waitForPendingOperations();
    messaging.emitToken('fcm-token-refreshed-12345678901234567890');
    await lifecycle.waitForPendingOperations();

    expect(session.requests, hasLength(2));
    expect(session.requests.last['body'], {
      'provider': 'fcm',
      'token': 'fcm-token-refreshed-12345678901234567890',
    });
  });

  test('unregisters before logout while the bearer session is still valid', () async {
    session.setAuthenticated(true);
    await lifecycle.waitForPendingOperations();
    await lifecycle.unregisterBeforeLogout();

    expect(session.requests.last, {
      'method': 'DELETE',
      'path': '/devices/me/push',
      'body': null,
      'authenticated': true,
    });
    session.setAuthenticated(false);
    messaging.emitToken('fcm-token-after-logout-123456789012345678');
    await lifecycle.waitForPendingOperations();
    expect(session.requests, hasLength(2));
  });

  test('removes a stale server registration when notification permission is denied', () async {
    messaging.permission = InOnePushAuthorizationStatus.denied;
    session.setAuthenticated(true);
    await lifecycle.waitForPendingOperations();

    expect(messaging.tokenRequests, 0);
    expect(session.requests.single['method'], 'DELETE');
  });

  test('does not call FCM token APIs on iOS before APNs registration exists', () async {
    lifecycle.dispose();
    lifecycle = InOnePushLifecycle(
      session: session,
      repository: InOnePushRepository(session),
      messaging: messaging,
      isApplePlatform: true,
    )..start();
    messaging.apnsToken = null;
    session.setAuthenticated(true);
    await lifecycle.waitForPendingOperations();

    expect(messaging.apnsTokenRequests, 1);
    expect(messaging.tokenRequests, 0);
    expect(session.requests, isEmpty);
  });
}

class _PushTestSession extends InOneSession {
  _PushTestSession() : super(baseUrl: 'https://api.inone.test');

  bool _authenticated = false;
  final List<Map<String, dynamic>> requests = [];

  @override
  bool get isAuthenticated => _authenticated;

  void setAuthenticated(bool value) {
    _authenticated = value;
    notifyListeners();
  }

  @override
  Future<Map<String, dynamic>> request(
    String method,
    String path, {
    Object? body,
    bool authenticated = true,
  }) async {
    requests.add({
      'method': method,
      'path': path,
      'body': body,
      'authenticated': authenticated,
    });
    return {'registered': method == 'PUT'};
  }
}

class _FakeMessaging implements InOnePushMessagingClient {
  final StreamController<String> _tokens =
      StreamController<String>.broadcast(sync: true);
  InOnePushAuthorizationStatus permission =
      InOnePushAuthorizationStatus.authorized;
  String? token = 'fcm-token-123456789012345678901234567890';
  String? apnsToken = 'apns-token-ready';
  int permissionRequests = 0;
  int tokenRequests = 0;
  int apnsTokenRequests = 0;

  @override
  Stream<String> get onTokenRefresh => _tokens.stream;

  @override
  Future<InOnePushAuthorizationStatus> requestPermission() async {
    permissionRequests++;
    return permission;
  }

  @override
  Future<String?> getToken() async {
    tokenRequests++;
    return token;
  }

  @override
  Future<String?> getApnsToken() async {
    apnsTokenRequests++;
    return apnsToken;
  }

  void emitToken(String value) => _tokens.add(value);

  Future<void> dispose() => _tokens.close();
}
