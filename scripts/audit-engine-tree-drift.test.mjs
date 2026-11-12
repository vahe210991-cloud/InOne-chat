import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLsTree, compareEntries, toMarkdown } from './audit-engine-tree-drift.mjs';

test('parseLsTree reads NUL-delimited Git records and strips the requested root', () => {
  const raw = '100644 blob abc123\tinone-development-archive-0.6.0/engine/src/a.js\0';
  const parsed = parseLsTree(raw, 'inone-development-archive-0.6.0/engine/');
  assert.equal(parsed.get('src/a.js').sha, 'abc123');
  assert.equal(parsed.get('src/a.js').mode, '100644');
});

test('compareEntries separates identical, divergent and one-sided files', () => {
  const archive = new Map([
    ['same.js', { path: 'same.js', mode: '100644', type: 'blob', sha: 'a' }],
    ['changed.js', { path: 'changed.js', mode: '100644', type: 'blob', sha: 'b' }],
    ['archive.js', { path: 'archive.js', mode: '100644', type: 'blob', sha: 'c' }],
  ]);
  const poc = new Map([
    ['same.js', { path: 'same.js', mode: '100644', type: 'blob', sha: 'a' }],
    ['changed.js', { path: 'changed.js', mode: '100644', type: 'blob', sha: 'd' }],
    ['poc.js', { path: 'poc.js', mode: '100644', type: 'blob', sha: 'e' }],
  ]);
  const report = compareEntries(archive, poc);
  assert.deepEqual(report.counts, {
    archiveFiles: 3, pocFiles: 3, identical: 1, divergent: 1, archiveOnly: 1, pocOnly: 1,
  });
  assert.equal(report.divergent[0].path, 'changed.js');
  assert.equal(report.archiveOnly[0].path, 'archive.js');
  assert.equal(report.pocOnly[0].path, 'poc.js');
});

test('compareEntries treats executable-mode drift as divergent', () => {
  const archive = new Map([['tool.sh', { path: 'tool.sh', mode: '100644', type: 'blob', sha: 'same' }]]);
  const poc = new Map([['tool.sh', { path: 'tool.sh', mode: '100755', type: 'blob', sha: 'same' }]]);
  assert.equal(compareEntries(archive, poc).counts.divergent, 1);
});

test('Markdown output is deterministic and warns against semantic conclusions', () => {
  const report = compareEntries(new Map(), new Map());
  const markdown = toMarkdown(report, 'HEAD');
  assert.match(markdown, /does not decide which version is correct/);
  assert.match(markdown, /POC-only files/);
});
