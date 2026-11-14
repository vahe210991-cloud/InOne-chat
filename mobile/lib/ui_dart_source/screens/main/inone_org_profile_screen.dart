import 'package:flutter/material.dart';

import '../../models/inone_models.dart';
import '../../theme/inone_theme.dart';
import '../../widgets/inone_bottom_nav.dart';
import '../../widgets/inone_ds_widgets.dart';
import '../../widgets/inone_icons.dart';

/// Screen 02 / D02 · Organization profile: обложка 4:1, логотип, показатели, описание.
class InOneOrgProfileScreen extends StatelessWidget {
  const InOneOrgProfileScreen({
    super.key,
    required this.profile,
    required this.onBack,
    required this.onMore,
    required this.onEditCover,
    required this.onTab,
    required this.onAdd,
  });

  final InOneOrgProfile profile;
  final VoidCallback onBack;
  final VoidCallback onMore;

  /// «Edit cover» (показывать только пользователям с правом редактирования).
  final VoidCallback? onEditCover;
  final ValueChanged<InOneTab> onTab;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return InOneShell(
      // Экран организации не относится ни к одному из разделов нижней навигации.
      nav: InOneBottomNav(selected: null, onSelected: onTab, onAdd: onAdd),
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  InOneIconAction(icon: InOneIcons.back, semanticLabel: 'Back', onTap: onBack, size: 28),
                  InOneIconAction(icon: InOneIcons.more, semanticLabel: 'More', onTap: onMore),
                ],
              ),
            ),
            const SizedBox(height: 10),
            LayoutBuilder(
              builder: (context, constraints) {
                final coverHeight = constraints.maxWidth / 4;
                return SizedBox(
                  height: coverHeight + 40,
                  child: Stack(
                    clipBehavior: Clip.none,
                    children: [
                      Positioned(
                        top: 0,
                        left: 0,
                        right: 0,
                        height: coverHeight,
                        child: _Cover(profile: profile, onEdit: onEditCover),
                      ),
                      Positioned(
                        top: coverHeight - 48,
                        left: 20,
                        right: 20,
                        child: _Identity(profile: profile),
                      ),
                    ],
                  ),
                );
              },
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
              child: Row(
                children: [
                  _Stat(value: profile.members?.toString() ?? '—', label: 'Members'),
                  _Stat(value: profile.projects?.toString() ?? '—', label: 'Projects'),
                  _Stat(value: profile.teams?.toString() ?? '—', label: 'Teams'),
                ],
              ),
            ),
            Container(
              margin: const EdgeInsets.fromLTRB(20, 14, 20, 20),
              padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 14),
              decoration: BoxDecoration(color: c.fill, borderRadius: BorderRadius.circular(14)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('About organization', style: InOneText.style(13, FontWeight.w700, c.text)),
                  const SizedBox(height: 6),
                  Text(profile.about?.isNotEmpty == true ? profile.about! : '—', style: InOneText.style(11.5, FontWeight.w400, c.sub, height: 1.5)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Cover extends StatelessWidget {
  const _Cover({required this.profile, required this.onEdit});
  final InOneOrgProfile profile;
  final VoidCallback? onEdit;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Stack(
      fit: StackFit.expand,
      children: [
        if (profile.cover != null)
          Image(image: profile.cover!, fit: BoxFit.cover)
        else
          const InOneStripeBox(stripe: 6),
        if (profile.cover == null)
          Positioned(
            left: 14,
            top: 12,
            child: Text(
              'cover · 4:1 · upload 2400×600, crops to fit',
              style: InOneText.style(10, FontWeight.w400, c.muted),
            ),
          ),
        const Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          height: 56,
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Color(0x00171A14), Color(0x47171A14)],
              ),
            ),
          ),
        ),
        if (onEdit != null)
          Positioned(
            right: 14,
            bottom: 12,
            child: Semantics(
              button: true,
              label: 'Edit cover',
              child: GestureDetector(
                onTap: onEdit,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                  decoration: BoxDecoration(
                    color: c.coverPill,
                    borderRadius: BorderRadius.circular(InOneRadius.pill),
                    boxShadow: const [
                      BoxShadow(color: Color(0x29171A14), blurRadius: 8, offset: Offset(0, 2)),
                    ],
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(InOneIcons.edit, size: 14, color: c.text),
                      const SizedBox(width: 6),
                      Text('Edit cover', style: InOneText.style(11.5, FontWeight.w700, c.text)),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _Identity extends StatelessWidget {
  const _Identity({required this.profile});
  final InOneOrgProfile profile;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Container(
          width: 88,
          height: 88,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: c.bg, width: 4),
            boxShadow: [BoxShadow(color: c.avatarShadow, blurRadius: 14, offset: const Offset(0, 4))],
          ),
          child: ClipOval(
            child: profile.logo != null
                ? Image(image: profile.logo!, fit: BoxFit.cover)
                : const InOneStripeBox(),
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        profile.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: InOneText.style(17, FontWeight.w700, c.text),
                      ),
                    ),
                    if (profile.verified) ...[
                      const SizedBox(width: 6),
                      Icon(InOneIcons.verified, size: 16, color: c.brand),
                    ],
                  ],
                ),
                const SizedBox(height: 3),
                Text(profile.subtitle, style: InOneText.style(12, FontWeight.w600, c.brand)),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.value, required this.label});
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Expanded(
      child: Column(
        children: [
          Text(value, style: InOneText.style(16, FontWeight.w800, c.text)),
          const SizedBox(height: 2),
          Text(label, style: InOneText.style(11, FontWeight.w400, c.muted)),
        ],
      ),
    );
  }
}
