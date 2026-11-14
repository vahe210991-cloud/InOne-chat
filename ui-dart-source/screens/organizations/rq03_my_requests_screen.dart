import 'package:flutter/material.dart';

import '../../models/inone_models.dart';
import '../../state/inone_state.dart';
import '../../widgets/inone_request_widgets.dart';
import '../../widgets/inone_widgets.dart';

/// RQ-03 · Իմ հայտերը: список моих заявок.
class InOneMyRequestsScreen extends StatelessWidget {
  const InOneMyRequestsScreen({
    super.key,
    required this.requests,
    required this.onOpen,
    required this.onNew,
    required this.onMenu,
  });

  final List<InOneOrgRequest> requests;
  final ValueChanged<InOneOrgRequest> onOpen;

  /// «Նոր հայտ» → RQ-01.
  final VoidCallback onNew;
  final VoidCallback onMenu;

  @override
  Widget build(BuildContext context) {
    final blocked = (InOneStatusScope.maybeOf(context)?.state ?? InOneScreenState.idle).blocksActions;
    return InOneScreen.bar(
      title: 'Իմ հայտերը',
      onMenu: onMenu,
      banner: InOneMessages.forState(
        InOneStatusScope.maybeOf(context)?.state ?? InOneScreenState.idle,
        message: InOneStatusScope.maybeOf(context)?.message,
      ),
      top: [
        if (requests.isEmpty)
          const InOneNote('Հայտեր դեռ չկան')
        else
          for (final r in requests)
            InOneListItem(
              title: r.name,
              subtitle: r.date,
              trailing: InOneRequestStatusPill(r.status),
              chevron: true,
              onTap: () => onOpen(r),
            ),
      ],
      dock: [
        InOneButton(label: 'Նոր հայտ', onPressed: blocked ? null : onNew),
      ],
    );
  }
}
