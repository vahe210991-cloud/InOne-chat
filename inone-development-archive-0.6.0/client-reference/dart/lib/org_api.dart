// HTTP-клиент организаций (ORG_API.md). НЕ ПРОВЕРЕНО.
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'org_errors.dart';
import 'org_models.dart';

class OrgApi {
  OrgApi({required this.baseUrl, required this.token, http.Client? client})
      : _client = client ?? http.Client();

  final String baseUrl;
  final String token;
  final http.Client _client;

  Map<String, String> get _headers => {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      };

  /// Организации текущего пользователя: только свои членства.
  Future<List<UserOrg>> myOrgs() async {
    final res = await _client.get(Uri.parse('$baseUrl/orgs/mine'), headers: _headers);
    _check(res);
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    final list = body['orgs'] as List<dynamic>;
    return list.map((e) => UserOrg.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Выход из организации; сервер вернёт ошибку, если есть комнаты или это последний владелец.
  Future<void> leave(String orgId) async {
    final res = await _client.post(
      Uri.parse('$baseUrl/orgs/${Uri.encodeComponent(orgId)}/leave'),
      headers: _headers,
      body: '{}',
    );
    _check(res);
  }

  void _check(http.Response res) {
    if (res.statusCode >= 200 && res.statusCode < 300) return;
    throw OrgError.fromResponse(res.statusCode, res.body);
  }
}
