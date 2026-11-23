import 'dart:async';
import 'dart:io' show Platform;
import 'dart:math' as math;

import 'package:file_picker/file_picker.dart';

import 'package:flutter/material.dart';

import '../core/data/inone_profile.dart';
import '../core/data/inone_room.dart';
import '../core/data/inone_public_room.dart';
import '../core/data/inone_push_repository.dart';
import '../core/data/inone_public_config.dart';
import '../core/data/inone_organization.dart';
import '../core/data/inone_repositories.dart';
import '../core/mls/rust_mls_session_bridge.dart';
import '../core/network/api_environment.dart';
import '../core/network/api_exception.dart';
import '../core/session/inone_session.dart';
import '../core/session/inone_push_lifecycle.dart';
import '../core/session/inone_push_receive_lifecycle.dart';
import '../core/session/recovery_deep_link.dart';
import '../ui_dart_source/inone.dart';

const _configuredApiBaseUrl = String.fromEnvironment('INONE_API_BASE_URL');
// Native MLS remains opt-in until the owner accepts the runtime, persistence,
// recovery, and security gates on an exact tested commit.
const _nativeMlsEnabled = bool.fromEnvironment(
  'INONE_MLS_NATIVE_ENABLED',
  defaultValue: false,
);

class InOneMobileApp extends StatefulWidget {
  const InOneMobileApp({super.key, this.enablePush = false});

  final bool enablePush;

  @override
  State<InOneMobileApp> createState() => _InOneMobileAppState();
}

class _InOneMobileAppState extends State<InOneMobileApp> with WidgetsBindingObserver {
  final _messengerKey = GlobalKey<ScaffoldMessengerState>();
  late final InOneSession _session;
  late final InOneRepositories _repositories;
  InOnePushLifecycle? _pushLifecycle;
  InOnePushReceiveLifecycle? _pushReceiveLifecycle;
  final InOnePushRouteQueue _pendingPushRoutes = InOnePushRouteQueue();
  bool _pushRouteInFlight = false;
  String? _pushRoomId;
  List<InOneThreadItem> _pushThreadItems = const [];

  String _screen = 'login';
  String _registrationEmail = '';
  String _recoveryEmail = '';
  String _recoveryUserId = '';
  String _pendingLoginEmail = '';
  String _pendingLoginPassword = '';
  String _waitingActivateAt = '';
  InOneProfile? _profile;
  List<InOneOrganization> _organizations = const [];
  InOneOrganization? _selectedOrganization;
  int? _organizationMemberCount;
  InOneSystemStatus? _systemStatus;
  List<InOneChatPreview> _mlsChats = const [];
  String? _activeMlsRoomId;
  String _activeMlsRoomName = '';
  List<InOneThreadItem> _activeMlsThread = const [];
  bool _messagesLoading = false;
  String? _messagesError;
  bool _darkMode = false;
  bool _initializing = true;
  final Completer<void> _initializationComplete = Completer<void>();
  bool _recoveryLinkInFlight = false;
  final Set<int> _handledRecoveryLinkFingerprints = <int>{};

  @override
  void initState() {
    super.initState();
    final baseUrl = resolveInOneApiBaseUrl(
      configured: _configuredApiBaseUrl,
      isAndroid: Platform.isAndroid,
    );
    _session = InOneSession(
      baseUrl: baseUrl,
      nativeMlsBridge: _nativeMlsEnabled &&
              (Platform.isAndroid || Platform.isIOS)
          ? RustMlsSessionBridge()
          : null,
    );
    _repositories = InOneRepositories(_session);
    if (widget.enablePush) {
      _pushLifecycle = InOnePushLifecycle.firebase(
        session: _session,
        repository: InOnePushRepository(_session),
      )..start();
      _pushReceiveLifecycle = InOnePushReceiveLifecycle.firebase(
        onForeground: _showForegroundPush,
        onOpen: _openPushRoute,
      );
      unawaited(_pushReceiveLifecycle!.start().catchError((Object _) {}));
    }
    WidgetsBinding.instance.addObserver(this);
    final initialRoute = WidgetsBinding.instance.platformDispatcher.defaultRouteName;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(_handleRecoveryRoute(initialRoute));
    });
    unawaited(_initialize());
  }

  Future<void> _initialize() async {
    try {
      try {
        await _session.initialize();
      } catch (_) {
        // The first authenticated operation will surface a safe UI error.
      }
      if (!mounted) return;
      setState(() => _initializing = false);
      if (_session.isAuthenticated) await _loadAuthenticatedData();
    } finally {
      if (!_initializationComplete.isCompleted) {
        _initializationComplete.complete();
      }
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    final pushLifecycle = _pushLifecycle;
    if (pushLifecycle != null) {
      unawaited(pushLifecycle.refreshRegistration().catchError((Object _) {}));
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _pushLifecycle?.dispose();
    unawaited(_pushReceiveLifecycle?.dispose() ?? Future<void>.value());
    _session.dispose();
    super.dispose();
  }

  InOneFailure _toFailure(Object error) {
    if (error is ApiException) {
      if (error.code == 'network_unavailable' || error.code == 'request_timeout') {
        return const InOneFailure(
          InOneScreenState.offline,
          message: 'Нет соединения с сервером. Проверьте подключение и повторите попытку.',
        );
      }
      if (error.statusCode == 429) {
        return const InOneFailure(
          InOneScreenState.rateLimited,
          message: 'Слишком много запросов. Подождите и попробуйте снова.',
        );
      }
      if (error.statusCode == 503) {
        return const InOneFailure(
          InOneScreenState.maintenance,
          message: 'Сервис временно недоступен. Попробуйте позже.',
        );
      }
      final message = switch (error.statusCode) {
        400 => 'Проверьте введённые данные.',
        401 => 'Неверные данные для входа или сессия завершена.',
        403 => 'Операция не разрешена для этой учётной записи.',
        404 => 'Запрошенные данные не найдены.',
        409 => 'Операция конфликтует с текущим состоянием учётной записи.',
        _ => 'Не удалось выполнить запрос. Попробуйте позже.',
      };
      return InOneFailure(InOneScreenState.error, message: message);
    }
    return const InOneFailure(
      InOneScreenState.error,
      message: 'Не удалось выполнить операцию. Попробуйте позже.',
    );
  }

  Future<InOneFailure?> _runApi(Future<Object?> Function() operation) async {
    try {
      await operation();
      return null;
    } catch (error) {
      return _toFailure(error);
    }
  }

  Future<InOneFailure?> _login(String email, String password) async {
    try {
      final response = await _session.login(email: email, password: password);
      if (_session.isAuthenticated) return null;

      final status = response['status'];
      if (status == 'waiting_period' && response['activateAt'] is String) {
        _pendingLoginEmail = email.trim();
        _pendingLoginPassword = password;
        _waitingActivateAt = _formatActivationTime(response['activateAt'] as String);
        if (mounted) setState(() => _screen = 'loginWaiting');
        return null;
      }
      if (status == 'approval_required') {
        return const InOneFailure(
          InOneScreenState.error,
          message: 'Вход ожидает подтверждения на другом устройстве. Сценарий подтверждения устройства ещё не подключён.',
        );
      }
      if (status == 'identity_check_required') {
        return const InOneFailure(
          InOneScreenState.error,
          message: 'Для этого входа требуется дополнительное подтверждение. Текущий мобильный контракт его не поддерживает; вход не выполнен.',
        );
      }
      return const InOneFailure(
        InOneScreenState.error,
        message: 'Сервер не выдал активную сессию. Вход не выполнен.',
      );
    } catch (error) {
      return _toFailure(error);
    }
  }

  void _afterLogin() {
    if (_session.isAuthenticated) unawaited(_loadAuthenticatedData());
  }

  void _showForegroundPush(InOnePushRoute route) {
    _messengerKey.currentState?.showSnackBar(
      SnackBar(
        content: const Text('Новое сообщение'),
        action: SnackBarAction(
          label: 'Открыть',
          onPressed: () => unawaited(_openPushRoute(route)),
        ),
      ),
    );
  }

  Future<void> _openPushRoute(InOnePushRoute route) async {
    await _initializationComplete.future;
    if (!mounted) return;
    _pendingPushRoutes.enqueue(route);
    if (!_session.isAuthenticated) {
      _notice('Войдите в InOne, чтобы открыть новое сообщение.');
      return;
    }
    await _processPendingPushRoute();
  }

  Future<void> _processPendingPushRoute() async {
    final route = _pendingPushRoutes.next;
    if (route == null || _pushRouteInFlight || !_session.isAuthenticated) return;
    _pushRouteInFlight = true;
    try {
      final history = await _session.request(
        'GET',
        '/rooms/${Uri.encodeComponent(route.roomId)}/events',
      );
      final rawEvents = history['events'];
      final eventExists = rawEvents is List &&
          rawEvents.any((entry) =>
              entry is Map && entry['event_id'] == route.eventId);
      if (!eventExists) {
        throw StateError('push event is not available to this device');
      }

      if (!_session.hasNativeMlsSession) {
        if (mounted) setState(() => _screen = 'messages');
        _notice('Уведомление открыто. Для просмотра содержимого требуется активный нативный MLS-сеанс. Зашифрованное сообщение не открывается в обход MLS.');
        return;
      }

      await _session.syncMlsMessages();
      final incoming = await _session.mlsMessagesForRoom(route.roomId);
      final target = incoming.where((message) => message.eventId == route.eventId).toList(growable: false);
      if (target.isEmpty || target.every((message) => !message.isReadable)) {
        if (mounted) setState(() => _screen = 'messages');
        _notice('Сообщение ещё не расшифровано на этом устройстве или недоступно.');
        return;
      }

      final items = target
          .where((message) => message.isReadable)
          .map((message) => InOneThreadItem(
                kind: InOneThreadItemKind.text,
                text: message.text,
              ))
          .toList(growable: false);
      if (!mounted) return;
      setState(() {
        _pushRoomId = route.roomId;
        _pushThreadItems = items;
        _screen = 'pushChat';
      });
    } catch (_) {
      if (mounted) {
        setState(() => _screen = 'messages');
        _notice('Не удалось безопасно открыть сообщение. Проверьте подключение и членство в комнате.');
      }
    } finally {
      _pendingPushRoutes.complete(route);
      _pushRouteInFlight = false;
      if (_pendingPushRoutes.next != null && mounted && _session.isAuthenticated) {
        unawaited(_processPendingPushRoute());
      }
    }
  }
  String _formatActivationTime(String raw) {
    final parsed = DateTime.tryParse(raw)?.toLocal();
    if (parsed == null) return raw;
    return '${parsed.day.toString().padLeft(2, '0')}.${parsed.month.toString().padLeft(2, '0')}.${parsed.year} ${parsed.hour.toString().padLeft(2, '0')}:${parsed.minute.toString().padLeft(2, '0')}';
  }

  Future<InOneFailure?> _recheckWaitingLogin() async {
    try {
      final result = await _session.login(email: _pendingLoginEmail, password: _pendingLoginPassword);
      if (_session.isAuthenticated) return null;
      if (result['status'] == 'waiting_period' && result['activateAt'] is String) {
        _waitingActivateAt = _formatActivationTime(result['activateAt'] as String);
        if (mounted) setState(() {});
        return null;
      }
      return const InOneFailure(InOneScreenState.error, message: 'Вход пока не подтверждён.');
    } catch (error) {
      return _toFailure(error);
    }
  }

  Future<InOneFailure?> _startRecovery(String email) async {
    _recoveryEmail = email.trim();
    _recoveryUserId = '';
    try {
      await _session.startRecovery(email: _recoveryEmail);
      return null;
    } catch (error) {
      return _toFailure(error);
    }
  }

  Future<InOneFailure?> _completeRecovery(String code, String newPassword, String pin) async {
    try {
      await _session.completeRecovery(
        email: _recoveryEmail,
        userId: _recoveryUserId,
        code: code,
        newPassword: newPassword,
        pin: pin,
      );
      return null;
    } catch (error) {
      return _toFailure(error);
    }
  }

  Future<InOneFailure?> _cancelRecoveryByCode(String email, String code) async {
    try {
      await _session.cancelRecoveryByCode(email: email, code: code);
      return null;
    } catch (error) {
      return _toFailure(error);
    }
  }

  void _finishRecovery() {
    setState(() {
      _recoveryEmail = '';
      _recoveryUserId = '';
      _screen = 'login';
    });
    _notice('Восстановление завершено. Теперь войдите с новым паролем.');
  }

  void _finishRecoveryCancellation() {
    setState(() {
      _recoveryEmail = '';
      _recoveryUserId = '';
      _screen = 'login';
    });
    _notice('Восстановление отменено. Прежний пароль восстановлен.');
  }


  Future<void> _loadAuthenticatedData() async {
    if (!_session.isAuthenticated) {
      setState(() => _screen = 'login');
      return;
    }
    setState(() => _screen = 'loading');
    try {
      final profile = await _repositories.profile();
      final organizationResponse = await _repositories.myOrganizations();
      final organizations = InOneOrganizationList.fromJson(organizationResponse).orgs;
      if (!mounted) return;
      setState(() {
        _profile = profile;
        _organizations = organizations;
        _selectedOrganization = organizations.isEmpty ? null : organizations.first;
        _organizationMemberCount = null;
        _screen = 'messages';
      });
      if (organizations.isNotEmpty) {
        unawaited(_refreshOrganizationMemberCount(organizations.first));
      }
      await _loadMlsRooms();
      if (_pendingPushRoutes.next != null) {
        unawaited(_processPendingPushRoute());
      }
    } catch (_) {
      if (mounted) setState(() => _screen = 'loadError');
    }
  }

  Future<InOneFailure?> _startEmailRegistration(String email) async {
    _registrationEmail = email.trim();
    return _runApi(() => _session.startEmailRegistration(_registrationEmail));
  }

  Future<InOneFailure?> _confirmEmailRegistration(String code) async {
    try {
      await _session.confirmEmailRegistration(
        email: _registrationEmail,
        code: code,
      );
      // The one-time registration ticket remains inside InOneSession.
      return null;
    } catch (error) {
      return _toFailure(error);
    }
  }

  Future<InOneFailure?> _createAccount(
    String nickname,
    String password,
    String phone,
  ) async {
    if (_registrationEmail.isEmpty) {
      return const InOneFailure(
        InOneScreenState.error,
        message: 'Сначала подтвердите адрес электронной почты.',
      );
    }
    return _runApi(() => _session.registerAccount(
          email: _registrationEmail,
          password: password,
          nickname: nickname,
          phone: phone,
        ));
  }

  Future<InOneFailure?> _logout() async {
    // Remove this device token while the authenticated bearer session is valid.
    // The server logout/revocation path independently removes the registration.
    try {
      await _pushLifecycle?.unregisterBeforeLogout();
    } catch (_) {
      // Continue: local logout must not be blocked by push-service availability.
    }
    try {
      await _session.logout();
      return null;
    } catch (error) {
      return _toFailure(error);
    }
  }

  void _finishLogout() {
    setState(() {
      _profile = null;
      _organizations = const [];
      _selectedOrganization = null;
      _systemStatus = null;
      _registrationEmail = '';
      _pendingPushRoutes.clear();
      _pushRoomId = null;
      _pushThreadItems = const [];
      _screen = 'login';
    });
  }

  void _notice(String message) {
    _messengerKey.currentState?.showSnackBar(SnackBar(content: Text(message)));
  }

  InOneUserProfile get _userProfile {
    final profile = _profile!;
    return InOneUserProfile(
      name: profile.nickname?.isNotEmpty == true
          ? profile.nickname!
          : (profile.email ?? 'Пользователь'),
      handle: profile.email ?? 'Аккаунт InOne',
      myTasks: '—',
      activity: '—',
      projects: '—',
      verified: profile.verificationLevel > 0,
      accountEmail: profile.email,
      locale: _session.locale,
      backupEmail: profile.backupEmail?.email,
      backupEmailVerified: profile.backupEmail?.verified ?? false,
    );
  }

  InOneWorkspaceSummary get _workspaceSummary => InOneWorkspaceSummary(
        name: _selectedOrganization?.name ?? 'Личное пространство',
        activeProjects: null,
        tasksDue: null,
        teamMembers: _organizationMemberCount,
        activeGroups: _messagesLoading || _messagesError != null
            ? null
            : _mlsChats.where((chat) => chat.kind == InOneChatKind.group).length,
        projectsCaption: '',
      );

  InOneOrgProfile get _organizationProfile {
    final org = _selectedOrganization!;
    return InOneOrgProfile(
      name: org.name,
      subtitle: '${org.role} · ${org.status}',
      members: _organizationMemberCount,
      projects: null,
      teams: null,
      about: null,
      verified: org.status == 'approved',
    );
  }

  Future<String?> _promptMlsInvitee() async {
    final controller = TextEditingController();
    try {
      return await showDialog<String>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Новый защищённый чат'),
          content: TextField(
            controller: controller,
            autofocus: true,
            autocorrect: false,
            decoration: const InputDecoration(
              labelText: 'ID пользователя',
              hintText: '@user:inone.test',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(controller.text.trim()),
              child: const Text('Создать'),
            ),
          ],
        ),
      );
    } finally {
      controller.dispose();
    }
  }

  Future<void> _createMlsRoomAndInvite() async {
    if (!_session.hasNativeMlsSession) {
      _notice('Нативная MLS-сессия недоступна.');
      return;
    }
    final invitee = await _promptMlsInvitee();
    if (invitee == null || invitee.isEmpty) return;
    try {
      await _session.ensureMlsKeyPackages(10);
      final random = math.Random.secure();
      final suffix = List<int>.generate(16, (_) => random.nextInt(256))
          .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
          .join();
      final roomId = '!$suffix:inone.test';
      await _session.createMlsRoom(roomId);
      await _session.inviteMlsMember(roomId, invitee);
      await _loadMlsRooms();
      if (mounted) _notice('Защищённая комната создана. MLS-приглашение отправлено.');
    } catch (error) {
      _notice('Не удалось создать защищённую комнату: $error');
    }
  }

  Future<void> _loadMlsRooms() async {
    if (mounted) {
      setState(() {
        _messagesLoading = true;
        _messagesError = null;
      });
    }
    try {
      // The authenticated room directory is a backend read and remains
      // available even while native MLS is opt-in/disabled. Only message
      // content, sync and outbox operations require the native Engine B session.
      if (_session.hasNativeMlsSession) {
        try {
          await _session.syncMlsMessages();
        } catch (error) {
          _notice('Серверная синхронизация недоступна; показываю локальную MLS-историю: $error');
        }
        try {
          await _session.flushMlsOutbox();
        } catch (error) {
          _notice('Исходящие MLS-сообщения останутся в защищённой очереди: $error');
        }
      }

      late final List<InOneRoom> rows;
      try {
        rows = (await _repositories.myRooms()).rooms;
      } catch (error) {
        // Local SQLCipher room recovery is permitted only when a native
        // Engine B session is present, and only for transport outages.
        if (!_session.hasNativeMlsSession ||
            (error is ApiException &&
                error.code != 'network_unavailable' &&
                error.code != 'request_timeout')) {
          rethrow;
        }
        final localRoomIds = await _session.localMlsRoomIds();
        rows = localRoomIds
            .map((roomId) => InOneRoom(
                  roomId: roomId,
                  name: roomId,
                  kind: 'group',
                  role: 'member',
                ))
            .toList(growable: false);
        _notice('Серверный список комнат недоступен; восстановлены локальные комнаты из SQLCipher: $error');
      }

      final chats = <InOneChatPreview>[];
      for (final row in rows) {
        String? lastMessage;
        if (_session.hasNativeMlsSession) {
          final messages = await _session.loadMlsRoomHistory(row.roomId);
          final pendingOutgoing = await _session.pendingMlsOutbox(row.roomId);
          for (final message in messages) {
            if (message.text != null) {
              lastMessage = message.text;
            } else if (message.isAttachment) {
              lastMessage = '📎 ${message.name ?? 'Вложение'}';
            }
          }
          if (pendingOutgoing.isNotEmpty) {
            lastMessage = pendingOutgoing.last.text ?? '📎 Вложение в очереди';
          }
        }
        final normalizedKind = row.kind.toLowerCase();
        final kind = const {'person', 'direct', 'dm'}.contains(normalizedKind)
            ? InOneChatKind.person
            : InOneChatKind.group;
        chats.add(InOneChatPreview(
          id: row.roomId,
          name: row.displayName,
          lastMessage: lastMessage,
          time: '—',
          kind: kind,
        ));
      }
      if (!mounted) return;
      setState(() {
        _mlsChats = chats;
        _messagesLoading = false;
        _messagesError = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _messagesLoading = false;
        _messagesError = 'Не удалось загрузить список комнат: $error';
      });
    }
  }

  Future<void> _openMlsChat(InOneChatPreview chat) async {
    if (!_session.hasNativeMlsSession) {
      _notice('Нативная MLS-сессия недоступна. Переписка не открыта.');
      return;
    }
    try {
      try {
        await _session.syncMlsMessages();
      } catch (error) {
        _notice('Показываю локальную историю комнаты; синхронизация повторится позже: $error');
      }
      try {
        await _session.flushMlsOutbox();
      } catch (error) {
        _notice('Исходящие сообщения остаются в защищённой очереди: $error');
      }
      final epoch = await _session.mlsLocalEpoch(chat.id);
      if (epoch == null) {
        _notice('Для этой комнаты ещё не получен MLS Welcome. Сообщения не открыты.');
        return;
      }
      final messages = await _session.loadMlsRoomHistory(chat.id);
      final pending = await _session.pendingMlsOutbox(chat.id);
      final items = messages.map((message) => message.isAttachment
          ? InOneThreadItem(
              kind: InOneThreadItemKind.file,
              fileId: message.fileId,
              fileLabel: message.name ?? 'Вложение',
              text: '${message.size ?? 0} bytes · ${message.mimeType ?? 'file'}',
              mine: message.mine,
              meta: 'MLS · epoch $epoch',
            )
          : InOneThreadItem(
              kind: InOneThreadItemKind.text,
              text: message.text ?? 'Не удалось расшифровать сообщение',
              mine: message.mine,
              meta: message.isReadable ? 'MLS · epoch $epoch' : 'Не расшифровано',
            )).toList();
      items.addAll(pending.map((message) => message.kind == 'attachment'
          ? InOneThreadItem(
              kind: InOneThreadItemKind.file,
              fileId: message.fileId,
              fileLabel: message.name ?? 'Вложение',
              text: '${message.size ?? 0} bytes · ${message.mimeType ?? 'file'}',
              mine: true,
              meta: 'В очереди · защищено SQLCipher',
            )
          : InOneThreadItem(
              kind: InOneThreadItemKind.text,
              text: message.text ?? 'Исходящее MLS-сообщение',
              mine: true,
              meta: 'В очереди · защищено SQLCipher',
            )));
      if (!mounted) return;
      setState(() {
        _activeMlsRoomId = chat.id;
        _activeMlsRoomName = chat.name;
        _activeMlsThread = items;
        _screen = 'chatThread';
      });
    } catch (error) {
      _notice('Не удалось открыть MLS-комнату: $error');
    }
  }

  Future<bool> _sendMlsMessage(String plaintext) async {
    final roomId = _activeMlsRoomId;
    if (roomId == null || plaintext.trim().isEmpty) return false;
    var enqueuedLocally = false;
    try {
      // Commit to SQLCipher before network I/O. Once this succeeds, the composer
      // must clear even if the server is temporarily unavailable; otherwise a
      // second tap could enqueue a duplicate copy of the same text.
      await _session.enqueueMlsText(roomId, plaintext);
      enqueuedLocally = true;
      if (mounted) {
        setState(() {
          _activeMlsThread = [
            ..._activeMlsThread,
            InOneThreadItem(
              kind: InOneThreadItemKind.text,
              text: plaintext,
              mine: true,
              meta: 'Сохранено в зашифрованной очереди',
            ),
          ];
          _mlsChats = _mlsChats.map((chat) => chat.id == roomId
              ? InOneChatPreview(
                  id: chat.id,
                  name: chat.name,
                  lastMessage: plaintext,
                  time: chat.time,
                  kind: chat.kind,
                  unread: chat.unread,
                  initials: chat.initials,
                )
              : chat).toList(growable: false);
        });
      }
      await _session.flushMlsOutbox();
      final queued = await _session.mlsOutboxLength();
      if (queued == 0) {
        await _refreshActiveMlsChat();
      } else {
        _notice('Сообщение сохранено в зашифрованной очереди и будет отправлено после восстановления связи.');
      }
      return true;
    } catch (error) {
      if (enqueuedLocally) {
        _notice('Сообщение уже сохранено в SQLCipher. Отправка будет повторена при следующей синхронизации: $error');
        return true;
      }
      _notice('Не удалось сохранить сообщение в зашифрованную очередь: $error');
      return false;
    }
  }

  String _newMlsClientMessageId() {
    final random = math.Random.secure();
    return List<int>.generate(16, (_) => random.nextInt(256))
        .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
        .join();
  }

  String _attachmentMimeType(String name) {
    final extension = name.split('.').last.toLowerCase();
    return switch (extension) {
      'pdf' => 'application/pdf',
      'png' => 'image/png',
      'jpg' || 'jpeg' => 'image/jpeg',
      'gif' => 'image/gif',
      'webp' => 'image/webp',
      'txt' => 'text/plain',
      'csv' => 'text/csv',
      'json' => 'application/json',
      'zip' => 'application/zip',
      'doc' => 'application/msword',
      'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls' => 'application/vnd.ms-excel',
      'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      _ => 'application/octet-stream',
    };
  }

  Future<void> _pickAndSendMlsAttachment() async {
    final roomId = _activeMlsRoomId;
    if (roomId == null || !_session.hasNativeMlsSession) return;
    try {
      final result = await FilePicker.pickFiles(
        type: FileType.any,
        allowMultiple: false,
        withData: true,
      );
      if (result == null || result.files.isEmpty) return;
      final selected = result.files.single;
      const maximumBytes = 50 * 1024 * 1024 - 16;
      if (selected.size <= 0 || selected.size > maximumBytes) {
        _notice('Размер вложения должен быть от 1 байта до 50 МиБ.');
        return;
      }
      final safeName = selected.name
          .replaceAll(RegExp(r'[/\\\x00-\x1F]'), '_');
      if (safeName.isEmpty) {
        _notice('У файла недопустимое имя.');
        return;
      }
      final displayName = safeName.length > 255 ? safeName.substring(0, 255) : safeName;
      final bytes = selected.bytes;
      if (bytes == null || bytes.isEmpty) {
        _notice('Не удалось прочитать выбранный файл. Выберите его повторно.');
        return;
      }
      try {
        if (bytes.isEmpty || bytes.length > maximumBytes) {
          _notice('Файл пустой или превышает допустимый размер.');
          return;
        }
        final clientMessageId = _newMlsClientMessageId();
        await _session.sendMlsAttachment(
          roomId,
          displayName,
          _attachmentMimeType(displayName),
          bytes,
          clientMessageId,
        );
        await _refreshActiveMlsChat();
        if (mounted) _notice('Вложение отправлено через MLS.');
      } finally {
        // The native FFI also zeroizes its owned copy after AES-GCM encryption.
        bytes.fillRange(0, bytes.length, 0);
      }
    } catch (error) {
      _notice('Не удалось отправить зашифрованное вложение: $error');
    }
  }

  Future<void> _downloadMlsAttachment(String fileId) async {
    try {
      String? rawName;
      for (final item in _activeMlsThread) {
        if (item.fileId == fileId) {
          rawName = item.fileLabel;
          break;
        }
      }
      final bytes = await _session.downloadMlsAttachment(fileId);
      try {
        final safeName = (rawName ?? 'attachment')
            .replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
        final savedPath = await FilePicker.saveFile(
          dialogTitle: 'Сохранить расшифрованное вложение',
          fileName: safeName,
          bytes: bytes,
        );
        if (savedPath != null && mounted) {
          _notice('Расшифрованное вложение сохранено: $savedPath');
        }
      } finally {
        bytes.fillRange(0, bytes.length, 0);
      }
    } catch (error) {
      _notice('Не удалось получить вложение: $error');
    }
  }

  Future<void> _refreshActiveMlsChat() async {
    final roomId = _activeMlsRoomId;
    if (roomId == null) return;
    try {
      try {
        await _session.syncMlsMessages();
      } catch (error) {
        _notice('Показываю локальную историю; серверная синхронизация повторится позже: $error');
      }
      try {
        await _session.flushMlsOutbox();
      } catch (error) {
        _notice('Очередь MLS сохранена до восстановления связи: $error');
      }
      final messages = await _session.mlsMessagesForRoom(roomId);
      final pending = await _session.pendingMlsOutbox(roomId);
      if (!mounted) return;
      setState(() {
        _activeMlsThread = [
          ...messages.map((message) => message.isAttachment
              ? InOneThreadItem(
                  kind: InOneThreadItemKind.file,
                  fileId: message.fileId,
                  fileLabel: message.name ?? 'Вложение',
                  text: '${message.size ?? 0} bytes · ${message.mimeType ?? 'file'}',
                  mine: message.mine,
                  meta: 'MLS',
                )
              : InOneThreadItem(
                  kind: InOneThreadItemKind.text,
                  text: message.text ?? 'Не удалось расшифровать сообщение',
                  mine: message.mine,
                  meta: message.isReadable ? 'MLS' : 'Не расшифровано',
                )),
          ...pending.map((message) => message.kind == 'attachment'
              ? InOneThreadItem(
                  kind: InOneThreadItemKind.file,
                  fileId: message.fileId,
                  fileLabel: message.name ?? 'Вложение',
                  text: '${message.size ?? 0} bytes · ${message.mimeType ?? 'file'}',
                  mine: true,
                  meta: 'В очереди · защищено SQLCipher',
                )
              : InOneThreadItem(
                  kind: InOneThreadItemKind.text,
                  text: message.text ?? 'Исходящее MLS-сообщение',
                  mine: true,
                  meta: 'В очереди · защищено SQLCipher',
                )),
        ];
      });
    } catch (error) {
      _notice('Синхронизация MLS не выполнена: $error');
    }
  }

  Future<void> _loadSystemStatus() async {
    setState(() => _screen = 'systemStatusLoading');
    try {
      final config = InOnePublicConfig.fromJson(await _repositories.publicConfig());
      if (!mounted) return;
      setState(() {
        _systemStatus = InOneSystemStatus(
          version: config.minimumAppVersion,
          maintenance: config.maintenanceEnabled,
          flags: {'maintenance.enabled': config.maintenanceEnabled},
        );
        _screen = 'systemStatus';
      });
    } catch (_) {
      if (mounted) setState(() => _screen = 'systemStatusError');
    }
  }

  Future<int> _readOrganizationMemberCount(String orgId) async {
    final response = await _repositories.organizationMembers(orgId);
    final members = response['members'];
    if (members is! List || members.any((member) => member is! Map)) {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 502,
        retryable: false,
      );
    }
    return members.length;
  }

  Future<void> _refreshOrganizationMemberCount(InOneOrganization org) async {
    try {
      final count = await _readOrganizationMemberCount(org.orgId);
      if (!mounted || _selectedOrganization?.orgId != org.orgId) return;
      setState(() => _organizationMemberCount = count);
    } catch (_) {
      // The workspace keeps an explicit unknown value when the read is denied
      // or temporarily unavailable; it never fabricates a member count.
    }
  }

  Future<void> _openOrganization() async {
    final org = _selectedOrganization;
    if (org == null) {
      _notice('У этой учётной записи пока нет подтверждённых организаций.');
      return;
    }
    setState(() => _screen = 'organizationLoading');
    try {
      final count = await _readOrganizationMemberCount(org.orgId);
      if (!mounted || _selectedOrganization?.orgId != org.orgId) return;
      setState(() {
        _organizationMemberCount = count;
        _screen = 'organization';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _screen = 'organizationError');
      _notice('Не удалось загрузить состав организации: ${_toFailure(error).message}');
    }
  }

  Future<void> _chooseOrganization() async {
    if (_organizations.isEmpty) {
      _notice('Нет доступных организаций для переключения.');
      return;
    }
    if (_organizations.length == 1) {
      _notice('Доступна одна организация. Переключение не требуется.');
      return;
    }
    final selected = await showDialog<InOneOrganization>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Выберите организацию'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final org in _organizations)
              ListTile(
                title: Text(org.name),
                subtitle: Text('${org.role} · ${org.status}'),
                onTap: () => Navigator.of(dialogContext).pop(org),
              ),
          ],
        ),
      ),
    );
    if (selected != null && mounted) {
      setState(() {
        _selectedOrganization = selected;
        _organizationMemberCount = null;
        _screen = 'workspace';
      });
      unawaited(_refreshOrganizationMemberCount(selected));
    }
  }

  Future<void> _searchPublicRooms() async {
    final controller = TextEditingController();
    try {
      await showDialog<void>(
        context: context,
        builder: (dialogContext) {
          var rooms = <InOnePublicRoom>[];
          var loading = false;
          String? failure;
          return StatefulBuilder(
            builder: (stateContext, setDialogState) {
              Future<void> search() async {
                final query = controller.text.trim();
                if (query.length < 2 || query.length > 50) {
                  setDialogState(() {
                    failure = 'Введите от 2 до 50 символов для поиска.';
                    rooms = [];
                  });
                  return;
                }
                setDialogState(() {
                  loading = true;
                  failure = null;
                  rooms = [];
                });
                try {
                  final found = await _repositories.searchPublicRooms(query);
                  if (!mounted) return;
                  setDialogState(() {
                    rooms = found;
                    loading = false;
                  });
                } catch (error) {
                  if (!mounted) return;
                  setDialogState(() {
                    failure = _toFailure(error).message;
                    loading = false;
                  });
                }
              }

              Future<void> join(InOnePublicRoom room) async {
                setDialogState(() {
                  loading = true;
                  failure = null;
                });
                try {
                  final result = await _repositories.joinPublicRoom(room.roomId);
                  if (!mounted) return;
                  Navigator.of(dialogContext).pop();
                  if (result == 'joined') {
                    await _loadMlsRooms();
                    _notice('Вы вступили в группу «${room.name}».');
                  } else {
                    _notice('Заявка на вступление в «${room.name}» отправлена.');
                  }
                } catch (error) {
                  if (!mounted) return;
                  setDialogState(() {
                    failure = _toFailure(error).message;
                    loading = false;
                  });
                }
              }

              return AlertDialog(
                title: const Text('Публичные группы'),
                content: SizedBox(
                  width: double.maxFinite,
                  height: 380,
                  child: Column(
                    children: [
                      TextField(
                        controller: controller,
                        autofocus: true,
                        textInputAction: TextInputAction.search,
                        onSubmitted: (_) => unawaited(search()),
                        decoration: const InputDecoration(
                          labelText: 'Название группы',
                          hintText: 'Не менее 2 символов',
                        ),
                      ),
                      const SizedBox(height: 10),
                      if (loading) const LinearProgressIndicator(),
                      if (failure != null) ...[
                        const SizedBox(height: 8),
                        Text(failure!, style: TextStyle(color: Theme.of(stateContext).colorScheme.error)),
                      ],
                      const SizedBox(height: 8),
                      Expanded(
                        child: rooms.isEmpty
                            ? Center(
                                child: Text(
                                  loading ? 'Поиск…' : 'Введите название и нажмите «Найти».',
                                  textAlign: TextAlign.center,
                                ),
                              )
                            : ListView.separated(
                                itemCount: rooms.length,
                                separatorBuilder: (_, __) => const Divider(height: 1),
                                itemBuilder: (context, index) {
                                  final room = rooms[index];
                                  return ListTile(
                                    contentPadding: EdgeInsets.zero,
                                    title: Text(room.name),
                                    subtitle: Text(
                                      '${room.members} участников · ${room.joinPolicy == 'open' ? 'Свободный вход' : 'По заявке'}',
                                    ),
                                    trailing: TextButton(
                                      onPressed: loading ? null : () => unawaited(join(room)),
                                      child: Text(room.joinPolicy == 'open' ? 'Вступить' : 'Запросить'),
                                    ),
                                  );
                                },
                              ),
                      ),
                    ],
                  ),
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.of(dialogContext).pop(),
                    child: const Text('Закрыть'),
                  ),
                  FilledButton(
                    onPressed: loading ? null : () => unawaited(search()),
                    child: const Text('Найти'),
                  ),
                ],
              );
            },
          );
        },
      );
    } finally {
      controller.dispose();
    }
  }

  Future<void> _chooseLocale() async {
    final selected = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Язык приложения'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final option in const [
              ('hy', 'Հայերեն'),
              ('ru', 'Русский'),
              ('en', 'English'),
            ])
              RadioListTile<String>(
                value: option.$1,
                groupValue: _session.locale,
                title: Text(option.$2),
                onChanged: (value) => Navigator.of(dialogContext).pop(value),
              ),
          ],
        ),
      ),
    );
    if (selected == null || selected == _session.locale) return;
    try {
      await _repositories.updateLocale(selected);
      if (!mounted) return;
      setState(() {});
      _notice('Язык приложения сохранён в профиле аккаунта.');
    } catch (_) {
      _notice('Не удалось сохранить язык приложения. Проверьте соединение и повторите попытку.');
    }
  }

  void _selectTab(InOneTab tab) {
    switch (tab) {
      case InOneTab.messages:
        setState(() => _screen = 'messages');
        return;
      case InOneTab.profile:
        setState(() => _screen = 'profile');
        return;
      case InOneTab.feed:
      case InOneTab.calls:
        _notice('Этот раздел пока не входит в подключённый объём Beta 1.0.');
        return;
    }
  }

  Widget _buildScreen() {
    if (_initializing) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    switch (_screen) {
      case 'login':
        return InOneLoginScreen(
          onSubmit: _login,
          onProvider: (_) async => const InOneFailure(
            InOneScreenState.error,
            message: 'Вход через Google и Apple пока заблокирован: нативная проверка провайдера не подключена.',
          ),
          onRegister: () => setState(() => _screen = 'registerEmail'),
          onForgotPassword: () => setState(() => _screen = 'recoveryStart'),
          onSuccess: _afterLogin,
        );
      case 'loginWaiting':
        return InOneLoginWaitingScreen(
          activateAt: _waitingActivateAt,
          onRecheck: _recheckWaitingLogin,
          onNotMe: () => setState(() => _screen = 'notYou'),
          onDone: _afterLogin,
        );
      case 'recoveryStart':
        return InOneRecoveryStartScreen(
          onSubmit: _startRecovery,
          onBack: () => setState(() => _screen = 'login'),
          onEnterCode: () => setState(() => _screen = 'recoveryPassword'),
        );
      case 'recoveryPassword':
        return InOneNewPasswordScreen(
          onSubmit: _completeRecovery,
          onDone: _finishRecovery,
        );
      case 'notYou':
        return InOneNotYouScreen(
          onSubmit: _cancelRecoveryByCode,
          onBack: () => setState(() => _screen = 'login'),
          onDone: _finishRecoveryCancellation,
        );
      case 'registerEmail':
        return InOneRegisterEmailScreen(
          onSubmit: _startEmailRegistration,
          onBack: () => setState(() => _screen = 'login'),
          onHaveAccount: () => setState(() => _screen = 'login'),
          onDone: () => setState(() => _screen = 'emailCode'),
        );
      case 'emailCode':
        return InOneEmailCodeScreen(
          onConfirm: _confirmEmailRegistration,
          onResend: () => _startEmailRegistration(_registrationEmail),
          onBack: () => setState(() => _screen = 'registerEmail'),
          onDone: () => setState(() => _screen = 'createAccount'),
        );
      case 'createAccount':
        return InOneCreateAccountScreen(
          onSubmit: _createAccount,
          onBack: () => setState(() => _screen = 'emailCode'),
          onDone: () {
            _registrationEmail = '';
            // registerAccount authenticates through the normal session flow.
            _afterLogin();
          },
        );
      case 'logout':
        return InOneLogoutScreen(
          onLogout: _logout,
          onCancel: () => setState(() => _screen = 'profile'),
          onDone: _finishLogout,
        );
      case 'loading':
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      case 'loadError':
        return InOneLoadingErrorScreen(onRetry: () => unawaited(_loadAuthenticatedData()));
      case 'workspace':
        return InOneWorkspaceScreen(
          summary: _workspaceSummary,
          modules: [
            InOneModuleTile(label: 'Messages', icon: Icons.forum_outlined, onTap: () => setState(() => _screen = 'messages')),
            InOneModuleTile(label: 'Organization', icon: Icons.business_outlined, onTap: _openOrganization),
            InOneModuleTile(label: 'Profile', icon: Icons.person_outline, onTap: () => setState(() => _screen = 'profile')),
            InOneModuleTile(label: 'System status', icon: Icons.settings_outlined, onTap: () => unawaited(_loadSystemStatus())),
          ],
          activity: const [],
          onSwitchWorkspace: _chooseOrganization,
          onNotifications: null,
          onCustomize: null,
          onSeeAll: null,
          onTab: _selectTab,
          onAdd: () => _notice('Создание публикаций не входит в Beta 1.0.'),
        );
      case 'organizationLoading':
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      case 'organizationError':
        return InOneLoadingErrorScreen(onRetry: () => unawaited(_openOrganization()));
      case 'organization':
        if (_selectedOrganization == null) {
          return InOneLoadingErrorScreen(onRetry: () => unawaited(_loadAuthenticatedData()));
        }
        return InOneOrgProfileScreen(
          profile: _organizationProfile,
          onBack: () => setState(() => _screen = 'workspace'),
          onMore: _chooseOrganization,
          onEditCover: null,
          onTab: _selectTab,
          onAdd: () => _notice('Создание публикаций не входит в Beta 1.0.'),
        );
      case 'systemStatusLoading':
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      case 'systemStatusError':
        return InOneLoadingErrorScreen(onRetry: () => unawaited(_loadSystemStatus()));
      case 'systemStatus':
        if (_systemStatus == null) {
          return InOneLoadingErrorScreen(onRetry: () => unawaited(_loadSystemStatus()));
        }
        return InOneSystemStatusScreen(
          status: _systemStatus!,
          onMenu: () => setState(() => _screen = 'workspace'),
        );
      case 'pushChat':
        return InOneChatThreadScreen(
          header: InOneThreadHeader(
            name: _pushRoomId ?? 'InOne chat',
            statusLabel: 'End-to-end encrypted',
            online: false,
          ),
          items: _pushThreadItems,
          onSend: (_) async => false,
          onBack: () => setState(() {
            _screen = 'messages';
            _pushRoomId = null;
            _pushThreadItems = const [];
          }),
          onAttach: () => _notice('Вложения доступны только после подключения полного MLS encrypted attachment flow.'),
        );
      case 'messages':
        if (_messagesLoading) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        if (_messagesError != null) {
          return InOneLoadingErrorScreen(onRetry: () => unawaited(_loadMlsRooms()));
        }
        return InOneMessagesScreen(
          chats: _mlsChats,
          unreadCountsAvailable: false,
          onOpenChat: _openMlsChat,
          onSearch: () => unawaited(_searchPublicRooms()),
          onFilter: null,
          onTab: _selectTab,
          onAdd: () => unawaited(_createMlsRoomAndInvite()),
        );
      case 'chatThread':
        return InOneChatThreadScreen(
          header: InOneThreadHeader(
            name: _activeMlsRoomName,
            statusLabel: 'Сквозное шифрование · MLS',
            online: false,
          ),
          items: _activeMlsThread,
          onSend: _sendMlsMessage,
          onBack: () => setState(() => _screen = 'messages'),
          onMore: () => unawaited(_refreshActiveMlsChat()),
          onAttach: () => unawaited(_pickAndSendMlsAttachment()),
          onDownloadAttachment: (fileId) => unawaited(_downloadMlsAttachment(fileId)),
        );
      case 'profile':
        if (_profile == null) {
          return InOneLoadingErrorScreen(onRetry: () => unawaited(_loadAuthenticatedData()));
        }
        return InOneProfileScreen(
          profile: _userProfile,
          menu: [
            InOneProfileMenuItem(
              label: 'Рабочее пространство',
              icon: Icons.workspaces_outline,
              onTap: () => setState(() => _screen = 'workspace'),
            ),
            InOneProfileMenuItem(
              label: 'Организация',
              icon: Icons.business_outlined,
              onTap: _openOrganization,
            ),
            InOneProfileMenuItem(
              label: 'Язык приложения · ${_session.locale.toUpperCase()}',
              icon: Icons.language,
              onTap: () => unawaited(_chooseLocale()),
            ),
            InOneProfileMenuItem(
              label: 'Состояние системы',
              icon: Icons.settings_outlined,
              onTap: () => unawaited(_loadSystemStatus()),
            ),
            InOneProfileMenuItem(
              label: 'Выйти из аккаунта',
              icon: Icons.logout,
              destructive: true,
              onTap: () => setState(() => _screen = 'logout'),
            ),
          ],
          onToggleTheme: () => setState(() => _darkMode = !_darkMode),
          onEditAvatar: null,
          onTab: _selectTab,
          onAdd: () => _notice('Создание публикаций не входит в Beta 1.0.'),
        );
      default:
        return InOneLoginScreen(
          onSubmit: _login,
          onProvider: (provider) async => const InOneFailure(InOneScreenState.error),
          onRegister: () => setState(() => _screen = 'registerEmail'),
          onForgotPassword: () => _notice('Восстановление пароля пока недоступно.'),
          onSuccess: _afterLogin,
        );
    }
  }


  @override
  Future<bool> didPushRoute(String route) => _handleRecoveryRoute(route);

  @override
  Future<bool> didPushRouteInformation(RouteInformation routeInformation) =>
      _handleRecoveryRoute(routeInformation.uri.toString());

  Future<bool> _handleRecoveryRoute(String rawRoute) async {
    final payload = RecoveryDeepLink.parse(rawRoute);
    if (payload == null) return false;
    await _initializationComplete.future;
    if (!mounted) return true;

    final fingerprint = Object.hash(payload.userId, payload.token);
    if (_handledRecoveryLinkFingerprints.contains(fingerprint)) return true;
    if (_recoveryLinkInFlight) return true;

    _recoveryLinkInFlight = true;
    try {
      await _session.confirmRecoveryLink(
        userId: payload.userId,
        token: payload.token,
      );
      if (!mounted) return true;
      _handledRecoveryLinkFingerprints.add(fingerprint);
      _recoveryEmail = '';
      _recoveryUserId = payload.userId;
      setState(() => _screen = 'recoveryPassword');
      final message = switch (payload.locale) {
        'ru' => 'Ссылка подтверждена. Введите код восстановления и новый пароль.',
        'en' => 'The link is confirmed. Enter your recovery code and new password.',
        _ => 'Հղումը հաստատված է։ Մուտքագրեք վերականգնման կոդը և նոր գաղտնաբառը։',
      };
      _notice(message);
    } on ApiException catch (error) {
      if (!mounted) return true;
      if (!error.retryable) _handledRecoveryLinkFingerprints.add(fingerprint);
      final message = switch (payload.locale) {
        'ru' => error.code == 'recovery expired'
            ? 'Ссылка восстановления истекла. Запросите новую.'
            : 'Не удалось подтвердить ссылку восстановления. Проверьте ссылку и повторите попытку.',
        'en' => error.code == 'recovery_expired'
            ? 'The recovery link expired. Request a new one.'
            : 'Could not confirm the recovery link. Check it and try again.',
        _ => error.code == 'recovery_expired'
            ? 'Վերականգնման հղումը ժամկետանց է։ Խնդրեք նորը։'
            : 'Չհաջողվեց հաստատել վերականգնման հղումը։ Ստուգեք այն և կրկին փորձեք։',
      };
      _notice(message);
    } catch (_) {
      if (mounted) {
        final message = switch (payload.locale) {
          'ru' => 'Нет соединения. Не удалось подтвердить восстановление.',
          'en' => 'Connection unavailable. Recovery could not be confirmed.',
          _ => 'Կապ չկա։ Չհաջողվեց հաստատել վերականգնումը։',
        };
        _notice(message);
      }
    } finally {
      _recoveryLinkInFlight = false;
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      scaffoldMessengerKey: _messengerKey,
      title: 'InOne',
      debugShowCheckedModeBanner: false,
      theme: InOneTheme.light(),
      darkTheme: InOneTheme.dark(),
      themeMode: _darkMode ? ThemeMode.dark : ThemeMode.light,
      home: InOneStatusScope(
        state: InOneScreenState.idle,
        child: _buildScreen(),
      ),
    );
  }
}
