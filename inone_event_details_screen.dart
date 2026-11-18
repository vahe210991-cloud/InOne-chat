import 'package:flutter/material.dart';

import '../../models/inone_calendar_models.dart';
import '../../state/inone_state.dart';
import '../../theme/inone_theme.dart';
import '../../widgets/inone_calendar_labels.dart';
import '../../widgets/inone_calendar_widgets.dart';
import '../../widgets/inone_ds_widgets.dart';
import '../../widgets/inone_icons.dart';
import '../../widgets/inone_widgets.dart';

/// Screen 63 / D63 · Event details: время, место, видеозвонок, повтор,
/// напоминание, участники со статусами и ответ на приглашение.
class InOneEventDetailsScreen extends StatefulWidget {
  const InOneEventDetailsScreen({
    super.key,
    required this.details,
    required this.onBack,
    required this.onEdit,
    required this.onMore,
    required this.onRsvp,
    this.onJoinVideo,
    this.labels = InOneCalendarLabels.hy,
  });

  final InOneEventDetails details;
  final VoidCallback onBack;
  final VoidCallback onEdit;
  final VoidCallback onMore;

  /// Ответ на приглашение: `true` — «Մասնակցում եմ», `false` — «Չեմ մասնակցի». `null` — успех.
  final Future<InOneFailure?> Function(bool going) onRsvp;
  final VoidCallback? onJoinVideo;
  final InOneCalendarLabels labels;

  @override
  State<InOneEventDetailsScreen> createState() => _InOneEventDetailsScreenState();
}

class _InOneEventDetailsScreenState extends State<InOneEventDetailsScreen>
    with InOneActionState<InOneEventDetailsScreen> {
  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final d = widget.details;
    final l = widget.labels;
    final kind = inOneKindStyle(c, d.event.kind);
    final banner = bannerText;

    final rows = <Widget>[
      InOneInfoRow(icon: InOneIcons.calendar, title: d.dateLabel, subtitle: d.timeLabel),
      if (d.locationTitle != null)
        InOneInfoRow(icon: InOneIcons.pin, title: d.locationTitle!, subtitle: d.locationSubtitle ?? ''),
      if (d.hasVideoCall)
        InOneInfoRow(
          icon: InOneIcons.video,
          title: l.videoJoin,
          subtitle: l.videoLinkHint,
          onTap: widget.onJoinVideo,
        ),
      InOneInfoRow(icon: InOneIcons.repeat, title: d.repeatLabel, subtitle: l.repeatHint),
      InOneInfoRow(icon: InOneIcons.bell, title: d.reminderLabel, subtitle: l.reminderHint, last: true),
    ];

    return InOneShell(
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
            child: Row(
              children: [
                Transform.translate(
                  offset: const Offset(-10, 0),
                  child: InOneIconAction(
                    icon: InOneIcons.back,
                    semanticLabel: l.back,
                    onTap: widget.onBack,
                    size: 28,
                  ),
                ),
                const Spacer(),
                InOneIconAction(icon: InOneIcons.edit, semanticLabel: l.edit, onTap: widget.onEdit, size: 22),
                InOneIconAction(icon: InOneIcons.more, semanticLabel: l.more, onTap: widget.onMore, size: 22),
              ],
            ),
          ),
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(
                            color: kind.background,
                            borderRadius: BorderRadius.circular(7),
                          ),
                          child: Text(
                            inOneKindLabel(l, d.event.kind),
                            style: InOneText.style(10, FontWeight.w700, kind.foreground),
                          ),
                        ),
                        const SizedBox(height: 10),
                        Text(d.event.title, style: InOneText.style(22, FontWeight.w700, c.text, height: 1.2)),
                        const SizedBox(height: 6),
                        Text(
                          l.organizerLine(d.organizerName),
                          style: InOneText.style(12.5, FontWeight.w400, c.muted),
                        ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                    child: Column(children: rows),
                  ),
                  InOneSectionTitle(l.participantsHeading(d.participants.length), top: 14),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: Column(
                      children: [
                        for (var i = 0; i < d.participants.length; i++)
                          _participant(context, d.participants[i], last: i == d.participants.length - 1),
                      ],
                    ),
                  ),
                  if (d.description != null) ...[
                    InOneSectionTitle(l.description, top: 18),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
                      child: Text(
                        d.description!,
                        style: InOneText.style(12.5, FontWeight.w400, c.sub, height: 1.55),
                      ),
                    ),
                  ] else
                    const SizedBox(height: 16),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 10, 20, 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (banner != null) InOneBanner.error(banner),
                Row(
                  children: [
                    Expanded(
                      child: InOneButton(
                        label: l.rsvpNo,
                        kind: InOneButtonKind.outline,
                        loading: isBusy(false),
                        onPressed: blocked ? null : () => run(false, () => widget.onRsvp(false)),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: InOneButton(
                        label: l.rsvpYes,
                        loading: isBusy(true),
                        onPressed: blocked ? null : () => run(true, () => widget.onRsvp(true)),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _participant(BuildContext context, InOneParticipant p, {required bool last}) {
    final c = context.inone;
    final l = widget.labels;
    final (avatarBg, avatarFg) = inOneAvatarColors(c, p.tone);
    final Color badgeBg;
    final Color badgeFg;
    final String badgeText;
    switch (p.status) {
      case InOneRsvp.going:
        badgeBg = c.soft;
        badgeFg = c.link;
        badgeText = l.statusGoing;
      case InOneRsvp.pending:
        badgeBg = c.fill;
        badgeFg = c.sub;
        badgeText = l.statusPending;
      case InOneRsvp.declined:
        badgeBg = c.dangerTint;
        badgeFg = c.dangerText;
        badgeText = l.statusDeclined;
    }
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(border: last ? null : Border(bottom: BorderSide(color: c.rowLine))),
      child: Row(
        children: [
          InOneAvatar(initials: p.initials, background: avatarBg, foreground: avatarFg, size: 36, fontSize: 12),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(p.name, style: InOneText.style(13.5, FontWeight.w700, c.text)),
                const SizedBox(height: 1),
                Text(
                  p.isOrganizer ? l.organizerRole : l.participantRole,
                  style: InOneText.style(11.5, FontWeight.w400, c.muted),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(color: badgeBg, borderRadius: BorderRadius.circular(7)),
            child: Text(badgeText, style: InOneText.style(10, FontWeight.w700, badgeFg)),
          ),
        ],
      ),
    );
  }
}
