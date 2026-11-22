import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/ui_dart_source/inone.dart';

void main() {
  const pending = InOneOrgRequest(
    id: 'request-pending',
    name: 'Pending Company',
    date: '18.11.2026',
    status: InOneRequestStatus.pending,
  );
  const approved = InOneOrgRequest(
    id: 'request-approved',
    name: 'Approved Company',
    date: '17.11.2026',
    status: InOneRequestStatus.approved,
  );
  const rejected = InOneOrgRequest(
    id: 'request-rejected',
    name: 'Rejected Company',
    date: '16.11.2026',
    status: InOneRequestStatus.rejected,
  );

  testWidgets('PS-01 filters live queue items and opens the selected request', (tester) async {
    String? openedRequestId;
    await tester.pumpWidget(MaterialApp(
      theme: InOneTheme.light(),
      home: InOneRequestsAdminScreen(
        requests: const [pending, approved, rejected],
        onOpen: (request) => openedRequestId = request.id,
        onMenu: () {},
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Pending Company'), findsOneWidget);
    expect(find.text('Approved Company'), findsOneWidget);
    expect(find.text('Rejected Company'), findsOneWidget);

    await tester.tap(find.text(InOneRequestLabels.pending).last);
    await tester.pumpAndSettle();

    expect(find.text('Pending Company'), findsOneWidget);
    expect(find.text('Approved Company'), findsNothing);
    expect(find.text('Rejected Company'), findsNothing);

    await tester.tap(find.text('Pending Company'));
    expect(openedRequestId, 'request-pending');
  });

  testWidgets('PS-02 exposes decision navigation to owner only', (tester) async {
    Future<InOneFailure?> noOpen(InOneDocument document) async => null;
    Widget screen({required bool isOwner}) => MaterialApp(
          theme: InOneTheme.light(),
          home: InOneRequestAdminDetailsScreen(
            request: pending,
            documents: const [],
            isOwner: isOwner,
            onOpen: noOpen,
            onDecide: () {},
            onBack: () {},
            onMenu: () {},
          ),
        );

    await tester.pumpWidget(screen(isOwner: false));
    await tester.pumpAndSettle();
    expect(find.text('Անցնել որոշմանը'), findsNothing);

    await tester.pumpWidget(screen(isOwner: true));
    await tester.pumpAndSettle();
    expect(find.text('Անցնել որոշմանը'), findsOneWidget);
  });

  testWidgets('PS-03 asks for confirmation before submitting an owner decision', (tester) async {
    InOneDecision? submittedDecision;
    var completed = false;
    await tester.pumpWidget(MaterialApp(
      theme: InOneTheme.light(),
      home: InOneRequestDecisionScreen(
        request: pending,
        onDecision: (decision) async {
          submittedDecision = decision;
          return null;
        },
        onBack: () {},
        onMenu: () {},
        onDone: () => completed = true,
      ),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Հաստատել').first);
    await tester.pumpAndSettle();
    expect(submittedDecision, isNull);
    expect(find.text('Հաստատե՞լ հայտը'), findsOneWidget);

    await tester.tap(find.text('Հաստատել').last);
    await tester.pumpAndSettle();
    expect(submittedDecision, InOneDecision.approve);
    expect(completed, isTrue);
  });
}
