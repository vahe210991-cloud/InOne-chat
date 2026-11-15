import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import 'api_exception.dart';

/// Supplies the current access token from the in-memory session.
///
/// This client deliberately does not refresh tokens. Once native MLS is open,
/// Rust is the single owner of refresh-token rotation.
typedef AccessTokenProvider = FutureOr<String?> Function();

class ApiClient {
  ApiClient({
    required String baseUrl,
    required AccessTokenProvider accessTokenProvider,
    http.Client? httpClient,
    this.timeout = const Duration(seconds: 20),
  })  : _baseUri = Uri.parse(baseUrl),
        _accessTokenProvider = accessTokenProvider,
        _http = httpClient ?? http.Client();

  final Uri _baseUri;
  final AccessTokenProvider _accessTokenProvider;
  final http.Client _http;
  final Duration timeout;

  Future<Map<String, dynamic>> get(
    String path, {
    bool authenticated = true,
  }) =>
      request('GET', path, authenticated: authenticated);

  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    bool authenticated = true,
  }) =>
      request('POST', path, body: body, authenticated: authenticated);

  /// Downloads a binary response from a same-origin signed URL.
  ///
  /// The bearer token is deliberately never sent to a different origin. Redirects
  /// are disabled so a file host cannot forward session credentials elsewhere.
  Future<Uint8List> getBytes(String signedUrl) async {
    final uri = _resolveDownload(signedUrl);
    final token = await _accessTokenProvider();
    if (token == null || token.isEmpty) {
      throw const ApiException(
        code: 'unauthenticated',
        statusCode: 401,
        retryable: false,
      );
    }

    final request = http.Request('GET', uri)
      ..followRedirects = false
      ..headers.addAll({
        'accept': 'application/octet-stream',
        'authorization': 'Bearer $token',
      });

    try {
      final streamed = await _http.send(request).timeout(timeout);
      final response = await http.Response.fromStream(streamed).timeout(timeout);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        Object? payload;
        try {
          payload = _decodePayload(utf8.decode(response.bodyBytes));
        } on FormatException {
          payload = null;
        }
        throw ApiException(
          code: _errorCode(payload, response.statusCode),
          statusCode: response.statusCode,
          retryable: _isRetryable(response.statusCode),
        );
      }
      return response.bodyBytes;
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw const ApiException(
        code: 'request_timeout',
        retryable: true,
      );
    } on SocketException {
      throw const ApiException(
        code: 'network_unavailable',
        retryable: true,
      );
    } on http.ClientException {
      throw const ApiException(
        code: 'network_unavailable',
        retryable: true,
      );
    }
  }

  /// Uploads already-encrypted bytes to a same-origin, HMAC-signed object URL.
  /// The URL is the authorization capability; no session token is sent to this PUT.
  Future<void> putBytes(String signedUrl, Uint8List bytes) async {
    final uri = _resolveDownload(signedUrl);
    final request = http.Request('PUT', uri)
      ..followRedirects = false
      ..headers['content-type'] = 'application/octet-stream'
      ..bodyBytes = bytes;

    try {
      final streamed = await _http.send(request).timeout(timeout);
      final response = await http.Response.fromStream(streamed).timeout(timeout);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        Object? payload;
        try {
          payload = _decodePayload(utf8.decode(response.bodyBytes));
        } on FormatException {
          payload = null;
        }
        throw ApiException(
          code: _errorCode(payload, response.statusCode),
          statusCode: response.statusCode,
          retryable: _isRetryable(response.statusCode),
        );
      }
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw const ApiException(
        code: 'request_timeout',
        retryable: true,
      );
    } on SocketException {
      throw const ApiException(
        code: 'network_unavailable',
        retryable: true,
      );
    } on http.ClientException {
      throw const ApiException(
        code: 'network_unavailable',
        retryable: true,
      );
    }
  }

  Uri _resolveDownload(String signedUrl) {
    final uri = Uri.parse(signedUrl);
    if (!uri.hasScheme ||
        !uri.hasAuthority ||
        uri.userInfo.isNotEmpty ||
        uri.fragment.isNotEmpty ||
        uri.origin != _baseUri.origin) {
      throw ArgumentError.value(
        signedUrl,
        'signedUrl',
        'File download URL must be absolute and same-origin with the API',
      );
    }
    return uri;
  }

  Future<Map<String, dynamic>> request(
    String method,
    String path, {
    Object? body,
    bool authenticated = true,
  }) async {
    final uri = _resolve(path);
    final headers = <String, String>{'accept': 'application/json'};

    if (body != null) {
      headers['content-type'] = 'application/json';
    }

    if (authenticated) {
      final token = await _accessTokenProvider();
      if (token == null || token.isEmpty) {
        throw const ApiException(
          code: 'unauthenticated',
          statusCode: 401,
          retryable: false,
        );
      }
      headers['authorization'] = 'Bearer $token';
    }

    final request = http.Request(method.toUpperCase(), uri)
      ..headers.addAll(headers);

    if (body != null) {
      request.body = _encodeBody(body);
    }

    try {
      final streamed = await _http.send(request).timeout(timeout);
      final response = await http.Response.fromStream(streamed).timeout(timeout);
      final payload = _decodePayload(response.body);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw ApiException(
          code: _errorCode(payload, response.statusCode),
          statusCode: response.statusCode,
          retryable: _isRetryable(response.statusCode),
        );
      }

      if (payload is Map<String, dynamic>) return payload;
      if (payload == null) return const <String, dynamic>{};

      throw ApiException(
        code: 'invalid_response',
        statusCode: response.statusCode,
        retryable: false,
      );
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw const ApiException(
        code: 'request_timeout',
        retryable: true,
      );
    } on SocketException {
      throw const ApiException(
        code: 'network_unavailable',
        retryable: true,
      );
    } on http.ClientException {
      throw const ApiException(
        code: 'network_unavailable',
        retryable: true,
      );
    } on FormatException {
      throw const ApiException(
        code: 'invalid_response',
        retryable: false,
      );
    }
  }

  Uri _resolve(String path) {
    final relative = Uri.parse(path);
    if (relative.hasScheme || relative.hasAuthority) {
      throw ArgumentError.value(path, 'path', 'Absolute URLs are not allowed');
    }
    return _baseUri.resolveUri(relative);
  }

  String _encodeBody(Object body) {
    if (body is String) return body;
    return jsonEncode(body);
  }

  Object? _decodePayload(String body) {
    if (body.trim().isEmpty) return null;
    return jsonDecode(body);
  }

  String _errorCode(Object? payload, int statusCode) {
    if (payload is Map<String, dynamic>) {
      final value = payload['code'] ?? payload['error'];
      if (value is String && value.isNotEmpty) return value;
    }
    return switch (statusCode) {
      401 => 'unauthorized',
      403 => 'forbidden',
      404 => 'not_found',
      409 => 'conflict',
      429 => 'rate_limited',
      >= 500 => 'server_error',
      _ => 'http_error',
    };
  }

  bool _isRetryable(int statusCode) =>
      statusCode == 408 ||
      statusCode == 425 ||
      statusCode == 429 ||
      statusCode == 500 ||
      statusCode == 502 ||
      statusCode == 503 ||
      statusCode == 504;

  void close() => _http.close();
}
