// Объектное хранилище для файлов. Сервер хранит только байты: клиент шифрует файл до отправки.
// Две реализации с одним интерфейсом (put, get, remove): на диске своего сервера и в памяти для тестов.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
  return {
    root,
    async put(key, bytes) {
      const target = fileOf(key);
      await mkdir(root, { recursive: true, mode: 0o700 });
      const temp = `${target}.${randomBytes(8).toString('hex')}.tmp`;
      try {
        await writeFile(temp, bytes, { mode: 0o600 });
        await rename(temp, target); // атомарно: читатель видит либо весь объект, либо ничего
      } catch (error) {
        await rm(temp, { force: true }).catch(() => {});
        throw error;
      }
    },
    async get(key) {
      try {
        return await readFile(fileOf(key));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async remove(key) {
      await rm(fileOf(key), { force: true });
    },
  };
}
