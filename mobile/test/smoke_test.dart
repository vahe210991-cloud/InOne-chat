import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/main.dart';

void main() {
  testWidgets('InOne app boots into the approved screens host', (tester) async {
    await tester.pumpWidget(const InOneApp());
    expect(find.byType(ApprovedScreensHost), findsOneWidget);
  });
}
