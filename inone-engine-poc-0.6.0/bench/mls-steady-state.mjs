// Установившаяся группа MLS: группа собрана приглашениями, затем каждый участник обновил ключи,
// и каждый участник обработал каждый коммит. Измеряем размер и время коммита в этом состоянии.
// Не тест, запускается вручную: node bench/mls-steady-state.mjs 100 /tmp/steady.json
import { writeFileSync } from 'node:fs';
import { createIdentity, parseKeyPackage, createGroupState, addMember, joinFromWelcome, processCommit, selfUpdate, encryptText, decryptText } from '../test/mls-reference-client.mjs';

const n = Number(process.argv[2] ?? 100);
const outFile = process.argv[3] ?? '/tmp/steady.json';
const bytes = (b64) => Buffer.from(b64, 'base64').length;
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const started = performance.now();
const log = (text) => process.stderr.write(`[${((performance.now() - started) / 1000).toFixed(0)} с] ${text}\n`);

const creatorId = await createIdentity('m0');
const states = [await createGroupState(creatorId, `steady-${n}`)];
const addMs = [];
const welcomeBytes = [];
for (let i = 1; i < n; i++) {
  const id = await createIdentity(`m${i}`);
  const start = performance.now();
  const added = await addMember(states[0], parseKeyPackage(id.keyPackageB64));
  addMs.push(performance.now() - start);
  states[0] = added.newState;
  welcomeBytes.push(bytes(added.welcomeB64));
  for (let j = 1; j < i; j++) states[j] = await processCommit(states[j], added.commitB64);
  states.push(await joinFromWelcome(added.welcomeB64, id));
  if (i % 10 === 0) log(`добавлено ${i + 1} из ${n}`);
}
log('сборка группы готова');

const roundMs = [];
const roundBytes = [];
const processMs = [];
for (let k = 0; k < n; k++) {
  const start = performance.now();
  const update = await selfUpdate(states[k]);
  roundMs.push(performance.now() - start);
  states[k] = update.newState;
  roundBytes.push(bytes(update.commitB64));
  for (let j = 0; j < n; j++) {
    if (j === k) continue;
    const s = performance.now();
    states[j] = await processCommit(states[j], update.commitB64);
    processMs.push(performance.now() - s);
  }
  if (k % 10 === 9) log(`обновили ключи ${k + 1} из ${n}`);
}
log('все участники обновили ключи');

const start = performance.now();
const steady = await selfUpdate(states[0]);
const steadyMs = performance.now() - start;
states[0] = steady.newState;
const steadyBytes = bytes(steady.commitB64);
for (let j = 1; j < n; j++) states[j] = await processCommit(states[j], steady.commitB64);

const message = await encryptText(states[0], 'установившаяся группа');
const readers = [];
for (let j = 1; j < n; j++) {
  const r = await decryptText(states[j], message.messageB64);
  readers.push(r.text === 'установившаяся группа');
}
const epochs = new Set(states.map((s) => String(s.groupContext.epoch)));

const result = {
  members: n,
  welcomeBytesAvg: Math.round(avg(welcomeBytes)),
  welcomeBytesLast: welcomeBytes[welcomeBytes.length - 1],
  addMsAvg: Number(avg(addMs).toFixed(1)),
  updateRoundBytesAvg: Math.round(avg(roundBytes)),
  updateRoundMsAvg: Number(avg(roundMs).toFixed(1)),
  processMsAvg: Number(avg(processMs).toFixed(2)),
  steadyUpdateBytes: steadyBytes,
  steadyUpdateMs: Number(steadyMs.toFixed(1)),
  allReadersOk: readers.every(Boolean),
  epochsAgree: epochs.size === 1,
  totalSeconds: Number(((performance.now() - started) / 1000).toFixed(0)),
};
writeFileSync(outFile, JSON.stringify(result, null, 2));
log('готово: ' + JSON.stringify(result));
