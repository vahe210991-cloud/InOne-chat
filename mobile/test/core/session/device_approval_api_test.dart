import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:inone_mobile/core/session/inone_session.dart';

InOneSession makeSession(http.Client client) => InOneSession(
      baseUrl: 'https://api.inone.test',
      httpClient: client,
      readDeviceId: () async => 'device-new',
      writeDeviceId: (_) async {},
      readMlsUserId: () async => null,
      writeMlsUserId: (_) async {},
      deleteMlsUserId: () async {},
      readLocale: () async => 'hy',
      writeLocale: (_) async {},
      readLocaleSyncPending: () async => 'false',
      writeLocaleSyncPending: (_) async {},
    );

void main() {
  test('login keeps approval ID and poll secret inside the session host', () async {
    final client = MockClient((request) async {
      expect(request.method, 'POST');
      expect(request.url.path, '/login');
      return http.Response(
        jsonEncode({
          'status': 'approval_required',
          'approvalId': 'approval-1',
          'pollSecret': 'poll-secret-never-returned',
          'code': '482913',
        }),
        202,
      );
    });
    final session = makeSession(client);

    final result = await session.login(
      email: 'person@example.test',
      password: 'correct horse battery staple',
    );

    expect(result, {'status': 'approval_required'});
    expect(jsonEncode(result), isNot(contains('poll-secret-never-returned')));
    expect(jsonEncode(result), isNot(contains('approval-1')));
    expect(session.pendingApprovalCode, '482913');
    expect(session.hasPendingApproval, isTrue);
    expect(session.isAuthenticated, isFalse);

    session.dispose();
    client.close();
  });

  test('claim polling retains pending secret and consumes it after approval', () async {
    var claimCalls = 0;
    final client = MockClient((request) async {
      if (request.url.path == '/login') {
        return http.Response(
          jsonEncode({
            'status': 'approval_required',
            'approvalId': 'approval-2',
            'pollSecret': 'poll-secret-2',
            'code': '123456',
          }),
          202,
        );
      }
      if (request.url.path == '/approvals/approval-2/claim') {
        expect(request.method, 'POST');
        expect(request.headers['authorization'], isNull);
        expect(jsonDecode(request.body), {'pollSecret': 'poll-secret-2'});
        claimCalls++;
        if (claimCalls == 1) {
          return http.Response(jsonEncode({'status': 'pending'}), 200);
        }
        return http.Response(
          jsonEncode({
            'status': 'approved',
            'token': 'access-after-approval',
            'refreshToken': 'refresh-after-approval',
            'deviceId': 'device-new',
          }),
          200,
        );
      }
      if (request.url.path == '/profile') {
        return http.Response(jsonEncode({'locale': 'hy'}), 200);
      }
      return http.Response(jsonEncode({'error': 'unexpected_route'}), 404);
    });
    final session = makeSession(client);

    await session.login(
      email: 'person@example.test',
      password: 'correct horse battery staple',
    );
    final pending = await session.claimPendingApproval();
    expect(pending, {'status': 'pending'});
    expect(session.hasPendingApproval, isTrue);
    expect(session.isAuthenticated, isFalse);

    final approved = await session.claimPendingApproval();
    expect(approved, {'status': 'approved'});
    expect(session.hasPendingApproval, isFalse);
    expect(session.pendingApprovalCode, isNull);
    expect(session.isAuthenticated, isTrue);
    expect(claimCalls, 2);

    session.dispose();
    client.close();
  });

  test('login sends the post-recovery identity code without returning credentials', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      if (request.url.path == '/login') {
        expect(jsonDecode(request.body), containsPair('identityCode', '654321'));
        expect(jsonDecode(request.body), containsPair('identityChallengeId', 'challenge-1'));
        return http.Response(
          jsonEncode({
            'token': 'identity-access',
            'refreshToken': 'identity-refresh',
            'deviceId': 'device-new',
          }),
          200,
        );
      }
      if (request.url.path == '/profile') {
        return http.Response(jsonEncode({'locale': 'hy'}), 200);
      }
      return http.Response('{}', 404);
    });
    final session = makeSession(client);

    final result = await session.login(
      email: 'person@example.test',
      password: 'correct horse battery staple',
      identityCode: ' 654321 ',
      identityChallengeId: 'challenge-1',
    );

    expect(result.containsKey('token'), isFalse);
    expect(result.containsKey('refreshToken'), isFalse);
    expect(session.isAuthenticated, isTrue);
    expect(requests.map((request) => request.url.path), ['/login', '/profile']);

    session.dispose();
    client.close();
  });

  test('trusted device lists, approves and denies pending sign-in requests', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      if (request.url.path == '/login') {
        return http.Response(
          jsonEncode({
            'token': 'trusted-access',
            'refreshToken': 'trusted-refresh',
            'deviceId': 'device-old',
          }),
          200,
        );
      }
      if (request.url.path == '/profile') {
        return http.Response(jsonEncode({'locale': 'hy'}), 200);
      }
      if (request.url.path == '/approvals' && request.method == 'GET') {
        return http.Response(
          jsonEncode({
            'approvals': [
              {
                'id': 'approval-3',
                'label': 'New phone',
                'platform': 'ios',
                'createdAt': '2026-11-26T18:00:00.000Z',
                'expiresAt': '2026-11-26T18:10:00.000Z',
              },
            ],
          }),
          200,
        );
      }
      if (request.url.path == '/approvals/approval-3/approve' ||
          request.url.path == '/approvals/approval-3/deny') {
        expect(request.headers['authorization'], 'Bearer trusted-access');
        return http.Response(jsonEncode({'ok': true}), 200);
      }
      return http.Response('{}', 404);
    });
    final session = makeSession(client);

    await session.login(
      email: 'person@example.test',
      password: 'correct horse battery staple',
    );
    final approvals = await session.pendingDeviceApprovals();
    expect(approvals, hasLength(1));
    expect(approvals.single['label'], 'New phone');

    await session.approvePendingDevice(
      approvalId: 'approval-3',
      code: '112233',
    );
    await session.denyPendingDevice(approvalId: 'approval-3');

    final approveRequest = requests.firstWhere(
      (request) => request.url.path.endsWith('/approve'),
    );
    expect(jsonDecode(approveRequest.body), {'code': '112233'});
    final denyRequest = requests.firstWhere(
      (request) => request.url.path.endsWith('/deny'),
    );
    expect(jsonDecode(denyRequest.body), isEmpty);

    session.dispose();
    client.close();
  });
}
