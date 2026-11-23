import '../session/inone_session.dart';
import 'inone_device.dart';
import 'inone_organization.dart';
import 'inone_profile.dart';
import '../network/api_exception.dart';
import 'inone_room.dart';

/// Typed read repositories shared by approved screens and the test-screen host.
class InOneRepositories {
  const InOneRepositories(this.session);

  final InOneSession session;

  Future<Map<String, dynamic>> health() =>
      session.request('GET', '/healthz', authenticated: false);
  Future<Map<String, dynamic>> readiness() =>
      session.request('GET', '/readyz', authenticated: false);
  Future<InOneProfile> profile() async =>
      InOneProfile.fromJson(await session.request('GET', '/profile'));
  Future<Map<String, dynamic>> updateLocale(String locale) async {
    await session.setLocale(locale);
    return {'locale': session.locale};
  }
  Future<Map<String, dynamic>> myOrganizations() =>
      session.request('GET', '/orgs/mine');
  Future<List<InOneOrganizationMember>> organizationMembers(String orgId) async {
    final response = await session.request(
      'GET', '/orgs/${Uri.encodeComponent(orgId)}/members',
    );
    final raw = response['members'];
    if (raw is! List || raw.any((member) => member is! Map)) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
    return List<InOneOrganizationMember>.unmodifiable(raw.map((member) =>
        InOneOrganizationMember.fromJson(Map<String, dynamic>.from(member as Map))));
  }
  Future<InOneOrganizationSettings> organizationSettings(String orgId) async {
    final response = await session.request(
      'GET', '/orgs/${Uri.encodeComponent(orgId)}/settings',
    );
    final raw = response['settings'];
    if (raw is! Map) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
    return InOneOrganizationSettings.fromJson(Map<String, dynamic>.from(raw));
  }

  Future<InOneOrganizationSettings> updateOrganizationSetting(
    String orgId, {
    required String field,
    required Object? value,
  }) async {
    final valid = switch (field) {
      'maxGroupMembers' => value == null || value is int && value >= 2,
      'channelsEnabled' => value is bool,
      'fileQuotaBytes' => value == null || value is int && value >= 1,
      _ => false,
    };
    if (!valid) throw ArgumentError('Invalid organization setting value');
    final response = await session.request(
      'POST',
      '/orgs/${Uri.encodeComponent(orgId)}/settings',
      body: {'field': field, 'value': value},
    );
    final raw = response['settings'];
    if (raw is! Map) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
    return InOneOrganizationSettings.fromJson(Map<String, dynamic>.from(raw));
  }

  Future<List<InOneOrganizationAdminAction>> organizationAdminLog(String orgId) async {
    final response = await session.request(
      'GET', '/orgs/${Uri.encodeComponent(orgId)}/admin-log',
    );
    final raw = response['actions'];
    if (raw is! List || raw.any((entry) => entry is! Map)) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
    return List<InOneOrganizationAdminAction>.unmodifiable(raw.map((entry) =>
        InOneOrganizationAdminAction.fromJson(Map<String, dynamic>.from(entry as Map))));
  }

  Future<List<InOneOrganizationLink>> organizationLinks(String orgId) async {
    final response = await session.request(
      'GET', '/orgs/${Uri.encodeComponent(orgId)}/links',
    );
    final raw = response['links'];
    if (raw is! List || raw.any((entry) => entry is! Map)) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
    return List<InOneOrganizationLink>.unmodifiable(raw.map((entry) =>
        InOneOrganizationLink.fromJson(Map<String, dynamic>.from(entry as Map))));
  }

  Future<void> proposeOrganizationLink(String orgId, String targetOrgId) async {
    final target = targetOrgId.trim();
    if (target.isEmpty || target == orgId) {
      throw ArgumentError.value(targetOrgId, 'targetOrgId');
    }
    final response = await session.request(
      'POST',
      '/orgs/${Uri.encodeComponent(orgId)}/links',
      body: {'targetOrgId': target},
    );
    if (response['status'] != 'proposed' || response['linkId'] is! String) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
  }

  Future<void> actOnOrganizationLink(
    String orgId,
    String linkId,
    String action,
  ) async {
    if (!const {'accept', 'revoke'}.contains(action)) {
      throw ArgumentError.value(action, 'action');
    }
    final response = await session.request(
      'POST',
      '/orgs/${Uri.encodeComponent(orgId)}/links/${Uri.encodeComponent(linkId)}/$action',
    );
    final expected = action == 'accept' ? 'active' : 'revoked';
    if (response['status'] != expected) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
  }

  Future<List<InOneOrganizationSettingLogEntry>> organizationSettingsLog(String orgId) async {
    final response = await session.request(
      'GET', '/orgs/${Uri.encodeComponent(orgId)}/settings/log',
    );
    final raw = response['log'];
    if (raw is! List || raw.any((entry) => entry is! Map)) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
    return List<InOneOrganizationSettingLogEntry>.unmodifiable(raw.map((entry) =>
        InOneOrganizationSettingLogEntry.fromJson(Map<String, dynamic>.from(entry as Map))));
  }

  Future<void> addOrganizationMember(
    String orgId, {
    required String userId,
    String role = 'member',
  }) async {
    if (userId.trim().isEmpty || !const {'owner', 'admin', 'member'}.contains(role)) {
      throw ArgumentError('A valid user ID and organization role are required');
    }
    final response = await session.request(
      'POST',
      '/orgs/${Uri.encodeComponent(orgId)}/members',
      body: {'userId': userId.trim(), 'role': role},
    );
    if (response['userId'] != userId.trim() || response['role'] != role) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
  }

  Future<void> updateOrganizationMemberRole(
    String orgId,
    String userId,
    String role,
  ) async {
    if (!const {'owner', 'admin', 'member'}.contains(role)) {
      throw ArgumentError.value(role, 'role');
    }
    final response = await session.request(
      'POST',
      '/orgs/${Uri.encodeComponent(orgId)}/members/${Uri.encodeComponent(userId)}/role',
      body: {'role': role},
    );
    if (response['userId'] != userId || response['role'] != role) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
  }

  Future<void> removeOrganizationMember(String orgId, String userId) async {
    final response = await session.request(
      'DELETE',
      '/orgs/${Uri.encodeComponent(orgId)}/members/${Uri.encodeComponent(userId)}',
    );
    if (response['removed'] != true) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
  }

  Future<List<InOneDevice>> myDevices() async =>
      InOneDeviceList.fromJson(await session.request('GET', '/devices/mine')).devices;

  Future<void> revokeDevice(String deviceId) async {
    if (deviceId.trim().isEmpty) {
      throw ArgumentError.value(deviceId, 'deviceId');
    }
    final response = await session.request(
      'DELETE', '/devices/${Uri.encodeComponent(deviceId)}',
    );
    if (response['ok'] != true) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
  }
  /// Returns the validated room-list DTO for the authenticated account.
  Future<InOneRoomList> myRooms() async =>
      InOneRoomList.fromJson(await session.request('GET', '/rooms/mine'));
  /// Searches only public rooms; the backend enforces the 2–50 character range.
  Future<List<InOnePublicRoom>> searchPublicRooms(String query) async {
    final normalized = query.trim();
    if (normalized.length < 2 || normalized.length > 50) {
      throw ArgumentError.value(query, 'query', 'Search must contain 2 to 50 characters');
    }
    final response = await session.request(
      'GET', '/rooms/search?q=${Uri.encodeQueryComponent(normalized)}',
    );
    return InOnePublicRoomSearch.fromJson(response).rooms;
  }

  /// Joins an open public room or creates a join request for approval-only rooms.
  Future<String> joinPublicRoom(String roomId) async {
    final response = await session.request(
      'POST', '/rooms/${Uri.encodeComponent(roomId)}/join',
    );
    final status = response['status'];
    if (status != 'joined' && status != 'requested') {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
    return status as String;
  }
  
  Future<InOneRoomDetails> roomDetails(String roomId) async =>
      InOneRoomDetails.fromJson(await session.request(
        'GET', '/rooms/${Uri.encodeComponent(roomId)}/members',
      ));

  Future<void> updateRoomName(String roomId, String name) async {
    final normalized = name.trim();
    if (normalized.isEmpty || normalized.length > 100) {
      throw ArgumentError.value(name, 'name', 'Room name must contain 1 to 100 characters');
    }
    await session.request(
      'POST',
      '/rooms/${Uri.encodeComponent(roomId)}/settings',
      body: {'name': normalized},
    );
  }
  Future<void> markRoomRead(String roomId, String upToEventId) async {
    final prefix = String.fromCharCode(36);
    final sequence = upToEventId.startsWith(prefix) && upToEventId.length > 1
        ? int.tryParse(upToEventId.substring(1))
        : null;
    if (sequence == null || sequence < 0) {
      throw ArgumentError.value(upToEventId, 'upToEventId', 'Expected a server event ID');
    }
    await session.request(
      'POST',
      '/rooms/${Uri.encodeComponent(roomId)}/read',
      body: {'upTo': upToEventId},
    );
  }

  Future<Map<String, dynamic>> loginApprovals() =>
      session.request('GET', '/approvals');
  Future<Map<String, dynamic>> organizationRequests() =>
      session.request('GET', '/org-requests');
  Future<Map<String, dynamic>> publicConfig() =>
      session.request('GET', '/config/public', authenticated: false);

  Future<Map<String, dynamic>> get(
    String path, {
    bool authenticated = true,
  }) =>
      session.request('GET', path, authenticated: authenticated);
}
).hasMatch(upToEventId)) {
      throw ArgumentError.value(upToEventId, 'upToEventId', 'Expected a server event ID');
    }
    await session.request(
      'POST',
      '/rooms/${Uri.encodeComponent(roomId)}/read',
      body: {'upTo': upToEventId},
    );
  }

  Future<Map<String, dynamic>> loginApprovals() =>
      session.request('GET', '/approvals');
  Future<Map<String, dynamic>> organizationRequests() =>
      session.request('GET', '/org-requests');
  Future<Map<String, dynamic>> publicConfig() =>
      session.request('GET', '/config/public', authenticated: false);

  Future<Map<String, dynamic>> get(
    String path, {
    bool authenticated = true,
  }) =>
      session.request('GET', path, authenticated: authenticated);
}
