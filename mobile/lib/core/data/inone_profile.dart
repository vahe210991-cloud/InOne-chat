import '../network/api_exception.dart';

class InOneProfile {
  const InOneProfile({
    required this.userId,
    required this.nickname,
    required this.email,
    required this.verificationLevel,
    required this.providers,
    required this.backupEmail,
    required this.securityHints,
    this.locale = 'hy',
    this.platformRole,
  });

  final String userId;
  final String? nickname;
  final String? email;
  final int verificationLevel;
  final List<String> providers;
  final BackupEmail? backupEmail;
  final List<String> securityHints;
  final String locale;
  final String? platformRole;

  bool get canViewPlatformRequests =>
      platformRole == 'owner' || platformRole == 'admin';
  bool get canDecidePlatformRequests => platformRole == 'owner';

  bool get isEmpty =>
      (nickname == null || nickname!.isEmpty) &&
      (email == null || email!.isEmpty);

  factory InOneProfile.fromJson(Map<String, dynamic> json) {
    final userId = json['userId'];
    final nickname = json['nickname'];
    final email = json['email'];
    final verificationLevel = json['verificationLevel'];
    final providers = json['providers'];
    final backupEmail = json['backupEmail'];
    final securityHints = json['securityHints'];
    final locale = json['locale'] ?? 'hy';
    final platformRole = json['platformRole'];

    if (!json.containsKey('userId') ||
        !json.containsKey('nickname') ||
        !json.containsKey('email') ||
        !json.containsKey('verificationLevel') ||
        !json.containsKey('providers') ||
        !json.containsKey('backupEmail') ||
        !json.containsKey('securityHints') ||
        userId is! String ||
        userId.isEmpty ||
        (nickname != null && nickname is! String) ||
        (email != null && email is! String) ||
        verificationLevel is! int ||
        verificationLevel < 0 ||
        verificationLevel > 2 ||
        providers is! List ||
        providers.any((provider) => provider is! String) ||
        (backupEmail != null && backupEmail is! Map<String, dynamic>) ||
        securityHints is! List ||
        locale is! String ||
        !const ['hy', 'ru', 'en'].contains(locale) ||
        (platformRole != null && !const ['owner', 'admin'].contains(platformRole)) ||
        securityHints.any((hint) => hint is! String)) {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 200,
        retryable: false,
      );
    }

    BackupEmail? parsedBackupEmail;
    if (backupEmail != null) {
      final backup = backupEmail as Map<String, dynamic>;
      final backupAddress = backup['email'];
      final verified = backup['verified'];
      if (backupAddress is! String || verified is! bool) {
        throw const ApiException(
          code: 'invalid_response',
          statusCode: 200,
          retryable: false,
        );
      }
      parsedBackupEmail = BackupEmail(email: backupAddress, verified: verified);
    }

    return InOneProfile(
      userId: userId,
      nickname: nickname as String?,
      email: email as String?,
      verificationLevel: verificationLevel,
      providers: List<String>.unmodifiable(providers.cast<String>()),
      backupEmail: parsedBackupEmail,
      securityHints: List<String>.unmodifiable(securityHints.cast<String>()),
      locale: locale,
      platformRole: platformRole as String?,
    );
  }
}

class BackupEmail {
  const BackupEmail({required this.email, required this.verified});

  final String email;
  final bool verified;
}
