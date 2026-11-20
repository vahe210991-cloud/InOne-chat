import 'package:flutter/material.dart';

import '../inone.dart';
import 'inone_demo_data.dart';

/// ДЕМО-галерея всех экранов InOne (только для предпросмотра, не для продакшена).
/// Запуск: `runApp(const InOneGalleryApp());`
class InOneGalleryApp extends StatefulWidget {
  const InOneGalleryApp({super.key});

  @override
  State<InOneGalleryApp> createState() => _InOneGalleryAppState();
}

class _InOneGalleryAppState extends State<InOneGalleryApp> {
  ThemeMode _mode = ThemeMode.light;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'InOne screens',
      theme: InOneTheme.light(),
      darkTheme: InOneTheme.dark(),
      themeMode: _mode,
      home: _GalleryHome(
        dark: _mode == ThemeMode.dark,
        onToggleTheme: () =>
            setState(() => _mode = _mode == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark),
      ),
    );
  }
}

typedef _Build = Widget Function(BuildContext context);

class _Entry {
  const _Entry(this.title, this.build);
  final String title;
  final _Build build;
}

Future<InOneFailure?> _ok0() async => null;
Future<InOneFailure?> _ok1(Object? _) async => null;
Future<InOneFailure?> _ok2(Object? _, Object? __) async => null;
void _noop() {}
void _noop1(Object? _) {}

class _GalleryHome extends StatelessWidget {
  const _GalleryHome({required this.dark, required this.onToggleTheme});
  final bool dark;
  final VoidCallback onToggleTheme;

  List<_Entry> _entries(BuildContext context) {
    void back() => Navigator.of(context).maybePop();
    return [
      _Entry('SC-01 Մուտք', (_) => InOneLoginScreen(
            onSubmit: (e, p) => _ok2(e, p),
            onProvider: _ok1,
            onRegister: _noop,
            onForgotPassword: _noop,
          )),
      _Entry('SC-02 Գրանցում', (_) => InOneRegisterEmailScreen(
            onSubmit: _ok1,
            onBack: back,
            onHaveAccount: back,
          )),
      _Entry('SC-03 Կոդ նամակից', (_) => InOneEmailCodeScreen(
            onConfirm: _ok1,
            onResend: _ok0,
            onBack: back,
          )),
      _Entry('SC-04 Հաշվի ստեղծում', (_) => InOneCreateAccountScreen(
            onSubmit: (a, b, c) async => null,
            onBack: back,
          )),
      _Entry('SC-06 Մականուն (Google/Apple)', (_) => InOneProviderNicknameScreen(
            onSubmit: _ok1,
            onBack: back,
          )),
      _Entry('SC-07 Վերականգնում', (_) => InOneRecoveryStartScreen(
            onSubmit: _ok1,
            onBack: back,
            onEnterCode: _noop,
          )),
      _Entry('SC-08 Հաստատում', (_) => InOneRecoveryConfirmScreen(onConfirm: _ok0)),
      _Entry('SC-09 Նոր գաղտնաբառ', (_) => InOneNewPasswordScreen(
            onSubmit: (a, b, c) async => null,
          )),
      _Entry('SC-10 Սա դուք չե՞ք', (_) => InOneNotYouScreen(
            onSubmit: (a, b) async => null,
            onBack: back,
          )),
      _Entry('SC-11 Մուտքի սպասում', (_) => InOneLoginWaitingScreen(
            activateAt: '14:30',
            onRecheck: _ok0,
            onNotMe: _noop,
          )),
      _Entry('SC-12 Ելք', (_) => InOneLogoutScreen(onLogout: _ok0, onCancel: back)),
      _Entry('RQ-01 Նոր հայտ', (_) => InOneNewRequestScreen(
            onSubmit: _ok1,
            onBack: back,
            onMenu: _noop,
          )),
      _Entry('RQ-02 Հայտի փաստաթղթեր', (_) => InOneRequestDocumentsScreen(
            documents: InOneDemoData.documents,
            onDownload: _ok1,
            onPickFile: () async => 'registration.pdf',
            onUpload: _ok1,
            onBack: back,
            onMenu: _noop,
          )),
      _Entry('RQ-03 Իմ հայտերը', (_) => InOneMyRequestsScreen(
            requests: InOneDemoData.requests,
            onOpen: _noop1,
            onNew: _noop,
            onMenu: _noop,
          )),
      _Entry('RQ-04 Հայտ', (_) => InOneRequestDetailsScreen(
            request: InOneDemoData.requests.first,
            documents: InOneDemoData.documents,
            onDownload: _ok1,
            onBack: back,
            onMenu: _noop,
          )),
      _Entry('PS-01 Հայտեր (admin)', (_) => InOneRequestsAdminScreen(
            requests: InOneDemoData.requests,
            onOpen: _noop1,
            onMenu: _noop,
          )),
      _Entry('PS-02 Հայտ (admin)', (_) => InOneRequestAdminDetailsScreen(
            request: InOneDemoData.requests.first,
            documents: InOneDemoData.documents,
            isOwner: true,
            onDownload: _ok1,
            onDecide: _noop,
            onBack: back,
            onMenu: _noop,
          )),
      _Entry('PS-03 Որոշում', (_) => InOneRequestDecisionScreen(
            request: InOneDemoData.requests.first,
            onDecision: _ok1,
            onBack: back,
            onMenu: _noop,
          )),
      _Entry('ST-01 Ծանուցումներ', (_) => InOneNotificationsSettingsScreen(
            initiallyEnabled: true,
            onEnable: _ok1,
            onDisable: _ok0,
            onMenu: _noop,
          )),
      _Entry('ST-02 Համակարգի վիճակ', (_) => const InOneSystemStatusScreen(
            status: InOneDemoData.systemStatus,
            onMenu: _noop,
          )),
      _Entry('ST-03 Բաններներ և վիճակներ', (_) => const InOneBannersStatesScreen(onMenu: _noop)),
      _Entry('Org profile (Screen 02)', (_) => InOneOrgProfileScreen(
            profile: InOneDemoData.orgProfile,
            onBack: back,
            onMore: _noop,
            onEditCover: _noop,
            onTab: _noop1,
            onAdd: _noop,
          )),
      _Entry('Workspace (Screen 03)', (_) => InOneWorkspaceScreen(
            summary: InOneDemoData.workspace,
            modules: InOneDemoData.modules(),
            activity: InOneDemoData.activity,
            onSwitchWorkspace: _noop,
            onNotifications: _noop,
            onCustomize: _noop,
            onSeeAll: _noop,
            onTab: _noop1,
            onAdd: _noop,
          )),
      _Entry('Messages (Screen 05)', (_) => InOneMessagesScreen(
            chats: InOneDemoData.chats,
            onOpenChat: _noop1,
            onSearch: _noop,
            onTab: _noop1,
            onAdd: _noop,
          )),
      _Entry('Notifications (Screen 06)', (_) => InOneNotificationsScreen(
            items: InOneDemoData.notifications,
            onOpen: _noop1,
            onSettings: _noop,
            onTab: _noop1,
            onAdd: _noop,
          )),
      _Entry('Leads (Screen 40)', (_) => InOneLeadsScreen(
            stats: InOneDemoData.leadStats,
            leads: InOneDemoData.leads,
            onOpenLead: _noop1,
            onAddLead: _noop,
            onBack: back,
          )),
      _Entry('Deals board (Screen 41)', (_) => InOneDealsBoardScreen(
            pipelineLabel: 'Project pipeline',
            countLabel: '14 projects',
            columns: InOneDemoData.kanban,
            onOpenDeal: _noop1,
            onBack: back,
          )),
      _Entry('Deal detail (Screen 42)', (_) => InOneDealDetailScreen(
            deal: InOneDemoData.deal,
            onBack: back,
            onMore: _noop,
            onCall: _noop,
            onMail: _noop,
            onAddNote: _noop,
            onMoveStage: _noop,
          )),
      _Entry('Profile (Screen 43)', (_) => InOneProfileScreen(
            profile: InOneDemoData.userProfile,
            menu: InOneDemoData.profileMenu(),
            onToggleTheme: onToggleTheme,
            onEditAvatar: _noop,
            onTab: _noop1,
            onAdd: _noop,
          )),
      _Entry('Chat thread (Screen 46)', (_) => InOneChatThreadScreen(
            header: InOneDemoData.threadHeader,
            items: InOneDemoData.thread,
            onSend: _noop1,
            onBack: back,
          )),
      _Entry('Empty states (Screen 51)', (_) => InOneEmptyStatesScreen(
            onStartChat: _noop,
            onClearSearch: _noop,
            onViewAllChats: _noop,
          )),
      _Entry('Calendar · Month / Week / Day (60–62)', (_) => const _CalendarDemo()),
      _Entry('Event details (63)', (_) => InOneEventDetailsScreen(
            details: InOneCalendarDemoData.detailsFor(InOneCalendarDemoData.events.first),
            onBack: back,
            onEdit: _noop,
            onMore: _noop,
            onRsvp: (_) async => null,
          )),
      _Entry('New event (64)', (_) => InOneNewEventScreen(
            initialStart: DateTime(2026, 11, 14, 10),
            onSave: (_) async => null,
            onClose: back,
            onEditParticipants: (current) async => current,
            onPickRepeat: (current) async => current,
            initialParticipants: InOneCalendarDemoData.participants.take(3).toList(),
            initialRepeatLabel: 'Չի կրկնվում',
          )),
      _Entry('Participant availability (65)', (_) => InOneAvailabilityScreen(
            subtitle: '14 նոյեմբերի · Նախագծի քննարկում',
            rows: InOneCalendarDemoData.availability,
            slots: InOneCalendarDemoData.slots,
            onBack: back,
            onConfirm: _noop1,
          )),
      _Entry('Loading & error (Screen 52)', (_) => InOneLoadingErrorScreen(onRetry: _noop)),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final entries = _entries(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('InOne screens (demo)'),
        actions: [
          IconButton(
            tooltip: 'Light / Dark',
            icon: Icon(dark ? InOneIcons.lightMode : InOneIcons.darkMode),
            onPressed: onToggleTheme,
          ),
        ],
      ),
      body: ListView.builder(
        itemCount: entries.length,
        itemBuilder: (context, i) => ListTile(
          title: Text(entries[i].title),
          trailing: const Icon(Icons.chevron_right_rounded),
          onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: entries[i].build)),
        ),
      ),
    );
  }
}

class _CalendarDemo extends StatefulWidget {
  const _CalendarDemo();

  @override
  State<_CalendarDemo> createState() => _CalendarDemoState();
}

class _CalendarDemoState extends State<_CalendarDemo> {
  InOneCalendarView _view = InOneCalendarView.month;
  DateTime _day = InOneCalendarDemoData.today;

  void _shiftMonth(int delta) => setState(() => _day = DateTime(_day.year, _day.month + delta, 1));
  void _shiftDays(int days) => setState(() => _day = _day.add(Duration(days: days)));

  void _open(InOneCalendarEvent e) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (ctx) => InOneEventDetailsScreen(
          details: InOneCalendarDemoData.detailsFor(e),
          onBack: () => Navigator.of(ctx).pop(),
          onEdit: _noop,
          onMore: _noop,
          onRsvp: (_) async => null,
        ),
      ),
    );
  }

  void _add() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (ctx) => InOneNewEventScreen(
          initialStart: DateTime(_day.year, _day.month, _day.day, 10),
          onSave: (_) async {
            Navigator.of(ctx).pop();
            return null;
          },
          onClose: () => Navigator.of(ctx).pop(),
          onEditParticipants: (current) async => current,
          onPickRepeat: (current) async => current,
          initialRepeatLabel: 'Չի կրկնվում',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final today = InOneCalendarDemoData.today;
    final events = InOneCalendarDemoData.events;
    void toToday() => setState(() => _day = today);
    void setView(InOneCalendarView v) => setState(() => _view = v);
    switch (_view) {
      case InOneCalendarView.month:
        return InOneCalendarMonthScreen(
          month: _day,
          selectedDay: _day,
          today: today,
          events: events,
          onSelectDay: (d) => setState(() => _day = d),
          onPrev: () => _shiftMonth(-1),
          onNext: () => _shiftMonth(1),
          onToday: toToday,
          onSearch: _noop,
          onView: setView,
          onAddEvent: _add,
          onOpenEvent: _open,
          onTab: _noop1,
          onAdd: _noop,
        );
      case InOneCalendarView.week:
        return InOneCalendarWeekScreen(
          weekOf: _day,
          selectedDay: _day,
          today: today,
          now: InOneCalendarDemoData.now,
          events: events,
          onSelectDay: (d) => setState(() => _day = d),
          onPrev: () => _shiftDays(-7),
          onNext: () => _shiftDays(7),
          onToday: toToday,
          onSearch: _noop,
          onView: setView,
          onAddEvent: _add,
          onOpenEvent: _open,
          onTab: _noop1,
          onAdd: _noop,
        );
      case InOneCalendarView.day:
        return InOneCalendarDayScreen(
          day: _day,
          now: InOneCalendarDemoData.now,
          events: events,
          onSelectDay: (d) => setState(() => _day = d),
          onToday: toToday,
          onSearch: _noop,
          onView: setView,
          onAddEvent: _add,
          onOpenEvent: _open,
          onTab: _noop1,
          onAdd: _noop,
        );
    }
  }
}
