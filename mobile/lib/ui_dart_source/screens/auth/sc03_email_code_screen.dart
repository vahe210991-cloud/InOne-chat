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
    this.onDone,
  });

  /// POST /register/email/confirm. `null` — успех.
  final Future<InOneFailure?> Function(String code) onConfirm;

  /// POST /register/email (повторная отправка). `null` — успех.
  final Future<InOneFailure?> Function() onResend;
  final VoidCallback onBack;

  /// Код подтверждён → экран SC-04.
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
      title: 'Կոդ նամակից',
      onBack: widget.onBack,
      banner: bannerText,
      dock: [
        InOneField(
          form: _form,
          name: 'code',
          label: 'Նամակի կոդը',
          keyboardType: TextInputType.text,
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
        const SizedBox(height: 12),
        InOneButton(
          label: 'Կրկին ուղարկել կոդը',
          kind: InOneButtonKind.outline,
          loading: isBusy('resend'),
          onPressed: blocked ? null : () => run('resend', widget.onResend),
        ),
      ],
    );
  }
}
