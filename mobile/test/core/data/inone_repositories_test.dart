import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/data/inone_profile.dart';
import 'package:inone_mobile/core/data/inone_repositories.dart';
import 'package:inone_mobile/core/network/api_exception.dart';
import 'package:inone_mobile/core/session/inone_session.dart';

void main() {
  test('requests the authenticated profile route and parses its response',
      () async {
    final session = _ProfileSession({
      'userId': 'user-1',
      'nickname': 'Test User',
      'email': 'user@example.test',
      'verificationLevel': 1,
      'providers': [],
      'backupEmail': null,
      'securityHints': ['no_backup_email'],
    });

    final profile = await InOneRepositories(session).profile();

    expect(session.method, 'GET');
    expect(session.path, '/profile');
    expect(session.authenticated, isTrue);
    expect(profile, isA<InOneProfile>());
    expect(profile.nickname, 'Test User');
    expect(profile.verificationLevel, 1);
    session.dispose();
  });


  test('updates the authenticated profile locale', () async {
    final session = _ProfileSession({'locale': 'en'});
    final result = await InOneRepositories(session).updateLocale('en');

    expect(session.method, 'PATCH');
    expect(session.path, '/profile/locale');
    expect(session.authenticated, isTrue);
    expect(session.body, {'locale': 'en'});
    expect(result['locale'], 'en');
    session.dispose();
  });

  test('propagates unauthorized responses from the existing session', () async {
    final session = _ProfileSession(
      const {},
      error: const ApiException(
        code: 'unauthorized',
        statusCode: 401,
        retryable: false,
      ),
    );

    await expectLater(
      InOneRepositories(session).profile(),
      throwsA(isA<ApiException>().having(
        (error) => error.statusCode,
        'statusCode',
        401,
      )),
    );
    session.dispose();
  });

  test('propagates backend server errors', () async {
    final session = _ProfileSession(
      const {},
      error: const ApiException(
        code: 'server_error',
        statusCode: 500,
        retryable: true,
      ),
    );

    await expectLater(
      InOneRepositories(session).profile(),
      throwsA(isA<ApiException>().having(
        (error) => error.statusCode,
        'statusCode',
        500,
      )),
    );
    session.dispose();
  });

  test('rejects a successful response with an invalid profile shape', () async {
    final session = _ProfileSession({
      'userId': 'user-1',
      'nickname': 'Test User',
      'email': 'user@example.test',
      'verificationLevel': 'verified',
      'providers': [],
      'backupEmail': null,
      'securityHints': [],
    });

    await expectLater(
      InOneRepositories(session).profile(),
      throwsA(isA<ApiException>().having(
        (error) => error.code,
        'code',
        'invalid_response',
      )),
    );
    session.dispose();
  });
}

class _ProfileSession extends InOneSession {
  _ProfileSession(this.response, {this.error})
      : super(baseUrl: 'https://api.inone.test');

  final Map<String, dynamic> response;
  final ApiException? error;
  String? method;
  String? path;
  bool? authenticated;
  Object? body;

  @override
  Future<Map<String, dynamic>> request(
    String method,
    String path, {
    Object? body,
    bool authenticated = true,
  }) async {
    this.method = method;
    this.path = path;
    this.authenticated = authenticated;
    this.body = body;
    if (error != null) throw error!
    return response;
  }
}
