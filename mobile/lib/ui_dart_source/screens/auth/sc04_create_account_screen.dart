import 'package:flutter/material.dart';

import '../../state/inone_state.dart';
import '../../widgets/inone_widgets.dart';

/// SC-04 · Հաշվի ստեղծում: никнейм, пароль, телефон և PIN վերականգնման համար.
class InOneCreateAccountScreen extends StatefulWidget {
  const InOneCreateAccountScreen({
    super.key,
    required this.onSubmit,
    required this.onBack,
    this.onDone,
  });

  /// POST /register. `null` — успех.
  final Future<InOneFailure?> Function(String nickname, String password, String phone, String pin, String pinConfirmation) onSubmit;
  final VoidCallback onBack;
  final VoidCallback? onDone;

  @override
  State<InOneCreateAccountScreen> createState() => _InOneCreateAccountScreenState();
}

class _InOneCreateAccountScreenState extends State<InOneCreateAccountScreen>
    with InOneActionState<InOneCreateAccountScreen> {
  final InOneFormController _form =
      InOneFormController(required: const ['nickname', 'password', 'phone', 'pin', 'pinConfirmation']);

  @override
  void dispose() {
    _form.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_form.validate()) return;
    run(
      'submit',
      () => widget.onSubmit(
        _form.value('nickname').trim(),
        _form.value('password'),
        _form.value('phone').trim(),
        _form.value('pin'),
        _form.value('pinConfirmation'),
      ),
      onSuccess: widget.onDone,
    );
  }

  @override
  Widget build(BuildContext context) {
    return InOneScreen.auth(
      title: 'Հաշվի ստեղծում',
      onBack: widget.onBack,
      banner: bannerText,
      dock: [
        AutofillGroup(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              InOneField(
                form: _form,
                name: 'nickname',
                label: 'Մականուն',
                autofillHints: const [AutofillHints.nickname],
                textInputAction: TextInputAction.next,
              ),
              InOneField(
                form: _form,
                name: 'password',
                label: 'Գաղտնաբառ',
                obscure: true,
                maxLength: 128,
                autofillHints: const [AutofillHints.newPassword],
                textInputAction: TextInputAction.next,
              ),
              InOneField(
                form: _form,
                name: 'pin',
                label: 'Վերականգնման PIN (8 թվանշան)',
                obscure: true,
                keyboardType: TextInputType.number,
                maxLength: 8,
                textInputAction: TextInputAction.next,
              ),
              InOneField(
                form: _form,
                name: 'pinConfirmation',
                label: 'Կրկնեք վերականգնման PIN-ը',
                obscure: true,
                keyboardType: TextInputType.number,
                maxLength: 8,
                textInputAction: TextInputAction.next,
              ),
              InOneField(
                form: _form,
                name: 'phone',
                label: 'Հեռախոսահամար',
                keyboardType: TextInputType.phone,
                autofillHints: const [AutofillHints.telephoneNumber],
                textInputAction: TextInputAction.done,
                onSubmitted: _submit,
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        InOneButton(
          label: 'Ստեղծել հաշիվ',
          loading: isBusy('submit'),
          onPressed: blocked ? null : _submit,
        ),
      ],
    );
  }
}
