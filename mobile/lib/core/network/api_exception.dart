class ApiException implements Exception {
  const ApiException({
    required this.code,
    this.statusCode,
    required this.retryable,
  });

  /// Stable machine-readable code. UI text must be resolved through localization.
  final String code;
  final int? statusCode;
  final bool retryable;

  @override
  String toString() =>
      'ApiException(code: $code, statusCode: $statusCode, retryable: $retryable)';
}
