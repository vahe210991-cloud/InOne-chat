#!/usr/bin/env node
/**
 * Copies the extracted canonical ui-approval package into Flutter's local
 * asset tree. Run from repository root:
 *   node mobile/tool/import_ui_approval.mjs /path/to/extracted/ui-approval
 *
 * The source archive remains immutable. Only the runtime copy receives the
 * documented v1 font-link patch: remote Google Fonts references are replaced
 * with the exact supplied local WOFF2 files.
 */
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const sourceArg = process.argv[2];
if (!sourceArg) {
  console.error('Usage: node mobile/tool/import_ui_approval.mjs <extracted-ui-approval-directory>');
  process.exit(2);
}
const source = path.resolve(sourceArg);
const repoRoot = process.cwd();
const destination = path.join(repoRoot, 'mobile/assets/ui-approval');
const manifestPath = path.join(source, 'screen-manifest.json');
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest.version !== '0.8-approval-batch-2') {
  throw new Error(`Unexpected UI package version: ${manifest.version}`);
}
if (!Array.isArray(manifest.screens) || manifest.screens.length !== 24) {
  throw new Error('Expected 24 manifest screens; refusing partial or different package');
}
for (const screen of manifest.screens) {
  const file = path.resolve(source, screen.file);
  if (!file.startsWith(source + path.sep)) throw new Error(`Unsafe screen path: ${screen.file}`);
  await readFile(file);
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true, force: true });

// The seven owner-approved v1 screens refer to Google Fonts. Keep the source
// files untouched and patch only the runtime copy to use supplied local fonts.
const legacyV1Files = [
  'screens/chat/CH-01.html',
  'screens/chat/CH-02.html',
  'screens/rooms/GR-01.html',
  'screens/rooms/GR-02.html',
  'screens/rooms/GR-04.html',
  'screens/organizations/OR-01.html',
  'screens/profile/PR-01.html',
];
const remoteFontLink = /<link\s+href="https:\/\/fonts\.googleapis\.com\/css2\?family=Noto\+Sans[^"]*"\s+rel="stylesheet">/g;
for (const relative of legacyV1Files) {
  const file = path.join(destination, relative);
  const html = await readFile(file, 'utf8');
  const patched = html.replace(remoteFontLink, '<link rel="stylesheet" href="../../legacy-fonts.css">');
  if (patched === html && html.includes('fonts.googleapis.com')) {
    throw new Error(`Could not replace remote font link in ${relative}`);
  }
  await writeFile(file, patched);
}
const legacyFonts = `@font-face{font-family:'Noto Sans';font-style:normal;font-weight:400 800;font-display:swap;src:url(assets/fonts/cyrillic-ext.woff2) format('woff2');unicode-range:U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F}
@font-face{font-family:'Noto Sans';font-style:normal;font-weight:400 800;font-display:swap;src:url(assets/fonts/cyrillic.woff2) format('woff2');unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:'Noto Sans';font-style:normal;font-weight:400 800;font-display:swap;src:url(assets/fonts/latin-ext.woff2) format('woff2');unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:'Noto Sans';font-style:normal;font-weight:400 800;font-display:swap;src:url(assets/fonts/latin.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF}
@font-face{font-family:'Noto Sans Armenian';font-style:normal;font-weight:400 800;font-display:swap;src:url(assets/fonts/armenian.woff2) format('woff2');unicode-range:U+0308,U+0530-058F,U+2010,U+2024,U+25CC,U+FB13-FB17}
`;
await writeFile(path.join(destination, 'legacy-fonts.css'), legacyFonts);
const sourceManifest = {
  packageVersion: manifest.version,
  manifestSha256: digest(manifestBytes),
  screenCount: manifest.screens.length,
  screenIds: manifest.screens.map(({ id }) => id),
  totalApprovedHtmlScreens: 31,
  runtimeOnlyPatches: [{
    files: legacyV1Files,
    change: 'Replace remote Google Fonts stylesheet with local legacy-fonts.css using supplied WOFF2 files',
    sourceFilesRemainUnmodified: true,
  }],
};
await writeFile(path.join(destination, 'IMPORT-MANIFEST.json'), JSON.stringify(sourceManifest, null, 2) + '\n');
const externalFontsRemain = [];
for (const relative of legacyV1Files) {
  const html = await readFile(path.join(destination, relative), 'utf8');
  if (html.includes('fonts.googleapis.com')) externalFontsRemain.push(relative);
}
if (externalFontsRemain.length) throw new Error(`Remote font references remain: ${externalFontsRemain.join(', ')}`);
console.log(JSON.stringify({
  destination,
  packageVersion: manifest.version,
  manifestScreens: manifest.screens.length,
  totalApprovedHtmlScreens: 31,
  manifestSha256: sourceManifest.manifestSha256,
  localFontPatch: 'PASS',
}, null, 2));
