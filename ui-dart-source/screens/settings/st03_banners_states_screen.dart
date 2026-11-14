import 'package:flutter/material.dart';

import '../../state/inone_state.dart';
import '../../theme/inone_theme.dart';
import '../../widgets/inone_widgets.dart';

/// ST-03 · Բաններներ և վիճակներ: каталог системных баннеров (справочный экран).
class InOneBannersStatesScreen extends StatelessWidget {
  const InOneBannersStatesScreen({super.key, required this.onMenu});

  final VoidCallback onMenu;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    Widget caption(String text) => Padding(
          padding: const EdgeInsets.fromLTRB(4, 0, 4, 16),
          child: Text(text, style: InOneText.style(13, FontWeight.w400, c.text2)),
        );
    return InOneScreen.bar(
      title: 'Բաններներ և վիճակներ',
      onMenu: onMenu,
      top: [
        const InOneBanner.error(InOneMessages.offline, bottom: 8),
        caption('Կարգավիճակ 0։ Փոփոխող գործողությունները արգելափակված են'),
        const InOneBanner.error(InOneMessages.maintenance, bottom: 8),
        caption('503 maintenance կոդով'),
        const InOneBanner.error(InOneMessages.unavailable, bottom: 8),
        caption('503 առանց կոդի'),
        const InOneBanner.error(InOneMessages.rateLimited, bottom: 8),
        caption('429'),
        const InOneBanner.error('Տեքստը ERROR_TEXT կատալոգից', bottom: 8),
        caption('401՝ token_expired, refresh_expired, refresh_reused, refresh_unknown, device_revoked։ Անցում SC-01-ին'),
      ],
    );
  }
}
