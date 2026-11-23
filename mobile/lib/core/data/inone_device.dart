import '../network/api_exception.dart';

/// Device record returned by the authenticated GET /devices/mine endpoint.
class InOneDevice {
  const InOneDevice({
    required this.deviceId,
    required this.label,
    required this.revoked,
    required this.pushRegistered,
  });

  final String deviceId;
  final String? label;
  final bool revoked;
  final bool pushRegistered;

  factory InOneDevice.fromJson(Map<String, dynamic> json) {
    final deviceId = json['deviceId'];
    final label = json['label'];
    final revoked = json['revoked'];
    final pushRegistered = json['pushRegistered'];
    if (deviceId is! String || deviceId.trim().isEmpty ||
        label != null && label is! String ||
        revoked is! bool || pushRegistered is! bool) {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 200,
        retryable: false,
      );
    }
    return InOneDevice(
      deviceId: deviceId,
      label: label as String?,
      revoked: revoked,
      pushRegistered: pushRegistered,
    );
  }
}

class InOneDeviceList {
  const InOneDeviceList(this.devices);
  final List<InOneDevice> devices;

  factory InOneDeviceList.fromJson(Map<String, dynamic> json) {
    final raw = json['devices'];
    if (raw is! List || raw.any((item) => item is! Map)) {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 200,
        retryable: false,
      );
    }
    return InOneDeviceList(List<InOneDevice>.unmodifiable(
      raw.map((item) => InOneDevice.fromJson(
        Map<String, dynamic>.from(item as Map),
      )),
    ));
  }
}
