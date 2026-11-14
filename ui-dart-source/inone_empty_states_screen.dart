import 'package:flutter/material.dart';

import '../../widgets/inone_ds_widgets.dart';
import '../../widgets/inone_icons.dart';

/// Screen 51 / D49 · Empty states: образцы пустых состояний (нет чатов,
/// нет результатов поиска, нет сообщений). Блоки [InOneEmptyState] можно
/// использовать в списках отдельно.
class InOneEmptyStatesScreen extends StatelessWidget {
  const InOneEmptyStatesScreen({
    super.key,
    required this.onStartChat,
    required this.onClearSearch,
    required this.onViewAllChats,
  });

  final VoidCallback onStartChat;
  final VoidCallback onClearSearch;
  final VoidCallback onViewAllChats;

  @override
  Widget build(BuildContext context) {
    return InOneShell(
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 6, 20, 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const InOneCaps('EMPTY STATES'),
            const SizedBox(height: 16),
            InOneEmptyState(
              icon: InOneIcons.chat,
              accentIcon: true,
              title: 'No chats yet',
              text: 'Start a conversation with a teammate or open a project chat.',
              actions: [InOneSmallAction(label: 'Start a chat', onTap: onStartChat)],
            ),
            const SizedBox(height: 14),
            InOneEmptyState(
              icon: InOneIcons.searchOff,
              title: 'No matching items',
              text: 'Nothing matches your search. Try another name or clear the filters.',
              textMaxWidth: 250,
              actions: [
                InOneSmallAction(label: 'Clear search', onTap: onClearSearch, style: InOneSmallActionStyle.outline),
                InOneSmallAction(label: 'View all chats', onTap: onViewAllChats, style: InOneSmallActionStyle.soft),
              ],
            ),
            const SizedBox(height: 14),
            const InOneEmptyState(
              icon: InOneIcons.inbox,
              title: 'No messages yet',
              text: 'When a teammate writes to you, the conversation will appear here.',
            ),
          ],
        ),
      ),
    );
  }
}
