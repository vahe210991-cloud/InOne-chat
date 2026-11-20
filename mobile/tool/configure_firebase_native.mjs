import fs from 'node:fs';
import path from 'node:path';

const platformsArg = process.argv[2];
const appRoot = path.resolve(process.argv[3] || '');
if (!platformsArg || !process.argv[3]) {
  throw new Error('Usage: node tool/configure_firebase_native.mjs <android[,ios]> <mobile-root>');
}
const platforms = platformsArg.split(',');
if (platforms.some((value) => value !== 'android' && value !== 'ios') ||
    new Set(platforms).size !== platforms.length) {
  throw new Error('Unsupported or duplicate platform list: ' + platformsArg);
}

function addGradlePlugin(file, pluginId, declaration) {
  let source = fs.readFileSync(file, 'utf8');
  if (source.includes(pluginId)) return;
  const block = source.match(/plugins\s*\{[\s\S]*?\}/);
  if (!block) throw new Error('Gradle plugins block missing: ' + file);
  const index = block.index + block[0].indexOf('{') + 1;
  source = source.slice(0, index) + '\n    ' + declaration + source.slice(index);
  fs.writeFileSync(file, source);
  if (!fs.readFileSync(file, 'utf8').includes(pluginId)) {
    throw new Error('Could not install Gradle plugin ' + pluginId);
  }
}

function configureAndroid() {
  const root = path.join(appRoot, 'android');
  const settings = path.join(root, 'settings.gradle.kts');
  const appGradle = path.join(root, 'app', 'build.gradle.kts');
  const manifest = path.join(root, 'app', 'src', 'main', 'AndroidManifest.xml');
  for (const file of [settings, appGradle, manifest]) {
    if (!fs.existsSync(file)) throw new Error('Generated Android file missing: ' + file);
  }
  addGradlePlugin(
    settings,
    'com.google.gms.google-services',
    'id("com.google.gms.google-services") version "4.6.0" apply false',
  );
  addGradlePlugin(
    appGradle,
    'com.google.gms.google-services',
    'id("com.google.gms.google-services")',
  );
  // Firebase Android Messaging 26.x requires API 24 or newer.
  let appSource = fs.readFileSync(appGradle, 'utf8');
  const minSdkLine = appSource.match(/^([	 ]*)minSdk(?:Version)?\s*=\s*[^\r\n]+/m);
  if (minSdkLine) {
    appSource = appSource.replace(
      /^([	 ]*)minSdk(?:Version)?\s*=\s*[^\r\n]+/m,
      '$1minSdk = 24',
    );
  } else {
    const defaultConfigIndex = appSource.search(/defaultConfig\s*\{/);
    if (defaultConfigIndex < 0) {
      throw new Error('Generated Android app Gradle file has no defaultConfig block');
    }
    const configOpen = appSource.indexOf('{', defaultConfigIndex);
    appSource = appSource.slice(0, configOpen + 1) +
      '\n        minSdk = 24' + appSource.slice(configOpen + 1);
  }
  if (!/^([	 ]*)minSdk\s*=\s*24$/m.test(appSource)) {
    throw new Error('Failed to enforce Android minSdk 24');
  }
  fs.writeFileSync(appGradle, appSource);
  let xml = fs.readFileSync(manifest, 'utf8');
  for (const permission of [
    'android.permission.INTERNET',
    'android.permission.POST_NOTIFICATIONS',
  ]) {
    if (!xml.includes('android:name="' + permission + '"')) {
      xml = xml.replace(
        /<manifest\b[^>]*>/,
        (tag) => tag + '\n    <uses-permission android:name="' + permission + '" />',
      );
    }
  }
  const applicationClose = xml.lastIndexOf('</application>');
  if (applicationClose < 0) throw new Error('Android application element is missing');
  const metadata = [
    ['firebase_messaging_installation_id_enabled', 'true'],
    ['firebase_messaging_auto_init_enabled', 'false'],
    ['firebase_analytics_collection_enabled', 'false'],
  ];
  for (const [name, value] of metadata) {
    if (!xml.includes('android:name="' + name + '"')) {
      xml = xml.slice(0, xml.lastIndexOf('</application>')) +
        '    <meta-data android:name="' + name + '" android:value="' + value + '" />\\n' +
        xml.slice(xml.lastIndexOf('</application>'));
    }
  }
  fs.writeFileSync(manifest, xml);
  if (!xml.includes('android.permission.INTERNET') ||
      !xml.includes('android.permission.POST_NOTIFICATIONS') ||
      !xml.includes('android:name="firebase_messaging_installation_id_enabled"') ||
      !xml.includes('android:name="firebase_messaging_auto_init_enabled"') ||
      !xml.includes('android:name="firebase_analytics_collection_enabled"')) {
    throw new Error('Android Firebase FID/auto-init/permission configuration is incomplete');
  }
}

function configureIos() {
  const root = path.join(appRoot, 'ios');
  const project = path.join(root, 'Runner.xcodeproj', 'project.pbxproj');
  const info = path.join(root, 'Runner', 'Info.plist');
  const entitlements = path.join(root, 'Runner', 'Runner.entitlements');
  if (!fs.existsSync(project) || !fs.existsSync(info)) {
    throw new Error('Generated iOS Xcode project or Info.plist is missing');
  }

  const fileRef = 'F1A2B3C4D5E6478899AABB01';
  const buildFile = 'F1A2B3C4D5E6478899AABB02';
  const entitlementRef = 'F1A2B3C4D5E6478899AABB03';
  let pbx = fs.readFileSync(project, 'utf8');

  if (!pbx.includes('GoogleService-Info.plist in Resources')) {
    const buildSection = pbx.match(/\/\* Begin PBXBuildFile section \*\/[\s\S]*?\/\* End PBXBuildFile section \*\//);
    const refSection = pbx.match(/\/\* Begin PBXFileReference section \*\/[\s\S]*?\/\* End PBXFileReference section \*\//);
    if (!buildSection || !refSection) throw new Error('Xcode file/build sections are missing');

    pbx = pbx.replace(
      buildSection[0],
      buildSection[0].replace(
        '/* End PBXBuildFile section */',
        '  ' + buildFile + ' /* GoogleService-Info.plist in Resources */ = {isa = PBXBuildFile; fileRef = ' +
          fileRef + ' /* GoogleService-Info.plist */; };\n/* End PBXBuildFile section */',
      ),
    );
    pbx = pbx.replace(
      refSection[0],
      refSection[0].replace(
        '/* End PBXFileReference section */',
        '  ' + fileRef + ' /* GoogleService-Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = "GoogleService-Info.plist"; sourceTree = "<group>"; };\n' +
          '  ' + entitlementRef + ' /* Runner.entitlements */ = {isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = Runner.entitlements; sourceTree = "<group>"; };\n' +
          '/* End PBXFileReference section */',
      ),
    );

    const runnerGroup = /([A-F0-9]{24} \/\* Runner \*\/ = \{\s*isa = PBXGroup;\s*children = \()([\s\S]*?)(\s*\);\s*path = Runner;)/;
    if (!runnerGroup.test(pbx)) throw new Error('Xcode Runner group not found');
    pbx = pbx.replace(
      runnerGroup,
      '$1\n                ' + fileRef + ' /* GoogleService-Info.plist */,\n                ' +
        entitlementRef + ' /* Runner.entitlements */,$2$3',
    );

    const start = pbx.indexOf('/* Begin PBXResourcesBuildPhase section */');
    const end = pbx.indexOf('/* End PBXResourcesBuildPhase section */');
    if (start < 0 || end < 0) throw new Error('Xcode resources phase section missing');
    const section = pbx.slice(start, end);
    const list = section.match(/(files = \()([\s\S]*?)(\s*\);)/);
    if (!list) throw new Error('Runner resource list not found');
    const updated = section.replace(
      list[0],
      list[1] + '\n                ' + buildFile +
        ' /* GoogleService-Info.plist in Resources */,' + list[2] + list[3],
    );
    pbx = pbx.slice(0, start) + updated + pbx.slice(end);
  }

  if (!fs.existsSync(entitlements)) {
    fs.writeFileSync(
      entitlements,
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
      '<plist version="1.0"><dict><key>aps-environment</key><string>$(APS_ENVIRONMENT)</string></dict></plist>\n',
    );
  }

  // Locate each XCBuildConfiguration object by its ISA marker. This avoids
  // depending on Xcode's generated UUID comments or indentation.
  const insertions = [];
  let targetConfigs = 0;
  let cursor = 0;
  let isaIndex;
  while ((isaIndex = pbx.indexOf('isa = XCBuildConfiguration;', cursor)) >= 0) {
    const objectOpen = pbx.lastIndexOf('{', isaIndex);
    if (objectOpen < 0) throw new Error('Xcode build configuration object has no opening brace');
    let depth = 0;
    let objectClose = -1;
    for (let index = objectOpen; index < pbx.length; index++) {
      if (pbx[index] === '{') depth++;
      if (pbx[index] === '}') {
        depth--;
        if (depth === 0) {
          objectClose = index;
          break;
        }
      }
    }
    if (objectClose < 0) throw new Error('Malformed Xcode build configuration object');
    const block = pbx.slice(objectOpen, objectClose + 1);
    cursor = objectClose + 1;
    const nameMatch = block.match(/name\s*=\s*(Debug|Release|Profile);/);
    if (!nameMatch ||
        !/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?com\.inone\.app"?;/.test(block)) {
      continue;
    }

    const settingsStart = block.indexOf('buildSettings = {');
    if (settingsStart < 0) throw new Error('Runner build settings dictionary is missing');
    const settingsOpen = block.indexOf('{', settingsStart);
    let settingsDepth = 0;
    let settingsClose = -1;
    for (let index = settingsOpen; index < block.length; index++) {
      if (block[index] === '{') settingsDepth++;
      if (block[index] === '}') {
        settingsDepth--;
        if (settingsDepth === 0) {
          settingsClose = index;
          break;
        }
      }
    }
    if (settingsClose < 0) throw new Error('Malformed Runner build settings dictionary');
    const settings = block.slice(settingsOpen + 1, settingsClose);
    const configName = nameMatch[1];
    const aps = configName === 'Release' ? 'production' : 'development';
    let additions = '';
    if (!settings.includes('CODE_SIGN_ENTITLEMENTS')) {
      additions += '\n                CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;';
    }
    if (!settings.includes('APS_ENVIRONMENT')) {
      additions += '\n                APS_ENVIRONMENT = ' + aps + ';';
    }
    if (additions) insertions.push({ index: objectOpen + settingsClose, text: additions });
    targetConfigs++;
  }
  for (const insertion of insertions.sort((left, right) => right.index - left.index)) {
    pbx = pbx.slice(0, insertion.index) + insertion.text + pbx.slice(insertion.index);
  }
  if (targetConfigs !== 3) {
    throw new Error('Expected 3 Runner build configurations for com.inone.app, found ' + targetConfigs);
  }
  fs.writeFileSync(project, pbx);

  let plist = fs.readFileSync(info, 'utf8');
  const backgroundKey = '<key>UIBackgroundModes</key>';
  const backgroundStart = plist.indexOf(backgroundKey);
  if (backgroundStart >= 0) {
    const arrayStart = plist.indexOf('<array>', backgroundStart);
    const arrayEnd = plist.indexOf('</array>', arrayStart);
    if (arrayStart < 0 || arrayEnd < 0) throw new Error('Malformed UIBackgroundModes array');
    let modes = plist.slice(arrayStart + '<array>'.length, arrayEnd);
    if (!modes.includes('<string>fetch</string>')) modes += '\n\t\t<string>fetch</string>';
    if (!modes.includes('<string>remote-notification</string>')) {
      modes += '\n\t\t<string>remote-notification</string>';
    }
    plist = plist.slice(0, arrayStart) + '<array>' + modes + '</array>' +
      plist.slice(arrayEnd + '</array>'.length);
  } else {
    plist = plist.replace(
      '</dict>',
      '\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>fetch</string>\n\t\t<string>remote-notification</string>\n\t</array>\n</dict>',
    );
  }
  if (!plist.includes('<key>FirebaseMessagingInstallationIdEnabled</key>')) {
    plist = plist.replace(
      '</dict>',
      '\t<key>FirebaseMessagingInstallationIdEnabled</key>\n\t<true/>\n</dict>',
    );
  }
  if (!plist.includes('<key>FirebaseMessagingAutoInitEnabled</key>')) {
    plist = plist.replace(
      '</dict>',
      '\t<key>FirebaseMessagingAutoInitEnabled</key>\n\t<false/>\n</dict>',
    );
  }
  fs.writeFileSync(info, plist);

  const verified = fs.readFileSync(project, 'utf8');
  const verifiedPlist = fs.readFileSync(info, 'utf8');
  if (!verified.includes('GoogleService-Info.plist in Resources') ||
      !verified.includes('CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;') ||
      !fs.readFileSync(entitlements, 'utf8').includes('aps-environment') ||
      !verifiedPlist.includes('<key>FirebaseMessagingInstallationIdEnabled</key>') ||
      !verifiedPlist.includes('<key>FirebaseMessagingAutoInitEnabled</key>') ||
      !verifiedPlist.includes('<string>fetch</string>') ||
      !verifiedPlist.includes('<string>remote-notification</string>')) {
    throw new Error('iOS Firebase FID/auto-init/APNs configuration is incomplete');
  }
}

if (platforms.includes('android')) configureAndroid();
if (platforms.includes('ios')) configureIos();
console.log('Configured Firebase native runtime wiring for ' + platforms.join(', '));
