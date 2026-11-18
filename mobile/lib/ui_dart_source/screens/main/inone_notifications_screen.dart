import 'package:flutter/material.dart';

import '../../models/inone_models.dart';
import '../../theme/inone_theme.dart';
import '../../widgets/inone_bottom_nav.dart';
import '../../widgets/inone_ds_widgets.dart';
import '../../widgets/inone_icons.dart';

/// Screen 06 / D06 · Notifications: уведомления с фильтрами All / Unread / Mentions.
class InOneNotificationsScreen extends StatefulWidget {
  const InOneNotificationsScreen({
    super.key,
    required this.items,
    required this.onOpen,
    required this.onSettings,
    required this.onTab,
    required this.onAdd,
  });

  final List<InOneNotificationItem> items;
  final ValueChanged<InOneNotificationItem> onOpen;
  final VoidCallback onSettings;
  final ValueChanged<InOneTab> onTab;
  final VoidCallback onAdd;

  @override
  State<InOneNotificationsScreen> createState() => _InOneNotificationsScreenState();
}

class _InOneNotificationsScreenState extends State<InOneNotificationsScreen> {
  int _filter = 0;

  /// «Mentions» = упоминания в CRM-комментариях.
  List<InOneNotificationItem> get _visible {
    switch (_filter) {
      case 1:
        return widget.items.where((n) => n.unread).toList();
      case 2:
        return widget.items.where((n) => n.kind == InOneNotificationKind.crm).toList();
      default:
        return widget.items;
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final items = _visible;
    return InOneShell(
      // Ни один раздел нижней навигации не соответствует экрану уведомлений.
      nav: InOneBottomNav(selected: null, onSelected: widget.onTab, onAdd: widget.onAdd),
      body: Padding(
        padding: const EdgeInsets.fromLTRB(20, 6, 20, 0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Notifications',
                    style: InOneText.style(24, FontWeight.w600, c.text, letterSpacing: -0.48),
                  ),
                ),
                InOneIconAction(
                  icon: InOneIcons.settings,
                  semanticLabel: 'Notification settings',
                  onTap: widget.onSettings,
                ),
              ],
            ),
            const SizedBox(height: 16),
            InOneFilterChips(
              labels: const ['All', 'Unread', 'Mentions'],
              selectedIndex: _filter,
              onChanged: (i) => setState(() => _filter = i),
            ),
            const SizedBox(height: 14),
            Expanded(
              child: ListView.separated(
                itemCount: items.length,
                separatorBuilder: (_, __) => const SizedBox(height: 6),
                itemBuilder: (context, i) => _NotificationRow(
                  item: items[i],
                  onTap: () => widget.onOpen(items[i]),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NotificationRow extends StatelessWidget {
  const _NotificationRow({required this.item, required this.onTap});
  final InOneNotificationItem item;
  final VoidCallback onTap;

  Widget _icon(BuildContext context) {
    final c = context.inone;
    switch (item.kind) {
      case InOneNotificationKind.task:
        return InOneIconTile(icon: InOneIcons.tasks, background: c.dangerTint, foreground: c.danger);
      case InOneNotificationKind.deadline:
        return InOneIconTile(icon: InOneIcons.deadline, background: c.soft, foreground: c.link);
      case InOneNotificationKind.message:
        return InOneStripeBox(width: 38, height: 38, radius: 11);
      case InOneNotificationKind.crm:
        return InOneIconTile(icon: InOneIcons.chat, background: c.soft, foreground: c.link);
      case InOneNotificationKind.calendar:
        return InOneIconTile(icon: InOneIcons.calendar, background: c.blueTint, foreground: c.blue);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Material(
      color: item.unread ? c.tint : c.bg,
      borderRadius: BorderRadius.circular(14),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _icon(context),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(item.title, style: InOneText.style(13.5, FontWeight.w700, c.text)),
                    const SizedBox(height: 3),
                    Text(item.body, style: InOneText.style(12, FontWeight.w400, c.muted)),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Text(item.timeAgo, style: InOneText.style(11, FontWeight.w400, c.muted)),
            ],
          ),
        ),
      ),
    );
  }
}
