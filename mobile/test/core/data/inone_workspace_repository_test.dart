import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/data/inone_organization.dart';
import 'package:inone_mobile/core/data/inone_workspace_repository.dart';
import 'package:inone_mobile/core/data/inone_workspace_screen_data.dart';
import 'package:inone_mobile/core/network/api_exception.dart';
import 'package:inone_mobile/core/session/inone_session.dart';

typedef _ResponseHandler = Future<Map<String, dynamic>> Function(
  String method,
  String path,
);

class _FakeSession extends InOneSession {
  _FakeSession(this._handler)
      : super(
          baseUrl: 'https://api.example.test',
          readDeviceId: () async => 'test-device',
          writeDeviceId: (_) async {},
          readMlsUserId: () async => null,
          writeMlsUserId: (_) async {},
          deleteMlsUserId: () async {},
          readLocale: () async => 'en',
          writeLocale: (_) async {},
          readLocaleSyncPending: () async => 'false',
          writeLocaleSyncPending: (_) async {},
        );

  final _ResponseHandler _handler;
  final List<String> requestedPaths = <String>[];

  @override
  Future<Map<String, dynamic>> request(
    String method,
    String path, {
    Object? body,
    bool authenticated = true,
  }) {
    requestedPaths.add(path);
    return _handler(method, path);
  }
}

InOneOrganization _organization({
  String id = 'org-1',
  String status = 'approved',
  String role = 'admin',
}) =>
    InOneOrganization(
      orgId: id,
      name: 'North Workspace',
      status: status,
      role: role,
    );

void main() {
  group('InOneWorkspaceRepository', () {
    test('loads organizations from the existing membership endpoint', () async {
      final session = _FakeSession((method, path) async {
        expect(method, 'GET');
        expect(path, '/orgs/mine');
        return {
          'orgs': [
            {
              'orgId': 'org-1',
              'name': 'North Workspace',
              'status': 'approved',
              'role': 'admin',
            },
          ],
        };
      });
      final repository = InOneWorkspaceRepository(session);

      final organizations = await repository.organizations();

      expect(organizations, hasLength(1));
      expect(organizations.single.orgId, 'org-1');
      expect(session.requestedPaths, ['/orgs/mine']);
      session.dispose();
    });

    test('counts only structurally valid members and derives verified/manage flags',
        () async {
      final session = _FakeSession((method, path) async {
        expect(method, 'GET');
        expect(path, '/orgs/org-1/members');
        return {
          'members': [
            {'userId': 'user-1', 'role': 'owner'},
            {'userId': 'user-2', 'role': 'admin'},
            {'userId': 'user-3', 'role': 'member'},
          ],
        };
      });
      final repository = InOneWorkspaceRepository(session);

      final overview = await repository.organizationOverview(_organization());

      expect(overview.memberCount, 3);
      expect(overview.verified, isTrue);
      expect(overview.canManage, isTrue);
      session.dispose();
    });

    test('encodes organization IDs before requesting member data', () async {
      final session = _FakeSession((method, path) async {
        expect(path, '/orgs/org%2Fwith%20space/members');
        return {'members': <dynamic>[]};
      });
      final repository = InOneWorkspaceRepository(session);

      final overview = await repository.organizationOverview(
        _organization(id: 'org/with space', role: 'member'),
      );

      expect(overview.memberCount, 0);
      expect(overview.canManage, isFalse);
      session.dispose();
    });

    test('rejects blank organization IDs without making a request', () async {
      final session = _FakeSession((method, path) async => {'members': []});
      final repository = InOneWorkspaceRepository(session);

      await expectLater(
        repository.organizationOverview(_organization(id: '  ')),
        throwsA(isA<ApiException>().having(
          (error) => error.code,
          'code',
          'invalid_organization_id',
        )),
      );
      expect(session.requestedPaths, isEmpty);
      session.dispose();
    });

    test('rejects malformed member envelopes and entries', () async {
      final badEnvelope = InOneWorkspaceRepository(
        _FakeSession((method, path) async => {'items': []}),
      );
      await expectLater(
        badEnvelope.organizationOverview(_organization()),
        throwsA(isA<ApiException>().having(
          (error) => error.code,
          'code',
          'invalid_response',
        )),
      );

      final badEntry = InOneWorkspaceRepository(
        _FakeSession((method, path) async => {
          'members': [
            {'userId': 'user-1', 'role': 'superuser'},
          ],
        }),
      );
      await expectLater(
        badEntry.organizationOverview(_organization()),
        throwsA(isA<ApiException>().having(
          (error) => error.code,
          'code',
          'invalid_response',
        )),
      );
    });
  });

  group('InOneWorkspaceScreenData', () {
    test('maps verified organization and member count without fabricated metrics',
        () async {
      final session = _FakeSession((method, path) async {
        if (path == '/orgs/mine') {
          return {
            'orgs': [
              {
                'orgId': 'org-1',
                'name': 'North Workspace',
                'status': 'approved',
                'role': 'owner',
              },
            ],
          };
        }
        if (path == '/orgs/org-1/members') {
          return {
            'members': [
              {'userId': 'user-1', 'role': 'owner'},
              {'userId': 'user-2', 'role': 'member'},
            ],
          };
        }
        throw StateError('Unexpected request: $path');
      });
      final data = await InOneWorkspaceScreenData.load(
        InOneWorkspaceRepository(session),
        selectedOrganizationId: 'org-1',
      );

      expect(data.selectedOrganization?.orgId, 'org-1');
      expect(data.workspaceSummary.name, 'North Workspace');
      expect(data.workspaceSummary.teamMembers, 2);
      expect(data.workspaceSummary.activeProjects, isNull);
      expect(data.workspaceSummary.tasksDue, isNull);
      expect(data.workspaceSummary.activeGroups, isNull);
      expect(data.organizationProfile?.members, 2);
      expect(data.organizationProfile?.verified, isTrue);
      expect(data.organizationProfile?.projects, isNull);
      expect(data.organizationProfile?.teams, isNull);
      expect(data.organizationProfile?.about, isNull);
      session.dispose();
    });

    test('returns a truthful personal workspace when no organizations exist',
        () async {
      final session = _FakeSession((method, path) async => {'orgs': []});

      final data = await InOneWorkspaceScreenData.load(
        InOneWorkspaceRepository(session),
      );

      expect(data.organizations, isEmpty);
      expect(data.selectedOrganization, isNull);
      expect(data.workspaceSummary.name, 'Личное пространство');
      expect(data.workspaceSummary.teamMembers, isNull);
      expect(data.organizationProfile, isNull);
      expect(session.requestedPaths, ['/orgs/mine']);
      session.dispose();
    });

    test('rejects a stale selected organization instead of silently switching',
        () async {
      final session = _FakeSession((method, path) async => {
            'orgs': [
              {
                'orgId': 'org-current',
                'name': 'Current Workspace',
                'status': 'approved',
                'role': 'member',
              },
            ],
          });

      await expectLater(
        InOneWorkspaceScreenData.load(
          InOneWorkspaceRepository(session),
          selectedOrganizationId: 'org-removed',
        ),
        throwsA(isA<ApiException>().having(
          (error) => error.statusCode,
          'statusCode',
          404,
        )),
      );
      expect(session.requestedPaths, ['/orgs/mine']);
      session.dispose();
    });
  });
}
