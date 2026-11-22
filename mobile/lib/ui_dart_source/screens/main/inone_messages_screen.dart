import 'package:flutter/material.dart';

import '../../models/inone_models.dart';
import '../../theme/inone_theme.dart';
import '../../widgets/inone_bottom_nav.dart';
import '../../widgets/inone_ds_widgets.dart';
import '../../widgets/inone_icons.dart';

/// Screen 05 / D05 · Chats: список диалогов с фильтрами All / Unread / Groups.
class InOneMessagesScreen extends StatefulWidget {
  const InOneMessagesScreen({
    super.key,
    required this.chats,
    required this.onOpenChat,
    required this.onSearch,
    required this.onTab,
    required this.onAdd,
    this.onFilter,
    this.unreadCountsAvailable = true,
  });

  final List<InOneChatPreview> chats;
  final ValueChanged<InOneChatPreview> onOpenChat;
  final VoidCallback onSearch;
  final VoidCallback? onFilter;
  final bool unreadCountsAvailable;
  final ValueChanged<InOneTab> onTab;

  /// «+» — добавить публикацию.
  final VoidCallback onAdd;

  @override
  State<InOneMessagesScreen> createState() => _InOneMessagesScreenState();
}

class _InOneMessagesScreenState extends State<InOneMessagesScreen> {
  int _filter = 0;

  List<InOneChatPreview> get _visible {
    if (!widget.unreadCountsAvailable) {
      return _filter == 1
          ? widget.chats.where((c) => c.kind == InOneChatKind.group).toList()
          : widget.chats;
    }
    switch (_filter) {
      case 1:
        return widget.chats.where((c) => c.unread > 0).toList();
      case 2:
        return widget.chats.where((c) => c.kind == InOneChatKind.group).toList();
      default:
        return widget.chats;
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final chats = _visible;
    return InOneShell(
      nav: InOneBottomNav(selected: InOneTab.messages, onSelected: widget.onTab, onAdd: widget.onAdd),
      body: Padding(
        padding: const EdgeInsets.fromLTRB(20, 6, 20, 0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Chats',
                    style: InOneText.style(24, FontWeight.w600, c.text, letterSpacing: -0.48),
                  ),
                ),
                InOneIconAction(icon: InOneIcons.filter, semanticLabel: 'Filter', onTap: widget.onFilter),
                InOneIconAction(icon: InOneIcons.search, semanticLabel: 'Search', onTap: widget.onSearch),
              ],
            ),
            const SizedBox(height: 16),
            InOneSearchBar(hint: 'Search messages', onTap: widget.onSearch),
            const SizedBox(height: 14),
            InOneFilterChips(
              labels: widget.unreadCountsAvailable
                  ? const ['All', 'Unread', 'Groups']
                  : const ['All', 'Groups'],
              selectedIndex: _filter,
              onChanged: (i) => setState(() => _filter = i),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: chats.isEmpty
                  ? const Center(
                      child: InOneEmptyState(
                        icon: InOneIcons.chat,
                        title: 'No chats yet',
                        text: 'No rooms are linked to this account yet. Rooms you belong to will appear here. Message history and sending require an active native MLS session on this device.',
                      ),
                    )
                  : ListView.builder(
                      itemCount: chats.length,
                      itemBuilder: (context, i) => _ChatRow(
                        chat: chats[i],
                        last: i == chats.length - 1,
                        onTap: () => widget.onOpenChat(chats[i]),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ChatRow extends StatelessWidget {
  const _ChatRow({required this.chat, required this.last, required this.onTap});
  final InOneChatPreview chat;
  final bool last;
  final VoidCallback onTap;

  Widget _avatar(BuildContext context) {
    final c = context.inone;
    switch (chat.kind) {
      case InOneChatKind.person:
        return InOneStripeBox(width: 44, height: 44, circle: true, borderColor: c.stripeB);
      case InOneChatKind.support:
        return InOneAvatar(
          initials: chat.initials ?? '',
          background: c.accent,
          foreground: c.onAccent,
        );
      case InOneChatKind.group:
        return InOneIconTile(
          icon: InOneIcons.group,
          background: c.soft,
          foreground: c.link,
          size: 44,
          circle: true,
        );
      case InOneChatKind.system:
        return InOneIconTile(
          icon: InOneIcons.files,
          background: c.blueTint,
          foreground: c.blue,
          size: 44,
          circle: true,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 13),
        decoration: BoxDecoration(
          border: last ? null : Border(bottom: BorderSide(color: c.rowLine)),
        ),
        child: Row(
          children: [
            _avatar(context),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(chat.name, style: InOneText.style(14, FontWeight.w700, c.text)),
                  const SizedBox(height: 3),
                  if (chat.lastMessage?.isNotEmpty == true)
                    Text(
                      chat.lastMessage!,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: InOneText.style(12, FontWeight.w400, c.muted),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (chat.time.isNotEmpty)
                  Text(chat.time, style: InOneText.style(11, FontWeight.w400, c.muted)),
                if (chat.unread > 0) ...[
                  const SizedBox(height: 5),
                  InOneCountBadge(chat.unread),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}
