import 'package:flutter/material.dart';

import '../../state/inone_state.dart';
import '../../widgets/inone_widgets.dart';

/// SC-10 · Սա դուք չե՞ք: отмена чужого входа или восстановления по коду из письма.
class InOneNotYouScreen extends StatefulWidget {
  const InOneNotYouScreen({
    super.key,
    required this.onSubmit,
    required this.onBack,
    this.onDone,
  });

  /// POST /admission/cancel or /recovery/cancel-by-code. `null` — успех.
  final Future<InOneFailure?> Function(String email, String code) onSubmit;
  final VoidCallback onBack;

  /// Отменено → экран SC-01.
  final VoidCallback? onDone;

  @override
  State<InOneNotYouScreen> createState() => _InOneNotYouScreenState();
}

class _InOneNotYouScreenState extends State<InOneNotYouScreen> with InOneActionState<InOneNotYouScreen> {
  final InOneFormController _form = InOneFormController(required: const ['email', 'code']);

  @override
  void dispose() {
    _form.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_form.validate()) return;
    run(
      'submit',
      () => widget.onSubmit(_form.value('email').trim(), _form.value('code').trim()),
      onSuccess: widget.onDone,
    );
  }

  @override
  Widget build(BuildContext context) {
    return InOneScreen.auth(
      title: 'Սա դուք չե՞ք',
      onBack: widget.onBack,
      banner: bannerText,
      dock: [
        AutofillGroup(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              InOneField(
                form: _form,
                name: 'email',
                label: 'Էլ. փոստ',
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
                textInputAction: TextInputAction.next,
              ),
              InOneField(
                form: _form,
                name: 'code',
                label: 'Կոդը նամակից',
                maxLength: 6,
                keyboardType: TextInputType.number,
                autofillHints: const [AutofillHints.oneTimeCode],
                textInputAction: TextInputAction.done,
                onSubmitted: _submit,
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        InOneButton(
          label: 'Չեղարկել',
          loading: isBusy('submit'),
          onPressed: blocked ? null : _submit,
        ),
      ],
    );
  }
}
