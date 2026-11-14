import 'package:flutter/material.dart';

import '../../state/inone_state.dart';
import '../../widgets/inone_widgets.dart';

/// SC-02 · Գրանցում: ввод e-mail, отправка кода.
class InOneRegisterEmailScreen extends StatefulWidget {
  const InOneRegisterEmailScreen({
    super.key,
    required this.onSubmit,
    required this.onBack,
    required this.onHaveAccount,
    this.onDone,
  });

  /// POST /register/email. `null` — успех.
  final Future<InOneFailure?> Function(String email) onSubmit;
  final VoidCallback onBack;
  final VoidCallback onHaveAccount;

  /// Код отправлен → экран SC-03.
  final VoidCallback? onDone;

  @override
  State<InOneRegisterEmailScreen> createState() => _InOneRegisterEmailScreenState();
}

class _InOneRegisterEmailScreenState extends State<InOneRegisterEmailScreen>
    with InOneActionState<InOneRegisterEmailScreen> {
  final InOneFormController _form = InOneFormController(required: const ['email']);

  @override
  void dispose() {
    _form.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_form.validate()) return;
    run('submit', () => widget.onSubmit(_form.value('email').trim()), onSuccess: widget.onDone);
  }

  @override
  Widget build(BuildContext context) {
    return InOneScreen.auth(
      title: 'Գրանցում',
      onBack: widget.onBack,
      banner: bannerText,
      dock: [
        InOneField(
          form: _form,
          name: 'email',
          label: 'Էլ. փոստ',
          keyboardType: TextInputType.emailAddress,
          autofillHints: const [AutofillHints.email],
          textInputAction: TextInputAction.done,
          onSubmitted: _submit,
        ),
        const SizedBox(height: 10),
        InOneButton(
          label: 'Ուղարկել կոդը',
          loading: isBusy('submit'),
          onPressed: blocked ? null : _submit,
        ),
        InOneLinks.column(
          children: [InOneLink(label: 'Արդեն ունեմ հաշիվ', onTap: widget.onHaveAccount)],
        ),
      ],
    );
  }
}
