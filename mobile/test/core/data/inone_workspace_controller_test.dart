import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/data/inone_workspace_controller.dart';
import 'package:inone_mobile/core/data/inone_workspace_repository.dart';
import 'package:inone_mobile/core/session/inone_session.dart';

typedef _Handler = Future<Map<String, dynamic>> Function(String path);

class _FakeSession extends InOneSession {
  _FakeSession(this._handler)
      : super(
          baseUrl: 'https://api.example.test',
          readDeviceId: () async => 'device',
          writeDeviceId: (_) async {},
          readMlsUserId: () async => null,
          writeMlsUserId: (_) async {},
          deleteMlsUserId: () async {},
          readLocale: () async => 'en',
          writeLocale: (_) async {},
          readLocaleSyncPending: () async => 'false',
          writeLocaleSyncPending: (_) async {},
        );

  final _Handler _handler;

  @override
  Future<Map<String, dynamic>> request(
    String method,
    String path, {
    Object? body,
    bool authenticated = true,
  }) => _handler(path);
}

void main() {
  test('loads a personal workspace when the account has no organizations', () async {
    final session = _FakeSession((path) async => {'orgs': []});
    final controller = InOneWorkspaceController(InOneWorkspaceRepository(session));

    await controller.load();

    expect(controller.isLoading, isFalse);
    expect(controller.error, isNull);
    expect(controller.data?.workspaceSummary.name, 'Личное пространство');
    controller.dispose();
    session.dispose();
  });

  test('selects an organization and publishes its server member count', () async {
    final session = _FakeSession((path) async {
      if (path == '/orgs/mine') {
        return {
          'orgs': [
            {'orgId': 'org-a', 'name': 'Workspace A', 'status': 'approved', 'role': 'owner'},
            {'orgId': 'org-b', 'name': 'Workspace B', 'status': 'pending', 'role': 'member'},
          ],
        };
      }
      if (path == '/orgs/org-b/members') {
        return {'members': [
          {'userId': 'u1', 'role': 'owner'},
          {'userId': 'u2', 'role': 'member'},
        ]};
      }
      throw StateError('Unexpected path: $path');
    });
    final controller = InOneWorkspaceController(InOneWorkspaceRepository(session));

    await controller.selectOrganization('org-b');

    expect(controller.error, isNull);
    expect(controller.data?.selectedOrganization?.orgId, 'org-b');
    expect(controller.data?.workspaceSummary.teamMembers, 2);
    expect(controller.data?.organizationProfile?.verified, isFalse);
    controller.dispose();
    session.dispose();
  });

  test('ignores an older response when a newer workspace request wins', () async {
    final slow = Completer<Map<String, dynamic>>();
    var orgRequests = 0;
    final session = _FakeSession((path) async {
      if (path != '/orgs/mine') throw StateError('Unexpected path: $path');
      orgRequests++;
      if (orgRequests == 1) return slow.future;
      return {'orgs': []};
    });
    final controller = InOneWorkspaceController(InOneWorkspaceRepository(session));

    final first = controller.load();
    await controller.load();
    slow.complete({
      'orgs': [
        {'orgId': 'stale', 'name': 'Stale', 'status': 'approved', 'role': 'owner'},
      ],
    });
    await first;

    expect(controller.data?.organizations, isEmpty);
    expect(controller.data?.workspaceSummary.name, 'Личное пространство');
    expect(controller.isLoading, isFalse);
    controller.dispose();
    session.dispose();
  });
}
