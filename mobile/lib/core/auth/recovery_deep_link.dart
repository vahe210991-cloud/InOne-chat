class RecoveryLinkData {
  const RecoveryLinkData({required this.userId, required this.token});

  final String userId;
  final String token;
}

/// Parses only the Beta custom scheme or an explicitly allowlisted HTTPS host.
/// Merely parsing a link never confirms recovery; the user must submit SC-08.
RecoveryLinkData? parseRecoveryDeepLink(
  Uri uri, {
  String verifiedHttpsHost = '',
}) {
  final customScheme = uri.scheme == 'inone' &&
      uri.host == 'recovery' &&
      uri.path == '/confirm';
  final expectedHost = verifiedHttpsHost.trim().toLowerCase();
  final verifiedHttps = expectedHost.isNotEmpty &&
      uri.scheme == 'https' &&
      uri.host.toLowerCase() == expectedHost &&
      uri.path == '/recovery/confirm';
  if (!customScheme && !verifiedHttps) return null;

  final userId = (uri.queryParameters['user'] ??
          uri.queryParameters['userId'] ??
          '')
      .trim();
  final token = (uri.queryParameters['token'] ?? '').trim();
  if (userId.isEmpty ||
      userId.length > 256 ||
      token.isEmpty ||
      token.length > 128 ||
      userId.contains('\n') ||
      userId.contains('\r') ||
      token.contains('\n') ||
      token.contains('\r')) {
    return null;
  }
  return RecoveryLinkData(userId: userId, token: token);
}
