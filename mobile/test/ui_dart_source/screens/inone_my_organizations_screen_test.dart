import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:inone_mobile/core/data/inone_organization.dart';
import 'package:inone_mobile/ui_dart_source/inone.dart';

void main() {
  testWidgets('organization picker renders server organizations and selects one', (tester) async {
    InOneOrganization? selected;
    final organizations = [
      const InOneOrganization(orgId: 'org-a', name: 'Alpha Studio', status: 'approved', role: 'owner'),
      const InOneOrganization(orgId: 'org-b', name: 'Beta Works', status: 'pending', role: 'member'),
    ];

    await tester.pumpWidget(
      MaterialApp(
        theme: InOneTheme.light(),
        home: InOneMyOrganizationsScreen(
          organizations: organizations,
          selectedOrganizationId: 'org-a',
          locale: 'en',
          onSelect: (organization) => selected = organization,
          onBack: () {},
          onTab: (_) {},
        ),
      ),
    );

    expect(find.text('Alpha Studio'), findsOneWidget);
    expect(find.text('Beta Works'), findsOneWidget);
    expect(find.text('Owner'), findsOneWidget);
    expect(find.text('Pending'), findsOneWidget);

    await tester.tap(find.text('Beta Works'));
    await tester.pump();

    expect(selected?.orgId, 'org-b');
  });

  testWidgets('organization picker shows an honest empty state', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: InOneTheme.light(),
        home: InOneMyOrganizationsScreen(
          organizations: const [],
          selectedOrganizationId: null,
          locale: 'ru',
          onSelect: (_) {},
          onBack: () {},
          onTab: (_) {},
        ),
      ),
    );

    expect(find.text('Нет доступных организаций'), findsOneWidget);
    expect(find.text('Создать организацию'), findsNothing);
  });
}
