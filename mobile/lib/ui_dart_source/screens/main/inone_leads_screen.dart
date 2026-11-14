import 'package:flutter/material.dart';

import '../../models/inone_models.dart';
import '../../theme/inone_colors.dart';
import '../../theme/inone_theme.dart';
import '../../widgets/inone_ds_widgets.dart';
import '../../widgets/inone_icons.dart';
import '../../widgets/inone_widgets.dart';

/// Tone → (фон, текст) для аватаров и бейджей.
(Color, Color) inOneToneColors(InOneColors c, InOneTone tone) {
  switch (tone) {
    case InOneTone.blue:
      return (c.blueTint, c.blue);
    case InOneTone.green:
      return (c.soft, c.link);
    case InOneTone.purple:
      return (c.purpleTint, c.purple);
    case InOneTone.neutral:
      return (c.fill, c.sub);
  }
}

/// Screen 40 / D38 · Leads: показатели, фильтры, список лидов, «Add lead».
class InOneLeadsScreen extends StatefulWidget {
  const InOneLeadsScreen({
    super.key,
    required this.stats,
    required this.leads,
    required this.onOpenLead,
    required this.onAddLead,
    required this.onBack,
    this.onFilter,
  });

  final InOneLeadStats stats;
  final List<InOneLead> leads;
  final ValueChanged<InOneLead> onOpenLead;
  final VoidCallback onAddLead;
  final VoidCallback onBack;
  final VoidCallback? onFilter;

  @override
  State<InOneLeadsScreen> createState() => _InOneLeadsScreenState();
}

class _InOneLeadsScreenState extends State<InOneLeadsScreen> {
  static const _filters = <InOneLeadStatus?>[
    null,
    InOneLeadStatus.fresh,
    InOneLeadStatus.contacted,
    InOneLeadStatus.won,
  ];
  int _filter = 0;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final status = _filters[_filter];
    final leads = widget.leads.where((l) => status == null || l.status == status).toList();
    return InOneShell(
      body: Padding(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                InOneIconAction(icon: InOneIcons.back, semanticLabel: 'Back', onTap: widget.onBack, size: 28),
                const SizedBox(width: 4),
                Expanded(child: Text('Leads', style: InOneText.style(16, FontWeight.w700, c.text))),
                InOneIconAction(icon: InOneIcons.filter, semanticLabel: 'Filter', onTap: widget.onFilter),
              ],
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(child: InOneStatTile(label: 'New', value: '${widget.stats.newCount}')),
                const SizedBox(width: 10),
                Expanded(child: InOneStatTile(label: 'Qualified', value: '${widget.stats.qualifiedCount}')),
                const SizedBox(width: 10),
                Expanded(
                  child: InOneStatTile(
                    label: 'Won this mo.',
                    value: '${widget.stats.wonThisMonth}',
                    valueColor: c.link,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            InOneFilterChips(
              labels: const ['All', 'New', 'Contacted', 'Won'],
              selectedIndex: _filter,
              onChanged: (i) => setState(() => _filter = i),
            ),
            const SizedBox(height: 16),
            Expanded(
              child: ListView.separated(
                itemCount: leads.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (context, i) => _LeadCard(lead: leads[i], onTap: () => widget.onOpenLead(leads[i])),
              ),
            ),
            const SizedBox(height: 12),
            InOneButton(
              label: 'Add lead',
              leading: Icon(InOneIcons.plus, size: 22, color: c.onAccent),
              onPressed: widget.onAddLead,
            ),
          ],
        ),
      ),
    );
  }
}

class _LeadCard extends StatelessWidget {
  const _LeadCard({required this.lead, required this.onTap});
  final InOneLead lead;
  final VoidCallback onTap;

  (Color, Color) _badge(InOneColors c) {
    switch (lead.status) {
      case InOneLeadStatus.fresh:
      case InOneLeadStatus.won:
        return (c.soft, c.link);
      case InOneLeadStatus.contacted:
        return (c.warnTint, c.warn);
      case InOneLeadStatus.qualified:
        return (c.blueTint, c.blue);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final (avatarBg, avatarFg) = inOneToneColors(c, lead.tone);
    final (badgeBg, badgeFg) = _badge(c);
    return Material(
      color: c.bg,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: c.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(13),
          child: Row(
            children: [
              InOneAvatar(initials: lead.initials, background: avatarBg, foreground: avatarFg, size: 42, fontSize: 14),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(lead.name, style: InOneText.style(13.5, FontWeight.w700, c.text)),
                    const SizedBox(height: 2),
                    Text(lead.source, style: InOneText.style(11.5, FontWeight.w400, c.muted)),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(color: badgeBg, borderRadius: BorderRadius.circular(7)),
                    child: Text(lead.statusLabel, style: InOneText.style(10, FontWeight.w700, badgeFg)),
                  ),
                  const SizedBox(height: 4),
                  Text(lead.timeAgo, style: InOneText.style(11, FontWeight.w400, c.muted)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
