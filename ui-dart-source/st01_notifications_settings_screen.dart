import 'package:flutter/material.dart';

import '../../state/inone_state.dart';
import '../../widgets/inone_widgets.dart';

enum InOnePushProvider { fcm, apns }

/// ST-01 · Ծանուցումներ: включение push-уведомлений устройства.
class InOneNotificationsSettingsScreen extends StatefulWidget {
  const InOneNotificationsSettingsScreen({
    super.key,
    required this.initiallyEnabled,
    required this.onEnable,
    required this.onDisable,
    required this.onMenu,
    this.isTestEnvironment = false,
  });

  final bool initiallyEnabled;

  /// PUT /devices/me/push. `null` — успех.
  final Future<InOneFailure?> Function(InOnePushProvider provider) onEnable;

  /// DELETE /devices/me/push. `null` — успех.
  final Future<InOneFailure?> Function() onDisable;
  final VoidCallback onMenu;

  /// В тестовом окружении переключатель недоступен.
  final bool isTestEnvironment;

  @override
  State<InOneNotificationsSettingsScreen> createState() => _InOneNotificationsSettingsScreenState();
}

class _InOneNotificationsSettingsScreenState extends State<InOneNotificationsSettingsScreen>
    with InOneActionState<InOneNotificationsSettingsScreen> {
  late bool _enabled = widget.initiallyEnabled;
  InOnePushProvider _provider = InOnePushProvider.fcm;

  void _toggle(bool on) {
    if (on) {
      run('toggle', () => widget.onEnable(_provider), onSuccess: () => setState(() => _enabled = true));
    } else {
      run('toggle', widget.onDisable, onSuccess: () => setState(() => _enabled = false));
    }
  }

  @override
  Widget build(BuildContext context) {
    final disabled = blocked || widget.isTestEnvironment;
    return InOneScreen.bar(
      title: 'Ծանուցումներ',
      onMenu: widget.onMenu,
      banner: bannerText,
      dock: [
        InOneSwitchRow(
          label: 'Ծանուցումներ',
          value: _enabled,
          onChanged: disabled ? null : _toggle,
        ),
        if (_enabled) ...[
          const InOneLabel('Մատակարար'),
          InOneChips<InOnePushProvider>(
            bottom: 14,
            selected: _provider,
            onChanged: disabled ? null : (v) => setState(() => _provider = v),
            options: const [
              InOneChipOption(InOnePushProvider.fcm, 'FCM'),
              InOneChipOption(InOnePushProvider.apns, 'APNs'),
            ],
          ),
        ],
        if (widget.isTestEnvironment) const InOneNote('Հասանելի չէ թեստային էկրանում'),
      ],
    );
  }
}
