#!/usr/bin/env node
/**
 * Deterministic, dependency-free comparison of the two historical InOne engine
 * source trees at HEAD. Reads Git's tracked blob index only; it never modifies files.
 *
 * Usage:
 *   node scripts/audit-engine-tree-drift.mjs
 *   node scripts/audit-engine-tree-drift.mjs --json
 *   node scripts/audit-engine-tree-drift.mjs --ref <commit-or-ref>
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ARCHIVE_ROOT = 'inone-development-archive-0.6.0/engine/';
export const POC_ROOT = 'inone-engine-poc-0.6.0/';

export function parseLsTree(output, root) {
  const result = new Map();
  for (const record of output.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab < 0) throw new Error('Invalid git ls-tree record: missing TAB separator');
    const [mode, type, sha] = record.slice(0, tab).split(' ');
    const fullPath = record.slice(tab + 1);
    if (!fullPath.startsWith(root)) continue;
    const relativePath = fullPath.slice(root.length);
    if (!relativePath) continue;
    result.set(relativePath, { path: relativePath, mode, type, sha });
  }
  return result;
}

export function compareEntries(archive, poc) {
  const identical = [];
  const divergent = [];
  const archiveOnly = [];
  const pocOnly = [];
  for (const [path, left] of archive) {
    const right = poc.get(path);
    if (!right) archiveOnly.push(left);
    else if (left.sha === right.sha && left.mode === right.mode) identical.push(left);
    else divergent.push({ path, archive: left, poc: right });
  }
  for (const [path, right] of poc) if (!archive.has(path)) pocOnly.push(right);
  const byPath = (a, b) => a.path.localeCompare(b.path);
  identical.sort(byPath);
  divergent.sort(byPath);
  archiveOnly.sort(byPath);
  pocOnly.sort(byPath);
  return {
    roots: { archive: ARCHIVE_ROOT, poc: POC_ROOT },
    counts: {
      archiveFiles: archive.size,
      pocFiles: poc.size,
      identical: identical.length,
      divergent: divergent.length,
      archiveOnly: archiveOnly.length,
      pocOnly: pocOnly.length,
    },
    identical,
    divergent,
    archiveOnly,
    pocOnly,
  };
}

export function collect(ref = 'HEAD') {
  const output = execFileSync(
    'git',
    ['ls-tree', '-r', '--full-tree', '-z', ref, '--', ARCHIVE_ROOT, POC_ROOT],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  return compareEntries(
    parseLsTree(output, ARCHIVE_ROOT),
    parseLsTree(output, POC_ROOT),
  );
}

export function toMarkdown(report, ref) {
  const { counts, divergent, archiveOnly, pocOnly } = report;
  const lines = [
    '# InOne engine tree drift audit',
    '',
    `Ref: \`${ref}\``,
    '',
    `- Archive tracked files: **${counts.archiveFiles}**`,
    `- POC tracked files: **${counts.pocFiles}**`,
    `- Identical files (blob + mode): **${counts.identical}**`,
    `- Divergent common files: **${counts.divergent}**`,
    `- Archive-only files: **${counts.archiveOnly}**`,
    `- POC-only files: **${counts.pocOnly}**`,
    '',
    '## Divergent common files',
    '',
    '| Relative path | Archive blob | POC blob | Archive bytes | POC bytes |',
    '|---|---|---|---:|---:|',
    ...divergent.map(x => `| \`${x.path}\` | \`${x.archive.sha}\` | \`${x.poc.sha}\` | — | — |`),
    '',
    '## Archive-only files',
    '',
    ...archiveOnly.map(x => `- \`${x.path}\` (\`${x.sha}\`)`),
    '',
    '## POC-only files',
    '',
    ...(pocOnly.length ? pocOnly.map(x => `- \`${x.path}\` (\`${x.sha}\`)`) : ['- None']),
    '',
    '> This report compares Git-tracked file blobs and modes. It does not decide which version is correct and does not inspect untracked files, generated build output, runtime behavior, or semantic equivalence.',
  ];
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  let ref = 'HEAD';
  const refIndex = args.indexOf('--ref');
  if (refIndex >= 0) {
    if (!args[refIndex + 1]) throw new Error('--ref requires a commit or ref');
    ref = args[refIndex + 1];
  }
  const report = collect(ref);
  process.stdout.write(args.includes('--json')
    ? JSON.stringify({ ref, ...report }, null, 2) + '\n'
    : toMarkdown(report, ref) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) {
    process.stderr.write(`engine tree audit failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
