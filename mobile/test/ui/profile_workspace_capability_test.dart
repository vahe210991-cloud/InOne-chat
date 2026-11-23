import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/ui_dart_source/models/inone_models.dart';
import 'package:inone_mobile/ui_dart_source/screens/main/inone_org_profile_screen.dart';
import 'package:inone_mobile/ui_dart_source/screens/main/inone_profile_screen.dart';
import 'package:inone_mobile/ui_dart_source/screens/main/inone_workspace_screen.dart';
import 'package:inone_mobile/ui_dart_source/theme/inone_theme.dart';

Widget _host(Widget child) => MaterialApp(
      theme: InOneTheme.light(),
      home: child,
    );

void main() {
  testWidgets('profile hides unavailable statistics and avatar edit affordance',
      (tester) async {
    await tester.pumpWidget(_host(
      InOneProfileScreen(
        profile: const InOneUserProfile(
          name: 'Test User',
          handle: 'user@example.test',
          myTasks: '—',
          activity: '—',
          projects: '—',
        ),
        menu: const [],
        onToggleTheme: () {},
        onEditAvatar: () {},
        onTab: (_) {},
        onAdd: () {},
      ),
    ));

    expect(find.text('My tasks'), findsNothing);
    expect(find.text('Activity'), findsNothing);
    expect(find.text('Projects'), findsNothing);
    expect(find.byIcon(Icons.add), findsNothing);
  });

  testWidgets('workspace hides unsupported notifications, customization and feed actions',
      (tester) async {
    await tester.pumpWidget(_host(
      InOneWorkspaceScreen(
        summary: const InOneWorkspaceSummary(
          name: 'Personal workspace',
          activeProjects: null,
          tasksDue: null,
          teamMembers: null,
          activeGroups: null,
        ),
        modules: const [],
        activity: const [
          InOneActivityItem(
            title: 'Server-backed event',
            subtitle: 'Visible only when supplied by the API',
            time: 'Now',
            icon: Icons.info_outline,
          ),
        ],
        onSwitchWorkspace: () {},
        onNotifications: () {},
        onCustomize: () {},
        onSeeAll: () {},
        onTab: (_) {},
        onAdd: () {},
      ),
    ));

    expect(find.bySemanticsLabel('Notifications'), findsNothing);
    expect(find.text('Customize'), findsNothing);
    expect(find.text('See all'), findsNothing);
    expect(find.text('Server-backed event'), findsOneWidget);
  });

  testWidgets('organization profile hides unavailable metrics and about section',
      (tester) async {
    await tester.pumpWidget(_host(
      InOneOrgProfileScreen(
        profile: const InOneOrgProfile(
          name: 'North Workspace',
          subtitle: 'member · pending',
          members: null,
          projects: null,
          teams: null,
          about: null,
        ),
        onBack: () {},
        onMore: () {},
        onEditCover: null,
        onTab: (_) {},
        onAdd: () {},
      ),
    ));

    expect(find.text('Members'), findsNothing);
    expect(find.text('Projects'), findsNothing);
    expect(find.text('Teams'), findsNothing);
    expect(find.text('About organization'), findsNothing);
    expect(find.text('Edit cover'), findsNothing);
  });
}
