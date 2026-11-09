import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/data/profile_load_status.dart';

void main() {
  testWidgets('shows loading state', (tester) async {
    await tester.pumpWidget(_statusApp(ProfileLoadStatus.loading));

    expect(find.text('Loading profile…'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('shows the signed-out state', (tester) async {
    await tester.pumpWidget(_statusApp(ProfileLoadStatus.unauthenticated));

    expect(
      find.textContaining('Sign in through API / Backend test'),
      findsOneWidget,
    );
  });

  testWidgets('shows empty profile state', (tester) async {
    await tester.pumpWidget(_statusApp(ProfileLoadStatus.empty));

    expect(
        find.text('Profile information is not available yet.'), findsOneWidget);
  });

  testWidgets('shows error state', (tester) async {
    await tester.pumpWidget(_statusApp(ProfileLoadStatus.error));

    expect(
      find.text('Could not load profile. Check your connection and try again.'),
      findsOneWidget,
    );
    expect(find.byIcon(Icons.error_outline), findsOneWidget);
  });
}

Widget _statusApp(ProfileLoadStatus status) => MaterialApp(
      home: Scaffold(
        body: ProfileLoadStatusBanner(status: status),
      ),
    );
