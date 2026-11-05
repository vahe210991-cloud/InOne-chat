// Эталонный клиент MLS для проверки серверного контракта. Только для тестов: байты RFC 9420 через ts-mls.
// Продуктовый клиент будет отдельной реализацией (мобильная библиотека), этот файл её не заменяет.
import {
  createGroup, joinGroup, createCommit, processMessage, createApplicationMessage, generateKeyPackage,
  defaultCapabilities, defaultLifetime, getCiphersuiteImpl, getCiphersuiteFromName, emptyPskIndex,
  encodeMlsMessage, decodeMlsMessage,
} from 'ts-mls';

const enc = new TextEncoder();
const dec = new TextDecoder();
const SUITE = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519';
const accept = async () => ({ kind: 'accept' });
let cipherSuite = null;
const suite = async () => (cipherSuite ??= await getCiphersuiteImpl(getCiphersuiteFromName(SUITE)));
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const fromB64 = (text) => new Uint8Array(Buffer.from(text, 'base64'));
const first = (decoded) => (Array.isArray(decoded) ? decoded[0] : decoded);

/** Личность участника: пара ключей и ключевой пакет в виде base64, который уходит на сервер. */
export async function createIdentity(name) {
  const cs = await suite();
  const { publicPackage, privatePackage } = await generateKeyPackage({ credentialType: 'basic', identity: enc.encode(name) }, defaultCapabilities(), defaultLifetime, [], cs);
  return { name, publicPackage, privatePackage, keyPackageB64: b64(encodeMlsMessage({ version: 'mls10', wireformat: 'mls_key_package', keyPackage: publicPackage })) };
}

/** Ключевой пакет, полученный с сервера, в виде объекта, который принимает приглашение. */
export function parseKeyPackage(base64) {
  return first(decodeMlsMessage(fromB64(base64), 0)).keyPackage;
}

export async function createGroupState(identity, groupId) {
  return createGroup(enc.encode(groupId), identity.publicPackage, identity.privatePackage, [], await suite());
}

/** Приглашение: коммит с добавлением и приветствие для нового участника, оба в виде байтов. */
export async function addMember(state, keyPackage) {
  const result = await createCommit({ state, cipherSuite: await suite() }, {
    extraProposals: [{ proposalType: 'add', add: { keyPackage } }],
    ratchetTreeExtension: true,
  });
  return {
    newState: result.newState,
    commitB64: b64(encodeMlsMessage(result.commit)),
    welcomeB64: b64(encodeMlsMessage({ version: 'mls10', wireformat: 'mls_welcome', welcome: result.welcome })),
  };
}

/** Удаление участника по индексу листа в дереве группы. */
export async function removeMember(state, leafIndex) {
  const result = await createCommit({ state, cipherSuite: await suite() }, {
    extraProposals: [{ proposalType: 'remove', remove: { removed: leafIndex } }],
  });
  return { newState: result.newState, commitB64: b64(encodeMlsMessage(result.commit)) };
}

/** Самообновление участника: коммит без предложений, обновляет путь его листа. */
export async function selfUpdate(state) {
  const result = await createCommit({ state, cipherSuite: await suite() }, {});
  return { newState: result.newState, commitB64: b64(encodeMlsMessage(result.commit)) };
}

export async function joinFromWelcome(welcomeB64, identity) {
  const welcome = first(decodeMlsMessage(fromB64(welcomeB64), 0)).welcome;
  return joinGroup(welcome, identity.publicPackage, identity.privatePackage, emptyPskIndex, await suite());
}

/** Обработка коммита. Для удалённого участника обработка может завершиться ошибкой — это тоже ответ. */
export async function processCommit(state, commitB64) {
  const message = first(decodeMlsMessage(fromB64(commitB64), 0));
  return (await processMessage(message, state, emptyPskIndex, accept, await suite())).newState;
}

export async function encryptText(state, text) {
  const result = await createApplicationMessage(state, enc.encode(text), await suite());
  return {
    newState: result.newState,
    messageB64: b64(encodeMlsMessage({ version: 'mls10', wireformat: 'mls_private_message', privateMessage: result.privateMessage })),
  };
}

/** Расшифровка сообщения. Текст ищется в результате обработки: поле с байтами сообщения. */
export async function decryptText(state, messageB64) {
  const result = await processMessage(first(decodeMlsMessage(fromB64(messageB64), 0)), state, emptyPskIndex, accept, await suite());
  const found = [];
  const walk = (value, depth) => {
    if (depth > 4 || value == null) return;
    if (value instanceof Uint8Array) { found.push(value); return; }
    if (typeof value === 'object') for (const k of Object.keys(value)) walk(value[k], depth + 1);
  };
  for (const k of Object.keys(result)) if (k !== 'newState') walk(result[k], 0);
  if (found.length === 0) throw new Error('no plaintext in the processing result');
  return { newState: result.newState, text: dec.decode(found[0]) };
}
