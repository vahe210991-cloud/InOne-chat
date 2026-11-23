import '../network/api_exception.dart';

class InOneOrganization {
  const InOneOrganization({
    required this.orgId,
    required this.name,
    required this.status,
    required this.role,
  });

  final String orgId;
  final String name;
  final String status;
  final String role;

  factory InOneOrganization.fromJson(Map<String, dynamic> json) {
    final orgId = json['orgId'];
    final name = json['name'];
    final status = json['status'];
    final role = json['role'];
    if (orgId is! String || orgId.isEmpty || name is! String || status is! String || role is! String) {
      throw const ApiException(code: 'invalid_response', statusCode: 502, retryable: false);
    }
    return InOneOrganization(
      orgId: orgId,
      name: name,
      status: status,
      role: role,
    );
  }
}

class InOneOrganizationList {
  const InOneOrganizationList(this.orgs);

  final List<InOneOrganization> orgs;

  factory InOneOrganizationList.fromJson(Map<String, dynamic> json) {
    final raw = json['orgs'];
    if (raw is! List) {
      throw const ApiException(code: 'invalid_response', statusCode: 502, retryable: false);
    }
    return InOneOrganizationList(
      raw.map((item) {
        if (item is! Map) {
          throw const ApiException(code: 'invalid_response', statusCode: 502, retryable: false);
        }
        return InOneOrganization.fromJson(Map<String, dynamic>.from(item));
      }).toList(growable: false),
    );
  }
}


/// A member returned by the authenticated organization roster endpoint.
class InOneOrganizationMember {
  const InOneOrganizationMember({required this.userId, required this.role});

  final String userId;
  final String role;

  factory InOneOrganizationMember.fromJson(Map<String, dynamic> json) {
    final userId = json['userId'];
    final role = json['role'];
    if (userId is! String || userId.trim().isEmpty ||
        role is! String || !const {'owner', 'admin', 'member'}.contains(role)) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
    return InOneOrganizationMember(userId: userId, role: role);
  }
}


class InOneOrganizationSettings {
  const InOneOrganizationSettings({
    required this.maxGroupMembers,
    required this.channelsEnabled,
    required this.fileQuotaBytes,
  });

  final int? maxGroupMembers;
  final bool channelsEnabled;
  final int? fileQuotaBytes;

  factory InOneOrganizationSettings.fromJson(Map<String, dynamic> json) {
    final maxGroupMembers = json['maxGroupMembers'];
    final channelsEnabled = json['channelsEnabled'];
    final fileQuotaBytes = json['fileQuotaBytes'];
    if (maxGroupMembers != null && (maxGroupMembers is! int || maxGroupMembers < 2) ||
        channelsEnabled is! bool ||
        fileQuotaBytes != null && (fileQuotaBytes is! int || fileQuotaBytes < 1)) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
    return InOneOrganizationSettings(
      maxGroupMembers: maxGroupMembers as int?,
      channelsEnabled: channelsEnabled,
      fileQuotaBytes: fileQuotaBytes as int?,
    );
  }
}

class InOneOrganizationSettingLogEntry {
  const InOneOrganizationSettingLogEntry({
    required this.actor,
    required this.field,
    required this.oldValue,
    required this.newValue,
    required this.at,
  });

  final String actor;
  final String field;
  final Object? oldValue;
  final Object? newValue;
  final int at;

  factory InOneOrganizationSettingLogEntry.fromJson(Map<String, dynamic> json) {
    final actor = json['actor'];
    final field = json['field'];
    final at = json['at'];
    if (actor is! String || field is! String || at is! num || !at.isFinite || at < 0) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
    return InOneOrganizationSettingLogEntry(
      actor: actor,
      field: field,
      oldValue: json['old'],
      newValue: json['new'],
      at: at.toInt(),
    );
  }
}


class InOneOrganizationLink {
  const InOneOrganizationLink({
    required this.linkId,
    required this.orgA,
    required this.orgB,
    required this.status,
    required this.proposingOrg,
  });

  final String linkId;
  final String orgA;
  final String orgB;
  final String status;
  final String proposingOrg;

  String otherOrganization(String currentOrgId) =>
      orgA == currentOrgId ? orgB : orgA;

  factory InOneOrganizationLink.fromJson(Map<String, dynamic> json) {
    final linkId = json['linkId'];
    final orgA = json['orgA'];
    final orgB = json['orgB'];
    final status = json['status'];
    final proposingOrg = json['proposingOrg'];
    if (linkId is! String || linkId.isEmpty ||
        orgA is! String || orgA.isEmpty ||
        orgB is! String || orgB.isEmpty ||
        status is! String || !const {'proposed', 'active', 'revoked'}.contains(status) ||
        proposingOrg is! String || proposingOrg.isEmpty) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
    return InOneOrganizationLink(
      linkId: linkId,
      orgA: orgA,
      orgB: orgB,
      status: status,
      proposingOrg: proposingOrg,
    );
  }
}
