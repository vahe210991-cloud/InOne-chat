import 'package:flutter/material.dart';

import '../../state/inone_state.dart';
import '../../widgets/inone_widgets.dart';

/// SC-07 · Մուտքի վերականգնում: request the account's registered recovery contact.
/// Ответ не раскрывает, существует ли аккаунт.
class InOneRecoveryStartScreen extends StatefulWidget {
  const InOneRecoveryStartScreen({
    super.key,
    required this.onSubmit,
    required this.onBack,
    required this.onEnterCode,
    this.onCancelRecovery,
  });

  /// POST /recovery/start. `null` — успех.
  final Future<InOneFailure?> Function(String email) onSubmit;
  final VoidCallback onBack;

  /// Перейти к вводу кода (SC-09).
  final VoidCallback onEnterCode;
  final VoidCallback? onCancelRecovery;

  @override
  State<InOneRecoveryStartScreen> createState() => _InOneRecoveryStartScreenState();
}

class _InOneRecoveryStartScreenState extends State<InOneRecoveryStartScreen>
    with InOneActionState<InOneRecoveryStartScreen> {
  final InOneFormController _form = InOneFormController(required: const ['email']);
  bool _sent = false;

  @override
  void dispose() {
    _form.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_form.validate()) return;
    run(
      'submit',
      () => widget.onSubmit(_form.value('email').trim()),
      onSuccess: () => setState(() => _sent = true),
    );
  }

  @override
  Widget build(BuildContext context) {
    return InOneScreen.auth(
      title: 'Մուտքի վերականգնում',
      onBack: widget.onBack,
      banner: bannerText,
      dock: [
        if (_sent) const InOneBanner.info('Եթե հաշիվ գոյություն ունի, նամակն ուղարկված է'),
        InOneField(
          form: _form,
          name: 'email',
          label: 'Էլ. փոստ',
          keyboardType: TextInputType.emailAddress,
          autofillHints: const [AutofillHints.username],
          textInputAction: TextInputAction.done,
          onSubmitted: _submit,
        ),
        if (!_sent) ...[
          const SizedBox(height: 10),
          InOneButton(
            label: 'Վերականգնել',
            loading: isBusy('submit'),
            onPressed: blocked ? null : _submit,
          ),
        ],
        if (_sent) ...[
          const SizedBox(height: 12),
          InOneButton(
            label: 'Մուտքագրել նամակի կոդը',
            kind: InOneButtonKind.outline,
            onPressed: widget.onEnterCode,
          ),
        ],
        if (widget.onCancelRecovery != null) ...[
          const SizedBox(height: 12),
          InOneButton(
            label: 'Արդեն ունե՞ք չեղարկման կոդը',
            kind: InOneButtonKind.outline,
            onPressed: widget.onCancelRecovery,
          ),
        ],
      ],
    );
  }
}
