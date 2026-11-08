import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:inone_mobile/core/network/api_client.dart';
import 'package:inone_mobile/core/network/api_exception.dart';

void main() {
  group('ApiClient', () {
    test('adds the in-memory bearer token and decodes JSON', () async {
      final mock = MockClient((request) async {
        expect(request.headers['authorization'], 'Bearer access-token');
        expect(request.url.path, '/rooms/mine');
        return http.Response('{"rooms":[]}', 200);
      });
      final api = ApiClient(
        baseUrl: 'https://api.example.test',
        accessTokenProvider: () => 'access-token',
        httpClient: mock,
      );

      expect(await api.get('/rooms/mine'), {'rooms': []});
      api.close();
    });

    test('sends JSON body for unauthenticated registration calls', () async {
      final mock = MockClient((request) async {
        expect(request.headers['authorization'], isNull);
        expect(request.headers['content-type'], 'application/json');
        expect(request.body, '{"email":"user@example.test"}');
        return http.Response('{"ok":true}', 200);
      });
      final api = ApiClient(
        baseUrl: 'https://api.example.test',
        accessTokenProvider: () => null,
        httpClient: mock,
      );

      expect(
        await api.post(
          '/register/email',
          body: {'email': 'user@example.test'},
          authenticated: false,
        ),
        {'ok': true},
      );
      api.close();
    });

    test('does not attempt token refresh on 401', () async {
      final mock = MockClient((_) async =>
          http.Response('{"error":"token_expired"}', 401));
      final api = ApiClient(
        baseUrl: 'https://api.example.test',
        accessTokenProvider: () => 'expired',
        httpClient: mock,
      );

      await expectLater(
        api.get('/profile'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.code, 'code', 'token_expired')
              .having((e) => e.statusCode, 'statusCode', 401)
              .having((e) => e.retryable, 'retryable', false),
        ),
      );
      api.close();
    });

    test('marks rate limits and server failures as retryable', () async {
      final mock = MockClient((_) async =>
          http.Response('{"error":"maintenance"}', 503));
      final api = ApiClient(
        baseUrl: 'https://api.example.test',
        accessTokenProvider: () => 'access-token',
        httpClient: mock,
      );

      await expectLater(
        api.get('/rooms/mine'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.code, 'code', 'maintenance')
              .having((e) => e.retryable, 'retryable', true),
        ),
      );
      api.close();
    });

    test('rejects absolute request URLs', () async {
      final api = ApiClient(
        baseUrl: 'https://api.example.test',
        accessTokenProvider: () => 'access-token',
        httpClient: MockClient((_) async => http.Response('{}', 200)),
      );

      expect(
        () => api.get('https://attacker.example/steal'),
        throwsA(isA<ArgumentError>()),
      );
      api.close();
    });
  });
}
