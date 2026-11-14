import 'package:flutter/material.dart';

import '../../models/inone_models.dart';
import '../../state/inone_state.dart';
import '../../widgets/inone_request_widgets.dart';
import '../../widgets/inone_widgets.dart';

/// RQ-04 · Հայտ: карточка заявки и её документы.
class InOneRequestDetailsScreen extends StatefulWidget {
  const InOneRequestDetailsScreen({
    super.key,
    required this.request,
    required this.documents,
    required this.onDownload,
    required this.onBack,
    required this.onMenu,
  });

  final InOneOrgRequest request;
  final List<InOneDocument> documents;

  /// GET /org-requests/:id/documents/:docId. `null` — успех.
  final Future<InOneFailure?> Function(InOneDocument document) onDownload;
  final VoidCallback onBack;
  final VoidCallback onMenu;

  @override
  State<InOneRequestDetailsScreen> createState() => _InOneRequestDetailsScreenState();
}

class _InOneRequestDetailsScreenState extends State<InOneRequestDetailsScreen>
    with InOneActionState<InOneRequestDetailsScreen> {
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
    );
  }
}
