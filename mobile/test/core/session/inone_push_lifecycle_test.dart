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

  test('registers the current Firebase Installation ID only after authentication', () async {
    expect(session.requests, isEmpty);
    session.setAuthenticated(true);
    await lifecycle.waitForPendingOperations();

    expect(messaging.permissionRequests, 1);
    expect(messaging.registrationRequests, 1);
    expect(session.requests, [
      {
        'method': 'PUT',
        'path': '/devices/me/push',
        'body': {
          'provider': 'fcm',
          'token': 'abcdefghijklmnopqrstuv',
        },
        'authenticated': true,
      },
    ]);
  });

  test('updates the server when the Firebase Installation ID changes', () async {
    session.setAuthenticated(true);
    await lifecycle.waitForPendingOperations();
    messaging.emitInstallationId('zyxwvutsrqponmlkjihgfe');
    await lifecycle.waitForPendingOperations();

    expect(session.requests, hasLength(2));
    expect(session.requests.last['body'], {
      'provider': 'fcm',
      'token': 'zyxwvutsrqponmlkjihgfe',
    });
  });

  test('does not restore an FID after notification permission is denied', () async {
    session.setAuthenticated(true);
    await lifecycle.waitForPendingOperations();
    messaging.permission = InOnePushAuthorizationStatus.deniedPermanently;
    messaging.emitInstallationId('zyxwvutsrqponmlkjihgfe');
    await lifecycle.waitForPendingOperations();

    expect(session.requests, hasLength(2));
    expect(session.requests.last['method'], 'DELETE');
    expect(messaging.unregisterRequests, 1);
  });

  test('unregisters Firebase and the server before logout with a valid bearer session', () async {
    session.setAuthenticated(true);
    await lifecycle.waitForPendingOperations();
    await lifecycle.unregisterBeforeLogout();

    expect(session.requests.last, {
      'method': 'DELETE',
      'path': '/devices/me/push',
      'body': null,
      'authenticated': true,
    });
    expect(messaging.unregisterRequests, 1);
    session.setAuthenticated(false);
    messaging.emitInstallationId('0123456789abcdefghijkl');
    await lifecycle.waitForPendingOperations();
    expect(session.requests, hasLength(2));
  });

  test('removes the server association when Firebase unregisters an FID', () async {
    session.setAuthenticated(true);
    await lifecycle.waitForPendingOperations();
    messaging.emitUnregistered('abcdefghijklmnopqrstuv');
    await lifecycle.waitForPendingOperations();

    expect(session.requests, hasLength(2));
    expect(session.requests.last['method'], 'DELETE');
    expect(session.requests.last['path'], '/devices/me/push');
  });

  test('does not register an iOS FID before APNs registration exists', () async {
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
    expect(messaging.registrationRequests, 0);
    expect(session.requests, isEmpty);
  });

  test('removes an old server registration when notification permission is denied', () async {
    messaging.permission = InOnePushAuthorizationStatus.denied;
    session.setAuthenticated(true);
    await lifecycle.waitForPendingOperations();

    expect(messaging.registrationRequests, 0);
    expect(messaging.unregisterRequests, 1);
    expect(session.requests.single['method'], 'DELETE');
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
  final StreamController<String> _registrations =
      StreamController<String>.broadcast(sync: true);
  final StreamController<String> _unregistrations =
      StreamController<String>.broadcast(sync: true);
  InOnePushAuthorizationStatus permission =
      InOnePushAuthorizationStatus.authorized;
  String installationId = 'abcdefghijklmnopqrstuv';
  String? apnsToken = 'apns-token-ready';
  int permissionRequests = 0;
  int registrationRequests = 0;
  int unregisterRequests = 0;
  int apnsTokenRequests = 0;

  @override
  Stream<String> get onRegistered => _registrations.stream;

  @override
  Stream<String> get onUnregistered => _unregistrations.stream;

  @override
  Future<InOnePushAuthorizationStatus> requestPermission() async {
    permissionRequests++;
    return permission;
  }

  @override
  Future<void> register() async {
    registrationRequests++;
    _registrations.add(installationId);
  }

  @override
  Future<void> unregister() async {
    unregisterRequests++;
    _unregistrations.add(installationId);
  }

  @override
  Future<String?> getApnsToken() async {
    apnsTokenRequests++;
    return apnsToken;
  }

  void emitInstallationId(String value) => _registrations.add(value);
  void emitUnregistered(String value) => _unregistrations.add(value);

  Future<void> dispose() async {
    await _registrations.close();
    await _unregistrations.close();
  }
}
