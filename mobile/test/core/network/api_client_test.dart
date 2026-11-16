import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:inone_mobile/core/network/api_client.dart';
import 'package:inone_mobile/core/network/api_exception.dart';

void main() {
  test('sends bearer token and decodes JSON response', () async {
    final mock = MockClient((request) async {
      expect(request.method, 'GET');
      expect(request.url.path, '/profile');
      expect(request.headers['authorization'], 'Bearer access-token');
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

  test('downloads binary bytes with the current device bearer token', () async {
    final expected = <int>[0, 1, 2, 127, 128, 255];
    final mock = MockClient((request) async {
      expect(request.method, 'GET');
      expect(request.url.path, '/objects/file-1');
      expect(request.url.queryParameters['sig'], 'signed');
      expect(request.headers['authorization'], 'Bearer access-token');
      expect(request.headers['accept'], 'application/octet-stream');
      expect(request.followRedirects, isFalse);
      return http.Response.bytes(expected, 200);
    });
    final client = ApiClient(
      baseUrl: 'https://api.inone.test',
      accessTokenProvider: () => 'access-token',
      httpClient: mock,
    );

    final result = await client.getBytes(
      'https://api.inone.test/objects/file-1?expires=123&sig=signed',
    );
    expect(result, expected);
    client.close();
  });

  test('uploads ciphertext to the signed URL without forwarding a bearer token', () async {
    final expected = <int>[0, 4, 8, 127, 128, 255];
    final mock = MockClient((request) async {
      expect(request.method, 'PUT');
      expect(request.url.path, '/objects/file-1');
      expect(request.headers['content-type'], 'application/octet-stream');
      expect(request.headers.containsKey('authorization'), isFalse);
      expect(request.followRedirects, isFalse);
      expect(request.bodyBytes, expected);
      return http.Response('{"uploaded":true}', 200);
    });
    final client = ApiClient(
      baseUrl: 'https://api.inone.test',
      accessTokenProvider: () => 'must-not-be-sent',
      httpClient: mock,
    );

    await client.putBytes(
      'https://api.inone.test/objects/file-1?expires=123&sig=upload',
      Uint8List.fromList(expected),
    );
    client.close();
  });

  test('never sends bearer credentials to a different download origin', () async {
    var sent = false;
    final mock = MockClient((request) async {
      sent = true;
      return http.Response.bytes([], 200);
    });
    final client = ApiClient(
      baseUrl: 'https://api.inone.test',
      accessTokenProvider: () => 'access-token',
      httpClient: mock,
    );

    await expectLater(
      client.getBytes('https://attacker.example/objects/file-1?sig=stolen'),
      throwsA(isA<ArgumentError>()),
    );
    expect(sent, isFalse);
    client.close();
  });

  test('does not follow redirects for authenticated file downloads', () async {
    final mock = MockClient((request) async {
      expect(request.followRedirects, isFalse);
      return http.Response('', 302, headers: {'location': 'https://attacker.example/file'});
    });
    final client = ApiClient(
      baseUrl: 'https://api.inone.test',
      accessTokenProvider: () => 'access-token',
      httpClient: mock,
    );

    await expectLater(
      client.getBytes('https://api.inone.test/objects/file-1?sig=signed'),
      throwsA(isA<ApiException>().having((error) => error.statusCode, 'statusCode', 302)),
    );
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
}
