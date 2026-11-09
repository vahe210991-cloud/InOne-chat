import 'dart:convert';

import 'inone_profile.dart';

class ProfileUiBridge {
  static const _assetPath =
      '/assets/approved-ui/InOne-approved-cross-platform.html';
  static const _profileLabels = {
    '43 Personal profile',
    'D41 Dark — Personal profile',
  };

  static bool isApprovedAssetUrl(String? value) {
    final uri = value == null ? null : Uri.tryParse(value);
    if (uri == null || uri.scheme != 'file' || uri.host.isNotEmpty) {
      return false;
    }
    try {
      final path = Uri.decodeComponent(uri.path);
      return path.startsWith('/android_asset/flutter_assets$_assetPath') ||
          path.contains(
              '.app/Frameworks/App.framework/flutter_assets$_assetPath') ||
          path.contains('.app/flutter_assets$_assetPath');
    } on FormatException {
      return false;
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
