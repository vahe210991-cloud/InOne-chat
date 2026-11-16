import fs from 'node:fs';
import path from 'node:path';

const infoPlist = path.join(process.cwd(), 'ios', 'Runner', 'Info.plist');
if (!fs.existsSync(infoPlist)) {
  throw new Error(`Flutter iOS Info.plist was not generated: ${infoPlist}`);
}

let source = fs.readFileSync(infoPlist, 'utf8');
if (!/<key>FlutterDeepLinkingEnabled<\/key>\s*<true\/>/.test(source)) {
  const rootClose = source.lastIndexOf('</dict>');
  if (rootClose < 0) throw new Error('Info.plist root dictionary is malformed');
  source = source.slice(0, rootClose)
    + '  <key>FlutterDeepLinkingEnabled</key>\n  <true/>\n'
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
} else if (!/<key>CFBundleURLSchemes<\/key>[\s\S]*?<string>inone<\/string>/.test(source)) {
  throw new Error('Info.plist already defines URL types without the required inone scheme; merge the URL scheme manually');
}

fs.writeFileSync(infoPlist, source, 'utf8');
console.log('Configured the InOne recovery URL scheme for iOS.');
