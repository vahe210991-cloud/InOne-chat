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
  fs.writeFileSync(manifest, xml);
  if (!xml.includes('android.permission.INTERNET') ||
      !xml.includes('android.permission.POST_NOTIFICATIONS')) {
    throw new Error('Android internet/notification permissions are missing');
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

  const configPattern = /([A-F0-9]{24} \/\* (Debug|Release|Profile) \*\/ = \{\s*isa = XCBuildConfiguration;\s*buildSettings = \{)([\s\S]*?)(\n\s*\};\s*name = (Debug|Release|Profile);)/g;
  let targetConfigs = 0;
  pbx = pbx.replace(configPattern, (whole, prefix, configName, settings, suffix) => {
    if (!settings.includes('PRODUCT_BUNDLE_IDENTIFIER = com.inone.app;')) return whole;
    targetConfigs++;
    const aps = configName === 'Release' ? 'production' : 'development';
    let next = settings;
    if (!next.includes('CODE_SIGN_ENTITLEMENTS')) {
      next += '\n                CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;';
    }
    if (!next.includes('APS_ENVIRONMENT')) {
      next += '\n                APS_ENVIRONMENT = ' + aps + ';';
    }
    return prefix + next + suffix;
  });
  if (targetConfigs !== 3) {
    throw new Error('Expected 3 Runner build configurations, found ' + targetConfigs);
  }
  fs.writeFileSync(project, pbx);

  let plist = fs.readFileSync(info, 'utf8');
  if (!plist.includes('<key>UIBackgroundModes</key>')) {
    plist = plist.replace(
      '</dict>',
      '\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>remote-notification</string>\n\t</array>\n</dict>',
    );
    fs.writeFileSync(info, plist);
  }

  const verified = fs.readFileSync(project, 'utf8');
  if (!verified.includes('GoogleService-Info.plist in Resources') ||
      !verified.includes('CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;') ||
      !fs.readFileSync(entitlements, 'utf8').includes('aps-environment')) {
    throw new Error('iOS Firebase bundle/APNs configuration is incomplete');
  }
}

if (platforms.includes('android')) configureAndroid();
if (platforms.includes('ios')) configureIos();
console.log('Configured Firebase native runtime wiring for ' + platforms.join(', '));
