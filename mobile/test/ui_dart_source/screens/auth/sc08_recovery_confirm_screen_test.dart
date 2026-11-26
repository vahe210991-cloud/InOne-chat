import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/ui_dart_source/screens/auth/sc08_recovery_confirm_screen.dart';

void main() {
  testWidgets('SC-08 confirms the recovery link only after explicit user tap',
      (tester) async {
    var confirmations = 0;
    var completed = 0;

    await tester.pumpWidget(
      MaterialApp(
        home: InOneRecoveryConfirmScreen(
          onConfirm: () async {
            confirmations++;
            return null;
          },
          onBack: () {},
          onDone: () => completed++,
        ),
      ),
    );

    expect(confirmations, 0);
    expect(completed, 0);

    await tester.tap(find.text('Շարունակել'));
    await tester.pump();
    await tester.pumpAndSettle();

    expect(confirmations, 1);
    expect(completed, 1);
  });

}
