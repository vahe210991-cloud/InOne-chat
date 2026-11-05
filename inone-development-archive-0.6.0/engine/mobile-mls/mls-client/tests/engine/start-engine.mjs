// Запускает настоящий сервер движка на свободном порту для тестов клиента. Выход — по закрытию stdin.
// Команды со стандартного входа: FLAG <ключ> <значение в JSON> меняет флаг так же, как оператор; ответ — OK.
// Путь к движку: переменная INONE_ENGINE_DIR; по умолчанию — папка engine рядом с mobile-mls.
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const engineDir = path.resolve(process.env.INONE_ENGINE_DIR ?? fileURLToPath(new URL('../../../..', import.meta.url)));
const { createServer } = await import(pathToFileURL(path.join(engineDir, 'src', 'server.js')).href);
const { createMemoryStore } = await import(pathToFileURL(path.join(engineDir, 'src', 'store-memory.js')).href);
const accessMs = process.env.INONE_ACCESS_TTL_MS ? Number(process.env.INONE_ACCESS_TTL_MS) : undefined;
const PEPPER = 'test-pepper-0123456789-0123456789-abcd';
const store = createMemoryStore({ pinPepper: PEPPER });
const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store, sessionTtl: accessMs ? { accessMs } : {} });
await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
console.log(`URL=http://127.0.0.1:${srv.server.address().port}`);
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  const m = /^FLAG (\S+) (.+)$/.exec(line.trim());
  if (!m) {
    console.log('ERR неизвестная команда');
    return;
  }
  try {
    await store.setFlag(m[1], JSON.parse(m[2]), 'клиентский тест', 'проверка клиента в тестах', Date.now());
    console.log('OK');
  } catch (error) {
    console.log(`ERR ${error.message}`);
  }
});
rl.on('close', () => srv.server.close(() => process.exit(0)));
