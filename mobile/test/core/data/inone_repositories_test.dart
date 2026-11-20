import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/data/inone_profile.dart';
import 'package:inone_mobile/core/data/inone_organization.dart';
import 'package:inone_mobile/core/data/inone_public_config.dart';
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

  test('requests own organizations and parses membership fields', () async {
    final session = _ProfileSession({
      'orgs': [
        {
          'orgId': 'org-opaque-1',
          'name': 'North Workspace',
          'status': 'approved',
          'role': 'admin',
        },
      ],
    });

    final orgs = await InOneRepositories(session).myOrganizations();

    expect(session.method, 'GET');
    expect(session.path, '/orgs/mine');
    expect(session.authenticated, isTrue);
    expect(orgs, hasLength(1));
    expect(orgs.single, isA<InOneOrganization>());
    expect(orgs.single.name, 'North Workspace');
    expect(orgs.single.status, 'approved');
    expect(orgs.single.role, 'admin');
    session.dispose();
  });

  test('reads only public system configuration without authentication', () async {
    final session = _ProfileSession({
      'version': 7,
      'flags': {
        'maintenance.enabled': false,
        'app.minVersion': '1.2.3',
      },
    });

    final config = await InOneRepositories(session).publicConfig();

    expect(session.method, 'GET');
    expect(session.path, '/config/public');
    expect(session.authenticated, isFalse);
    expect(config, isA<InOnePublicConfig>());
    expect(config.configVersion, 7);
    expect(config.minimumAppVersion, '1.2.3');
    expect(config.maintenanceEnabled, isFalse);
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
    if (error != null) throw error!;
    return response;
  }
}
