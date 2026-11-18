import '../network/api_exception.dart';

class InOnePublicConfig {
  const InOnePublicConfig({
    required this.configVersion,
    required this.maintenanceEnabled,
    required this.minimumAppVersion,
  });

  final int configVersion;
  final bool maintenanceEnabled;
  final String minimumAppVersion;

  factory InOnePublicConfig.fromJson(Map<String, dynamic> json) {
    final version = json['version'];
    final rawFlags = json['flags'];
    if (version is! int || rawFlags is! Map) {
      throw const ApiException(code: 'invalid_response', statusCode: 502, retryable: false);
    }
    final flags = Map<String, dynamic>.from(rawFlags);
    final maintenance = flags['maintenance.enabled'];
    final minimumVersion = flags['app.minVersion'];
    if (maintenance is! bool || minimumVersion is! String || minimumVersion.isEmpty) {
      throw const ApiException(code: 'invalid_response', statusCode: 502, retryable: false);
    }
    return InOnePublicConfig(
      configVersion: version,
      maintenanceEnabled: maintenance,
      minimumAppVersion: minimumVersion,
    );
  }
}
