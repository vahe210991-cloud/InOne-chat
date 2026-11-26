import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/ui_dart_source/screens/auth/sc01_login_screen.dart';

void main() {
  testWidgets('SC-01 exposes recovery cancellation as a separate action',
      (tester) async {
    var cancellations = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: InOneLoginScreen(
          onSubmit: (_, __) async => null,
          onProvider: (_) async => null,
          onRegister: () {},
          onForgotPassword: () {},
          onCancelRecovery: () => cancellations++,
        ),
      ),
    );

    expect(find.text('Չեղարկել վերականգնումը'), findsOneWidget);
    await tester.tap(find.text('Չեղարկել վերականգնումը'));
    await tester.pump();

    expect(cancellations, 1);
  });

  testWidgets('SC-01 hides recovery cancellation when no handler is supplied',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: InOneLoginScreen(
          onSubmit: (_, __) async => null,
          onProvider: (_) async => null,
          onRegister: () {},
          onForgotPassword: () {},
        ),
      ),
    );

    expect(find.text('Չեղարկել վերականգնումը'), findsNothing);
  });
}
