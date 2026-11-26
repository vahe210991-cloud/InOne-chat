import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/ui_dart_source/models/inone_models.dart';
import 'package:inone_mobile/ui_dart_source/screens/main/inone_messages_screen.dart';
import 'package:inone_mobile/ui_dart_source/theme/inone_theme.dart';

void main() {
  testWidgets('unread filter shows only rooms with unread encrypted messages', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: InOneTheme.light(),
        home: InOneMessagesScreen(
          chats: const [
            InOneChatPreview(
              id: 'room-unread',
              name: 'Unread room',
              lastMessage: 'Encrypted preview',
              time: '10:30',
              kind: InOneChatKind.group,
              unread: 2,
            ),
            InOneChatPreview(
              id: 'room-read',
              name: 'Read room',
              lastMessage: 'Earlier preview',
              time: '09:30',
              kind: InOneChatKind.group,
            ),
          ],
          onOpenChat: (_) {},
          onSearch: () {},
          onTab: (_) {},
          unreadCountsAvailable: true,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Unread'));
    await tester.pumpAndSettle();

    expect(find.text('Unread room'), findsOneWidget);
    expect(find.text('Read room'), findsNothing);
  });

  testWidgets('channel filter excludes ordinary groups', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: InOneTheme.light(),
        home: InOneMessagesScreen(
          chats: const [
            InOneChatPreview(
              id: 'group-1',
              name: 'Project team',
              lastMessage: null,
              time: '',
              kind: InOneChatKind.group,
            ),
            InOneChatPreview(
              id: 'channel-1',
              name: 'Announcements',
              lastMessage: null,
              time: '',
              kind: InOneChatKind.channel,
            ),
          ],
          onOpenChat: (_) {},
          onSearch: () {},
          onTab: (_) {},
          unreadCountsAvailable: false,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Project team'), findsOneWidget);
    expect(find.text('Announcements'), findsOneWidget);

    await tester.tap(find.text('Channels'));
    await tester.pumpAndSettle();

    expect(find.text('Announcements'), findsOneWidget);
    expect(find.text('Project team'), findsNothing);
  });
}
