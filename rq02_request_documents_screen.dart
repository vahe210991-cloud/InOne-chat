import 'package:flutter/material.dart';

import '../../models/inone_models.dart';
import '../../state/inone_state.dart';
import '../../widgets/inone_request_widgets.dart';
import '../../widgets/inone_widgets.dart';

/// RQ-02 · Հայտի փաստաթղթեր: загруженные документы и загрузка нового (до 5 МБ).
class InOneRequestDocumentsScreen extends StatefulWidget {
  const InOneRequestDocumentsScreen({
    super.key,
    required this.documents,
    required this.onDownload,
    required this.onPickFile,
    required this.onUpload,
    required this.onBack,
    required this.onMenu,
  });

  final List<InOneDocument> documents;

  /// GET /org-requests/:id/documents/:docId. `null` — успех.
  final Future<InOneFailure?> Function(InOneDocument document) onDownload;

  /// Системный выбор файла. Возвращает имя выбранного файла или `null`, если выбор отменён.
  /// Сам файл хранит вызывающий код (экран не держит содержимое в памяти).
  final Future<String?> Function() onPickFile;

  /// POST /org-requests/:id/documents. `null` — успех.
  final Future<InOneFailure?> Function(InOneDocType type) onUpload;
  final VoidCallback onBack;
  final VoidCallback onMenu;

  @override
  State<InOneRequestDocumentsScreen> createState() => _InOneRequestDocumentsScreenState();
}

class _InOneRequestDocumentsScreenState extends State<InOneRequestDocumentsScreen>
    with InOneActionState<InOneRequestDocumentsScreen> {
  InOneDocType _type = InOneDocType.registration;
  String? _fileName;

  Future<void> _pick() async {
    final name = await widget.onPickFile();
    if (!mounted || name == null) return;
    setState(() => _fileName = name);
  }

  /// Если файл ещё не выбран, кнопка «Վերբեռնել» сначала открывает выбор файла.
  void _upload() {
    if (_fileName == null) {
      _pick();
      return;
    }
    run('upload', () => widget.onUpload(_type), onSuccess: () => setState(() => _fileName = null));
  }

  @override
  Widget build(BuildContext context) {
    return InOneScreen.bar(
      title: 'Հայտի փաստաթղթեր',
      onBack: widget.onBack,
      onMenu: widget.onMenu,
      banner: bannerText,
      top: [
        const InOneSectionLabel('Վերբեռնված փաստաթղթեր'),
        for (final d in widget.documents)
          InOneDocumentRow(
            document: d,
            busy: isBusy(d.id),
            onDownload: blocked ? null : () => run(d.id, () => widget.onDownload(d)),
          ),
      ],
      dock: [
        const InOneLabel('Փաստաթղթի տեսակը'),
        InOneChips<InOneDocType>(
          wrap: true,
          bottom: 14,
          selected: _type,
          onChanged: (v) => setState(() => _type = v),
          options: const [
            InOneChipOption(InOneDocType.registration, 'Գրանցում'),
            InOneChipOption(InOneDocType.authority, 'Լիազորություններ'),
            InOneChipOption(InOneDocType.other, 'Այլ'),
          ],
        ),
        InOnePickRow(
          title: _fileName ?? 'Ֆայլն ընտրված չէ',
          hint: 'մինչև 5 ՄԲ',
          buttonLabel: 'Ընտրել ֆայլ',
          onPick: blocked ? null : _pick,
        ),
        InOneButton(
          label: 'Վերբեռնել',
          loading: isBusy('upload'),
          onPressed: blocked ? null : _upload,
        ),
      ],
    );
  }
}
