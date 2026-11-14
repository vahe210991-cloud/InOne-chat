import 'package:flutter/material.dart';

import '../../models/inone_models.dart';
import '../../theme/inone_theme.dart';
import '../../widgets/inone_ds_widgets.dart';
import '../../widgets/inone_icons.dart';
import 'inone_leads_screen.dart' show inOneToneColors;

/// Screen 41 / D39 · Deals board: канбан воронки проектов.
class InOneDealsBoardScreen extends StatelessWidget {
  const InOneDealsBoardScreen({
    super.key,
    required this.pipelineLabel,
    required this.countLabel,
    required this.columns,
    required this.onOpenDeal,
    required this.onBack,
    this.onSearch,
    this.onFilter,
  });

  /// Название воронки («Project pipeline») и подпись количества («14 projects»).
  final String pipelineLabel;
  final String countLabel;
  final List<InOneKanbanColumn> columns;
  final ValueChanged<InOneDealCard> onOpenDeal;
  final VoidCallback onBack;
  final VoidCallback? onSearch;
  final VoidCallback? onFilter;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return InOneShell(
      body: Padding(
        padding: const EdgeInsets.only(top: 4, bottom: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Row(
                children: [
                  InOneIconAction(icon: InOneIcons.back, semanticLabel: 'Back', onTap: onBack, size: 28),
                  const SizedBox(width: 4),
                  Expanded(child: Text('Deals board', style: InOneText.style(16, FontWeight.w700, c.text))),
                  InOneIconAction(icon: InOneIcons.search, semanticLabel: 'Search', onTap: onSearch),
                  InOneIconAction(icon: InOneIcons.filter, semanticLabel: 'Filter', onTap: onFilter),
                ],
              ),
            ),
            const SizedBox(height: 14),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: InOneFilterChips(
                labels: [pipelineLabel, countLabel],
                selectedIndex: 0,
                onChanged: null,
                horizontalPadding: 14,
                fontSize: 12,
              ),
            ),
            const SizedBox(height: 16),
            Expanded(
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (var i = 0; i < columns.length; i++) ...[
                      if (i > 0) const SizedBox(width: 12),
                      SizedBox(width: 196, child: _Column(column: columns[i], onOpenDeal: onOpenDeal)),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Column extends StatelessWidget {
  const _Column({required this.column, required this.onOpenDeal});
  final InOneKanbanColumn column;
  final ValueChanged<InOneDealCard> onOpenDeal;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Container(width: 8, height: 8, decoration: BoxDecoration(color: column.color, shape: BoxShape.circle)),
            const SizedBox(width: 7),
            Expanded(child: Text(column.title, style: InOneText.style(12.5, FontWeight.w700, c.text))),
            Text('${column.cards.length}', style: InOneText.style(11, FontWeight.w700, c.muted)),
          ],
        ),
        const SizedBox(height: 10),
        Expanded(
          child: ListView.separated(
            itemCount: column.cards.length,
            separatorBuilder: (_, __) => const SizedBox(height: 10),
            itemBuilder: (context, i) {
              final card = column.cards[i];
              final (ownerBg, ownerFg) = inOneToneColors(c, card.ownerTone);
              return Material(
                color: c.fill,
                borderRadius: BorderRadius.circular(14),
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  onTap: () => onOpenDeal(card),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(card.title, style: InOneText.style(12.5, FontWeight.w700, c.text, height: 1.35)),
                        const SizedBox(height: 8),
                        Text(card.company, style: InOneText.style(11, FontWeight.w400, c.muted)),
                        const SizedBox(height: 8),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(card.amount, style: InOneText.style(13, FontWeight.w800, c.text)),
                            InOneAvatar(
                              initials: card.ownerInitials,
                              background: ownerBg,
                              foreground: ownerFg,
                              size: 22,
                              fontSize: 9,
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}
