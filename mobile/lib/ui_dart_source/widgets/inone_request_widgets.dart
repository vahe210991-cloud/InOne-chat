import 'package:flutter/material.dart';

import '../models/inone_models.dart';
import 'inone_widgets.dart';

/// Подписи и виджеты, общие для экранов заявок организаций (RQ-xx, PS-xx).
abstract final class InOneRequestLabels {
  static const pending = 'Քննարկվում է';
  static const approved = 'Հաստատված';
  static const rejected = 'Մերժված';
  static const all = 'Բոլորը';

  static String of(InOneRequestStatus status) {
    switch (status) {
      case InOneRequestStatus.pending:
        return pending;
      case InOneRequestStatus.approved:
        return approved;
      case InOneRequestStatus.rejected:
        return rejected;
    }
  }

  static InOneStatusKind kindOf(InOneRequestStatus status) {
    switch (status) {
      case InOneRequestStatus.pending:
        return InOneStatusKind.pending;
      case InOneRequestStatus.approved:
        return InOneStatusKind.approved;
      case InOneRequestStatus.rejected:
        return InOneStatusKind.rejected;
    }
  }
}

class InOneRequestStatusPill extends StatelessWidget {
  const InOneRequestStatusPill(this.status, {super.key});
  final InOneRequestStatus status;

  @override
  Widget build(BuildContext context) =>
      InOneStatusPill(label: InOneRequestLabels.of(status), kind: InOneRequestLabels.kindOf(status));
}

/// Карточка заявки: название, статус, дата.
class InOneRequestSummaryCard extends StatelessWidget {
  const InOneRequestSummaryCard({super.key, required this.request});
  final InOneOrgRequest request;

  @override
  Widget build(BuildContext context) {
    return InOneKeyValueCard(
      rows: [
        InOneKvRow('Անվանում', text: request.name),
        InOneKvRow('Կարգավիճակ', widget: InOneRequestStatusPill(request.status)),
        InOneKvRow('Ամսաթիվ', text: request.date),
      ],
    );
  }
}

/// Строка документа с кнопкой «Ներբեռնել».
class InOneDocumentRow extends StatelessWidget {
  const InOneDocumentRow({
    super.key,
    required this.document,
    this.onOpen,
    this.onDownload,
    this.busy = false,
  }) : assert((onOpen == null) != (onDownload == null));

  final InOneDocument document;

  /// Native preview/open action for protected documents.
  final VoidCallback? onOpen;

  /// Legacy download action used by applicant-side request screens.
  final VoidCallback? onDownload;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return InOneListItem(
      title: document.name,
      subtitle: document.typeLabel,
      trailing: InOneButton(
        label: onOpen != null ? 'Բացել' : 'Ներբեռնել',
        kind: InOneButtonKind.outline,
        small: true,
        loading: busy,
        onPressed: onOpen ?? onDownload,
      ),
    );
  }
}
