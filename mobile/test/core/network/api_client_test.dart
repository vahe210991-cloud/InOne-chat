import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:inone_mobile/core/network/api_client.dart';
import 'package:inone_mobile/core/network/api_exception.dart';

void main() {
  test('sends bearer token and decodes JSON response', () async {
    final mock = MockClient((request) async {
      expect(request.method, 'GET');
      expect(request.url.path, '/rooms/mine');
      expect(request.headers['authorization'], 'Bearer access-token');
      return http.Response('{"rooms":[]}', 200,
          headers: {'content-type': 'application/json'});
    });
    final client = ApiClient(
      baseUrl: 'https://api.inone.test',
      accessTokenProvider: () => 'access-token',
      httpClient: mock,
    );

    final response = await client.get('/rooms/mine');
    expect(response['rooms'], isEmpty);
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

  test('classifies unauthorized responses without retrying in the transport', () async {
    final mock = MockClient((request) async => http.Response('{"error":"unauthorized"}', 401));
    final client = ApiClient(
      baseUrl: 'https://api.inone.test',
      accessTokenProvider: () => 'expired-token',
      httpClient: mock,
    );

    await expectLater(
      client.get('/profile'),
      throwsA(isA<ApiException>().having((error) => error.statusCode, 'statusCode', 401)),
    );
    client.close();
  });
}
