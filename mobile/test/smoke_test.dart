import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/app/inone_mobile_app.dart';
import 'package:inone_mobile/ui_dart_source/inone.dart';

void main() {
  testWidgets('production entry renders the native Dart authentication screen',
      (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(const InOneMobileApp());
    await tester.pumpAndSettle(const Duration(milliseconds: 100));

    expect(find.byType(InOneLoginScreen), findsOneWidget);
    expect(find.text('Մուտք'), findsOneWidget);
    expect(find.text('Google'), findsOneWidget);
    expect(find.text('Apple'), findsOneWidget);
  });
}
