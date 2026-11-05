// Организация пользователя (ответ GET /orgs/mine). НЕ ПРОВЕРЕНО.
class UserOrg {
  const UserOrg({required this.orgId, required this.name, required this.status, required this.role});

  final String orgId;
  final String name;
  /// pending, approved или rejected.
  final String status;
  /// owner, admin или member.
  final String role;

  factory UserOrg.fromJson(Map<String, dynamic> json) => UserOrg(
        orgId: json['orgId'] as String,
        name: json['name'] as String,
        status: json['status'] as String,
        role: json['role'] as String,
      );
}
