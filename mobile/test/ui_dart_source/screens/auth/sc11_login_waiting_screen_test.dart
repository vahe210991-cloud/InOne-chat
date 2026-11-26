import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../../../lib/ui_dart_source/theme/inone_theme.dart';
import 'package:inone_mobile/ui_dart_source/screens/auth/sc11_login_waiting_screen.dart';
import 'package:inone_mobile/ui_dart_source/state/inone_state.dart';

void main() {
  testWidgets('SC-11 displays the approval code and polls at a bounded interval',
      (tester) async {
    var polls = 0;

    await tester.pumpWidget(
      MaterialApp(
        theme: InOneTheme.light(),
        home: InOneLoginWaitingScreen(
          activateAt: '',
          approvalCode: '482913',
          autoPoll: true,
          showNotMe: false,
          onRecheck: () async {
            polls++;
            return const InOneFailure(
              InOneScreenState.error,
              message: 'Ожидаем подтверждения.',
            );
          },
          onNotMe: () {},
        ),
      ),
    );

    expect(find.textContaining('482913'), findsOneWidget);
    expect(find.text('Սա ես չեմ'), findsNothing);
    expect(polls, 0);

    await tester.pump(const Duration(seconds: 5));
    await tester.pump();

    expect(polls, 1);

    await tester.pumpWidget(const SizedBox.shrink());
  });
}
