import 'package:flutter/material.dart';

import '../../state/inone_state.dart';
import '../../widgets/inone_widgets.dart';

class InOnePinVerificationScreen extends StatefulWidget {
  const InOnePinVerificationScreen({
    super.key,
    required this.onSubmit,
    required this.onForgotPin,
    required this.onLogout,
    required this.onDone,
  });

  final Future<InOneFailure?> Function(String pin) onSubmit;
  final VoidCallback onForgotPin;
  final VoidCallback onLogout;
  final VoidCallback onDone;

  @override
  State<InOnePinVerificationScreen> createState() => _InOnePinVerificationScreenState();
}

class _InOnePinVerificationScreenState extends State<InOnePinVerificationScreen>
    with InOneActionState<InOnePinVerificationScreen> {
  final InOneFormController _form = InOneFormController(required: const ['pin']);

  @override
  void dispose() {
    _form.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_form.validate()) return;
    run('verify', () => widget.onSubmit(_form.value('pin')), onSuccess: widget.onDone);
  }

  @override
  Widget build(BuildContext context) {
    return InOneScreen.auth(
      title: 'Подтверждение безопасности',
      banner: bannerText ??
          'Просим прощения за временные неудобства. Мы хотим защитить вас и ваш аккаунт от злоумышленников. Пожалуйста, подтвердите PIN-код восстановления.',
      dock: [
        InOneField(
          form: _form,
          name: 'pin',
          label: 'PIN-код восстановления · 8 цифр',
          obscure: true,
          keyboardType: TextInputType.number,
          maxLength: 8,
          textInputAction: TextInputAction.done,
          onSubmitted: _submit,
        ),
        const SizedBox(height: 10),
        InOneButton(
          label: 'Подтвердить',
          loading: isBusy('verify'),
          onPressed: blocked ? null : _submit,
        ),
        TextButton(
          onPressed: blocked ? null : widget.onForgotPin,
          child: const Text('Не помню PIN-код'),
        ),
        TextButton(
          onPressed: blocked ? null : widget.onLogout,
          child: const Text('Выйти из аккаунта'),
        ),
      ],
    );
  }
}
