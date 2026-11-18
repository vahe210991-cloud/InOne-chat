class RecoveryDeepLinkPayload {
  const RecoveryDeepLinkPayload({
    required this.userId,
    required this.token,
    required this.locale,
  });

  final String userId;
  final String token;
  final String locale;
}

class RecoveryDeepLink {
  const RecoveryDeepLink._();

  static RecoveryDeepLinkPayload? parse(String raw) {
    final uri = Uri.tryParse(raw.trim());
    if (uri == null || uri.hasFragment || uri.userInfo.isNotEmpty) return null;

    final customScheme = uri.scheme.toLowerCase() == 'inone' &&
        uri.host.toLowerCase() == 'recovery' &&
        uri.path == '/confirm';
    final platformRoute = uri.scheme.isEmpty &&
        !uri.hasAuthority &&
        uri.path == '/recovery/confirm';
    if (!customScheme && !platformRoute) return null;

    final users = uri.queryParametersAll['user'];
    final tokens = uri.queryParametersAll['token'];
    if (users == null || users.length != 1 || tokens == null || tokens.length != 1) {
      return null;
    }

    final userId = users.single.trim();
    final token = tokens.single;
    if (userId.isEmpty || userId.length > 256 || token.isEmpty || token.length > 1024) {
      return null;
    }

    final requestedLocale = uri.queryParameters['locale'];
    final locale = const {'hy', 'ru', 'en'}.contains(requestedLocale)
        ? requestedLocale!
        : 'hy';
    return RecoveryDeepLinkPayload(
      userId: userId,
      token: token,
      locale: locale,
    );
  }
}
