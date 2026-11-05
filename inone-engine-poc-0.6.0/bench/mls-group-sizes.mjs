// Измерение групп MLS: сколько весят и сколько занимают приветствия, удаления и самообновление.
// Не тест, запускается вручную: node bench/mls-group-sizes.mjs 100 500
// Ограничение: группа строится приглашениями одного создателя; обновления ключей других участников не моделируются.
import { createIdentity, parseKeyPackage, createGroupState, addMember, removeMember, selfUpdate } from '../test/mls-reference-client.mjs';

const bytes = (b64) => Buffer.from(b64, 'base64').length;
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

async function measure(n) {
  const creator = await createIdentity('creator');
  let state = await createGroupState(creator, `bench-${n}`);
  const packages = [];
  for (let i = 1; i < n; i++) packages.push(await createIdentity(`m${i}`));
  const welcomeBytes = [];
  const addMs = [];
  for (const id of packages) {
    const kp = parseKeyPackage(id.keyPackageB64);
    const t0 = performance.now();
    const r = await addMember(state, kp);
    addMs.push(performance.now() - t0);
    state = r.newState;
    welcomeBytes.push(bytes(r.welcomeB64));
  }
  const removeMs = [];
  const removeBytes = [];
  for (const leaf of [1, Math.floor(n / 2), n - 2]) {
    const t0 = performance.now();
    const r = await removeMember(state, leaf);
    removeMs.push(performance.now() - t0);
    removeBytes.push(bytes(r.commitB64));
    state = r.newState;
  }
  const t0 = performance.now();
  const u = await selfUpdate(state);
  const updateMs = performance.now() - t0;
  const updateBytes = bytes(u.commitB64);
  return {
    n,
    addMsAvg: avg(addMs).toFixed(0),
    welcomeBytesAvg: Math.round(avg(welcomeBytes)),
    welcomeBytesLast: welcomeBytes[welcomeBytes.length - 1],
    removeMsAvg: avg(removeMs).toFixed(0),
    removeBytesAvg: Math.round(avg(removeBytes)),
    updateMs: updateMs.toFixed(0),
    updateBytes,
  };
}

const sizes = process.argv.slice(2).map(Number).filter((x) => Number.isInteger(x) && x > 1);
const rows = [];
for (const n of sizes) {
  const t0 = performance.now();
  rows.push(await measure(n));
  process.stderr.write(`  n=${n} готово за ${((performance.now() - t0) / 1000).toFixed(1)} с\n`);
}
console.table(rows);
