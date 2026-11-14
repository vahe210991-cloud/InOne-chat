import 'package:flutter/material.dart';

import '../../models/inone_models.dart';
import '../../theme/inone_theme.dart';
import '../../widgets/inone_ds_widgets.dart';
import '../../widgets/inone_icons.dart';
import '../../widgets/inone_widgets.dart';
import 'inone_leads_screen.dart' show inOneToneColors;

/// Screen 42 / D40 · Deal detail: сделка, контакт, этап воронки, активность.
class InOneDealDetailScreen extends StatelessWidget {
  const InOneDealDetailScreen({
    super.key,
    required this.deal,
    required this.onBack,
    required this.onMore,
    required this.onCall,
    required this.onMail,
    required this.onAddNote,
    required this.onMoveStage,
  });

  final InOneDealDetail deal;
  final VoidCallback onBack;
  final VoidCallback onMore;
  final VoidCallback onCall;
  final VoidCallback onMail;
  final VoidCallback onAddNote;
  final VoidCallback onMoveStage;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    Widget heading(String text) => Padding(
          padding: const EdgeInsets.only(top: 20, bottom: 12),
          child: Text(text, style: InOneText.style(14, FontWeight.w700, c.text)),
        );
    return InOneShell(
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      InOneIconAction(icon: InOneIcons.back, semanticLabel: 'Back', onTap: onBack, size: 28),
                      InOneIconAction(icon: InOneIcons.more, semanticLabel: 'More', onTap: onMore),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                      decoration: BoxDecoration(color: c.warnTint, borderRadius: BorderRadius.circular(7)),
                      child: Text(deal.statusLabel, style: InOneText.style(10.5, FontWeight.w700, c.warn)),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(deal.title, style: InOneText.style(22, FontWeight.w700, c.text)),
                  const SizedBox(height: 8),
                  Text(deal.amount, style: InOneText.style(28, FontWeight.w700, c.text)),
                  const SizedBox(height: 18),
                  Row(
                    children: [
                      Expanded(child: InOneStatTile(label: 'Probability', value: deal.probability, valueSize: 15)),
                      const SizedBox(width: 10),
                      Expanded(child: InOneStatTile(label: 'Close date', value: deal.closeDate, valueSize: 15)),
                      const SizedBox(width: 10),
                      Expanded(child: InOneStatTile(label: 'Age', value: deal.age, valueSize: 15)),
                    ],
                  ),
                  heading('Contact'),
                  _contact(context),
                  heading('Stage'),
                  _stages(context),
                  heading('Activity'),
                  for (var i = 0; i < deal.activities.length; i++) ...[
                    if (i > 0) const SizedBox(height: 12),
                    _activity(context, deal.activities[i]),
                  ],
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
            child: Row(
              children: [
                Expanded(
                  child: InOneButton(label: 'Add note', kind: InOneButtonKind.outline, onPressed: onAddNote),
                ),
                const SizedBox(width: 12),
                Expanded(child: InOneButton(label: 'Move stage', onPressed: onMoveStage)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _contact(BuildContext context) {
    final c = context.inone;
    Widget action(IconData icon, String label, VoidCallback onTap) => Semantics(
          button: true,
          label: label,
          child: GestureDetector(
            onTap: onTap,
            child: Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(color: c.soft, shape: BoxShape.circle),
              child: Icon(icon, size: 18, color: c.link),
            ),
          ),
        );
    final (bg, fg) = inOneToneColors(c, InOneTone.blue);
    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        border: Border.all(color: c.border),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          InOneAvatar(initials: deal.contactInitials, background: bg, foreground: fg, size: 42, fontSize: 14),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(deal.contactName, style: InOneText.style(13.5, FontWeight.w700, c.text)),
                const SizedBox(height: 2),
                Text(deal.contactInfo, style: InOneText.style(11.5, FontWeight.w400, c.muted)),
              ],
            ),
          ),
          action(InOneIcons.call, 'Call', onCall),
          const SizedBox(width: 8),
          action(InOneIcons.mail, 'Email', onMail),
        ],
      ),
    );
  }

  Widget _stages(BuildContext context) {
    final c = context.inone;
    return Column(
      children: [
        Row(
          children: [
            for (var i = 0; i < deal.stages.length; i++) ...[
              if (i > 0) const SizedBox(width: 6),
              Expanded(
                child: Container(
                  height: 5,
                  decoration: BoxDecoration(
                    color: i < deal.stageIndex
                        ? c.brand
                        : (i == deal.stageIndex ? c.accent : c.border),
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            for (final s in deal.stages) Text(s, style: InOneText.style(10, FontWeight.w400, c.muted)),
          ],
        ),
      ],
    );
  }

  Widget _activity(BuildContext context, InOneDealActivity a) {
    final c = context.inone;
    final (bg, fg) = inOneToneColors(c, a.tone);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InOneIconTile(icon: a.icon, background: bg, foreground: fg, size: 32, radius: 10, iconSize: 18),
        const SizedBox(width: 11),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(a.title, style: InOneText.style(12.5, FontWeight.w700, c.text)),
              const SizedBox(height: 2),
              Text(a.time, style: InOneText.style(11, FontWeight.w400, c.muted)),
            ],
          ),
        ),
      ],
    );
  }
}
