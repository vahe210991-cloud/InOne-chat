import 'dart:async';
import 'dart:io' show Directory, File, Platform;
import 'dart:typed_data';
import 'dart:math' as math;

import 'package:file_picker/file_picker.dart';

import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

import '../core/data/inone_device.dart';
import '../core/data/inone_profile.dart';
import '../core/data/inone_room.dart';
import '../core/data/inone_push_repository.dart';
import '../core/data/inone_public_config.dart';
import '../core/data/inone_organization.dart';
import '../core/data/inone_chat_preview_mapper.dart';
import '../core/data/inone_encrypted_document_store.dart';
import '../core/data/inone_repositories.dart';
import '../core/mls/mls_session_bridge.dart';
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
  late final InOneEncryptedDocumentStore _documentStore;
  String? _documentOwnerId;
  bool _wasAuthenticated = false;
  bool _manualLogoutInProgress = false;
  bool _documentViewerHandOffActive = false;
  Future<void>? _revocationCleanupInFlight;
  InOnePushLifecycle? _pushLifecycle;
  InOnePushReceiveLifecycle? _pushReceiveLifecycle;
  final InOnePushRouteQueue _pendingPushRoutes = InOnePushRouteQueue();
  bool _pushRouteInFlight = false;
  String _screen = 'login';
  String _registrationEmail = '';
  String _recoveryEmail = '';
  String _recoveryUserId = '';
  String _pendingLoginEmail = '';
  String _pendingLoginPassword = '';
  String? _pendingIdentityChallengeId;
  String _waitingActivateAt = '';
  bool _pinReminderDue = false;
  bool _pinLegacyFormat = false;
  bool _pinResetRequired = false;
  String? _pinResetReturnScreen;
  InOneProfile? _profile;
  List<InOneOrganization> _organizations = const [];
  InOneOrganization? _selectedOrganization;
  int? _organizationMemberCount;
  List<InOneOrganizationMember> _organizationMembers = const [];
  InOneSystemStatus? _systemStatus;
  InOneOrgRequest? _selectedAdminRequest;
  List<InOneOrgRequest> _adminRequests = const [];
  List<InOneDocument> _adminDocuments = const [];
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
  RecoveryDeepLinkPayload? _pendingRecoveryLinkPayload;
  int? _pendingRecoveryLinkFingerprint;
  String _recoveryLinkLocale = 'hy';
  bool _cancelingAdmission = false;
  bool _deviceApprovalDialogInFlight = false;
  Timer? _deviceApprovalPollTimer;
  final Set<String> _shownDeviceApprovalIds = <String>{};
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
    _documentStore = InOneEncryptedDocumentStore();
    _session.addListener(_handleSessionStateChanged);
    unawaited(_clearDocumentPreviewCache().catchError((Object _) {}));
    unawaited(_purgeLegacyDocumentCache());
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
      if (_session.isAuthenticated) {
        _startDeviceApprovalPolling();
        await _loadAuthenticatedData();
      }
    } finally {
      if (!_initializationComplete.isCompleted) {
        _initializationComplete.complete();
      }
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _documentViewerHandOffActive) {
      _documentViewerHandOffActive = false;
      unawaited(_clearDocumentPreviewCache().catchError((Object _) {}));
    }
    if (state != AppLifecycleState.resumed) return;
    if (_session.isAuthenticated) {
      unawaited(_refreshPinReminder());
      unawaited(_checkPendingDeviceApprovals());
    }
    final pushLifecycle = _pushLifecycle;
    if (pushLifecycle != null) {
      unawaited(pushLifecycle.refreshRegistration().catchError((Object _) {}));
    }
    if (_session.hasNativeMlsSession) {
      // Resume retries durable Engine B outbox work and refreshes the active
      // room (or the room list) without creating a second logical send.
      if (_activeMlsRoomId != null) {
        unawaited(_refreshActiveMlsChat());
      } else {
        unawaited(_loadMlsRooms());
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stopDeviceApprovalPolling();
    _session.removeListener(_handleSessionStateChanged);
    unawaited(_clearDocumentPreviewCache().catchError((Object _) {}));
    _pushLifecycle?.dispose();
    unawaited(_pushReceiveLifecycle?.dispose() ?? Future<void>.value());
    _session.dispose();
    super.dispose();
  }

  void _handleSessionStateChanged() {
    if (_session.isAuthenticated) {
      _wasAuthenticated = true;
      _documentOwnerId ??= _profile?.userId ?? _session.userId;
      return;
    }
    if (!_wasAuthenticated) return;
    _wasAuthenticated = false;
    if (_manualLogoutInProgress) return;
    final owner = _documentOwnerId ?? _profile?.userId ?? _session.userId;
    _documentOwnerId = null;
    if (owner != null) unawaited(_handleUnauthorizedSession(owner));
  }

  Future<void> _handleUnauthorizedSession([String? requestedOwnerUserId]) {
    final active = _revocationCleanupInFlight;
    if (active != null) return active;
    final operation = _handleUnauthorizedSessionOnce(requestedOwnerUserId);
    _revocationCleanupInFlight = operation;
    return operation.whenComplete(() {
      if (identical(_revocationCleanupInFlight, operation)) {
        _revocationCleanupInFlight = null;
      }
    });
  }

  Future<void> _handleUnauthorizedSessionOnce(String? requestedOwnerUserId) async {
    _stopDeviceApprovalPolling();
    final ownerUserId = requestedOwnerUserId ?? _documentOwnerId ?? _profile?.userId ?? _session.userId;
    if (ownerUserId != null) {
      try {
        await _documentStore.purgeAccount(ownerUserId);
      } catch (_) {
        // Continue cleanup; ciphertext deletion is attempted by purgeAccount even if key deletion fails.
      }
    }
    try {
      await _clearDocumentPreviewCache();
    } catch (_) {
      // Startup retries private preview cleanup.
    }
    try {
      await _session.logout();
    } catch (_) {
      // A revoked device may no longer be able to complete remote logout.
    }
    if (mounted) {
      setState(() {
        _documentOwnerId = null;
        _profile = null;
        _organizations = const [];
        _selectedOrganization = null;
        _organizationMemberCount = null;
        _organizationMembers = const [];
        _selectedAdminRequest = null;
        _adminRequests = const [];
        _adminDocuments = const [];
        _screen = 'login';
      });
      _notice('Сессия отозвана. Локальные документы и ключи очищены. Войдите снова.');
    }
  }

  Future<void> _clearDocumentPreviewCache() async {
    final temporary = await getTemporaryDirectory();
    final directory = Directory(
      '${temporary.path}${Platform.pathSeparator}InOne'
      '${Platform.pathSeparator}organization-document-preview',
    );
    if (await directory.exists()) await directory.delete(recursive: true);
  }

  Future<void> _purgeLegacyDocumentCache() async {
    try {
      await _documentStore.purgeLegacyUnscopedData();
    } catch (_) {
      if (mounted) _notice('Не удалось полностью удалить устаревший кеш документов.');
    }
  }

  Future<Directory> _documentPreviewDirectory() async {
    final temporary = await getTemporaryDirectory();
    final directory = Directory(
      '${temporary.path}${Platform.pathSeparator}InOne'
      '${Platform.pathSeparator}organization-document-preview',
    );
    await directory.create(recursive: true);
    return directory;
  }

  Future<void> _openNativeDocument(String requestId, InOneDocument document, List<int> bytes) async {
    final directory = await _documentPreviewDirectory();
    final safeName = document.name.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
    final file = File(
      '${directory.path}${Platform.pathSeparator}${requestId}_'
      '${document.id}_$safeName',
    );
    await file.writeAsBytes(bytes, flush: true);
    _documentViewerHandOffActive = true;
    try {
      final result = await OpenFilex.open(file.path, type: document.mimeType);
      if (result.type != ResultType.done) {
        _documentViewerHandOffActive = false;
        if (await file.exists()) await file.delete();
        throw StateError('Native document viewer failed: ${result.message}');
      }
    } catch (_) {
      _documentViewerHandOffActive = false;
      if (await file.exists()) await file.delete();
      rethrow;
    }
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
    final ownerUserId = _documentOwnerId ?? _session.userId ?? _profile?.userId;
    try {
      await operation();
      return null;
    } catch (error) {
      if (error is ApiException && error.statusCode == 401) {
        await _handleUnauthorizedSession(ownerUserId);
      }
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
        _pendingLoginEmail = email.trim();
        _pendingLoginPassword = password;
        if (mounted) setState(() => _screen = 'loginApproval');
        return null;
      }
      if (status == 'identity_check_required') {
        final challengeId = response['challengeId'];
        if (challengeId is! String || challengeId.isEmpty) {
          return const InOneFailure(
            InOneScreenState.error,
            message: 'Сервер не вернул идентификатор проверки. Повторите вход.',
          );
        }
        _pendingLoginEmail = email.trim();
        _pendingLoginPassword = password;
        _pendingIdentityChallengeId = challengeId;
        if (mounted) setState(() => _screen = 'identityCheck');
        return null;
      }
      return const InOneFailure(
        InOneScreenState.error,
        message: 'Сервер не выдал активную сессию. Вход не выполнен.',
      );
    } catch (error) {
      return _toFailure(error);
    }
  }

  Future<InOneFailure?> _submitIdentityCode(String code) async {
    if (_pendingLoginEmail.isEmpty || _pendingLoginPassword.isEmpty) {
      return const InOneFailure(
        InOneScreenState.error,
        message: 'Срок проверки истёк. Начните вход заново.',
      );
    }
    try {
      final response = await _session.login(
        email: _pendingLoginEmail,
        password: _pendingLoginPassword,
        identityCode: code,
        identityChallengeId: _pendingIdentityChallengeId,
      );
      if (_session.isAuthenticated) return null;
      final status = response['status'];
      if (status == 'approval_required') {
        if (mounted) setState(() => _screen = 'loginApproval');
        return null;
      }
      if (status == 'identity_check_required' && response['challengeId'] is String) {
        _pendingIdentityChallengeId = response['challengeId'] as String;
        return const InOneFailure(
          InOneScreenState.error,
          message: 'Код обновлён. Введите последний код из письма.',
        );
      }
      if (status == 'waiting_period' && response['activateAt'] is String) {
        _waitingActivateAt = _formatActivationTime(response['activateAt'] as String);
        if (mounted) setState(() => _screen = 'loginWaiting');
        return null;
      }
      return const InOneFailure(
        InOneScreenState.error,
        message: 'Дополнительная проверка не завершена. Проверьте код и попробуйте снова.',
      );
    } catch (error) {
      return _toFailure(error);
    }
  }

  void _leaveApprovalFlow() {
    _session.discardPendingApproval();
    setState(() {
      _pendingLoginEmail = '';
      _pendingLoginPassword = '';
      _pendingIdentityChallengeId = null;
      _screen = 'login';
    });
  }

  Future<InOneFailure?> _resendIdentityCode() async {
    if (_pendingLoginEmail.isEmpty || _pendingLoginPassword.isEmpty) {
      return const InOneFailure(
        InOneScreenState.error,
        message: 'Срок проверки истёк. Начните вход заново.',
      );
    }
    try {
      final response = await _session.login(
        email: _pendingLoginEmail,
        password: _pendingLoginPassword,
      );
      if (_session.isAuthenticated) {
        _afterLogin();
        return null;
      }
      if (response['status'] != 'identity_check_required' || response['challengeId'] is! String) {
        return const InOneFailure(
          InOneScreenState.error,
          message: 'Не удалось обновить проверку входа.',
        );
      }
      _pendingIdentityChallengeId = response['challengeId'] as String;
      _notice(response['codeSent'] == true
          ? 'Новый код отправлен на подтверждённый адрес.'
          : 'Предыдущий код ещё действует. Проверьте письмо и используйте последний код.');
      return null;
    } catch (error) {
      return _toFailure(error);
    }
  }

  Future<InOneFailure?> _claimPendingApproval() async {
    try {
      final result = await _session.claimPendingApproval();
      final status = result['status'];
      if (status == 'pending') {
        return const InOneFailure(
          InOneScreenState.error,
          message: 'Ожидаем подтверждения на доверенном устройстве.',
        );
      }
      if (status == 'denied' || status == 'expired') {
        if (mounted) {
          setState(() {
            _pendingLoginEmail = '';
            _pendingLoginPassword = '';
            _screen = 'login';
          });
        }
        return InOneFailure(
          InOneScreenState.error,
          message: status == 'denied'
              ? 'Запрос входа отклонён. Начните вход заново, если это были вы.'
              : 'Время подтверждения истекло. Начните вход заново.',
        );
      }
      if (_session.isAuthenticated) return null;
      return const InOneFailure(
        InOneScreenState.error,
        message: 'Подтверждение не выдало сессию. Повторите вход.',
      );
    } catch (error) {
      return _toFailure(error);
    }
  }

  void _afterLogin() {
    if (!_session.isAuthenticated) return;
    _startDeviceApprovalPolling();
    _pendingLoginEmail = '';
    _pendingLoginPassword = '';
    _pendingIdentityChallengeId = null;
    _waitingActivateAt = '';
    _pinReminderDue = false;
    _pinLegacyFormat = false;
    _pinResetRequired = false;
    unawaited(_loadAuthenticatedData());
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
      // Read the durable SQLCipher history first. This acknowledges only
      // readable inbox events that are already persisted for this room.
      final incoming = await _session.loadMlsRoomHistory(route.roomId);
      final target = incoming
          .where((message) => message.eventId == route.eventId)
          .toList(growable: false);
      if (target.isEmpty || target.every((message) => !message.isReadable)) {
        if (mounted) setState(() => _screen = 'messages');
        _notice('Сообщение ещё не расшифровано на этом устройстве или недоступно.');
        return;
      }

      final epoch = await _session.mlsLocalEpoch(route.roomId);
      final items = target
          .where((message) => message.isReadable)
          .map((message) => message.isAttachment
              ? InOneThreadItem(
                  kind: InOneThreadItemKind.file,
                  fileId: message.fileId,
                  fileLabel: message.name ?? 'Вложение',
                  text: '${message.size ?? 0} bytes · ${message.mimeType ?? 'file'}',
                  mine: message.mine,
                  meta: 'MLS · epoch ${epoch ?? '—'}',
                )
              : InOneThreadItem(
                  kind: InOneThreadItemKind.text,
                  text: message.text,
                  mine: message.mine,
                  meta: 'MLS · epoch ${epoch ?? '—'}',
                ))
          .toList(growable: false);
      if (!mounted) return;
      setState(() {
        _activeMlsRoomId = route.roomId;
        _activeMlsRoomName = route.roomId;
        _activeMlsThread = items;
        _screen = 'chatThread';
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
      if (result['status'] == 'approval_required') {
        if (mounted) setState(() => _screen = 'loginApproval');
        return null;
      }
      if (result['status'] == 'identity_check_required' && result['challengeId'] is String) {
        _pendingIdentityChallengeId = result['challengeId'] as String;
        if (mounted) setState(() => _screen = 'identityCheck');
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

  Future<InOneFailure?> _cancelAdmissionByCode(String email, String code) async {
    try {
      await _session.cancelAdmissionByCode(email: email, code: code);
      return null;
    } catch (error) {
      return _toFailure(error);
    }
  }

  Future<InOneFailure?> _confirmRecoveryLink() async {
    final payload = _pendingRecoveryLinkPayload;
    final fingerprint = _pendingRecoveryLinkFingerprint;
    if (payload == null || fingerprint == null) {
      return const InOneFailure(
        InOneScreenState.error,
        message: 'Ссылка восстановления не найдена. Откройте письмо и перейдите по ссылке ещё раз.',
      );
    }
    if (_recoveryLinkInFlight) {
      return const InOneFailure(
        InOneScreenState.error,
        message: 'Подтверждение уже выполняется. Подождите.',
      );
    }
    _recoveryLinkInFlight = true;
    try {
      await _session.confirmRecoveryLink(
        userId: payload.userId,
        token: payload.token,
      );
      if (!mounted) return null;
      _handledRecoveryLinkFingerprints.add(fingerprint);
      _pendingRecoveryLinkPayload = null;
      _pendingRecoveryLinkFingerprint = null;
      _recoveryUserId = payload.userId;
      _recoveryEmail = '';
      return null;
    } catch (error) {
      return _toFailure(error);
    } finally {
      _recoveryLinkInFlight = false;
    }
  }

  void _finishRecoveryLinkConfirmation() {
    setState(() => _screen = 'recoveryPassword');
    final message = switch (_recoveryLinkLocale) {
      'ru' => 'Ссылка подтверждена. Введите код восстановления и новый пароль.',
      'en' => 'The link is confirmed. Enter your recovery code and new password.',
      _ => 'Հղումը հաստատված է։ Մուտքագրեք վերականգնման կոդը և նոր գաղտնաբառը։',
    };
    _notice(message);
  }

  void _cancelPendingRecoveryLink() {
    setState(() {
      _pendingRecoveryLinkPayload = null;
      _pendingRecoveryLinkFingerprint = null;
      _recoveryUserId = '';
      _screen = 'login';
    });
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
    final wasAdmissionCancellation = _cancelingAdmission;
    setState(() {
      _recoveryEmail = '';
      _recoveryUserId = '';
      _pendingLoginEmail = '';
      _pendingLoginPassword = '';
      _pendingIdentityChallengeId = null;
      _waitingActivateAt = '';
      _cancelingAdmission = false;
      _screen = 'login';
    });
    _notice(wasAdmissionCancellation
        ? 'Запрос входа с нового устройства отменён.'
        : 'Восстановление отменено. Прежний пароль восстановлен.');
  }


  Future<void> _loadAuthenticatedData() async {
    if (!_session.isAuthenticated) {
      setState(() => _screen = 'login');
      return;
    }
    setState(() => _screen = 'loading');
    try {
      final pinState = await _session.pinStatus();
      if (pinState['verificationRequired'] == true) {
        if (!mounted) return;
        setState(() {
          _pinReminderDue = false;
          _pinLegacyFormat = pinState['legacy'] == true;
          _screen = _pinResetRequired || pinState['configured'] != true ? 'pinReset' : 'pinVerification';
          _pinResetReturnScreen = 'pinVerification';
        });
        return;
      }
      final profile = await _repositories.profile();
      final organizationResponse = await _repositories.myOrganizations();
      final organizations = InOneOrganizationList.fromJson(organizationResponse).orgs;
      if (!mounted) return;
      setState(() {
        _profile = profile;
        _documentOwnerId = profile.userId;
        _wasAuthenticated = true;
        _organizations = organizations;
        _selectedOrganization = organizations.isEmpty ? null : organizations.first;
        _pinReminderDue = pinState['reminderDue'] == true;
        _pinLegacyFormat = false;
        _pinResetRequired = false;
        _organizationMemberCount = null;
        _organizationMembers = const [];
        _screen = 'messages';
      });
      if (organizations.isNotEmpty) {
        unawaited(_refreshOrganizationMemberCount(organizations.first));
      }
      await _loadMlsRooms();
      unawaited(_checkPendingDeviceApprovals());
      if (_pendingPushRoutes.next != null) {
        unawaited(_processPendingPushRoute());
      }
    } catch (error) {
      if (error is ApiException && error.statusCode == 401) {
        await _handleUnauthorizedSession(_documentOwnerId ?? _session.userId);
        return;
      }
      if (mounted) setState(() => _screen = 'loadError');
    }
  }

  void _startDeviceApprovalPolling() {
    if (_deviceApprovalPollTimer != null) return;
    _deviceApprovalPollTimer = Timer.periodic(const Duration(seconds: 30), (timer) {
      if (!mounted || !_session.isAuthenticated) {
        timer.cancel();
        _deviceApprovalPollTimer = null;
        return;
      }
      if (WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed) {
        unawaited(_checkPendingDeviceApprovals());
      }
    });
  }

  void _stopDeviceApprovalPolling() {
    _deviceApprovalPollTimer?.cancel();
    _deviceApprovalPollTimer = null;
  }

  Future<void> _checkPendingDeviceApprovals() async {
    if (!mounted || !_session.isAuthenticated || _deviceApprovalDialogInFlight) return;
    _deviceApprovalDialogInFlight = true;
    try {
      final approvals = await _session.pendingDeviceApprovals();
      for (final approval in approvals) {
        if (!mounted || !_session.isAuthenticated) break;
        final id = approval['id'] as String;
        if (!_shownDeviceApprovalIds.add(id)) continue;
        final codeController = TextEditingController();
        final label = (approval['label'] as String?)?.trim();
        final platform = (approval['platform'] as String?)?.trim();
        final deviceDescription = [
          if (label != null && label.isNotEmpty) label,
          if (platform != null && platform.isNotEmpty) platform.toUpperCase(),
        ].join(' · ');
        bool? decision;
        try {
          decision = await showDialog<bool>(
            context: context,
            barrierDismissible: true,
            builder: (dialogContext) => AlertDialog(
              title: const Text('Подтверждение входа'),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    deviceDescription.isEmpty
                        ? 'Новое устройство запрашивает доступ к вашему аккаунту.'
                        : 'Запрос с устройства: $deviceDescription',
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: codeController,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    decoration: const InputDecoration(
                      labelText: 'Код, показанный на новом устройстве',
                    ),
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(false),
                  child: const Text('Отклонить'),
                ),
                FilledButton(
                  onPressed: () => Navigator.of(dialogContext).pop(true),
                  child: const Text('Подтвердить'),
                ),
              ],
            ),
          );
        } catch (_) {
          codeController.dispose();
          rethrow;
        }
        if (!mounted) {
          codeController.dispose();
          return;
        }
        if (decision == null) {
          _shownDeviceApprovalIds.remove(id);
          codeController.dispose();
          continue;
        }
        try {
          if (decision) {
            final code = codeController.text.trim();
            if (!RegExp(r'^[0-9]{6}$').hasMatch(code)) {
              _shownDeviceApprovalIds.remove(id);
              _notice('Введите шестизначный код с нового устройства.');
              continue;
            }
            await _session.approvePendingDevice(approvalId: id, code: code);
            _notice('Вход с нового устройства подтверждён.');
          } else {
            await _session.denyPendingDevice(approvalId: id);
            _notice('Запрос входа с нового устройства отклонён.');
          }
        } catch (error) {
          _shownDeviceApprovalIds.remove(id);
          final failure = _toFailure(error);
          if (mounted) {
            _notice(failure.message ??
                'Не удалось обработать запрос подтверждения. Повторите попытку.');
          }
        } finally {
          codeController.clear();
          codeController.dispose();
        }
      }
    } catch (error) {
      if (mounted) {
        final failure = _toFailure(error);
        _notice(failure.message ?? 'Не удалось проверить запросы входа.');
      }
    } finally {
      _deviceApprovalDialogInFlight = false;
    }
  }

  String _formatAdminRequestDate(Object? value) {
    if (value is! int || value < 0) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
    final date = DateTime.fromMillisecondsSinceEpoch(value).toLocal();
    return '${date.day.toString().padLeft(2, '0')}.${date.month.toString().padLeft(2, '0')}.${date.year}';
  }

  InOneOrgRequest _parseAdminRequest(Map<String, dynamic> json) {
    final id = json['requestId'];
    final name = json['name'];
    final status = switch (json['status']) {
      'pending' => InOneRequestStatus.pending,
      'approved' => InOneRequestStatus.approved,
      'rejected' => InOneRequestStatus.rejected,
      _ => null,
    };
    if (id is! String || id.isEmpty || name is! String || name.isEmpty || status == null) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
    return InOneOrgRequest(
      id: id,
      name: name,
      date: _formatAdminRequestDate(json['createdAt']),
      status: status,
    );
  }

  Future<void> _openAdminRequests() async {
    if (!(_profile?.canViewPlatformRequests ?? false)) {
      _notice('Недостаточно прав для просмотра заявок платформы.');
      return;
    }
    setState(() => _screen = 'adminRequestsLoading');
    try {
      final response = await _repositories.organizationRequests();
      final raw = response['requests'];
      if (raw is! List || raw.any((item) => item is! Map<String, dynamic>)) {
        throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
      }
      final requests = raw.cast<Map<String, dynamic>>().map(_parseAdminRequest).toList(growable: false);
      if (!mounted) return;
      setState(() {
        _adminRequests = requests;
        _screen = 'adminRequests';
      });
    } catch (error) {
      if (error is ApiException && error.statusCode == 401) {
        await _handleUnauthorizedSession(_documentOwnerId ?? _session.userId);
        return;
      }
      if (!mounted) return;
      final failure = _toFailure(error);
      setState(() => _screen = 'adminRequestsError');
      _notice(failure.message ?? 'Не удалось загрузить очередь заявок.');
    }
  }

  Future<void> _openAdminRequest(InOneOrgRequest request) async {
    if (!(_profile?.canViewPlatformRequests ?? false)) return;
    setState(() {
      _selectedAdminRequest = request;
      _screen = 'adminRequestLoading';
    });
    try {
      final response = await _repositories.organizationRequest(request.id);
      final rawRequest = response['request'];
      final rawDocuments = response['documents'];
      if (rawRequest is! Map<String, dynamic> || rawDocuments is! List ||
          rawDocuments.any((item) => item is! Map<String, dynamic>)) {
        throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
      }
      final parsedRequest = _parseAdminRequest(rawRequest);
      final documents = rawDocuments.cast<Map<String, dynamic>>().map((json) {
        final id = json['docId'];
        final kind = json['kind'];
        final size = json['size'];
        final filename = json['filename'];
        final mimeType = json['mimeType'];
        if (id is! String || id.isEmpty || kind is! String || size is! int || size < 0 ||
            filename is! String || filename.isEmpty ||
            mimeType is! String ||
            !const ['application/pdf', 'image/jpeg', 'image/png', 'application/octet-stream'].contains(mimeType)) {
          throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
        }
        final label = switch (kind) {
          'registration' => 'Регистрационный документ',
          'authority' => 'Подтверждение полномочий',
          'other' => 'Другой документ',
          _ => throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false),
        };
        return InOneDocument(
          id: id,
          name: filename,
          typeLabel: '$label · ${(size / 1024).ceil()} КБ',
          mimeType: mimeType,
        );
      }).toList(growable: false);
      if (!mounted) return;
      setState(() {
        _selectedAdminRequest = parsedRequest;
        _adminDocuments = documents;
        _screen = 'adminRequestDetails';
      });
    } catch (error) {
      if (error is ApiException && error.statusCode == 401) {
        await _handleUnauthorizedSession(_documentOwnerId ?? _session.userId);
        return;
      }
      if (!mounted) return;
      final failure = _toFailure(error);
      setState(() => _screen = 'adminRequestsError');
      _notice(failure.message ?? 'Не удалось загрузить заявку.');
    }
  }

  Future<InOneFailure?> _decideAdminRequest(InOneDecision decision) async {
    final request = _selectedAdminRequest;
    if (request == null || !(_profile?.canDecidePlatformRequests ?? false)) {
      return const InOneFailure(InOneScreenState.error, message: 'Решение доступно только владельцу платформы.');
    }
    try {
      final response = await _repositories.decideOrganizationRequest(
        request.id,
        decision: decision == InOneDecision.approve ? 'approve' : 'reject',
      );
      final expected = decision == InOneDecision.approve ? 'approved' : 'rejected';
      if (response['status'] != expected) {
        throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
      }
      return null;
    } catch (error) {
      if (error is ApiException && error.statusCode == 401) {
        await _handleUnauthorizedSession(_documentOwnerId ?? _session.userId);
      }
      return _toFailure(error);
    }
  }

  Future<InOneFailure?> _openAdminDocument(InOneDocument document) async {
    final request = _selectedAdminRequest;
    final ownerUserId = _documentOwnerId ?? _session.userId;
    if (request == null || ownerUserId == null || !(_profile?.canViewPlatformRequests ?? false)) {
      return const InOneFailure(
        InOneScreenState.error,
        message: 'Документ недоступен для этой учётной записи.',
      );
    }
    try {
      final response = await _repositories.downloadOrganizationRequestDocument(
        request.id,
        document.id,
      );
      final responseType = response.headers['content-type']?.split(';').first.trim().toLowerCase();
      if (document.mimeType != null && responseType != document.mimeType) {
        throw const ApiException(code: 'invalid_download_response', statusCode: 502, retryable: false);
      }
      await _documentStore.save(
        ownerUserId: ownerUserId,
        requestId: request.id,
        documentId: document.id,
        filename: document.name,
        bytes: response.bodyBytes,
      );
      final plaintext = await _documentStore.read(
        ownerUserId: ownerUserId,
        requestId: request.id,
        documentId: document.id,
        filename: document.name,
      );
      if (document.mimeType == 'image/jpeg' || document.mimeType == 'image/png') {
        if (!mounted) return null;
        await showDialog<void>(
          context: context,
          builder: (dialogContext) => Dialog(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(document.name, style: Theme.of(dialogContext).textTheme.titleMedium),
                ),
                Flexible(
                  child: InteractiveViewer(
                    child: Image.memory(
                      Uint8List.fromList(plaintext),
                      fit: BoxFit.contain,
                      errorBuilder: (_, __, ___) => const Center(
                        child: Text('Не удалось отобразить изображение.'),
                      ),
                    ),
                  ),
                ),
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  child: const Text('Закрыть'),
                ),
              ],
            ),
          ),
        );
      } else {
        await _openNativeDocument(request.id, document, plaintext);
      }
      if (mounted) _notice('Документ открыт из зашифрованного локального хранилища.');
      return null;
    } catch (error) {
      if (error is ApiException && error.statusCode == 401) {
        await _handleUnauthorizedSession(ownerUserId);
      }
      return _toFailure(error);
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
    String pin,
    String pinConfirmation,
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
          pin: pin,
          pinConfirmation: pinConfirmation,
        ));
  }

  Future<InOneFailure?> _verifyRecoveryPin(String pin) async {
    try {
      final result = await _session.verifyRecoveryPin(pin);
      if (result['resetRequired'] == true) {
        _pinResetRequired = true;
        _pinResetReturnScreen = 'pinVerification';
      }
      return null;
    } catch (error) {
      return _toFailure(error);
    }
  }

  Future<InOneFailure?> _startPinReset(
    String password,
    ValueChanged<String> onChallenge,
  ) async {
    try {
      final result = await _session.startPinReset(password: password);
      final challengeId = result['challengeId'];
      if (challengeId is! String || challengeId.isEmpty) {
        return const InOneFailure(
          InOneScreenState.error,
          message: 'Не удалось создать запрос на замену PIN.',
        );
      }
      onChallenge(challengeId);
      _notice('Одноразовый код отправлен на подтверждённую электронную почту.');
      return null;
    } catch (error) {
      return _toFailure(error);
    }
  }

  Future<InOneFailure?> _completePinReset(
    String challengeId,
    String code,
    String pin,
    String pinConfirmation,
  ) async {
    try {
      await _session.completePinReset(
        challengeId: challengeId,
        code: code,
        pin: pin,
        pinConfirmation: pinConfirmation,
      );
      _pinResetReturnScreen = null;
      _pinResetRequired = false;
      return null;
    } catch (error) {
      return _toFailure(error);
    }
  }

  Future<void> _acknowledgePinReminder() async {
    try {
      await _session.acknowledgePinReminder();
      if (mounted) setState(() => _pinReminderDue = false);
    } catch (error) {
      _notice(_toFailure(error).message);
    }
  }

  void _openPinReset() {
    _pinResetReturnScreen = _screen == 'profile' ? 'profile' : 'pinVerification';
    setState(() => _screen = 'pinReset');
  }

  Future<InOneFailure?> _logout() async {
    _stopDeviceApprovalPolling();
    final ownerUserId = _documentOwnerId ?? _profile?.userId ?? _session.userId;
    InOneFailure? failure;
    _manualLogoutInProgress = true;
    try {
      try {
        await _pushLifecycle?.unregisterBeforeLogout();
      } catch (_) {
        // Continue: local logout must not be blocked by push-service availability.
      }
      try {
        await _session.logout();
      } catch (error) {
        failure = _toFailure(error);
      }
    } finally {
      _manualLogoutInProgress = false;
    }
    try {
      await _clearDocumentPreviewCache();
    } catch (error) {
      failure ??= _toFailure(error);
    }
    if (ownerUserId != null) {
      try {
        await _documentStore.purgeAccount(ownerUserId);
      } catch (error) {
        failure ??= _toFailure(error);
      }
    }
    return failure;
  }

  void _finishLogout() {
    _stopDeviceApprovalPolling();
    setState(() {
      _profile = null;
      _documentOwnerId = null;
      _wasAuthenticated = false;
      _selectedAdminRequest = null;
      _adminRequests = const [];
      _adminDocuments = const [];
      _organizations = const [];
      _selectedOrganization = null;
      _organizationMemberCount = null;
      _organizationMembers = const [];
      _systemStatus = null;
      _pinReminderDue = false;
      _pinLegacyFormat = false;
      _pinResetRequired = false;
      _pinResetReturnScreen = null;
      _registrationEmail = '';
      _pendingPushRoutes.clear();
      _activeMlsRoomId = null;
      _activeMlsRoomName = '';
      _activeMlsThread = const [];
      _mlsChats = const [];
      _messagesLoading = false;
      _messagesError = null;
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
      organizationMembers: _organizationMembers
          .map((member) => (userId: member.userId, role: member.role))
          .toList(growable: false),
      currentUserId: _session.userId,
      canAddMembers: org.role == 'owner' || org.role == 'admin',
      canChangeMemberRoles: org.role == 'owner',
      removableMemberIds: _organizationMembers
          .where((member) => member.userId != _session.userId &&
              (org.role == 'owner' || (org.role == 'admin' && member.role == 'member')))
          .map((member) => member.userId)
          .toSet(),
      projects: null,
      teams: null,
      about: null,
      verified: false,
    );
  }

  Future<String?> _promptMlsInvitee({
    String title = 'Новый защищённый чат',
    String actionLabel = 'Создать',
  }) async {
    final controller = TextEditingController();
    try {
      return await showDialog<String>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(title),
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
              child: Text(actionLabel),
            ),
          ],
        ),
      );
    } finally {
      controller.dispose();
    }
  }

  Future<void> _discoverPublicRooms() async {
    final controller = TextEditingController();
    var loading = false;
    var joiningRoomId = '';
    String? errorMessage;
    List<InOnePublicRoom> results = const [];
    final statuses = <String, String>{};

    try {
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
          builder: (context, setDialogState) {
            Future<void> search() async {
              final query = controller.text.trim();
              if (query.length < 2 || query.length > 50) {
                setDialogState(() => errorMessage = 'Введите от 2 до 50 символов.');
                return;
              }
              setDialogState(() {
                loading = true;
                errorMessage = null;
                results = const [];
              });
              try {
                final rooms = await _repositories.searchPublicRooms(query);
                if (!dialogContext.mounted) return;
                setDialogState(() => results = rooms);
              } catch (error) {
                if (!dialogContext.mounted) return;
                setDialogState(() => errorMessage = _toFailure(error).message);
              } finally {
                if (dialogContext.mounted) {
                  setDialogState(() => loading = false);
                }
              }
            }

            Future<void> join(InOnePublicRoom room) async {
              setDialogState(() {
                joiningRoomId = room.roomId;
                errorMessage = null;
              });
              try {
                final status = await _repositories.joinPublicRoom(room.roomId);
                if (!dialogContext.mounted) return;
                setDialogState(() => statuses[room.roomId] = status);
                if (status == 'joined') {
                  await _loadMlsRooms();
                  if (!mounted || !dialogContext.mounted) return;
                  _notice('Вы вступили в группу. Для чтения её истории этому устройству ещё требуется MLS Welcome.');
                } else {
                  setDialogState(() {});
                }
              } catch (error) {
                if (!dialogContext.mounted) return;
                final failure = _toFailure(error);
                setDialogState(() => errorMessage = failure.message);
                if (error is ApiException && error.statusCode == 409) {
                  setDialogState(() => statuses[room.roomId] = 'already_member');
                  await _loadMlsRooms();
                }
              } finally {
                if (dialogContext.mounted) {
                  setDialogState(() => joiningRoomId = '');
                }
              }
            }

            return AlertDialog(
              title: const Text('Найти публичную группу'),
              content: SizedBox(
                width: 420,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text(
                      'Вступление фиксирует членство на сервере. Зашифрованная история откроется только после получения устройством MLS Welcome.',
                      style: TextStyle(fontSize: 12),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: controller,
                      autofocus: true,
                      maxLength: 50,
                      textInputAction: TextInputAction.search,
                      onSubmitted: (_) => unawaited(search()),
                      decoration: const InputDecoration(
                        labelText: 'Название группы',
                        hintText: 'Введите минимум 2 символа',
                        counterText: '',
                      ),
                    ),
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerRight,
                      child: FilledButton(
                        onPressed: loading ? null : () => unawaited(search()),
                        child: const Text('Искать'),
                      ),
                    ),
                    if (loading) const Padding(
                      padding: EdgeInsets.all(16),
                      child: CircularProgressIndicator(),
                    ),
                    if (errorMessage != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(errorMessage!, style: const TextStyle(color: Colors.red)),
                      ),
                    if (!loading && results.isNotEmpty)
                      SizedBox(
                        height: 260,
                        child: ListView(
                          children: [
                            for (final room in results)
                              ListTile(
                                contentPadding: EdgeInsets.zero,
                                title: Text(room.name),
                                subtitle: Text(
                                  '${room.members} участников · ${room.joinPolicy == 'open' ? 'Свободное вступление' : 'По заявке'}',
                                ),
                                trailing: statuses[room.roomId] == 'joined' ||
                                        statuses[room.roomId] == 'requested' ||
                                        statuses[room.roomId] == 'already_member'
                                    ? Text(switch (statuses[room.roomId]) {
                                        'joined' => 'Вы вступили',
                                        'requested' => 'Заявка отправлена',
                                        _ => 'Уже участник',
                                      })
                                    : TextButton(
                                        onPressed: joiningRoomId.isNotEmpty
                                            ? null
                                            : () => unawaited(join(room)),
                                        child: Text(room.joinPolicy == 'open' ? 'Вступить' : 'Запросить'),
                                      ),
                              ),
                          ],
                        ),
                      ),
                    if (!loading && results.isEmpty && errorMessage == null)
                      const Padding(
                        padding: EdgeInsets.only(top: 12),
                        child: Text('Введите название и выполните поиск публичных групп.'),
                      ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  child: const Text('Закрыть'),
                ),
              ],
            );
          },
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
        final kind = mapInOneRoomKind(row.kind);
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

  Future<void> _markMlsRoomReadAfterPersistence(
    String roomId,
    List<MlsIncomingMessage> persistedMessages,
  ) async {
    final prefix = String.fromCharCode(36);
    final sequences = persistedMessages
        .where((message) => message.isReadable)
        .map((message) {
          final eventId = message.eventId;
          if (!eventId.startsWith(prefix)) return null;
          return int.tryParse(eventId.substring(1));
        })
        .whereType<int>()
        .toList(growable: false);
    if (sequences.isEmpty) return;
    final latest = sequences.reduce((a, b) => a > b ? a : b);
    try {
      await _repositories.markRoomRead(roomId, prefix + latest.toString());
    } catch (error) {
      _notice('История сохранена, но отметку прочтения не удалось отправить: ${_toFailure(error).message}');
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
      await _markMlsRoomReadAfterPersistence(chat.id, messages);
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

  Future<void> _changeRoomMemberRole(String roomId, String memberId, String role) async {
    final roleLabel = role == 'admin' ? 'администратором' : 'участником';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Изменить роль?'),
        content: Text('Назначить участника $memberId: $roleLabel?'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Отмена')),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: const Text('Подтвердить')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await _repositories.updateRoomMemberRole(roomId, userId: memberId, role: role);
      if (!mounted) return;
      _notice('Роль участника обновлена на сервере.');
      await _showMlsRoomDetails();
    } catch (error) {
      if (mounted) _notice('Не удалось изменить роль: ${_toFailure(error).message}');
    }
  }

  Future<void> _approveRoomJoinRequest(String roomId, String userId) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Одобрить заявку?'),
        content: Text(
          'Пользователь $userId будет добавлен в защищённую MLS-группу. '
          'Каждое его устройство получит Welcome после подтверждения Commit.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Отмена')),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: const Text('Одобрить')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await _session.approveMlsJoinRequest(roomId, userId);
      if (!mounted) return;
      _notice('Заявка одобрена: MLS Commit подтверждён, Welcome поставлен на доставку.');
      await _showMlsRoomDetails();
    } catch (error) {
      if (mounted) _notice('Не удалось одобрить заявку: ${_toFailure(error).message}');
    }
  }

  Future<void> _showRoomJoinRequests(String roomId) async {
    List<InOneRoomJoinRequest> requests;
    try {
      requests = await _repositories.roomJoinRequests(roomId);
    } catch (error) {
      if (mounted) _notice('Не удалось загрузить заявки: ${_toFailure(error).message}');
      return;
    }
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Заявки на вступление'),
          content: SizedBox(
            width: 420,
            height: 360,
            child: requests.isEmpty
                ? const Text('Новых заявок нет.')
                : ListView(
                    shrinkWrap: true,
                    children: [
                      for (final request in requests)
                        ListTile(
                          dense: true,
                          title: Text(request.userId, maxLines: 1, overflow: TextOverflow.ellipsis),
                          subtitle: Text('Заявка: ${DateTime.fromMillisecondsSinceEpoch(request.createdAt).toLocal()}'),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              IconButton(
                                tooltip: 'Одобрить через MLS',
                                icon: const Icon(Icons.check_circle_outline),
                                onPressed: () async {
                                  await _approveRoomJoinRequest(roomId, request.userId);
                                  if (!dialogContext.mounted) return;
                                  try {
                                    final refreshed = await _repositories.roomJoinRequests(roomId);
                                    setDialogState(() => requests = refreshed);
                                  } catch (_) {
                                    // Keep the current list visible; the next open reloads server state.
                                  }
                                },
                              ),
                              IconButton(
                                tooltip: 'Отклонить заявку',
                                icon: const Icon(Icons.close),
                                onPressed: () async {
                                  try {
                                    await _repositories.rejectRoomJoinRequest(roomId, request.userId);
                                    if (!dialogContext.mounted) return;
                                    setDialogState(() {
                                      requests = requests.where((item) => item.userId != request.userId).toList(growable: false);
                                    });
                                  } catch (error) {
                                    if (dialogContext.mounted) {
                                      ScaffoldMessenger.of(dialogContext).showSnackBar(
                                        SnackBar(content: Text('Не удалось отклонить заявку: ${_toFailure(error).message}')),
                                      );
                                    }
                                  }
                                },
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Закрыть')),
          ],
        ),
      ),
    );
    if (mounted) await _showMlsRoomDetails();
  }

  Future<void> _editRoomMemberCapabilities(String roomId, String memberId, List<String> currentCapabilities) async {
    const labels = <String, String>{
      'invite_members': 'Приглашать участников',
      'remove_members': 'Удалять участников',
      'send_messages': 'Отправлять сообщения',
      'send_stickers_gifs': 'Стикеры и GIF',
      'forward_messages': 'Пересылать сообщения',
      'edit_own_messages': 'Редактировать свои сообщения',
      'delete_own_messages': 'Удалять свои сообщения',
      'delete_any_messages': 'Удалять чужие сообщения',
      'edit_group_name': 'Менять название группы',
      'edit_group_appearance': 'Менять оформление группы',
      'edit_group_settings': 'Менять настройки группы',
    };
    final selected = currentCapabilities.toSet();
    var saving = false;
    String? errorMessage;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Права участника'),
          content: SizedBox(
            width: 420,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final entry in labels.entries)
                    CheckboxListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      title: Text(entry.value),
                      value: selected.contains(entry.key),
                      onChanged: saving ? null : (checked) {
                        setDialogState(() {
                          if (checked == true) { selected.add(entry.key); }
                          else { selected.remove(entry.key); }
                        });
                      },
                    ),
                  if (errorMessage != null)
                    Text(errorMessage!, style: const TextStyle(color: Colors.red)),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: saving ? null : () => Navigator.of(dialogContext).pop(false),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: saving ? null : () async {
                setDialogState(() { saving = true; errorMessage = null; });
                try {
                  await _repositories.updateRoomMemberCapabilities(
                    roomId, userId: memberId, capabilities: selected.toList(growable: false),
                  );
                  if (dialogContext.mounted) Navigator.of(dialogContext).pop(true);
                } catch (error) {
                  if (dialogContext.mounted) setDialogState(() => errorMessage = _toFailure(error).message);
                } finally {
                  if (dialogContext.mounted) setDialogState(() => saving = false);
                }
              },
              child: const Text('Сохранить права'),
            ),
          ],
        ),
      ),
    );
    if (saved == true && mounted) {
      _notice('Права участника обновлены на сервере.');
      await _showMlsRoomDetails();
    }
  }

  Future<void> _removeMlsRoomMember(String roomId, String memberId) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Удалить участника из группы?'),
        content: Text(
          'Все устройства пользователя $memberId будут удалены из MLS-группы. '
          'После подтверждённого Commit участник потеряет доступ к новым сообщениям.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Удалить'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await _session.removeMlsMember(roomId, memberId);
      if (!mounted) return;
      _notice('Участник удалён из защищённой группы. MLS Commit подтверждён.');
      await _showMlsRoomDetails();
    } catch (error) {
      if (mounted) {
        _notice('Не удалось удалить участника: ${_toFailure(error).message}');
      }
    }
  }

  Future<void> _showMlsRoomDetails() async {
    final roomId = _activeMlsRoomId;
    if (roomId == null) return;
    try {
      final details = await _repositories.roomDetails(roomId);
      if (!mounted) return;
      final currentUserId = _session.userId;
      final canRename = currentUserId != null &&
          (details.capabilities[currentUserId]?.contains('edit_group_name') ?? false);
      final canEditSettings = currentUserId != null &&
          (details.capabilities[currentUserId]?.contains('edit_group_settings') ?? false);
      var visibility = details.visibility;
      var joinPolicy = details.joinPolicy;
      final controller = TextEditingController(text: details.name ?? _activeMlsRoomName);
      var saving = false;
      String? errorMessage;
      try {
        await showDialog<void>(
          context: context,
          builder: (dialogContext) => StatefulBuilder(
            builder: (context, setDialogState) => AlertDialog(
              title: const Text('Параметры группы'),
              content: SizedBox(
                width: 420,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (canEditSettings) ...[
                      DropdownButtonFormField<String>(
                        initialValue: visibility,
                        decoration: const InputDecoration(labelText: 'Видимость'),
                        items: const [
                          DropdownMenuItem(value: 'public', child: Text('Публичная')),
                          DropdownMenuItem(value: 'private', child: Text('Приватная')),
                        ],
                        onChanged: saving ? null : (value) {
                          if (value != null) setDialogState(() => visibility = value);
                        },
                      ),
                      DropdownButtonFormField<String>(
                        initialValue: joinPolicy,
                        decoration: const InputDecoration(labelText: 'Правило вступления'),
                        items: const [
                          DropdownMenuItem(value: 'open', child: Text('Свободное')),
                          DropdownMenuItem(value: 'approval', child: Text('По заявке')),
                        ],
                        onChanged: saving ? null : (value) {
                          if (value != null) setDialogState(() => joinPolicy = value);
                        },
                      ),
                    ] else ...[
                      Text('Видимость: ${details.visibility == 'public' ? 'публичная' : 'приватная'}'),
                      Text('Вступление: ${details.joinPolicy == 'open' ? 'свободное' : 'по заявке'}'),
                    ],
                    const SizedBox(height: 12),
                    const Text('Участники', style: TextStyle(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 6),
                    SizedBox(
                      height: 240,
                      child: ListView(
                        children: [
                          for (final memberId in details.members)
                            ListTile(
                              dense: true,
                              contentPadding: EdgeInsets.zero,
                              title: Text(memberId, maxLines: 1, overflow: TextOverflow.ellipsis),
                              subtitle: Text(
                                '${memberId == details.owner
                                    ? 'Владелец'
                                    : details.admins.contains(memberId)
                                        ? 'Администратор'
                                        : 'Участник'} · ${details.readUpTo[memberId] == null ? 'Нет отметки прочтения' : 'Прочитано до ${details.readUpTo[memberId]}'}',
                              ),
                              trailing: currentUserId != null &&
                                      memberId != details.owner &&
                                      memberId != currentUserId &&
                                      (currentUserId == details.owner ||
                                          ((details.capabilities[currentUserId]?.contains('remove_members') ?? false) &&
                                              !details.admins.contains(memberId)))
                                  ? Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        if (currentUserId == details.owner)
                                          PopupMenuButton<String>(
                                          tooltip: 'Изменить роль',
                                          enabled: !saving,
                                          onSelected: (role) async {
                                            Navigator.of(dialogContext).pop();
                                            await _changeRoomMemberRole(roomId, memberId, role);
                                          },
                                          itemBuilder: (context) => [
                                            PopupMenuItem(
                                              value: 'member',
                                              child: Row(children: [
                                                const Text('Участник'),
                                                if (!details.admins.contains(memberId)) ...[
                                                  const Spacer(),
                                                  const Icon(Icons.check, size: 18),
                                                ],
                                              ]),
                                            ),
                                            PopupMenuItem(
                                              value: 'admin',
                                              child: Row(children: [
                                                const Text('Администратор'),
                                                if (details.admins.contains(memberId)) ...[
                                                  const Spacer(),
                                                  const Icon(Icons.check, size: 18),
                                                ],
                                              ]),
                                            ),
                                          ],
                                        ),
                                        if (currentUserId == details.owner)
                                          IconButton(
                                            tooltip: 'Изменить права участника',
                                            icon: const Icon(Icons.tune),
                                            onPressed: saving ? null : () async {
                                              Navigator.of(dialogContext).pop();
                                              await _editRoomMemberCapabilities(
                                                roomId, memberId, details.capabilities[memberId] ?? const [],
                                              );
                                            },
                                          ),
                                        IconButton(
                                          tooltip: 'Удалить участника из MLS-группы',
                                          icon: const Icon(Icons.person_remove_alt_1),
                                          onPressed: saving ? null : () async {
                                            Navigator.of(dialogContext).pop();
                                            await _removeMlsRoomMember(roomId, memberId);
                                          },
                                        ),
                                      ],
                                    )
                                  : null,
                            ),
                        ],
                      ),
                    ),
                    if (canRename) ...[
                      const SizedBox(height: 8),
                      TextField(
                        controller: controller,
                        maxLength: 100,
                        decoration: const InputDecoration(labelText: 'Название группы'),
                      ),
                    ],
                    if (errorMessage != null)
                      Text(errorMessage!, style: const TextStyle(color: Colors.red)),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  child: const Text('Закрыть'),
                ),
                if (currentUserId != null &&
                    (details.capabilities[currentUserId]?.contains('invite_members') ?? false))
                  TextButton(
                    onPressed: saving ? null : () async {
                      Navigator.of(dialogContext).pop();
                      await _showRoomJoinRequests(roomId);
                    },
                    child: const Text('Заявки'),
                  ),
                if (currentUserId != null &&
                    (details.capabilities[currentUserId]?.contains('invite_members') ?? false) &&
                    _session.hasNativeMlsSession)
                  TextButton(
                    onPressed: saving ? null : () async {
                      final invitee = await _promptMlsInvitee(
                        title: 'Пригласить в группу',
                        actionLabel: 'Пригласить',
                      );
                      if (invitee == null || invitee.trim().isEmpty || !mounted) return;
                      try {
                        await _session.inviteMlsMember(roomId, invitee.trim());
                        if (!mounted || !dialogContext.mounted) return;
                        Navigator.of(dialogContext).pop();
                        await _refreshActiveMlsChat();
                        _notice('MLS-приглашение отправлено. Новый участник получит доступ после обработки защищённого приглашения.');
                      } catch (error) {
                        if (dialogContext.mounted) {
                          setDialogState(() => errorMessage = _toFailure(error).message);
                        }
                      }
                    },
                    child: const Text('Пригласить участника'),
                  ),
                if (canRename || canEditSettings)
                  FilledButton(
                    onPressed: saving ? null : () async {
                      final newName = canRename ? controller.text.trim() : null;
                      if (canRename && (newName == null || newName.isEmpty || newName.length > 100)) {
                        setDialogState(() => errorMessage = 'Название должно содержать от 1 до 100 символов.');
                        return;
                      }
                      final nameChanged = canRename &&
                          newName != (details.name ?? _activeMlsRoomName);
                      final visibilityChanged = canEditSettings && visibility != details.visibility;
                      final joinPolicyChanged = canEditSettings && joinPolicy != details.joinPolicy;
                      if (!nameChanged && !visibilityChanged && !joinPolicyChanged) {
                        setDialogState(() => errorMessage = 'Изменений нет.');
                        return;
                      }
                      if (visibilityChanged) {
                        final makingPrivate = visibility == 'private';
                        final confirmed = await showDialog<bool>(
                          context: dialogContext,
                          builder: (confirmContext) => AlertDialog(
                            title: Text(makingPrivate
                                ? 'Сделать группу приватной?'
                                : 'Сделать группу публичной?'),
                            content: Text(makingPrivate
                                ? 'Сервер удалит ожидающие заявки на вступление.'
                                : 'Группа станет доступна в публичном поиске.'),
                            actions: [
                              TextButton(
                                onPressed: () => Navigator.of(confirmContext).pop(false),
                                child: const Text('Отмена'),
                              ),
                              FilledButton(
                                onPressed: () => Navigator.of(confirmContext).pop(true),
                                child: const Text('Продолжить'),
                              ),
                            ],
                          ),
                        );
                        if (confirmed != true || !dialogContext.mounted) return;
                      }
                      setDialogState(() {
                        saving = true;
                        errorMessage = null;
                      });
                      try {
                        await _repositories.updateRoomSettings(
                          roomId,
                          name: nameChanged ? newName : null,
                          visibility: visibilityChanged ? visibility : null,
                          joinPolicy: joinPolicyChanged ? joinPolicy : null,
                        );
                        if (!mounted || !dialogContext.mounted) return;
                        if (nameChanged) {
                          setState(() {
                            _activeMlsRoomName = newName!;
                            _mlsChats = _mlsChats.map((chat) => chat.id == roomId
                                ? InOneChatPreview(
                                    id: chat.id,
                                    name: newName,
                                    lastMessage: chat.lastMessage,
                                    time: chat.time,
                                    kind: chat.kind,
                                    unread: chat.unread,
                                    initials: chat.initials,
                                  )
                                : chat).toList(growable: false);
                          });
                        }
                        Navigator.of(dialogContext).pop();
                        _notice('Настройки группы обновлены на сервере.');
                      } catch (error) {
                        if (dialogContext.mounted) {
                          setDialogState(() => errorMessage = _toFailure(error).message);
                        }
                      } finally {
                        if (dialogContext.mounted) {
                          setDialogState(() => saving = false);
                        }
                      }
                    },
                    child: const Text('Сохранить'),
                  ),
              ],
            ),
          ),
        );
      } finally {
        controller.dispose();
      }
    } catch (error) {
      _notice('Не удалось загрузить параметры группы: ${_toFailure(error).message}');
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
      final messages = await _session.loadMlsRoomHistory(roomId);
      await _markMlsRoomReadAfterPersistence(roomId, messages);
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

  Future<List<InOneOrganizationMember>> _readOrganizationMembers(String orgId) =>
      _repositories.organizationMembers(orgId);

  Future<void> _refreshOrganizationMemberCount(InOneOrganization org) async {
    try {
      final members = await _readOrganizationMembers(org.orgId);
      if (!mounted || _selectedOrganization?.orgId != org.orgId) return;
      setState(() {
        _organizationMembers = members;
        _organizationMemberCount = members.length;
      });
    } catch (_) {
      // Keep the roster unknown when access is denied or the server is offline.
    }
  }

  Future<void> _addOrganizationMember() async {
    final org = _selectedOrganization;
    if (org == null || (org.role != 'owner' && org.role != 'admin')) return;
    final controller = TextEditingController();
    var role = 'member';
    try {
      final selection = await showDialog<({String userId, String role})>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
          builder: (context, setDialogState) => AlertDialog(
            title: const Text('Добавить участника'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: controller,
                  autofocus: true,
                  autocorrect: false,
                  decoration: const InputDecoration(labelText: 'ID пользователя'),
                ),
                if (org.role == 'owner')
                  DropdownButtonFormField<String>(
                    initialValue: role,
                    decoration: const InputDecoration(labelText: 'Роль'),
                    items: const [
                      DropdownMenuItem(value: 'member', child: Text('Участник')),
                      DropdownMenuItem(value: 'admin', child: Text('Администратор')),
                      DropdownMenuItem(value: 'owner', child: Text('Владелец')),
                    ],
                    onChanged: (value) {
                      if (value != null) setDialogState(() => role = value);
                    },
                  ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: const Text('Отмена'),
              ),
              FilledButton(
                onPressed: () {
                  final userId = controller.text.trim();
                  if (userId.isNotEmpty) {
                    Navigator.of(dialogContext).pop((userId: userId, role: role));
                  }
                },
                child: const Text('Добавить'),
              ),
            ],
          ),
        ),
      );
      if (selection == null) return;
      await _repositories.addOrganizationMember(
        org.orgId,
        userId: selection.userId,
        role: org.role == 'admin' ? 'member' : selection.role,
      );
      await _refreshOrganizationMemberCount(org);
      if (mounted) _notice('Участник добавлен в организацию.');
    } catch (error) {
      _notice('Не удалось добавить участника: ${_toFailure(error).message}');
    } finally {
      controller.dispose();
    }
  }

  Future<void> _changeOrganizationMemberRole(String userId, String role) async {
    final org = _selectedOrganization;
    if (org == null || org.role != 'owner') return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Изменить роль участника?'),
        content: Text('Назначить пользователю $userId роль «$role»?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Подтвердить'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await _repositories.updateOrganizationMemberRole(org.orgId, userId, role);
      if (userId == _session.userId && mounted) {
        final updated = InOneOrganization(
          orgId: org.orgId,
          name: org.name,
          status: org.status,
          role: role,
        );
        setState(() {
          _selectedOrganization = updated;
          _organizations = _organizations
              .map((item) => item.orgId == updated.orgId ? updated : item)
              .toList(growable: false);
        });
      }
      await _refreshOrganizationMemberCount(_selectedOrganization?.orgId == org.orgId
          ? _selectedOrganization!
          : org);
      if (mounted) _notice('Роль участника обновлена.');
    } catch (error) {
      _notice('Не удалось изменить роль: ${_toFailure(error).message}');
    }
  }

  Future<void> _removeOrganizationMember(String userId) async {
    final org = _selectedOrganization;
    if (org == null || userId == _session.userId) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Удалить участника?'),
        content: Text('Удалить $userId из организации? Сервер проверит права, владение комнатами и наличие других владельцев.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Удалить'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await _repositories.removeOrganizationMember(org.orgId, userId);
      await _refreshOrganizationMemberCount(org);
      if (mounted) _notice('Участник удалён из организации.');
    } catch (error) {
      _notice('Не удалось удалить участника: ${_toFailure(error).message}');
    }
  }

  Future<void> _showOrganizationAdminLog() async {
    final org = _selectedOrganization;
    if (org == null || (org.role != 'owner' && org.role != 'admin')) return;
    try {
      final actions = await _repositories.organizationAdminLog(org.orgId);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Журнал действий организации'),
          content: SizedBox(
            width: 460,
            height: 340,
            child: actions.isEmpty
                ? const Center(child: Text('Записей пока нет.'))
                : ListView(
                    children: [
                      for (final entry in actions.reversed)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(entry.action),
                          subtitle: Text([
                            entry.actor,
                            if (entry.target != null) entry.target!,
                            if (entry.detail != null) entry.detail!,
                          ].join(' · ')),
                          trailing: Text(
                            DateTime.fromMillisecondsSinceEpoch(entry.at)
                                .toLocal()
                                .toString()
                                .split('.')
                                .first,
                            style: const TextStyle(fontSize: 10),
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
          ],
        ),
      );
    } catch (error) {
      _notice('Не удалось загрузить журнал действий: ${_toFailure(error).message}');
    }
  }

  Future<void> _showOrganizationLinks() async {
    final org = _selectedOrganization;
    if (org == null || (org.role != 'owner' && org.role != 'admin')) return;
    List<InOneOrganizationLink> links;
    try {
      links = await _repositories.organizationLinks(org.orgId);
    } catch (error) {
      _notice('Не удалось загрузить связи организаций: ${_toFailure(error).message}');
      return;
    }
    if (!mounted) return;
    final targetController = TextEditingController();
    var busy = false;
    String? errorMessage;
    try {
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
          builder: (context, setDialogState) {
            Future<void> refresh() async {
              final updated = await _repositories.organizationLinks(org.orgId);
              if (dialogContext.mounted) setDialogState(() => links = updated);
            }

            Future<void> propose() async {
              final target = targetController.text.trim();
              if (target.isEmpty || target == org.orgId) {
                setDialogState(() => errorMessage = 'Укажите ID другой организации.');
                return;
              }
              setDialogState(() {
                busy = true;
                errorMessage = null;
              });
              try {
                await _repositories.proposeOrganizationLink(org.orgId, target);
                targetController.clear();
                await refresh();
              } catch (error) {
                if (dialogContext.mounted) {
                  setDialogState(() => errorMessage = _toFailure(error).message);
                }
              } finally {
                if (dialogContext.mounted) setDialogState(() => busy = false);
              }
            }

            Future<void> act(InOneOrganizationLink link, String action) async {
              final other = link.otherOrganization(org.orgId);
              final confirmed = await showDialog<bool>(
                context: dialogContext,
                builder: (confirmContext) => AlertDialog(
                  title: Text(action == 'accept' ? 'Принять связь?' : 'Отозвать связь?'),
                  content: Text('Организация: $other'),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.of(confirmContext).pop(false),
                      child: const Text('Отмена'),
                    ),
                    FilledButton(
                      onPressed: () => Navigator.of(confirmContext).pop(true),
                      child: const Text('Подтвердить'),
                    ),
                  ],
                ),
              );
              if (confirmed != true || !dialogContext.mounted) return;
              setDialogState(() {
                busy = true;
                errorMessage = null;
              });
              try {
                await _repositories.actOnOrganizationLink(org.orgId, link.linkId, action);
                await refresh();
              } catch (error) {
                if (dialogContext.mounted) {
                  setDialogState(() => errorMessage = _toFailure(error).message);
                }
              } finally {
                if (dialogContext.mounted) setDialogState(() => busy = false);
              }
            }

            return AlertDialog(
              title: const Text('Связи организаций'),
              content: SizedBox(
                width: 460,
                height: 360,
                child: Column(
                  children: [
                    TextField(
                      controller: targetController,
                      enabled: !busy,
                      decoration: const InputDecoration(
                        labelText: 'ID организации для связи',
                      ),
                    ),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(
                        onPressed: busy ? null : () => unawaited(propose()),
                        child: const Text('Предложить связь'),
                      ),
                    ),
                    if (errorMessage != null)
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Text(errorMessage!, style: const TextStyle(color: Colors.red)),
                      ),
                    Expanded(
                      child: links.isEmpty
                          ? const Center(child: Text('Связей организаций пока нет.'))
                          : ListView(
                              children: [
                                for (final link in links)
                                  ListTile(
                                    contentPadding: EdgeInsets.zero,
                                    title: Text(link.otherOrganization(org.orgId)),
                                    subtitle: Text(
                                      link.status == 'active'
                                          ? 'Активна'
                                          : link.status == 'revoked'
                                              ? 'Отозвана'
                                              : link.proposingOrg == org.orgId
                                                  ? 'Ожидает принятия другой стороной'
                                                  : 'Ожидает вашего решения',
                                    ),
                                    trailing: Wrap(
                                      spacing: 2,
                                      children: [
                                        if (link.status == 'proposed' && link.proposingOrg != org.orgId)
                                          TextButton(
                                            onPressed: busy ? null : () => unawaited(act(link, 'accept')),
                                            child: const Text('Принять'),
                                          ),
                                        if (link.status != 'revoked')
                                          TextButton(
                                            onPressed: busy ? null : () => unawaited(act(link, 'revoke')),
                                            child: const Text('Отозвать'),
                                          ),
                                      ],
                                    ),
                                  ),
                              ],
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
              ],
            );
          },
        ),
      );
    } finally {
      targetController.dispose();
    }
  }

  Future<void> _showOrganizationSettings() async {
    final org = _selectedOrganization;
    if (org == null) return;
    try {
      var settings = await _repositories.organizationSettings(org.orgId);
      if (!mounted) return;
      final canEdit = org.role == 'owner' || org.role == 'admin';
      final maxMembersController = TextEditingController(
        text: settings.maxGroupMembers?.toString() ?? '',
      );
      final quotaController = TextEditingController(
        text: settings.fileQuotaBytes?.toString() ?? '',
      );
      var channelsEnabled = settings.channelsEnabled;
      var saving = false;
      String? errorMessage;
      try {
        await showDialog<void>(
          context: context,
          builder: (dialogContext) => StatefulBuilder(
            builder: (context, setDialogState) {
              Future<void> save(String field, Object? value) async {
                setDialogState(() {
                  saving = true;
                  errorMessage = null;
                });
                try {
                  final updated = await _repositories.updateOrganizationSetting(
                    org.orgId,
                    field: field,
                    value: value,
                  );
                  if (!dialogContext.mounted) return;
                  setDialogState(() {
                    settings = updated;
                    channelsEnabled = updated.channelsEnabled;
                    maxMembersController.text = updated.maxGroupMembers?.toString() ?? '';
                    quotaController.text = updated.fileQuotaBytes?.toString() ?? '';
                  });
                  if (mounted) _notice('Настройки организации сохранены на сервере.');
                } catch (error) {
                  if (dialogContext.mounted) {
                    setDialogState(() {
                      errorMessage = _toFailure(error).message;
                      channelsEnabled = settings.channelsEnabled;
                    });
                  }
                } finally {
                  if (dialogContext.mounted) {
                    setDialogState(() => saving = false);
                  }
                }
              }

              Future<void> showLog() async {
                try {
                  final entries = await _repositories.organizationSettingsLog(org.orgId);
                  if (!dialogContext.mounted) return;
                  await showDialog<void>(
                    context: dialogContext,
                    builder: (logContext) => AlertDialog(
                      title: const Text('Журнал настроек'),
                      content: SizedBox(
                        width: 460,
                        height: 320,
                        child: entries.isEmpty
                            ? const Center(child: Text('Изменений пока нет.'))
                            : ListView(
                                children: [
                                  for (final entry in entries.reversed)
                                    ListTile(
                                      contentPadding: EdgeInsets.zero,
                                      title: Text(entry.field),
                                      subtitle: Text(
                                        '${entry.actor} · ${entry.oldValue ?? '—'} → ${entry.newValue ?? '—'}',
                                      ),
                                      trailing: Text(
                                        DateTime.fromMillisecondsSinceEpoch(entry.at)
                                            .toLocal()
                                            .toString()
                                            .split('.')
                                            .first,
                                        style: const TextStyle(fontSize: 10),
                                      ),
                                    ),
                                ],
                              ),
                      ),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.of(logContext).pop(),
                          child: const Text('Закрыть'),
                        ),
                      ],
                    ),
                  );
                } catch (error) {
                  if (dialogContext.mounted) {
                    setDialogState(() => errorMessage = _toFailure(error).message);
                  }
                }
              }

              return AlertDialog(
                title: const Text('Настройки организации'),
                content: SizedBox(
                  width: 460,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      TextField(
                        controller: maxMembersController,
                        enabled: canEdit && !saving,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          labelText: 'Максимум участников в группе',
                          helperText: 'Пустое значение — лимит платформы',
                        ),
                      ),
                      if (canEdit)
                        Align(
                          alignment: Alignment.centerRight,
                          child: TextButton(
                            onPressed: saving ? null : () {
                              final raw = maxMembersController.text.trim();
                              final value = raw.isEmpty ? null : int.tryParse(raw);
                              if (raw.isNotEmpty && (value == null || value < 2)) {
                                setDialogState(() => errorMessage = 'Введите целое число не меньше 2 или оставьте поле пустым.');
                                return;
                              }
                              unawaited(save('maxGroupMembers', value));
                            },
                            child: const Text('Сохранить лимит'),
                          ),
                        ),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Каналы организации'),
                        value: channelsEnabled,
                        onChanged: !canEdit || saving
                            ? null
                            : (value) {
                                setDialogState(() => channelsEnabled = value);
                                unawaited(save('channelsEnabled', value));
                              },
                      ),
                      TextField(
                        controller: quotaController,
                        enabled: canEdit && !saving,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          labelText: 'Квота файлов (байт)',
                          helperText: 'Пустое значение — значение по умолчанию',
                        ),
                      ),
                      if (canEdit)
                        Align(
                          alignment: Alignment.centerRight,
                          child: TextButton(
                            onPressed: saving ? null : () {
                              final raw = quotaController.text.trim();
                              final value = raw.isEmpty ? null : int.tryParse(raw);
                              if (raw.isNotEmpty && (value == null || value < 1)) {
                                setDialogState(() => errorMessage = 'Введите положительное целое число или оставьте поле пустым.');
                                return;
                              }
                              unawaited(save('fileQuotaBytes', value));
                            },
                            child: const Text('Сохранить квоту'),
                          ),
                        ),
                      if (errorMessage != null)
                        Text(errorMessage!, style: const TextStyle(color: Colors.red)),
                    ],
                  ),
                ),
                actions: [
                  if (canEdit)
                    TextButton(
                      onPressed: saving ? null : () => unawaited(showLog()),
                      child: const Text('Журнал изменений'),
                    ),
                  if (canEdit)
                    TextButton(
                      onPressed: saving ? null : () => unawaited(_showOrganizationLinks()),
                      child: const Text('Связи организаций'),
                    ),
                  if (canEdit)
                    TextButton(
                      onPressed: saving ? null : () => unawaited(_showOrganizationAdminLog()),
                      child: const Text('Журнал действий'),
                    ),
                  TextButton(
                    onPressed: () => Navigator.of(dialogContext).pop(),
                    child: const Text('Закрыть'),
                  ),
                ],
              );
            },
          ),
        );
      } finally {
        maxMembersController.dispose();
        quotaController.dispose();
      }
    } catch (error) {
      _notice('Не удалось загрузить настройки организации: ${_toFailure(error).message}');
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
      final members = await _readOrganizationMembers(org.orgId);
      if (!mounted || _selectedOrganization?.orgId != org.orgId) return;
      setState(() {
        _organizationMembers = members;
        _organizationMemberCount = members.length;
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
        _organizationMembers = const [];
        _screen = 'workspace';
      });
      unawaited(_refreshOrganizationMemberCount(selected));
    }
  }

  Future<void> _showDeviceManagement() async {
    List<InOneDevice> devices;
    try {
      devices = await _repositories.myDevices();
    } catch (error) {
      _notice('Не удалось загрузить устройства аккаунта: ${_toFailure(error).message}');
      return;
    }
    if (!mounted) return;
    final currentDeviceId = _session.deviceId;
    final revoking = <String>{};
    String? errorMessage;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) {
          Future<void> revoke(InOneDevice device) async {
            final confirmed = await showDialog<bool>(
              context: dialogContext,
              builder: (confirmContext) => AlertDialog(
                title: const Text('Отозвать устройство?'),
                content: Text('Устройство «${device.label?.isNotEmpty == true ? device.label : device.deviceId}» потеряет доступ к аккаунту, push и MLS-ключам.'),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.of(confirmContext).pop(false),
                    child: const Text('Отмена'),
                  ),
                  FilledButton(
                    onPressed: () => Navigator.of(confirmContext).pop(true),
                    child: const Text('Отозвать'),
                  ),
                ],
              ),
            );
            if (confirmed != true || !dialogContext.mounted) return;
            setDialogState(() {
              revoking.add(device.deviceId);
              errorMessage = null;
            });
            try {
              await _repositories.revokeDevice(device.deviceId);
              final updated = await _repositories.myDevices();
              if (!dialogContext.mounted) return;
              setDialogState(() => devices = updated);
            } catch (error) {
              if (dialogContext.mounted) {
                setDialogState(() => errorMessage = _toFailure(error).message);
              }
            } finally {
              if (dialogContext.mounted) {
                setDialogState(() => revoking.remove(device.deviceId));
              }
            }
          }

          return AlertDialog(
            title: const Text('Устройства аккаунта'),
            content: SizedBox(
              width: 460,
              height: 340,
              child: Column(
                children: [
                  Expanded(
                    child: devices.isEmpty
                        ? const Center(child: Text('Устройства не найдены.'))
                        : ListView(
                            children: [
                              for (final device in devices)
                                ListTile(
                                  contentPadding: EdgeInsets.zero,
                                  title: Text(
                                    device.label?.isNotEmpty == true ? device.label! : device.deviceId,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  subtitle: Text([
                                    if (device.deviceId == currentDeviceId) 'Это устройство',
                                    if (device.revoked) 'Доступ отозван',
                                    if (!device.revoked && device.pushRegistered) 'Push включён',
                                    if (!device.revoked && !device.pushRegistered) 'Push не зарегистрирован',
                                  ].join(' · ')),
                                  trailing: device.revoked
                                      ? const Text('Отозвано')
                                      : device.deviceId == currentDeviceId
                                          ? const Text('Текущее')
                                          : TextButton(
                                              onPressed: revoking.contains(device.deviceId)
                                                  ? null
                                                  : () => unawaited(revoke(device)),
                                              child: revoking.contains(device.deviceId)
                                                  ? const SizedBox(
                                                      width: 16,
                                                      height: 16,
                                                      child: CircularProgressIndicator(strokeWidth: 2),
                                                    )
                                                  : const Text('Отозвать'),
                                            ),
                                ),
                            ],
                          ),
                  ),
                  if (errorMessage != null)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Text(errorMessage!, style: const TextStyle(color: Colors.red)),
                    ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: const Text('Закрыть'),
              ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _chooseLocale() async {
    final selected = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Язык приложения'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            RadioGroup<String>(
              groupValue: _session.locale,
              onChanged: (value) => Navigator.of(dialogContext).pop(value),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final option in const [
                    ('hy', 'Հայերեն'),
                    ('ru', 'Русский'),
                    ('en', 'English'),
                  ])
                    RadioListTile<String>(
                      value: option.$1,
                      title: Text(option.$2),
                    ),
                ],
              ),
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

  Future<void> _refreshPinReminder() async {
    if (!_session.isAuthenticated) return;
    try {
      final state = await _session.pinStatus();
      if (!mounted) return;
      if (state['verificationRequired'] == true) {
        if (_screen == 'pinReset') return;
        setState(() {
          _pinLegacyFormat = state['legacy'] == true;
          _screen = _pinResetRequired || state['configured'] != true ? 'pinReset' : 'pinVerification';
          _pinResetReturnScreen = 'pinVerification';
          _pinReminderDue = false;
        });
        return;
      }
      setState(() {
        _pinReminderDue = state['reminderDue'] == true;
        _pinLegacyFormat = false;
        _pinResetRequired = false;
      });
    } catch (_) {
      // The backend remains authoritative and blocks protected APIs if verification is due.
    }
  }

  void _selectTab(InOneTab tab) {
    switch (tab) {
      case InOneTab.messages:
        setState(() => _screen = 'messages');
        return;
      case InOneTab.profile:
        setState(() => _screen = 'profile');
        unawaited(_refreshPinReminder());
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
          onCancelRecovery: () => setState(() {
            _cancelingAdmission = false;
            _screen = 'notYou';
          }),
          onSuccess: _afterLogin,
        );
      case 'loginWaiting':
        return InOneLoginWaitingScreen(
          activateAt: _waitingActivateAt,
          onRecheck: _recheckWaitingLogin,
          onNotMe: () => setState(() {
            _cancelingAdmission = true;
            _screen = 'notYou';
          }),
          onDone: _afterLogin,
        );
      case 'loginApproval':
        final approvalCode = _session.pendingApprovalCode;
        if (approvalCode == null) {
          return InOneLoadingErrorScreen(
            onRetry: () => unawaited(_login(_pendingLoginEmail, _pendingLoginPassword)),
          );
        }
        return InOneLoginWaitingScreen(
          activateAt: '',
          approvalCode: approvalCode,
          autoPoll: true,
          showNotMe: true,
          notMeLabel: 'Վերադառնալ մուտք',
          onRecheck: _claimPendingApproval,
          onNotMe: _leaveApprovalFlow,
          onDone: _afterLogin,
        );
      case 'identityCheck':
        return InOneEmailCodeScreen(
          title: 'Մուտքի հաստատում',
          codeLabel: 'Կոդը նամակից',
          showResend: true,
          resendLabel: 'Կրկին ուղարկել կոդը',
          onConfirm: _submitIdentityCode,
          onResend: _resendIdentityCode,
          onBack: () => setState(() {
            _pendingLoginEmail = '';
            _pendingLoginPassword = '';
            _pendingIdentityChallengeId = null;
            _screen = 'login';
          }),
          onDone: _afterLogin,
        );
      case 'recoveryConfirm':
        return InOneRecoveryConfirmScreen(
          onConfirm: _confirmRecoveryLink,
          onBack: _cancelPendingRecoveryLink,
          onDone: _finishRecoveryLinkConfirmation,
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
          onSubmit: _cancelingAdmission ? _cancelAdmissionByCode : _cancelRecoveryByCode,
          onBack: () => setState(() {
            _cancelingAdmission = false;
            _pendingLoginEmail = '';
            _pendingLoginPassword = '';
            _waitingActivateAt = '';
            _screen = 'login';
          }),
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
      case 'pinVerification':
        return InOnePinVerificationScreen(
          onSubmit: _verifyRecoveryPin,
          onForgotPin: _openPinReset,
          onLogout: () => setState(() => _screen = 'logout'),
          onDone: () => unawaited(_loadAuthenticatedData()),
          legacyPin: _pinLegacyFormat,
        );
      case 'pinReset':
        return InOnePinResetScreen(
          onStart: _startPinReset,
          onComplete: _completePinReset,
          onBack: () {
            if (_pinResetRequired) {
              setState(() => _screen = 'logout');
              return;
            }
            setState(() => _screen = _pinResetReturnScreen ?? 'profile');
            unawaited(_refreshPinReminder());
          },
          onDone: () => unawaited(_loadAuthenticatedData()),
        );
      case 'logout':
        return InOneLogoutScreen(
          onLogout: _logout,
          onCancel: () => setState(() => _screen = 'profile'),
          onDone: _finishLogout,
        );
      case 'adminRequestsLoading':
      case 'adminRequestLoading':
      case 'loading':
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      case 'loadError':
        return InOneLoadingErrorScreen(onRetry: () => unawaited(_loadAuthenticatedData()));
      case 'adminRequestsError':
        return InOneLoadingErrorScreen(onRetry: () => unawaited(_openAdminRequests()));
      case 'adminRequests':
        return InOneRequestsAdminScreen(
          requests: _adminRequests,
          onOpen: (request) => unawaited(_openAdminRequest(request)),
          onMenu: () => setState(() => _screen = 'profile'),
        );
      case 'adminRequestDetails':
        if (_selectedAdminRequest == null) {
          return InOneLoadingErrorScreen(onRetry: () => unawaited(_openAdminRequests()));
        }
        return InOneRequestAdminDetailsScreen(
          request: _selectedAdminRequest!,
          documents: _adminDocuments,
          isOwner: _profile?.canDecidePlatformRequests ?? false,
          onOpen: _openAdminDocument,
          onDecide: () => setState(() => _screen = 'adminRequestDecision'),
          onBack: () => unawaited(_openAdminRequests()),
          onMenu: () => setState(() => _screen = 'profile'),
        );
      case 'adminRequestDecision':
        if (_selectedAdminRequest == null || !(_profile?.canDecidePlatformRequests ?? false)) {
          return InOneLoadingErrorScreen(onRetry: () => unawaited(_openAdminRequests()));
        }
        return InOneRequestDecisionScreen(
          request: _selectedAdminRequest!,
          onDecision: _decideAdminRequest,
          onBack: () => setState(() => _screen = 'adminRequestDetails'),
          onMenu: () => setState(() => _screen = 'profile'),
          onDone: () {
            _notice('Решение по заявке сохранено.');
            unawaited(_openAdminRequests());
          },
        );
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
          onAdd: null,
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
          onMore: () => unawaited(_showOrganizationSettings()),
          onEditCover: null,
          onTab: _selectTab,
          onAdd: null,
          onAddMember: _organizationProfile.canAddMembers ? _addOrganizationMember : null,
          onChangeMemberRole: _organizationProfile.canChangeMemberRoles
              ? _changeOrganizationMemberRole
              : null,
          onRemoveMember: _organizationProfile.removableMemberIds.isNotEmpty
              ? _removeOrganizationMember
              : null,
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
          onSearch: () => unawaited(_discoverPublicRooms()),
          onTab: _selectTab,
          onAdd: _session.hasNativeMlsSession
              ? () => unawaited(_createMlsRoomAndInvite())
              : null,
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
          onMore: () => unawaited(_showMlsRoomDetails()),
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
            if (_profile?.canViewPlatformRequests == true)
              InOneProfileMenuItem(
                label: 'Заявки платформы',
                icon: Icons.admin_panel_settings_outlined,
                onTap: () => unawaited(_openAdminRequests()),
              ),
            InOneProfileMenuItem(
              label: 'Язык приложения · ${_session.locale.toUpperCase()}',
              icon: Icons.language,
              onTap: () => unawaited(_chooseLocale()),
            ),
            InOneProfileMenuItem(
              label: 'Устройства и безопасность',
              icon: Icons.devices_other_outlined,
              onTap: () => unawaited(_showDeviceManagement()),
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
          onAdd: null,
          pinReminderDue: _pinReminderDue,
          onPinRemember: _acknowledgePinReminder,
          onPinReplace: _openPinReset,
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
    if (_recoveryLinkInFlight || _pendingRecoveryLinkFingerprint == fingerprint) {
      return true;
    }

    // Opening a recovery URL only stages the secret in host memory. The
    // one-time POST is performed only after the user taps Continue on SC-08.
    _pendingRecoveryLinkPayload = payload;
    _pendingRecoveryLinkFingerprint = fingerprint;
    _recoveryLinkLocale = payload.locale;
    _recoveryEmail = '';
    _recoveryUserId = payload.userId;
    setState(() => _screen = 'recoveryConfirm');
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
