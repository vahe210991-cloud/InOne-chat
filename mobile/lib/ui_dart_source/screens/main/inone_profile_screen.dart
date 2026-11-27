import 'package:flutter/material.dart';

import '../../models/inone_models.dart';
import '../../theme/inone_theme.dart';
import '../../widgets/inone_bottom_nav.dart';
import '../../widgets/inone_ds_widgets.dart';
import '../../widgets/inone_icons.dart';

/// Screen 43 / D41 · Profile: профиль пользователя, показатели, меню разделов.
class InOneProfileScreen extends StatelessWidget {
  const InOneProfileScreen({
    super.key,
    required this.profile,
    required this.menu,
    required this.onToggleTheme,
    required this.onEditAvatar,
    required this.onTab,
    this.onAdd,
    this.pinReminderDue = false,
    this.onPinRemember,
    this.onPinReplace,
  });

  final InOneUserProfile profile;
  final List<InOneProfileMenuItem> menu;
  final VoidCallback onToggleTheme;
  final VoidCallback? onEditAvatar;
  final ValueChanged<InOneTab> onTab;
  final VoidCallback? onAdd;
  final bool pinReminderDue;
  final VoidCallback? onPinRemember;
  final VoidCallback? onPinReplace;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return InOneShell(
      nav: InOneBottomNav(selected: InOneTab.profile, onSelected: onTab, onAdd: onAdd, availableTabs: const {InOneTab.messages, InOneTab.profile}),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 6, 20, 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(child: Text('Profile', style: InOneText.style(23, FontWeight.w700, c.text))),
                InOneIconAction(
                  icon: dark ? InOneIcons.lightMode : InOneIcons.darkMode,
                  semanticLabel: 'Toggle theme',
                  onTap: onToggleTheme,
                ),
              ],
            ),
            const SizedBox(height: 18),
            Row(
              children: [
                GestureDetector(
                  onTap: onEditAvatar,
                  child: SizedBox(
                    width: 64,
                    height: 64,
                    child: Stack(
                      clipBehavior: Clip.none,
                      children: [
                        Positioned.fill(
                          child: ClipOval(
                            child: profile.avatar != null
                                ? Image(image: profile.avatar!, fit: BoxFit.cover)
                                : InOneStripeBox(circle: true, borderColor: c.line),
                          ),
                        ),
                        if (onEditAvatar != null)
                          Positioned(
                            right: -2,
                            bottom: -2,
                            child: Container(
                              width: 22,
                              height: 22,
                              decoration: BoxDecoration(
                                color: c.accent,
                                shape: BoxShape.circle,
                                border: Border.all(color: c.bg, width: 2),
                              ),
                              child: Icon(InOneIcons.plus, size: 14, color: c.onAccent),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(profile.name, style: InOneText.style(17, FontWeight.w700, c.text)),
                      const SizedBox(height: 3),
                      Text(profile.handle, style: InOneText.style(12.5, FontWeight.w400, c.muted)),
                      if (profile.verified) ...[
                        const SizedBox(height: 3),
                        Row(
                          children: [
                            Icon(InOneIcons.verified, size: 14, color: c.link),
                            const SizedBox(width: 5),
                            Text('Verified account', style: InOneText.style(11.5, FontWeight.w700, c.link)),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            Row(
              children: [
                Expanded(
                  child: InOneStatTile(label: 'My tasks', value: profile.myTasks, valueSize: 16, center: true),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: InOneStatTile(label: 'Activity', value: profile.activity, valueSize: 16, center: true),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: InOneStatTile(label: 'Projects', value: profile.projects, valueSize: 16, center: true),
                ),
              ],
            ),
            const SizedBox(height: 20),
            if (pinReminderDue) ...[
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: c.soft,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: c.line),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Помните ли вы свой PIN-код восстановления?',
                      style: InOneText.style(14, FontWeight.w700, c.text),
                    ),
                    const SizedBox(height: 7),
                    Text(
                      'Он поможет защитить аккаунт при восстановлении доступа. PIN не является паролем для входа.',
                      style: InOneText.style(12.5, FontWeight.w400, c.muted),
                    ),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        OutlinedButton(
                          onPressed: onPinRemember,
                          child: const Text('Помню'),
                        ),
                        FilledButton(
                          onPressed: onPinReplace,
                          child: const Text('Не помню, заменить'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),
            ],
            for (var i = 0; i < menu.length; i++) _MenuRow(item: menu[i], last: i == menu.length - 1),
          ],
        ),
      ),
    );
  }
}

class _MenuRow extends StatelessWidget {
  const _MenuRow({required this.item, required this.last});
  final InOneProfileMenuItem item;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final Color tileBg;
    final Color tileFg;
    if (item.destructive) {
      tileBg = c.dangerTint;
      tileFg = c.danger;
    } else if (item.accentTile) {
      tileBg = c.soft;
      tileFg = c.link;
    } else {
      tileBg = c.fill;
      tileFg = c.textSoft;
    }
    return InkWell(
      onTap: item.onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: BoxDecoration(border: last ? null : Border(bottom: BorderSide(color: c.rowLine))),
        child: Row(
          children: [
            InOneIconTile(icon: item.icon, background: tileBg, foreground: tileFg, size: 36, radius: 11),
            const SizedBox(width: 13),
            Expanded(
              child: Text(
                item.label,
                style: InOneText.style(13.5, FontWeight.w600, item.destructive ? c.dangerText : c.text),
              ),
            ),
            if (!item.destructive) Icon(InOneIcons.chevronRight, size: 20, color: c.hint),
          ],
        ),
      ),
    );
  }
}
