import 'package:flutter/material.dart';

import '../../state/inone_state.dart';
import '../../widgets/inone_widgets.dart';

/// SC-03 · Կոդ նամակից: подтверждение кода из письма.
class InOneEmailCodeScreen extends StatefulWidget {
  const InOneEmailCodeScreen({
    super.key,
    required this.onConfirm,
    required this.onResend,
    required this.onBack,
    this.title = 'Կոդ նամակից',
    this.codeLabel = 'Նամակի կոդը',
    this.resendLabel = 'Կրկին ուղարկել կոդը',
    this.showResend = true,
    this.onDone,
  });

  /// POST /register/email/confirm or login identity-code verification.
  final Future<InOneFailure?> Function(String code) onConfirm;

  /// POST /register/email (registration only).
  final Future<InOneFailure?> Function() onResend;
  final VoidCallback onBack;
  final String title;
  final String codeLabel;
  final String resendLabel;
  final bool showResend;

  /// Код подтверждён → следующий экран соответствующего auth flow.
  final VoidCallback? onDone;

  @override
  State<InOneEmailCodeScreen> createState() => _InOneEmailCodeScreenState();
}

class _InOneEmailCodeScreenState extends State<InOneEmailCodeScreen>
    with InOneActionState<InOneEmailCodeScreen> {
  final InOneFormController _form = InOneFormController(required: const ['code']);

  @override
  void dispose() {
    _form.dispose();
    super.dispose();
  }

  void _confirm() {
    if (!_form.validate()) return;
    run('confirm', () => widget.onConfirm(_form.value('code').trim()), onSuccess: widget.onDone);
  }

  @override
  Widget build(BuildContext context) {
    return InOneScreen.auth(
      title: widget.title,
      onBack: widget.onBack,
      banner: bannerText,
      dock: [
        InOneField(
          form: _form,
          name: 'code',
          label: widget.codeLabel,
          maxLength: 6,
          keyboardType: TextInputType.number,
          autofillHints: const [AutofillHints.oneTimeCode],
          textInputAction: TextInputAction.done,
          onSubmitted: _confirm,
        ),
        const SizedBox(height: 10),
        InOneButton(
          label: 'Հաստատել',
          loading: isBusy('confirm'),
          onPressed: blocked ? null : _confirm,
        ),
        if (widget.showResend) ...[
          const SizedBox(height: 12),
          InOneButton(
            label: widget.resendLabel,
            kind: InOneButtonKind.outline,
            loading: isBusy('resend'),
            onPressed: blocked ? null : () => run('resend', widget.onResend),
          ),
        ],
      ],
    );
  }
}
