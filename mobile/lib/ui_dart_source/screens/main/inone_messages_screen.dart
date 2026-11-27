import 'package:flutter/material.dart';

import '../../models/inone_models.dart';
import '../../theme/inone_theme.dart';
import '../../widgets/inone_bottom_nav.dart';
import '../../widgets/inone_ds_widgets.dart';
import '../../widgets/inone_icons.dart';

/// Screen 05 / D05 · Chats: список диалогов с фильтрами All / Unread / Groups / Channels.
class InOneMessagesScreen extends StatefulWidget {
  const InOneMessagesScreen({
    super.key,
    required this.chats,
    required this.onOpenChat,
    required this.onSearch,
    required this.onTab,
    this.onAdd,
    this.onAcceptContact,
    this.onBlockContact,
    this.unreadCountsAvailable = true,
  });

  final List<InOneChatPreview> chats;
  final ValueChanged<InOneChatPreview> onOpenChat;
  final VoidCallback onSearch;
  final bool unreadCountsAvailable;
  final ValueChanged<InOneTab> onTab;

  /// Starts a protected MLS room when the native Engine B session is active.
  final VoidCallback? onAdd;
  final ValueChanged<InOneChatPreview>? onAcceptContact;
  final ValueChanged<InOneChatPreview>? onBlockContact;

  @override
  State<InOneMessagesScreen> createState() => _InOneMessagesScreenState();
}

class _InOneMessagesScreenState extends State<InOneMessagesScreen> {
  int _filter = 0;

  List<InOneChatPreview> get _visible {
    if (!widget.unreadCountsAvailable) {
      switch (_filter) {
        case 1:
          return widget.chats.where((c) => c.kind == InOneChatKind.group).toList();
        case 2:
          return widget.chats.where((c) => c.kind == InOneChatKind.channel).toList();
        default:
          return widget.chats;
      }
    }
    switch (_filter) {
      case 1:
        return widget.chats.where((c) => c.unread > 0).toList();
      case 2:
        return widget.chats.where((c) => c.kind == InOneChatKind.group).toList();
      case 3:
        return widget.chats.where((c) => c.kind == InOneChatKind.channel).toList();
      default:
        return widget.chats;
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final chats = _visible;
    return InOneShell(
      nav: InOneBottomNav(selected: InOneTab.messages, onSelected: widget.onTab, availableTabs: const {InOneTab.messages, InOneTab.profile}),
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
                InOneIconAction(icon: InOneIcons.filter, semanticLabel: 'Toggle group filter', onTap: () => setState(() => _filter = _filter == 0 ? 1 : 0)),
                InOneIconAction(icon: InOneIcons.search, semanticLabel: 'Search', onTap: widget.onSearch),
                if (widget.onAdd != null)
                  InOneIconAction(icon: InOneIcons.plus, semanticLabel: 'New direct chat', onTap: widget.onAdd),
              ],
            ),
            const SizedBox(height: 16),
            InOneSearchBar(hint: 'Find public groups', onTap: widget.onSearch),
            const SizedBox(height: 14),
            InOneFilterChips(
              labels: widget.unreadCountsAvailable
                  ? const ['All', 'Unread', 'Groups', 'Channels']
                  : const ['All', 'Groups', 'Channels'],
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
                        text: 'Your MLS chats appear after this device receives and processes a valid MLS Welcome.',
                      ),
                    )
                  : ListView.builder(
                      itemCount: chats.length,
                      itemBuilder: (context, i) => _ChatRow(
                        chat: chats[i],
                        last: i == chats.length - 1,
                        onTap: () => widget.onOpenChat(chats[i]),
                        onAcceptContact: widget.onAcceptContact == null
                            ? null
                            : () => widget.onAcceptContact!(chats[i]),
                        onBlockContact: widget.onBlockContact == null
                            ? null
                            : () => widget.onBlockContact!(chats[i]),
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
  const _ChatRow({
    required this.chat,
    required this.last,
    required this.onTap,
    this.onAcceptContact,
    this.onBlockContact,
  });
  final InOneChatPreview chat;
  final bool last;
  final VoidCallback onTap;
  final VoidCallback? onAcceptContact;
  final VoidCallback? onBlockContact;

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
      case InOneChatKind.channel:
        return InOneIconTile(
          icon: InOneIcons.campaign,
          background: c.blueTint,
          foreground: c.blue,
          size: 44,
          circle: true,
        );
      case InOneChatKind.unknown:
        return InOneIconTile(
          icon: InOneIcons.help,
          background: c.soft,
          foreground: c.muted,
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
    final showContactActions = chat.incomingContactRequest &&
        chat.peerUserId != null &&
        !chat.isPeerContact &&
        !chat.isBlocked &&
        onAcceptContact != null &&
        onBlockContact != null;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 13),
      decoration: BoxDecoration(
        border: last ? null : Border(bottom: BorderSide(color: c.rowLine)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: onTap,
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
          if (showContactActions)
            Padding(
              padding: const EdgeInsets.only(left: 56, top: 5),
              child: Wrap(
                spacing: 8,
                runSpacing: 4,
                children: [
                  TextButton(
                    onPressed: onAcceptContact,
                    style: TextButton.styleFrom(
                      foregroundColor: c.link,
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      minimumSize: const Size(0, 32),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: const Text('Принять'),
                  ),
                  TextButton(
                    onPressed: onBlockContact,
                    style: TextButton.styleFrom(
                      foregroundColor: c.dangerText,
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      minimumSize: const Size(0, 32),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: const Text('Заблокировать'),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
