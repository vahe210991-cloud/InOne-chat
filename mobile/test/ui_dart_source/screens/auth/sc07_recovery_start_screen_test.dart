import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../../../lib/ui_dart_source/screens/auth/sc07_recovery_start_screen.dart';

void main() {
  testWidgets('SC-07 exposes a separate recovery-cancellation code entry', (tester) async {
    var cancellationOpened = false;
    await tester.pumpWidget(
      MaterialApp(
        home: InOneRecoveryStartScreen(
          onSubmit: (_) async => null,
          onBack: () {},
          onEnterCode: () {},
          onCancelRecovery: () => cancellationOpened = true,
        ),
      ),
    );

    final action = find.text('Արդեն ունե՞ք չեղարկման կոդը');
    expect(action, findsOneWidget);
    await tester.tap(action);
    await tester.pumpAndSettle();

    expect(cancellationOpened, isTrue);
  });
}
