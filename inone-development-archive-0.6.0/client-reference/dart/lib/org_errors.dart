// Ошибки организаций для показа пользователю (ORG_API.md, шаг 5.9). НЕ ПРОВЕРЕНО: нет Dart SDK в среде.
import 'dart:convert';

enum OrgErrorCode {
  orgNotFound,
  orgNotApproved,
  orgNotMember,
  orgRoleRequired,
  lastOwner,
  ownsRooms,
  linkExists,
  linkOwnSide,
  notPlatformOwner,
  orgChannelsDisabled,
  orgQuotaExceeded,
  groupFull,
  unknown,
}

class OrgError implements Exception {
  OrgError(this.code, this.status, this.serverText);

  final OrgErrorCode code;
  final int status;
  final String serverText;

  /// Ключ сообщения для локализации (ORG_API.md).
  String get messageKey {
    switch (code) {
      case OrgErrorCode.orgNotFound:
        return 'org.error.not_found';
      case OrgErrorCode.orgNotApproved:
        return 'org.error.not_approved';
      case OrgErrorCode.orgNotMember:
        return 'org.error.not_member';
      case OrgErrorCode.orgRoleRequired:
        return 'org.error.role_required';
      case OrgErrorCode.lastOwner:
        return 'org.error.last_owner';
      case OrgErrorCode.ownsRooms:
        return 'org.error.owns_rooms';
      case OrgErrorCode.linkExists:
        return 'org.error.link_exists';
      case OrgErrorCode.linkOwnSide:
        return 'org.error.link_own_side';
      case OrgErrorCode.notPlatformOwner:
        return 'org.error.not_platform_owner';
      case OrgErrorCode.orgChannelsDisabled:
        return 'org.error.channels_disabled';
      case OrgErrorCode.orgQuotaExceeded:
        return 'org.error.quota_exceeded';
      case OrgErrorCode.groupFull:
        return 'org.error.group_full';
      case OrgErrorCode.unknown:
        return 'org.error.unknown';
    }
  }

  /// Текст по умолчанию на русском, пока локализация не подключена.
  String get defaultMessage => _defaultMessages[messageKey] ?? 'Что-то пошло не так. Попробуйте позже.';

  /// Разбор ответа сервера: статус HTTP и тело с полями error и code.
  factory OrgError.fromResponse(int status, String body) {
    var code = '';
    var text = body;
    try {
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) {
        code = (decoded['code'] as String?) ?? '';
        text = (decoded['error'] as String?) ?? body;
      }
    } catch (_) {
      // Тело не JSON: оставляем текст как есть.
    }
    return OrgError(_codeFrom(code, text), status, text);
  }
}

OrgErrorCode _codeFrom(String code, String text) {
  switch (code) {
    case 'org_not_found':
      return OrgErrorCode.orgNotFound;
    case 'org_not_approved':
      return OrgErrorCode.orgNotApproved;
    case 'org_not_member':
      return OrgErrorCode.orgNotMember;
    case 'org_role_required':
      return OrgErrorCode.orgRoleRequired;
    case 'last_owner':
      return OrgErrorCode.lastOwner;
    case 'owns_rooms':
      return OrgErrorCode.ownsRooms;
    case 'link_exists':
      return OrgErrorCode.linkExists;
    case 'link_own_side':
      return OrgErrorCode.linkOwnSide;
    case 'not_platform_owner':
      return OrgErrorCode.notPlatformOwner;
    case 'org_channels_disabled':
      return OrgErrorCode.orgChannelsDisabled;
    case 'org_quota_exceeded':
      return OrgErrorCode.orgQuotaExceeded;
  }
  if (text == 'group is full') return OrgErrorCode.groupFull;
  return OrgErrorCode.unknown;
}

const Map<String, String> _defaultMessages = {
  'org.error.not_found': 'Организация не найдена.',
  'org.error.not_approved': 'Организация ещё не одобрена.',
  'org.error.not_member': 'Вы не участник этой организации.',
  'org.error.role_required': 'Это может сделать владелец или администратор организации.',
  'org.error.last_owner': 'Нельзя понизить или удалить последнего владельца.',
  'org.error.owns_rooms': 'Сначала передайте комнаты, которыми вы владеете.',
  'org.error.link_exists': 'Связь с этой организацией уже есть.',
  'org.error.link_own_side': 'Связь принимает другая сторона.',
  'org.error.not_platform_owner': 'Решение принимает владелец платформы.',
  'org.error.channels_disabled': 'В организации отключены каналы.',
  'org.error.quota_exceeded': 'Превышена квота хранения организации.',
  'org.error.group_full': 'Группа достигла лимита участников.',
  'org.error.unknown': 'Что-то пошло не так. Попробуйте позже.',
};
