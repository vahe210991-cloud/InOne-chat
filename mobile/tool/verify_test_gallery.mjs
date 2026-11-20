import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const parts = Array.from({ length: 7 }, (_, index) => {
  const number = String(index + 1).padStart(2, '0');
  return readFileSync(new URL('../assets/test-ui/part-' + number + '.b64', import.meta.url), 'utf8').trim();
});
const html = gunzipSync(Buffer.from(parts.join(''), 'base64')).toString('utf8');
const cards = Array.from(html.matchAll(/<article class="screen-card"[^>]*data-title="([^"]+)"/g));
assert.equal(cards.length, 73, 'The source gallery must contain exactly 73 test screen cards');

const catalog = readFileSync(new URL('../lib/test_screens.dart', import.meta.url), 'utf8');
const expectedIds = Array.from(catalog.matchAll(/\bTestScreen\s*\(\s*id\s*:\s*"([^"]+)"/g), (match) => match[1]);
assert.equal(expectedIds.length, 73, 'The Flutter catalogue must contain exactly 73 test screen IDs');
assert.equal(new Set(expectedIds).size, expectedIds.length, 'The Flutter catalogue must not contain duplicate screen IDs');
for (const id of expectedIds) {
  assert.equal(cards.filter((card) => card[1].includes(id)).length, 1, 'Gallery card missing or duplicated: ' + id);
}
console.log('Verified original gallery: 73/73 screen cards match the Flutter test catalogue.');
