import 'package:flutter/material.dart';

import '../../theme/inone_theme.dart';
import '../../widgets/inone_ds_widgets.dart';
import '../../widgets/inone_icons.dart';

/// Screen 52 / D50 · Loading & error: скелетоны, индикатор загрузки,
/// ошибки и состояние «нет соединения». Блоки доступны как отдельные
/// виджеты ([InOneSkeletonBox], [InOneInlineAlert], [InOneEmptyState]).
class InOneLoadingErrorScreen extends StatelessWidget {
  const InOneLoadingErrorScreen({super.key, required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    Widget skeletonCard(double a, double b, double d) => Expanded(
          child: Container(
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              border: Border.all(color: c.border),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const InOneSkeletonBox(height: 104, radius: 0),
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 11, 12, 13),
                  child: LayoutBuilder(
                    builder: (context, box) => Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        InOneSkeletonBox(width: box.maxWidth * a),
                        const SizedBox(height: 7),
                        InOneSkeletonBox(width: box.maxWidth * b),
                        const SizedBox(height: 7),
                        InOneSkeletonBox(width: box.maxWidth * d, height: 13, strong: true),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
    Widget skeletonRow(double a, double b) => Row(
          children: [
            const InOneSkeletonBox(width: 52, height: 52, radius: 12),
            const SizedBox(width: 12),
            Expanded(
              child: LayoutBuilder(
                builder: (context, box) => Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    InOneSkeletonBox(width: box.maxWidth * a),
                    const SizedBox(height: 7),
                    InOneSkeletonBox(width: box.maxWidth * b),
                  ],
                ),
              ),
            ),
          ],
        );
    return InOneShell(
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 6, 20, 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const InOneCaps('SKELETON LOADING'),
            const SizedBox(height: 14),
            Row(children: [skeletonCard(0.8, 0.5, 0.4), const SizedBox(width: 12), skeletonCard(0.7, 0.45, 0.38)]),
            const SizedBox(height: 14),
            skeletonRow(0.6, 0.38),
            const SizedBox(height: 12),
            skeletonRow(0.72, 0.3),
            const SizedBox(height: 22),
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(color: c.tint, borderRadius: BorderRadius.circular(16)),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SizedBox(
                    width: 26,
                    height: 26,
                    child: CircularProgressIndicator(
                      strokeWidth: 3,
                      color: c.brand,
                      backgroundColor: c.spinnerTrack,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Text('Loading your workspace…', style: InOneText.style(13, FontWeight.w600, c.textSoft)),
                ],
              ),
            ),
            const SizedBox(height: 26),
            const InOneCaps('ERRORS'),
            const SizedBox(height: 14),
            const InOneInlineAlert(
              kind: InOneAlertKind.error,
              title: 'Message not sent',
              text: 'The message could not be delivered. Check your connection and retry.',
            ),
            const SizedBox(height: 12),
            const InOneInlineAlert(
              kind: InOneAlertKind.warning,
              title: 'Sync pending',
              text: 'Your workspace is syncing. This may take a moment.',
            ),
            const SizedBox(height: 22),
            InOneEmptyState(
              icon: InOneIcons.wifiOff,
              title: 'Connection lost',
              text: 'Check your network and try again.',
              circleSize: 68,
              titleSize: 15,
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
              actions: [InOneSmallAction(label: 'Retry', onTap: onRetry)],
            ),
          ],
        ),
      ),
    );
  }
}
