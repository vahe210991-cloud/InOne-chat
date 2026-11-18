import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const main = readFileSync('lib/main.dart', 'utf8');
const pubspec = readFileSync('pubspec.yaml', 'utf8');
const lockfile = readFileSync('pubspec.lock', 'utf8');

if (!main.includes("app/inone_mobile_app.dart") || !main.includes("InOneMobileApp")) {
  throw new Error('The Flutter entry point must launch InOneMobileApp.');
}
if (/webview_flutter|WebViewController|loadFlutterAsset|InOneBridge/.test(main)) {
  throw new Error('The application entry point still contains a legacy HTML/WebView runtime path.');
}
if (/webview_flutter/.test(pubspec) || /webview_flutter/.test(lockfile) || /^\s+assets:\s*$/m.test(pubspec)) {
  throw new Error('The mobile pubspec must not bundle WebView or legacy HTML assets.');
}

function walk(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

const dartFiles = walk('lib').filter((path) => path.endsWith('.dart'));
for (const path of dartFiles) {
  const source = readFileSync(path, 'utf8');
  if (/package:webview_flutter|WebViewController|loadFlutterAsset|InOneBridge/.test(source)) {
    throw new Error(`Legacy WebView reference remains in production Dart source: ${path}`);
  }
}

const htmlFiles = [
  ...walk('lib').filter((path) => path.endsWith('.html')),
  ...(existsSync('assets') ? walk('assets').filter((path) => path.endsWith('.html')) : []),
];
if (htmlFiles.length !== 0) {
  throw new Error(`Legacy HTML assets remain inside the mobile package: ${htmlFiles.join(', ')}`);
}

console.log(`Native-only mobile runtime verified: ${dartFiles.length} Dart files; no HTML assets or WebView bridge.`);
