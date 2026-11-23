import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/session/inone_session.dart';
import 'package:inone_mobile/ui_dart_source/models/inone_models.dart';
import 'package:inone_mobile/ui_dart_source/screens/main/inone_connected_workspace_screen.dart';
import 'package:inone_mobile/ui_dart_source/theme/inone_theme.dart';

class _FakeSession extends InOneSession {
  _FakeSession()
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

  @override
  Future<Map<String, dynamic>> request(
    String method,
    String path, {
    Object? body,
    bool authenticated = true,
  }) async {
    if (path == '/orgs/mine') {
      return {
        'orgs': [
          {'orgId': 'org-1', 'name': 'North Workspace', 'status': 'approved', 'role': 'owner'},
          {'orgId': 'org-2', 'name': 'South Workspace', 'status': 'pending', 'role': 'member'},
        ],
      };
    }
    if (path == '/orgs/org-1/members') {
      return {'members': [
        {'userId': 'u1', 'role': 'owner'},
        {'userId': 'u2', 'role': 'member'},
      ]};
    }
    if (path == '/orgs/org-2/members') {
      return {'members': [
        {'userId': 'u3', 'role': 'member'},
      ]};
    }
    throw StateError('Unexpected request: $path');
  }
}

void main() {
  testWidgets('loads organization workspace from the server and switches selection',
      (tester) async {
    final session = _FakeSession();
    String? selected;
    await tester.pumpWidget(MaterialApp(
      theme: InOneTheme.light(),
      home: InOneConnectedWorkspaceScreen(
        session: session,
        modules: const [],
        activity: const [],
        onNotifications: null,
        onCustomize: null,
        onSeeAll: null,
        onOrganizationSelected: (id) => selected = id,
        onTab: (_) {},
        onAdd: () {},
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('North Workspace'), findsOneWidget);
    expect(find.text('2'), findsOneWidget);

    await tester.tap(find.text('North Workspace'));
    await tester.pumpAndSettle();
    expect(find.text('South Workspace'), findsOneWidget);
    await tester.tap(find.text('South Workspace').last);
    await tester.pumpAndSettle();

    expect(selected, 'org-2');
    expect(find.text('South Workspace'), findsOneWidget);
    expect(find.text('1'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    session.dispose();
  });
}
