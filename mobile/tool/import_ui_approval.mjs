#!/usr/bin/env node
/**
 * Copies the already-extracted canonical ui-approval package into Flutter's
 * local asset tree. Run from repository root:
 *   node mobile/tool/import_ui_approval.mjs /path/to/extracted/ui-approval
 * This script does not edit source files, rewrite HTML, or generate new design.
 */
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
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
const sourceManifest = {
  packageVersion: manifest.version,
  manifestSha256: digest(manifestBytes),
  screenCount: manifest.screens.length,
  screenIds: manifest.screens.map(({ id }) => id),
  sourceFiles: ['index.html', 'screen-manifest.json', 'design-tokens.css', 'design-tokens.v2.css', 'interactions.js', 'interactions.v2.js', 'API-INTEGRATION.md', 'API-INTEGRATION-v1.md'],
};
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true, force: true });
await writeFile(path.join(destination, 'IMPORT-MANIFEST.json'), JSON.stringify(sourceManifest, null, 2) + '\\n');
console.log(JSON.stringify({ destination, packageVersion: manifest.version, screens: manifest.screens.length, manifestSha256: sourceManifest.manifestSha256 }, null, 2));
