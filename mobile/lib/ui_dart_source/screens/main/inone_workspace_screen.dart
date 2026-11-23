import 'package:flutter/material.dart';

import '../../models/inone_models.dart';
import '../../theme/inone_theme.dart';
import '../../widgets/inone_bottom_nav.dart';
import '../../widgets/inone_ds_widgets.dart';
import '../../widgets/inone_icons.dart';

/// Screen 03 / D03 · Workspace: сводка, модули, последняя активность.
class InOneWorkspaceScreen extends StatelessWidget {
  const InOneWorkspaceScreen({
    super.key,
    required this.summary,
    required this.modules,
    required this.activity,
    required this.onSwitchWorkspace,
    this.onNotifications,
    this.onCustomize,
    this.onSeeAll,
    required this.onTab,
    this.onAdd,
  });

  final InOneWorkspaceSummary summary;
  final List<InOneModuleTile> modules;
  final List<InOneActivityItem> activity;
  final VoidCallback onSwitchWorkspace;
  final VoidCallback? onNotifications;
  final VoidCallback? onCustomize;
  final VoidCallback? onSeeAll;
  final ValueChanged<InOneTab> onTab;
  final VoidCallback? onAdd;

  @override
  Widget build(BuildContext context) {
    return InOneShell(
      nav: InOneBottomNav(selected: null, onSelected: onTab, onAdd: onAdd),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _header(context),
            const SizedBox(height: 14),
            _hero(context),
            const SizedBox(height: 18),
            _sectionHeader(context, 'Modules', onCustomize == null ? null : 'Customize', onCustomize),
            const SizedBox(height: 11),
            _modulesGrid(context),
            if (activity.isNotEmpty) ...[
              const SizedBox(height: 20),
              _sectionHeader(context, 'Recent activity', onSeeAll == null ? null : 'See all', onSeeAll),
              const SizedBox(height: 10),
              for (var i = 0; i < activity.length; i++) ...[
                if (i > 0) const SizedBox(height: 12),
                _activityRow(context, activity[i]),
              ],
            ],
          ],
        ),
      ),
    );
  }

  Widget _header(BuildContext context) {
    final c = context.inone;
    return Row(
      children: [
        const InOneStripeBox(width: 32, height: 32, radius: 10),
        const SizedBox(width: 10),
        Expanded(
          child: InkWell(
            onTap: onSwitchWorkspace,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'WORKSPACE',
                  style: InOneText.style(10.5, FontWeight.w600, c.muted, letterSpacing: 0.63),
                ),
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        summary.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: InOneText.style(14, FontWeight.w700, c.text),
                      ),
                    ),
                    const SizedBox(width: 5),
                    Icon(InOneIcons.chevronDown, size: 18, color: c.text),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 10),
        if (onNotifications != null)
          Semantics(
            button: true,
            label: 'Notifications',
            child: GestureDetector(
              onTap: onNotifications,
              child: Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: c.line)),
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    Icon(InOneIcons.bell, size: 20, color: c.text),
                    if (summary.hasUnread)
                      Positioned(
                        right: 8,
                        top: 7,
                        child: Container(
                          width: 7,
                          height: 7,
                          decoration: BoxDecoration(
                            color: c.danger,
                            shape: BoxShape.circle,
                            border: Border.all(color: c.bg, width: 1.5),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _hero(BuildContext context) {
    final c = context.inone;
    Widget stat(String value, String label) => Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(value, style: InOneText.style(16, FontWeight.w700, c.heroFg)),
              const SizedBox(height: 2),
              Text(label, style: InOneText.style(10.5, FontWeight.w400, c.heroMuted2)),
            ],
          ),
        );
    Widget divider() => Container(width: 1, height: 26, color: c.heroDivider);
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(color: c.heroBg, borderRadius: BorderRadius.circular(22)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Active projects', style: InOneText.style(11.5, FontWeight.w600, c.heroMuted)),
          const SizedBox(height: 5),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                summary.activeProjects?.toString() ?? '—',
                style: InOneText.style(34, FontWeight.w700, c.heroFg, height: 1, letterSpacing: -0.68),
              ),
              const SizedBox(width: 9),
              if (summary.projectsCaption.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: c.heroPillBg,
                      borderRadius: BorderRadius.circular(InOneRadius.pill),
                    ),
                    child: Text(
                      summary.projectsCaption,
                      style: InOneText.style(11, FontWeight.w700, c.heroPillFg),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              stat(summary.tasksDue?.toString() ?? '—', 'Tasks due'),
              const SizedBox(width: 14),
              divider(),
              const SizedBox(width: 14),
              stat(summary.teamMembers?.toString() ?? '—', 'Team members'),
              const SizedBox(width: 14),
              divider(),
              const SizedBox(width: 14),
              stat(summary.activeGroups?.toString() ?? '—', 'Active groups'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _sectionHeader(BuildContext context, String title, String? action, VoidCallback? onAction) {
    final c = context.inone;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(title, style: InOneText.style(15, FontWeight.w700, c.text)),
        if (action != null && onAction != null)
          GestureDetector(
            onTap: onAction,
            child: Text(action, style: InOneText.style(12, FontWeight.w600, c.link)),
          ),
      ],
    );
  }

  Widget _modulesGrid(BuildContext context) {
    final rows = <Widget>[];
    for (var start = 0; start < modules.length; start += 4) {
      final slice = modules.skip(start).take(4).toList();
      rows.add(
        Padding(
          padding: EdgeInsets.only(top: start == 0 ? 0 : 12),
          child: Row(
            children: [
              for (var i = 0; i < 4; i++) ...[
                if (i > 0) const SizedBox(width: 10),
                Expanded(
                  child: i < slice.length ? _moduleTile(context, slice[i]) : const SizedBox.shrink(),
                ),
              ],
            ],
          ),
        ),
      );
    }
    return Column(children: rows);
  }

  Widget _moduleTile(BuildContext context, InOneModuleTile m) {
    final c = context.inone;
    return Semantics(
      button: true,
      label: m.label,
      child: GestureDetector(
        onTap: m.onTap,
        child: Column(
          children: [
            AspectRatio(
              aspectRatio: 1,
              child: Container(
                decoration: BoxDecoration(color: c.fill, borderRadius: BorderRadius.circular(16)),
                child: Icon(m.icon, size: 26, color: c.link),
              ),
            ),
            const SizedBox(height: 7),
            Text(
              m.label,
              textAlign: TextAlign.center,
              style: InOneText.style(11, FontWeight.w600, c.textMid, height: 1.2),
            ),
          ],
        ),
      ),
    );
  }

  Widget _activityRow(BuildContext context, InOneActivityItem a) {
    final c = context.inone;
    return Row(
      children: [
        InOneIconTile(
          icon: a.icon,
          background: a.highlighted ? c.soft : c.fill,
          foreground: a.highlighted ? c.link : c.textSoft,
          radius: 12,
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(a.title, style: InOneText.style(13.5, FontWeight.w700, c.text)),
              const SizedBox(height: 2),
              Text(a.subtitle, style: InOneText.style(11, FontWeight.w400, c.muted)),
            ],
          ),
        ),
        Text(a.time, style: InOneText.style(11, FontWeight.w400, c.hint)),
      ],
    );
  }
}
