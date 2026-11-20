import 'dart:async';

import 'package:flutter/material.dart';

import '../../models/inone_models.dart';
import '../../theme/inone_theme.dart';
import '../../widgets/inone_ds_widgets.dart';
import '../../widgets/inone_icons.dart';

/// Screen 46 / D44 · Chat thread: переписка, баннер проекта, поле ввода.
class InOneChatThreadScreen extends StatefulWidget {
  const InOneChatThreadScreen({
    super.key,
    required this.header,
    required this.items,
    required this.onSend,
    required this.onBack,
    this.onCall,
    this.onMore,
    this.onAttach,
    this.onDownloadAttachment,
    this.onViewProject,
  });

  final InOneThreadHeader header;
  final List<InOneThreadItem> items;

  /// Отправка текста. Пустые сообщения не отправляются.
  final Future<bool> Function(String) onSend;
  final VoidCallback onBack;
  final VoidCallback? onCall;
  final VoidCallback? onMore;
  final VoidCallback? onAttach;
  final ValueChanged<String>? onDownloadAttachment;
  final VoidCallback? onViewProject;

  @override
  State<InOneChatThreadScreen> createState() => _InOneChatThreadScreenState();
}

class _InOneChatThreadScreenState extends State<InOneChatThreadScreen> {
  final TextEditingController _input = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final accepted = await widget.onSend(text);
      if (accepted && mounted) _input.clear();
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final h = widget.header;
    return InOneShell(
      body: Padding(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              padding: const EdgeInsets.only(bottom: 6),
              decoration: BoxDecoration(border: Border(bottom: BorderSide(color: c.border))),
              child: Row(
                children: [
                  InOneIconAction(icon: InOneIcons.back, semanticLabel: 'Back', onTap: widget.onBack, size: 28),
                  const SizedBox(width: 4),
                  const InOneStripeBox(width: 38, height: 38, circle: true),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(h.name, style: InOneText.style(14.5, FontWeight.w700, c.text)),
                        const SizedBox(height: 2),
                        Text(
                          h.statusLabel,
                          style: InOneText.style(11.5, FontWeight.w600, h.online ? c.brand : c.muted),
                        ),
                      ],
                    ),
                  ),
                  InOneIconAction(icon: InOneIcons.call, semanticLabel: 'Call', onTap: widget.onCall),
                  InOneIconAction(icon: InOneIcons.more, semanticLabel: 'More', onTap: widget.onMore),
                ],
              ),
            ),
            if (h.projectTitle != null) ...[
              const SizedBox(height: 14),
              _projectBanner(context),
            ],
            const SizedBox(height: 16),
            Expanded(
              child: ListView.separated(
                itemCount: widget.items.length,
                separatorBuilder: (_, __) => const SizedBox(height: 12),
                itemBuilder: (context, i) => _ThreadItem(
                  item: widget.items[i],
                  onDownloadAttachment: widget.onDownloadAttachment,
                ),
              ),
            ),
            const SizedBox(height: 12),
            _composer(context),
          ],
        ),
      ),
    );
  }

  Widget _projectBanner(BuildContext context) {
    final c = context.inone;
    final h = widget.header;
    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(color: c.tint, borderRadius: BorderRadius.circular(14)),
      child: Row(
        children: [
          const InOneStripeBox(width: 40, height: 40, radius: 11),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(h.projectTitle!, style: InOneText.style(12.5, FontWeight.w700, c.text)),
                if (h.projectSubtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(h.projectSubtitle!, style: InOneText.style(12, FontWeight.w800, c.text)),
                ],
              ],
            ),
          ),
          const SizedBox(width: 11),
          GestureDetector(
            onTap: widget.onViewProject,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
              decoration: BoxDecoration(color: c.bg, borderRadius: BorderRadius.circular(InOneRadius.pill)),
              child: Text('View', style: InOneText.style(11.5, FontWeight.w700, c.text)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _composer(BuildContext context) {
    final c = context.inone;
    return Row(
      children: [
        Semantics(
          button: true,
          label: 'Attach',
          child: GestureDetector(
            onTap: widget.onAttach,
            child: Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(color: c.fill, shape: BoxShape.circle),
              child: Icon(InOneIcons.attach, size: 22, color: c.textSoft),
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: SizedBox(
            height: 44,
            child: TextField(
              controller: _input,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => unawaited(_send()),
              cursorColor: c.link,
              textAlignVertical: TextAlignVertical.center,
              style: InOneText.style(13.5, FontWeight.w400, c.text),
              decoration: InputDecoration(
                isDense: true,
                filled: true,
                fillColor: c.fill,
                hintText: 'Message…',
                hintStyle: InOneText.style(13.5, FontWeight.w400, c.hint),
                contentPadding: const EdgeInsets.symmetric(horizontal: 16),
                suffixIcon: Icon(InOneIcons.emoji, size: 20, color: c.hint),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(InOneRadius.pill),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
        ),
        const SizedBox(width: 10),
        Semantics(
          button: true,
          label: 'Send',
          child: GestureDetector(
            onTap: () => unawaited(_send()),
            child: Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(color: c.accent, shape: BoxShape.circle),
              child: Icon(InOneIcons.send, size: 22, color: c.onAccent),
            ),
          ),
        ),
      ],
    );
  }
}

class _ThreadItem extends StatelessWidget {
  const _ThreadItem({required this.item, this.onDownloadAttachment});
  final InOneThreadItem item;
  final ValueChanged<String>? onDownloadAttachment;

  static const _maxBubble = 262.0;
  static const _theirs = BorderRadius.only(
    topLeft: Radius.circular(16),
    topRight: Radius.circular(16),
    bottomRight: Radius.circular(16),
    bottomLeft: Radius.circular(5),
  );
  static const _mine = BorderRadius.only(
    topLeft: Radius.circular(16),
    topRight: Radius.circular(16),
    bottomLeft: Radius.circular(16),
    bottomRight: Radius.circular(5),
  );

  Widget _bubble(BuildContext context, String text) {
    final c = context.inone;
    return Container(
      constraints: const BoxConstraints(maxWidth: _maxBubble),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      decoration: BoxDecoration(
        color: item.mine ? c.accent : c.fill,
        borderRadius: item.mine ? _mine : _theirs,
      ),
      child: Text(text, style: InOneText.style(13, FontWeight.w400, item.mine ? c.onAccent : c.text, height: 1.5)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    switch (item.kind) {
      case InOneThreadItemKind.dayDivider:
        return Align(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
            decoration: BoxDecoration(color: c.fill, borderRadius: BorderRadius.circular(InOneRadius.pill)),
            child: Text(item.text ?? '', style: InOneText.style(10.5, FontWeight.w600, c.muted)),
          ),
        );
      case InOneThreadItemKind.text:
        return Align(
          alignment: item.mine ? Alignment.centerRight : Alignment.centerLeft,
          child: Column(
            crossAxisAlignment: item.mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
            children: [
              _bubble(context, item.text ?? ''),
              if (item.meta != null) ...[
                const SizedBox(height: 6),
                Text(item.meta!, style: InOneText.style(10, FontWeight.w400, c.muted)),
              ],
            ],
          ),
        );
      case InOneThreadItemKind.file:
        return Align(
          alignment: item.mine ? Alignment.centerRight : Alignment.centerLeft,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: _maxBubble),
            child: Column(
              crossAxisAlignment: item.mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
              children: [
                InkWell(
                  onTap: item.fileId == null || onDownloadAttachment == null
                      ? null
                      : () => onDownloadAttachment!(item.fileId!),
                  borderRadius: BorderRadius.circular(14),
                  child: InOneStripeBox(
                    width: 170,
                    height: 120,
                    radius: 14,
                    stripe: 6,
                    child: Center(
                      child: Text(item.fileLabel ?? '', style: InOneText.style(9, FontWeight.w400, c.muted)),
                    ),
                  ),
                ),
                if (item.text != null) ...[
                  const SizedBox(height: 6),
                  _bubble(context, item.text!),
                ],
                if (item.meta != null) ...[
                  const SizedBox(height: 6),
                  Text(item.meta!, style: InOneText.style(10, FontWeight.w400, c.muted)),
                ],
              ],
            ),
          ),
        );
      case InOneThreadItemKind.typing:
        return Align(
          alignment: Alignment.centerLeft,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
            decoration: BoxDecoration(color: c.fill, borderRadius: _theirs),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final dot in [c.dot1, c.dot2, c.dot3]) ...[
                  Container(width: 6, height: 6, decoration: BoxDecoration(color: dot, shape: BoxShape.circle)),
                  if (dot != c.dot3) const SizedBox(width: 4),
                ],
              ],
            ),
          ),
        );
    }
  }
}
