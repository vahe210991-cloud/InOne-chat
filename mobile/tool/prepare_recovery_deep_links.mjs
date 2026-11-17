import fs from 'node:fs';
import path from 'node:path';

const androidManifest = path.join(
  process.cwd(),
  'android',
  'app',
  'src',
  'main',
  'AndroidManifest.xml',
);
const infoPlist = path.join(process.cwd(), 'ios', 'Runner', 'Info.plist');

function configureAndroidRecoveryLink() {
  if (!fs.existsSync(androidManifest)) {
    throw new Error(`Flutter Android manifest was not generated: ${androidManifest}`);
  }
  let source = fs.readFileSync(androidManifest, 'utf8');
  const activityPattern =
    /<activity\\b(?=[^>]*android:name="[^"]*MainActivity")[^>]*>[\\s\\S]*?<\\/activity>/m;
  const match = source.match(activityPattern);
  if (!match) throw new Error('Android MainActivity declaration was not found');

  const activity = match[0];
  const expected = [
    'android:scheme="inone"',
    'android:host="recovery"',
    'android:path="/confirm"',
  ];
  if (expected.every((value) => activity.includes(value))) return;
  if (activity.includes('android:scheme="inone"')) {
    throw new Error('Android MainActivity already declares the inone scheme with a conflicting route');
  }

  const filter = `\n            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="inone" android:host="recovery" android:path="/confirm" />
            </intent-filter>\n`;
  source = source.replace(activity, activity.replace('</activity>', `${filter}        </activity>`));
  fs.writeFileSync(androidManifest, source, 'utf8');
}

function configureIosRecoveryLink() {
  if (!fs.existsSync(infoPlist)) {
    throw new Error(`Flutter iOS Info.plist was not generated: ${infoPlist}`);
  }
  let source = fs.readFileSync(infoPlist, 'utf8');
  if (/<key>FlutterDeepLinkingEnabled<\\/key>\\s*<false\\/>/.test(source)) {
    source = source.replace(
      /<key>FlutterDeepLinkingEnabled<\\/key>\\s*<false\\/>/,
      '<key>FlutterDeepLinkingEnabled</key><true/>',
    );
  } else if (!/<key>FlutterDeepLinkingEnabled<\\/key>\\s*<true\\/>/.test(source)) {
    const rootClose = source.lastIndexOf('</dict>');
    if (rootClose < 0) throw new Error('Info.plist root dictionary is malformed');
    source = source.slice(0, rootClose)
      + '  <key>FlutterDeepLinkingEnabled</key>\\n  <true/>\\n'
      + source.slice(rootClose);
  }

  if (!source.includes('<key>CFBundleURLTypes</key>')) {
    const rootClose = source.lastIndexOf('</dict>');
    if (rootClose < 0) throw new Error('Info.plist root dictionary is malformed');
    const urlTypes = `  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>inone</string>
      </array>
    </dict>
  </array>
`;
    source = source.slice(0, rootClose) + urlTypes + source.slice(rootClose);
  } else if (!/<key>CFBundleURLSchemes<\\/key>[\\s\\S]*?<string>inone<\\/string>/.test(source)) {
    throw new Error('Info.plist already defines URL types without the required inone scheme; merge the URL scheme manually');
  }

  fs.writeFileSync(infoPlist, source, 'utf8');
}

configureAndroidRecoveryLink();
configureIosRecoveryLink();
console.log('Configured Android and iOS InOne recovery deep links.');
