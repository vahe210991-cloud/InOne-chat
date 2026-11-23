import 'package:flutter/material.dart';

import '../theme/inone_theme.dart';
import 'inone_icons.dart';

/// Разделы нижней навигации. Центральная кнопка «+» — не раздел,
/// а действие «добавить публикацию» ([InOneBottomNav.onAdd]).
enum InOneTab { feed, calls, messages, profile }

/// Нижняя навигация InOne: Лента · Звонки · + · Сообщения · Профиль.
/// [selected] = null — ни один раздел не подсвечен (например, экран организации).
class InOneBottomNav extends StatelessWidget {
  const InOneBottomNav({
    super.key,
    required this.selected,
    required this.onSelected,
    this.onAdd,
    this.availableTabs = const {InOneTab.feed, InOneTab.calls, InOneTab.messages, InOneTab.profile},
  });

  final InOneTab? selected;
  final ValueChanged<InOneTab> onSelected;
  final VoidCallback? onAdd;
  final Set<InOneTab> availableTabs;

  static const String feedLabel = 'Лента';
  static const String callsLabel = 'Звонки';
  static const String messagesLabel = 'Сообщения';
  static const String profileLabel = 'Профиль';
  static const String addLabel = 'Добавить публикацию';

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final bottom = MediaQuery.of(context).padding.bottom;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: c.bg,
        border: Border(top: BorderSide(color: c.border)),
        boxShadow: [BoxShadow(color: c.navShadow, blurRadius: 20, offset: const Offset(0, -4))],
      ),
      child: Padding(
        padding: EdgeInsets.fromLTRB(18, 10, 18, bottom + 6),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            if (availableTabs.contains(InOneTab.feed))
              _item(context, InOneTab.feed, InOneIcons.feed, feedLabel),
            if (availableTabs.contains(InOneTab.calls))
              _item(context, InOneTab.calls, InOneIcons.calls, callsLabel),
            if (onAdd != null) _AddButton(onTap: onAdd!),
            if (availableTabs.contains(InOneTab.messages))
              _item(context, InOneTab.messages, InOneIcons.messages, messagesLabel),
            if (availableTabs.contains(InOneTab.profile))
              _item(context, InOneTab.profile, InOneIcons.profile, profileLabel),
          ],
        ),
      ),
    );
  }

  Widget _item(BuildContext context, InOneTab tab, IconData icon, String label) {
    final c = context.inone;
    final active = selected == tab;
    final color = active ? c.brand : c.hint;
    return Semantics(
      button: true,
      selected: active,
      label: label,
      child: InkResponse(
        onTap: () => onSelected(tab),
        radius: 32,
        child: SizedBox(
          width: 64,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 24, color: color),
              const SizedBox(height: 4),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: InOneText.style(10, active ? FontWeight.w700 : FontWeight.w600, color),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AddButton extends StatelessWidget {
  const _AddButton({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Semantics(
      button: true,
      label: InOneBottomNav.addLabel,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: c.accent,
            shape: BoxShape.circle,
            boxShadow: const [
              BoxShadow(color: Color(0x6696C428), blurRadius: 16, offset: Offset(0, 6)),
            ],
          ),
          child: Icon(InOneIcons.plus, size: 26, color: c.onAccent),
        ),
      ),
    );
  }
}
