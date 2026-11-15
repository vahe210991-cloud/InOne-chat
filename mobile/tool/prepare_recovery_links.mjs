import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const infoPlistPath = path.join(root, 'ios', 'Runner', 'Info.plist');

if (!fs.existsSync(manifestPath)) {
  throw new Error(`Flutter Android manifest was not generated: ${manifestPath}`);
}
if (!fs.existsSync(infoPlistPath)) {
  throw new Error(`Flutter iOS Info.plist was not generated: ${infoPlistPath}`);
}

let manifest = fs.readFileSync(manifestPath, 'utf8');
if (!manifest.includes('android:scheme="inone"')) {
  const activityName = manifest.indexOf('android:name=".MainActivity"');
  if (activityName < 0) {
    throw new Error('Could not find the generated .MainActivity declaration in AndroidManifest.xml');
  }
  const activityStart = manifest.lastIndexOf('<activity', activityName);
  const activityEnd = manifest.indexOf('</activity>', activityName);
  if (activityStart < 0 || activityEnd < 0) {
    throw new Error('Could not locate the MainActivity element in AndroidManifest.xml');
  }
  const intentFilter = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="inone" android:host="recovery" android:path="/confirm" />
            </intent-filter>
`;
  manifest = manifest.slice(0, activityEnd) + intentFilter + manifest.slice(activityEnd);
  fs.writeFileSync(manifestPath, manifest, 'utf8');
}

let infoPlist = fs.readFileSync(infoPlistPath, 'utf8');
if (!infoPlist.includes('<string>inone</string>')) {
  const urlTypesKey = infoPlist.indexOf('<key>CFBundleURLTypes</key>');
  const urlType = `
        <dict>
            <key>CFBundleURLName</key>
            <string>com.inone.inone_mobile.recovery</string>
            <key>CFBundleURLSchemes</key>
            <array>
                <string>inone</string>
            </array>
        </dict>
`;
  if (urlTypesKey >= 0) {
    const arrayStart = infoPlist.indexOf('<array>', urlTypesKey);
    const arrayEnd = infoPlist.indexOf('</array>', arrayStart);
    if (arrayStart < 0 || arrayEnd < 0) {
      throw new Error('CFBundleURLTypes exists but its array could not be located');
    }
    infoPlist = infoPlist.slice(0, arrayEnd) + urlType + infoPlist.slice(arrayEnd);
  } else {
    const rootEnd = infoPlist.lastIndexOf('</dict>');
    if (rootEnd < 0) throw new Error('Could not locate the root dictionary in Info.plist');
    const keyBlock = `
    <key>CFBundleURLTypes</key>
    <array>
${urlType}
    </array>
`;
    infoPlist = infoPlist.slice(0, rootEnd) + keyBlock + infoPlist.slice(rootEnd);
  }
  fs.writeFileSync(infoPlistPath, infoPlist, 'utf8');
}

console.log('Configured the InOne recovery custom URL scheme on Android and iOS.');
console.log('Verified HTTPS App Links / Universal Links still require the production domain and platform association files.');
