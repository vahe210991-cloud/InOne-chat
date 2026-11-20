import '../network/api_exception.dart';
import '../session/inone_session.dart';

/// Provider names accepted by the authenticated device push-token API.
enum InOnePushProvider { fcm, apns }

/// Device-scoped push-token lifecycle. The raw token is sent only in the
/// authenticated request and is never persisted by this repository.
class InOnePushRepository {
  const InOnePushRepository(this.session);

  final InOneSession session;

  static final RegExp _fidPattern = RegExp(r'^[A-Za-z0-9_-]{22}
    final response = await session.request(
      'PUT',
      '/devices/me/push',
      body: {'provider': provider.name, 'token': token},
    );
    if (response['registered'] != true) {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 200,
        retryable: false,
      );
    }
  }

  Future<void> unregister() async {
    final response = await session.request('DELETE', '/devices/me/push');
    if (response['registered'] != false) {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 200,
        retryable: false,
      );
    }
  }
}
);
  static final RegExp _legacyTokenPattern = RegExp(r'^[A-Za-z0-9:_.-]+
    final response = await session.request(
      'PUT',
      '/devices/me/push',
      body: {'provider': provider.name, 'token': token},
    );
    if (response['registered'] != true) {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 200,
        retryable: false,
      );
    }
  }

  Future<void> unregister() async {
    final response = await session.request('DELETE', '/devices/me/push');
    if (response['registered'] != false) {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 200,
        retryable: false,
      );
    }
  }
}
);

  Future<void> register({
    required InOnePushProvider provider,
    required String token,
  }) async {
    final isFirebaseInstallationId =
        provider == InOnePushProvider.fcm && _fidPattern.hasMatch(token);
    final isLegacyProviderToken = token.length >= 32 &&
        token.length <= 512 &&
        _legacyTokenPattern.hasMatch(token);
    if (!isFirebaseInstallationId && !isLegacyProviderToken) {
      throw ArgumentError('Invalid push registration identifier format');
    }

    final response = await session.request(
      'PUT',
      '/devices/me/push',
      body: {'provider': provider.name, 'token': token},
    );
    if (response['registered'] != true) {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 200,
        retryable: false,
      );
    }
  }

  Future<void> unregister() async {
    final response = await session.request('DELETE', '/devices/me/push');
    if (response['registered'] != false) {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 200,
        retryable: false,
      );
    }
  }
}
