import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:inone_mobile/core/network/api_client.dart';
import 'package:inone_mobile/core/network/api_exception.dart';

void main() {
  test('allows HTTPS API origins', () {
    final client = ApiClient(
      baseUrl: 'https://api.inone.test',
      accessTokenProvider: () => null,
    );
    client.close();
  });

  test('allows private HTTP endpoints in debug builds', () {
    final client = ApiClient(
      baseUrl: 'http://10.0.2.2:8080',
      accessTokenProvider: () => null,
    );
    client.close();
  });

  test('rejects public HTTP endpoints before sending credentials', () {
    expect(
      () => ApiClient(
        baseUrl: 'http://api.inone.test',
        accessTokenProvider: () => 'secret-token',
      ),
      throwsArgumentError,
    );
  });

  test('rejects credentials and query strings in the API origin', () {
    expect(
      () => ApiClient(
        baseUrl: 'https://user:password@api.inone.test',
        accessTokenProvider: () => null,
      ),
      throwsArgumentError,
    );
    expect(
      () => ApiClient(
        baseUrl: 'https://api.inone.test?token=secret',
        accessTokenProvider: () => null,
      ),
      throwsArgumentError,
    );
  });

  test('sends bearer token and decodes JSON response', () async {
    final mock = MockClient((request) async {
      expect(request.method, 'GET');
      expect(request.url.path, '/profile');
      expect(request.headers['authorization'], 'Bearer access-token');
      expect(request.followRedirects, isFalse);
      return http.Response(
          '{"userId":"user-1","nickname":"Test User","email":"user@example.test","verificationLevel":1,"providers":[],"backupEmail":null,"securityHints":[]}',
          200,
          headers: {'content-type': 'application/json'});
    });
    final client = ApiClient(
      baseUrl: 'https://api.inone.test',
      accessTokenProvider: () => 'access-token',
      httpClient: mock,
    );

    final response = await client.get('/profile');
    expect(response['userId'], 'user-1');
    client.close();
  });

  test('public request does not require or send an access token', () async {
    final mock = MockClient((request) async {
      expect(request.headers.containsKey('authorization'), isFalse);
      return http.Response('{"status":"ok"}', 200);
    });
    final client = ApiClient(
      baseUrl: 'https://api.inone.test',
      accessTokenProvider: () => null,
      httpClient: mock,
    );

    final response = await client.get('/config/public', authenticated: false);
    expect(response['status'], 'ok');
    client.close();
  });

  test('classifies unauthorized responses without retrying in the transport',
      () async {
    final mock = MockClient(
        (request) async => http.Response('{"error":"unauthorized"}', 401));
    final client = ApiClient(
      baseUrl: 'https://api.inone.test',
      accessTokenProvider: () => 'expired-token',
      httpClient: mock,
    );

    await expectLater(
      client.get('/profile'),
      throwsA(isA<ApiException>()
          .having((error) => error.statusCode, 'statusCode', 401)),
    );
    client.close();
  });

  test('reports malformed JSON as an invalid response', () async {
    final mock = MockClient((request) async => http.Response('not json', 200));
    final client = ApiClient(
      baseUrl: 'https://api.inone.test',
      accessTokenProvider: () => 'access-token',
      httpClient: mock,
    );

    await expectLater(
      client.get('/profile'),
      throwsA(
        isA<ApiException>().having(
          (error) => error.code,
          'code',
          'invalid_response',
        ),
      ),
    );
    client.close();
  });

  test('classifies profile server errors', () async {
    final mock = MockClient(
      (request) async => http.Response('{"error":"server_error"}', 500),
    );
    final client = ApiClient(
      baseUrl: 'https://api.inone.test',
      accessTokenProvider: () => 'access-token',
      httpClient: mock,
    );

    await expectLater(
      client.get('/profile'),
      throwsA(
        isA<ApiException>()
            .having((error) => error.statusCode, 'statusCode', 500)
            .having((error) => error.retryable, 'retryable', isTrue),
      ),
    );
    client.close();
  });
  test('downloads only authenticated no-store attachments with safe headers', () async {
    final bytes = [37, 80, 68, 70, 45, 49, 46, 55];
    final mock = MockClient((request) async {
      expect(request.method, 'GET');
      expect(request.url.path, '/org-requests/request-1/documents/doc-1');
      expect(request.headers['authorization'], 'Bearer access-token');
      expect(request.followRedirects, isFalse);
      return http.Response.bytes(
        bytes,
        200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': "attachment; filename=\"application.pdf\"; filename*=UTF-8''application.pdf",
          'x-content-type-options': 'nosniff',
          'cache-control': 'private, no-store',
        },
      );
    });
    final client = ApiClient(
      baseUrl: 'https://api.inone.test',
      accessTokenProvider: () => 'access-token',
      httpClient: mock,
    );

    final response = await client.download('/org-requests/request-1/documents/doc-1');
    expect(response.bodyBytes, bytes);
    expect(response.headers['content-type'], 'application/pdf');
    client.close();
  });

  test('rejects a binary response without attachment and no-store protections', () async {
    final mock = MockClient((request) async => http.Response.bytes(
          [1, 2, 3],
          200,
          headers: {'content-type': 'application/pdf'},
        ));
    final client = ApiClient(
      baseUrl: 'https://api.inone.test',
      accessTokenProvider: () => 'access-token',
      httpClient: mock,
    );

    await expectLater(
      client.download('/org-requests/request-1/documents/doc-1'),
      throwsA(isA<ApiException>().having(
        (error) => error.code,
        'code',
        'invalid_download_response',
      )),
    );
    client.close();
  });


}
