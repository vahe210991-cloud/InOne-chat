import 'package:flutter/material.dart';

import '../../state/inone_state.dart';
import '../../theme/inone_theme.dart';
import '../../widgets/inone_brand_logos.dart';
import '../../widgets/inone_icons.dart';
import '../../widgets/inone_widgets.dart';

/// SC-01 · Մուտք (вход). Принят для беты.
/// Кнопки Google и Apple — отдельные, с логотипами, под строками формы
/// (бывший SC-05 больше не отдельный экран).
class InOneLoginScreen extends StatefulWidget {
  const InOneLoginScreen({
    super.key,
    required this.onSubmit,
    required this.onProvider,
    required this.onRegister,
    required this.onForgotPassword,
    this.onSuccess,
    this.onProviderSuccess,
    this.onCancelRecovery,
  });

  /// POST /login. `null` — успех.
  final Future<InOneFailure?> Function(String email, String password) onSubmit;

  /// POST /auth/nonce для выбранного провайдера. `null` — успех.
  final Future<InOneFailure?> Function(InOneAuthProvider provider) onProvider;
  final VoidCallback onRegister;
  final VoidCallback onForgotPassword;
  final VoidCallback? onSuccess;

  /// После успешного ответа провайдера (дальше — ввод никнейма, SC-06).
  final VoidCallback? onProviderSuccess;
  final VoidCallback? onCancelRecovery;

  @override
  State<InOneLoginScreen> createState() => _InOneLoginScreenState();
}

class _InOneLoginScreenState extends State<InOneLoginScreen> with InOneActionState<InOneLoginScreen> {
  final InOneFormController _form = InOneFormController(required: const ['email', 'password']);

  @override
  void dispose() {
    _form.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_form.validate()) return;
    run(
      'login',
      () => widget.onSubmit(_form.value('email').trim(), _form.value('password')),
      onSuccess: widget.onSuccess,
    );
  }

  void _provider(InOneAuthProvider provider) {
    run(
      provider,
      () => widget.onProvider(provider),
      onSuccess: widget.onProviderSuccess,
      busy: InOneScreenState.waiting,
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return InOneScreen.auth(
      title: 'Մուտք',
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
                autofillHints: const [AutofillHints.username],
                textInputAction: TextInputAction.next,
              ),
              InOneField(
                form: _form,
                name: 'password',
                label: 'Գաղտնաբառ',
                obscure: true,
                maxLength: 128,
                autofillHints: const [AutofillHints.password],
                textInputAction: TextInputAction.done,
                onSubmitted: _submit,
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        InOneButton(
          label: 'Մուտք գործել',
          loadingLabel: 'Մուտք…',
          loading: isBusy('login'),
          onPressed: blocked ? null : _submit,
        ),
        if (status == InOneScreenState.waiting) const InOneNote('Սպասում ենք մատակարարի պատասխանին'),
        const SizedBox(height: 12),
        InOneButton(
          label: 'Google',
          kind: InOneButtonKind.outline,
          leading: const InOneGoogleLogo(),
          loading: isBusy(InOneAuthProvider.google),
          onPressed: blocked ? null : () => _provider(InOneAuthProvider.google),
        ),
        const SizedBox(height: 12),
        InOneButton(
          label: 'Apple',
          kind: InOneButtonKind.outline,
          leading: Icon(InOneIcons.apple, size: 22, color: c.text),
          loading: isBusy(InOneAuthProvider.apple),
          onPressed: blocked ? null : () => _provider(InOneAuthProvider.apple),
        ),
        InOneLinks.row(
          children: [
            InOneLink(label: 'Գրանցում', onTap: widget.onRegister),
            InOneLink(label: 'Մոռացել եմ գաղտնաբառը', onTap: widget.onForgotPassword),
          ],
        ),
        if (widget.onCancelRecovery != null)
          InOneLinks.row(
            children: [
              InOneLink(label: 'Չեղարկել վերականգնումը', onTap: widget.onCancelRecovery!),
            ],
          ),
      ],
    );
  }
}
