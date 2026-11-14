import 'package:flutter/material.dart';

import '../../models/inone_models.dart';
import '../../widgets/inone_request_widgets.dart';
import '../../widgets/inone_widgets.dart';
import '../../state/inone_state.dart';

/// PS-01 · Հայտեր (админ): все заявки с фильтром по статусу.
class InOneRequestsAdminScreen extends StatefulWidget {
  const InOneRequestsAdminScreen({
    super.key,
    required this.requests,
    required this.onOpen,
    required this.onMenu,
  });

  final List<InOneOrgRequest> requests;
  final ValueChanged<InOneOrgRequest> onOpen;
  final VoidCallback onMenu;

  @override
  State<InOneRequestsAdminScreen> createState() => _InOneRequestsAdminScreenState();
}

class _InOneRequestsAdminScreenState extends State<InOneRequestsAdminScreen> {
  /// `null` — «Բոլորը».
  InOneRequestStatus? _filter;

  @override
  Widget build(BuildContext context) {
    final scope = InOneStatusScope.maybeOf(context);
    final visible = widget.requests.where((r) => _filter == null || r.status == _filter).toList();
    return InOneScreen.bar(
      title: 'Հայտեր',
      onMenu: widget.onMenu,
      banner: scope == null ? null : InOneMessages.forState(scope.state, message: scope.message),
      top: [
        for (final r in visible)
          InOneListItem(
            title: r.name,
            subtitle: r.date,
            trailing: InOneRequestStatusPill(r.status),
            chevron: true,
            onTap: () => widget.onOpen(r),
          ),
      ],
      dock: [
        InOneChips<InOneRequestStatus?>(
          wrap: true,
          bottom: 0,
          selected: _filter,
          onChanged: (v) => setState(() => _filter = v),
          options: const [
            InOneChipOption<InOneRequestStatus?>(null, InOneRequestLabels.all),
            InOneChipOption<InOneRequestStatus?>(InOneRequestStatus.pending, InOneRequestLabels.pending),
            InOneChipOption<InOneRequestStatus?>(InOneRequestStatus.approved, InOneRequestLabels.approved),
            InOneChipOption<InOneRequestStatus?>(InOneRequestStatus.rejected, InOneRequestLabels.rejected),
          ],
        ),
      ],
    );
  }
}
