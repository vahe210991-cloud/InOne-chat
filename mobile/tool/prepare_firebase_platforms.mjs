import fs from 'node:fs';
import path from 'node:path';

const [platformsArg, repoRootArg, appRootArg] = process.argv.slice(2);
if (!platformsArg || !repoRootArg || !appRootArg) {
  throw new Error('Usage: node tool/prepare_firebase_platforms.mjs <android[,ios]> <repo-root> <mobile-root>');
}
const platforms = platformsArg.split(',');
if (platforms.some((platform) => !['android', 'ios'].includes(platform)) ||
    new Set(platforms).size !== platforms.length) {
  throw new Error(`Unsupported or duplicate platform list: ${platformsArg}`);
}
const repoRoot = path.resolve(repoRootArg);
const appRoot = path.resolve(appRootArg);

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`Firebase ${label} mismatch: expected ${expected}, got ${String(actual)}`);
  }
}
function plistString(xml, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = xml.match(new RegExp(`<key>\\s*${escaped}\\s*</key>\\s*<string>([^<]*)</string>`));
  return match?.[1] ?? null;
}
function copyVerified(source, destination) {
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`Required Firebase client configuration is missing: ${source}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  if (!fs.readFileSync(source).equals(fs.readFileSync(destination))) {
    throw new Error(`Firebase configuration copy verification failed: ${destination}`);
  }
}

if (platforms.includes('android')) {
  const source = path.join(repoRoot, 'google-services.json');
  if (!fs.existsSync(source)) throw new Error(`Missing checked-in Firebase Android client config: ${source}`);
  const config = JSON.parse(fs.readFileSync(source, 'utf8'));
  assertEqual(config.project_info?.project_id, 'inone-messenger', 'Android project ID');
  assertEqual(config.project_info?.project_number, '687951175916', 'Android sender ID');
  const clients = (config.client ?? []).filter(
    (client) => client.client_info?.android_client_info?.package_name === 'com.inone.app',
  );
  if (clients.length !== 1) {
    throw new Error(`Expected exactly one Android Firebase client for com.inone.app; found ${clients.length}`);
  }
  assertEqual(
    clients[0].client_info.mobilesdk_app_id,
    '1:687951175916:android:7bb45a64913dd7797c05c9',
    'Android App ID',
  );
  const generatedApp = path.join(appRoot, 'android', 'app');
  if (!fs.existsSync(generatedApp)) throw new Error(`Generated Android app directory is missing: ${generatedApp}`);
  copyVerified(source, path.join(generatedApp, 'google-services.json'));
}

if (platforms.includes('ios')) {
  const source = path.join(repoRoot, 'GoogleService-Info.plist');
  if (!fs.existsSync(source)) throw new Error(`Missing checked-in Firebase iOS client config: ${source}`);
  const xml = fs.readFileSync(source, 'utf8');
  assertEqual(plistString(xml, 'PROJECT_ID'), 'inone-messenger', 'iOS project ID');
  assertEqual(plistString(xml, 'GCM_SENDER_ID'), '687951175916', 'iOS sender ID');
  assertEqual(plistString(xml, 'BUNDLE_ID'), 'com.inone.app', 'iOS bundle ID');
  assertEqual(
    plistString(xml, 'GOOGLE_APP_ID'),
    '1:687951175916:ios:51b46acf985759337c05c9',
    'iOS App ID',
  );
  const runner = path.join(appRoot, 'ios', 'Runner');
  if (!fs.existsSync(runner)) throw new Error(`Generated iOS Runner directory is missing: ${runner}`);
  copyVerified(source, path.join(runner, 'GoogleService-Info.plist'));
}

console.log(`Validated and installed Firebase client configuration for: ${platforms.join(', ')}`);
