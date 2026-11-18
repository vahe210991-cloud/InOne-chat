import 'dart:convert';

import 'inone_profile.dart';

class ProfileUiBridge {
  static const _assetPath =
      '/assets/approved-ui/InOne-approved-cross-platform.html';
  static const _profileLabels = {
    '43 Personal profile',
    'D41 Dark — Personal profile',
  };

  static const _androidFlutterAssetsPrefix = [
    'android_asset',
    'flutter_assets',
    'assets',
  ];
  static const _iosFrameworkAssetsPrefix = [
    'Frameworks',
    'App.framework',
    'flutter_assets',
    'assets',
  ];
  static const _iosDirectAssetsPrefix = [
    'flutter_assets',
    'assets',
  ];

  /// Allows only a file inside the bundled owner-approved UI package.
  /// Dot-segments, encoded separators, hosts, queries and fragments fail closed.
  static bool isUiApprovalAssetUrl(String? value) {
    return _isBundledAssetUrl(value, const ['ui-approval'], allowChildren: true);
  }

  /// Allows only the single bundled profile document, not sibling file URLs.
  static bool isApprovedAssetUrl(String? value) {
    return _isBundledAssetUrl(
      value,
      const ['approved-ui', 'InOne-approved-cross-platform.html'],
    );
  }

  static bool _isBundledAssetUrl(
    String? value,
    List<String> assetPath, {
    bool allowChildren = false,
  }) {
    final segments = _decodedLocalFileSegments(value);
    if (segments == null) return false;

    bool matchesFrom(int start, List<String> prefix) {
      final requiredLength = start + prefix.length;
      if (segments.length < requiredLength) return false;
      if (allowChildren
          ? segments.length == requiredLength
          : segments.length != requiredLength) {
        return false;
      }
      for (var index = 0; index < prefix.length; index++) {
        if (segments[start + index] != prefix[index]) return false;
      }
      return true;
    }

    if (matchesFrom(
      0,
      [..._androidFlutterAssetsPrefix, ...assetPath],
    )) {
      return true;
    }

    for (var index = 0; index < segments.length; index++) {
      if (!segments[index].endsWith('.app')) continue;
      if (matchesFrom(
            index + 1,
            [..._iosFrameworkAssetsPrefix, ...assetPath],
          ) ||
          matchesFrom(
            index + 1,
            [..._iosDirectAssetsPrefix, ...assetPath],
          )) {
        return true;
      }
    }
    return false;
  }

  static List<String>? _decodedLocalFileSegments(String? value) {
    final uri = value == null ? null : Uri.tryParse(value);
    if (uri == null ||
        uri.scheme != 'file' ||
        uri.host.isNotEmpty ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment) {
      return null;
    }

    try {
      final path = Uri.decodeComponent(uri.path);
      if (!path.startsWith('/') ||
          path.contains('\\') ||
          path.contains('\u0000') ||
          path.contains('%')) {
        return null;
      }

      final segments = path.substring(1).split('/');
      if (segments.isEmpty ||
          segments.any((segment) =>
              segment.isEmpty || segment == '.' || segment == '..')) {
        return null;
      }
      return segments;
    } on FormatException {
      return null;
    }
  }

  static String updateScript({
    required String screenLabel,
    required InOneProfile? profile,
  }) {
    if (!_profileLabels.contains(screenLabel)) {
      throw ArgumentError.value(screenLabel, 'screenLabel');
    }

    final nickname = profile?.nickname;
    final email = profile?.email;
    final verificationLabel = switch (profile?.verificationLevel) {
      0 => 'Unverified account',
      1 => 'Email verified',
      2 => 'Verified account',
      _ => '—',
    };

    return '''
(() => {
  const assetPath = '/flutter_assets$_assetPath';
  if (location.protocol !== 'file:' ||
      !decodeURIComponent(location.pathname).includes(assetPath)) return false;
  const label = ${jsonEncode(screenLabel)};
  const root = Array.from(document.querySelectorAll('[data-screen-label]'))
    .find((node) => node.getAttribute('data-screen-label') === label);
  if (!root) return false;
  const spans = Array.from(root.querySelectorAll('span'));
  const field = (name, sample) =>
    root.querySelector(`[data-inone-profile-field="\${name}"]`) ||
    spans.find((node) => node.textContent.trim() === sample);
  const nameNode = field('nickname', 'Anna Grigoryan');
  const emailNode = field('email', '@anna.inone • Workspace');
  const verificationNode = field('verification', 'Verified account');
  if (!nameNode || !emailNode || !verificationNode) return false;
  const metricValue = (label) => {
    const labelNode = spans.find((node) => node.textContent.trim() === label);
    return labelNode?.parentElement?.querySelector(':scope > span');
  };
  const taskCount = metricValue('My tasks');
  const activityScore = metricValue('Activity');
  const projectCount = metricValue('Projects');
  if (!taskCount || !activityScore || !projectCount) return false;
  nameNode.dataset.inoneProfileField = 'nickname';
  emailNode.dataset.inoneProfileField = 'email';
  verificationNode.dataset.inoneProfileField = 'verification';
  taskCount.dataset.inoneProfileField = 'task-count';
  activityScore.dataset.inoneProfileField = 'activity-score';
  projectCount.dataset.inoneProfileField = 'project-count';
  nameNode.textContent = ${jsonEncode(nickname?.isNotEmpty == true ? nickname : '—')};
  emailNode.textContent = ${jsonEncode(email?.isNotEmpty == true ? email : '—')};
  verificationNode.textContent = ${jsonEncode(verificationLabel)};
  taskCount.textContent = '—';
  activityScore.textContent = '—';
  projectCount.textContent = '—';
  return true;
})()
''';
  }
}
