import 'package:flutter/material.dart';

import '../../models/inone_models.dart';
import '../../state/inone_state.dart';
import '../../widgets/inone_widgets.dart';

/// ST-02 · Համակարգի վիճակ: версия, режим обслуживания, публичные флаги.
class InOneSystemStatusScreen extends StatelessWidget {
  const InOneSystemStatusScreen({super.key, required this.status, required this.onMenu});

  final InOneSystemStatus status;
  final VoidCallback onMenu;

  static const _on = 'միացված է';
  static const _off = 'անջատված է';

  @override
  Widget build(BuildContext context) {
    final scope = InOneStatusScope.maybeOf(context);
    return InOneScreen.bar(
      title: 'Համակարգի վիճակ',
      onMenu: onMenu,
      banner: scope == null ? null : InOneMessages.forState(scope.state, message: scope.message),
      top: [
        InOneKeyValueCard(
          rows: [
            InOneKvRow('Տարբերակ', text: status.version),
            InOneKvRow('Սպասարկման ռեժիմ', text: status.maintenance ? 'Միացված է' : 'Անջատված է'),
          ],
        ),
        const InOneSectionLabel('Հանրային դրոշակներ'),
        InOneKeyValueCard(
          rows: [
            for (final e in status.flags.entries) InOneKvRow(e.key, text: e.value ? _on : _off),
          ],
        ),
      ],
    );
  }
}
