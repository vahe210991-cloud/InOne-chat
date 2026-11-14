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
    if (orgId is! String || name is! String || status is! String || role is! String) {
      throw const FormatException('Invalid organization response');
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
      throw const FormatException('Invalid organizations response');
    }
    return InOneOrganizationList(
      raw.map((item) {
        if (item is! Map) {
          throw const FormatException('Invalid organization item');
        }
        return InOneOrganization.fromJson(Map<String, dynamic>.from(item));
      }).toList(growable: false),
    );
  }
}
