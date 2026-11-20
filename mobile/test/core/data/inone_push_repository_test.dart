import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/data/inone_push_repository.dart';
import 'package:inone_mobile/core/network/api_exception.dart';
import 'package:inone_mobile/core/session/inone_session.dart';

void main() {
  test('registers an FCM token only through the authenticated device route', () async {
    final session = _PushSession({'registered': true});
    final repository = InOnePushRepository(session);
    final token = 'fcm-token-123456789012345678901234567890';

    await repository.register(provider: InOnePushProvider.fcm, token: token);

    expect(session.method, 'PUT');
    expect(session.path, '/devices/me/push');
    expect(session.authenticated, isTrue);
    expect(session.body, {'provider': 'fcm', 'token': token});
    session.dispose();
  });

  test('registers a Firebase Installation ID for the FCM provider', () async {
    final session = _PushSession({'registered': true});
    const installationId = 'abcdefghijklmnopqrstuv';

    await InOnePushRepository(session).register(
      provider: InOnePushProvider.fcm,
      token: installationId,
    );

    expect(session.body, {
      'provider': 'fcm',
      'token': installationId,
    });
    session.dispose();
  });

  test('rejects a Firebase Installation ID for the APNs provider', () async {
    final session = _PushSession({'registered': true});

    await expectLater(
      InOnePushRepository(session).register(
        provider: InOnePushProvider.apns,
        token: 'abcdefghijklmnopqrstuv',
      ),
      throwsA(isA<ArgumentError>()),
    );
    expect(session.method, isNull);
    session.dispose();
  });

  test('registers an APNs token with the APNs provider identifier', () async {
    final session = _PushSession({'registered': true});

    await InOnePushRepository(session).register(
      provider: InOnePushProvider.apns,
      token: 'apns-token-123456789012345678901234567890',
    );

    expect(session.body, {
      'provider': 'apns',
      'token': 'apns-token-123456789012345678901234567890',
    });
    session.dispose();
  });

  test('rejects malformed tokens before making a network request', () async {
    final session = _PushSession({'registered': true});

    await expectLater(
      InOnePushRepository(session).register(
        provider: InOnePushProvider.fcm,
        token: 'short token',
      ),
      throwsA(isA<ArgumentError>()),
    );

    expect(session.method, isNull);
    session.dispose();
  });

  test('unregisters only the current authenticated device token', () async {
    final session = _PushSession({'registered': false});

    await InOnePushRepository(session).unregister();

    expect(session.method, 'DELETE');
    expect(session.path, '/devices/me/push');
    expect(session.authenticated, isTrue);
    expect(session.body, isNull);
    session.dispose();
  });

  test('rejects a malformed successful registration response', () async {
    final session = _PushSession({'ok': true});

    await expectLater(
      InOnePushRepository(session).register(
        provider: InOnePushProvider.fcm,
        token: 'fcm-token-123456789012345678901234567890',
      ),
      throwsA(isA<ApiException>().having(
        (error) => error.code,
        'code',
        'invalid_response',
      )),
    );
    session.dispose();
  });

  test('propagates authenticated API failures', () async {
    final session = _PushSession(
      const {},
      error: const ApiException(
        code: 'unauthorized',
        statusCode: 401,
        retryable: false,
      ),
    );

    await expectLater(
      InOnePushRepository(session).unregister(),
      throwsA(isA<ApiException>().having(
        (error) => error.statusCode,
        'statusCode',
        401,
      )),
    );
    session.dispose();
  });
}

class _PushSession extends InOneSession {
  _PushSession(this.response, {this.error})
      : super(baseUrl: 'https://api.inone.test');

  final Map<String, dynamic> response;
  final ApiException? error;
  String? method;
  String? path;
  Object? body;
  bool? authenticated;

  @override
  Future<Map<String, dynamic>> request(
    String method,
    String path, {
    Object? body,
    bool authenticated = true,
  }) async {
    this.method = method;
    this.path = path;
    this.body = body;
    this.authenticated = authenticated;
    if (error != null) throw error!;
    return response;
  }
}
