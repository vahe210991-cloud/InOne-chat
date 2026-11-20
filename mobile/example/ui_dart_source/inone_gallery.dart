import 'package:flutter/material.dart';

import 'package:inone_mobile/ui_dart_source/inone.dart';
import 'inone_demo_data.dart';

void main() => runApp(const InOneGalleryApp());

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
