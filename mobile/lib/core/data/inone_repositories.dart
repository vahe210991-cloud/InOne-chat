import '../network/api_exception.dart';
import '../session/inone_session.dart';
import 'inone_profile.dart';

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

  /// Returns only rooms the authenticated account currently belongs to.
  /// The response is validated here so UI code never has to trust raw JSON.
  Future<List<InOneRoom>> myRooms() async {
    final response = await session.request('GET', '/rooms/mine');
    final rawRooms = response['rooms'];
    if (rawRooms is! List) {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 502,
        retryable: false,
      );
    }

    try {
      return rawRooms
          .map((raw) {
            if (raw is! Map) throw const FormatException('room must be an object');
            return InOneRoom.fromJson(Map<String, dynamic>.from(raw));
          })
          .toList(growable: false);
    } on FormatException {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 502,
        retryable: false,
      );
    } on TypeError {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 502,
        retryable: false,
      );
    }
  }

  Future<Map<String, dynamic>> myOrganizations() =>
      session.request('GET', '/orgs/mine');
  Future<Map<String, dynamic>> myDevices() =>
      session.request('GET', '/devices/mine');
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

/// Verified DTO for GET /rooms/mine.
class InOneRoom {
  const InOneRoom({
    required this.roomId,
    required this.kind,
    required this.role,
    this.name,
  });

  final String roomId;
  final String kind;
  final String role;
  final String? name;

  factory InOneRoom.fromJson(Map<String, dynamic> json) {
    final roomId = json['roomId'];
    final kind = json['kind'];
    final role = json['role'];
    final name = json['name'];
    if (roomId is! String ||
        roomId.trim().isEmpty ||
        kind is! String ||
        kind.trim().isEmpty ||
        role is! String ||
        role.trim().isEmpty ||
        (name != null && name is! String)) {
      throw const FormatException('invalid room DTO');
    }
    return InOneRoom(
      roomId: roomId,
      kind: kind,
      role: role,
      name: name as String?,
    );
  }
}
