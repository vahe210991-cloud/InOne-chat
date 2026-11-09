import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/approved_screens.dart';
import 'package:inone_mobile/core/data/inone_profile.dart';
import 'package:inone_mobile/core/data/profile_ui_bridge.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('accepts only the bundled approved UI document URL', () {
    expect(
      ProfileUiBridge.isApprovedAssetUrl(
        'file:///android_asset/flutter_assets/assets/approved-ui/InOne-approved-cross-platform.html',
      ),
      isTrue,
    );
    expect(
      ProfileUiBridge.isApprovedAssetUrl(
        'file:///private/Runner.app/flutter_assets/assets/approved-ui/InOne-approved-cross-platform.html',
      ),
      isTrue,
    );
    expect(
      ProfileUiBridge.isApprovedAssetUrl('https://unpkg.com/profile.html'),
      isFalse,
    );
    expect(
      ProfileUiBridge.isApprovedAssetUrl(
        'file:///tmp/unrelated/flutter_assets/assets/approved-ui/InOne-approved-cross-platform.html',
      ),
      isFalse,
    );
    expect(
      ProfileUiBridge.isApprovedAssetUrl(
        'file://untrusted.example/flutter_assets/assets/approved-ui/InOne-approved-cross-platform.html',
      ),
      isFalse,
    );
    expect(
        ProfileUiBridge.isApprovedAssetUrl('data:text/html,profile'), isFalse);
  });

  test('allows only local bundled UI handoff assets', () {
    expect(
      ProfileUiBridge.isUiApprovalAssetUrl(
        'file:///android_asset/flutter_assets/assets/ui-approval/screens/auth/SC-01.html',
      ),
      isTrue,
    );
    expect(
      ProfileUiBridge.isUiApprovalAssetUrl(
        'file:///private/Runner.app/Frameworks/App.framework/flutter_assets/assets/ui-approval/screens/chat/CH-01.html',
      ),
      isTrue,
    );
    expect(
      ProfileUiBridge.isUiApprovalAssetUrl('https://example.test/SC-01.html'),
      isFalse,
    );
    expect(
      ProfileUiBridge.isUiApprovalAssetUrl(
        'file:///tmp/attacker/assets/ui-approval/screens/auth/SC-01.html',
      ),
      isFalse,
    );
    expect(
      ProfileUiBridge.isUiApprovalAssetUrl(
        'file://untrusted.example/assets/ui-approval/screens/auth/SC-01.html',
      ),
      isFalse,
    );
  });

  test(
      'targets the original selected profile and writes text-only profile fields',
      () {
    final script = ProfileUiBridge.updateScript(
      screenLabel: '43 Personal profile',
      profile: const InOneProfile(
        userId: 'user-1',
        nickname: 'Ada Example',
        email: 'ada@example.test',
        verificationLevel: 1,
        providers: [],
        backupEmail: null,
        securityHints: [],
      ),
    );

    expect(script, contains('43 Personal profile'));
    expect(script, contains('Ada Example'));
    expect(script, contains('ada@example.test'));
    expect(script, contains('Email verified'));
    expect(script, contains("location.protocol !== 'file:'"));
    expect(script, contains('/flutter_assets/assets/approved-ui/'));
    expect(script, contains('textContent'));
    expect(script, isNot(contains('innerHTML')));
    expect(script, isNot(contains('localStorage')));
    expect(
      () => ProfileUiBridge.updateScript(
        screenLabel: '05 Messages',
        profile: null,
      ),
      throwsArgumentError,
    );
  });

  test('profile data can be cleared without leaving demo identity text', () {
    final script = ProfileUiBridge.updateScript(
      screenLabel: 'D41 Dark — Personal profile',
      profile: null,
    );

    expect(script, contains('D41 Dark — Personal profile'));
    expect(script, contains("'Anna Grigoryan'"));
    expect(script, contains("'@anna.inone • Workspace'"));
    expect(script, contains('"—"'));
    expect(script, contains("taskCount.textContent = '—'"));
    expect(script, contains("activityScore.textContent = '—'"));
    expect(script, contains("projectCount.textContent = '—'"));
  });

  test('profile values remain JavaScript string data, not markup', () {
    const nickname = '"><img src=x onerror=alert(1)>';
    final script = ProfileUiBridge.updateScript(
      screenLabel: '43 Personal profile',
      profile: const InOneProfile(
        userId: 'user-1',
        nickname: nickname,
        email: 'safe@example.test',
        verificationLevel: 0,
        providers: [],
        backupEmail: null,
        securityHints: [],
      ),
    );

    expect(
      script,
      contains('nameNode.textContent = ${jsonEncode(nickname)};'),
    );
    expect(script, contains('textContent'));
    expect(script, isNot(contains('innerHTML')));
  });

  test(
      'bridge anchors match both original profile variants in the bundled asset',
      () async {
    final html = await rootBundle.loadString(approvedScreensAssetPath);

    expect(html, contains('43 Personal profile'));
    expect(html, contains('D41 Dark — Personal profile'));
    expect(html, contains('Anna Grigoryan'));
    expect(html, contains('@anna.inone • Workspace'));
  });
}
