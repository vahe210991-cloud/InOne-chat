import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/data/inone_organization.dart';
import 'package:inone_mobile/core/network/api_exception.dart';

void main() {
  test('parses organization membership response from the backend', () {
    final orgs = InOneOrganizationList.fromJson({
      'orgs': [
        {
          'orgId': 'org-opaque-1',
          'name': 'North Workspace',
          'status': 'approved',
          'role': 'admin',
        },
      ],
    }).orgs;

    expect(orgs, hasLength(1));
    expect(orgs.single.orgId, 'org-opaque-1');
    expect(orgs.single.name, 'North Workspace');
    expect(orgs.single.status, 'approved');
    expect(orgs.single.role, 'admin');
  });

  test('accepts an empty organization list', () {
    expect(InOneOrganizationList.fromJson({'orgs': []}).orgs, isEmpty);
  });

  test('rejects an invalid organization envelope', () {
    expect(
      () => InOneOrganizationList.fromJson({'items': []}),
      throwsA(isA<ApiException>().having(
        (error) => error.code,
        'code',
        'invalid_response',
      )),
    );
  });

  test('rejects missing or invalid membership fields', () {
    expect(
      () => InOneOrganization.fromJson({
        'orgId': '',
        'name': 'Broken',
        'status': 'approved',
        'role': 'member',
      }),
      throwsA(isA<ApiException>()),
    );
    expect(
      () => InOneOrganization.fromJson({
        'orgId': 'org-1',
        'name': 'Broken',
        'status': 'approved',
      }),
      throwsA(isA<ApiException>()),
    );
  });
}
