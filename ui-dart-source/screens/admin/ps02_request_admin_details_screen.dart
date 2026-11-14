import 'package:flutter/material.dart';

import '../../models/inone_models.dart';
import '../../state/inone_state.dart';
import '../../widgets/inone_request_widgets.dart';
import '../../widgets/inone_widgets.dart';

/// PS-02 · Հայտ (админ): карточка заявки, документы; владелец может перейти к решению.
class InOneRequestAdminDetailsScreen extends StatefulWidget {
  const InOneRequestAdminDetailsScreen({
    super.key,
    required this.request,
    required this.documents,
    required this.isOwner,
    required this.onDownload,
    required this.onDecide,
    required this.onBack,
    required this.onMenu,
  });

  final InOneOrgRequest request;
  final List<InOneDocument> documents;

  /// Только владелец видит «Անցնել որոշմանը».
  final bool isOwner;

  /// GET /org-requests/:id/documents/:docId. `null` — успех.
  final Future<InOneFailure?> Function(InOneDocument document) onDownload;

  /// «Անցնել որոշմանը» → PS-03.
  final VoidCallback onDecide;
  final VoidCallback onBack;
  final VoidCallback onMenu;

  @override
  State<InOneRequestAdminDetailsScreen> createState() => _InOneRequestAdminDetailsScreenState();
}

class _InOneRequestAdminDetailsScreenState extends State<InOneRequestAdminDetailsScreen>
    with InOneActionState<InOneRequestAdminDetailsScreen> {
  @override
  Widget build(BuildContext context) {
    return InOneScreen.bar(
      title: 'Հայտ',
      onBack: widget.onBack,
      onMenu: widget.onMenu,
      banner: bannerText,
      top: [
        InOneRequestSummaryCard(request: widget.request),
        const InOneSectionLabel('Փաստաթղթեր'),
        for (final d in widget.documents)
          InOneDocumentRow(
            document: d,
            busy: isBusy(d.id),
            onDownload: blocked ? null : () => run(d.id, () => widget.onDownload(d)),
          ),
      ],
      dock: [
        if (widget.isOwner)
          InOneButton(label: 'Անցնել որոշմանը', onPressed: blocked ? null : widget.onDecide),
      ],
    );
  }
}
