// Объектное хранилище для файлов. Сервер хранит только байты: клиент шифрует файл до отправки.
// Две реализации с одним интерфейсом (put, get, remove): на диске своего сервера и в памяти для тестов.
import { chmod, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const OBJECT_KEY = /^[a-f0-9]{32}$/;

export function createMemoryObjectStore() {
  const objects = new Map();
  return {
    async put(key, bytes) {
      objects.set(key, Buffer.from(bytes));
    },
    async get(key) {
      const bytes = objects.get(key);
      return bytes ? Buffer.from(bytes) : null;
    },
    async remove(key) {
      objects.delete(key);
    },
  };
}

/** Хранилище на диске сервера. Имя файла — случайный идентификатор объекта, имя пользователя не используется. */
export function createFsObjectStore(dir) {
  const root = path.resolve(dir);
  const fileOf = (key) => {
    if (typeof key !== 'string' || !OBJECT_KEY.test(key)) throw new Error('object key must be a 32-character hex id');
    return path.join(root, key);
  };
  const ensureRoot = async () => {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('object store root must be a real directory, not a symlink');
    await chmod(root, 0o700);
  };
  const syncRoot = async () => {
    const handle = await open(root, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  };
  return {
    root,
    async put(key, bytes) {
      const target = fileOf(key);
      await ensureRoot();
      const temp = `${target}.${randomBytes(8).toString('hex')}.tmp`;
      let handle;
      try {
        handle = await open(temp, 'wx', 0o600);
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close();
        handle = null;
        await rename(temp, target); // атомарно: читатель видит либо весь объект, либо ничего
        await syncRoot();
      } catch (error) {
        await handle?.close().catch(() => {});
        await rm(temp, { force: true }).catch(() => {});
        throw error;
      }
    },
    async get(key) {
      await ensureRoot();
      try {
        return await readFile(fileOf(key));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async remove(key) {
      await ensureRoot();
      await rm(fileOf(key), { force: true });
      await syncRoot();
    },
  };
}
