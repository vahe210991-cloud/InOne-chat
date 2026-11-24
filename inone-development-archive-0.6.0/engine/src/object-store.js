// Object storage for opaque, client-encrypted file payloads.
// Buffer helpers remain for compatibility; streaming is the production transfer path.
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const OBJECT_KEY = /^[a-f0-9]{32}$/;

export function createMemoryObjectStore() {
  const objects = new Map();
  return {
    async put(key, bytes) {
      objects.set(key, Buffer.from(bytes));
    },
    async putStream(key, source) {
      const chunks = [];
      const sink = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk));
          callback();
        },
      });
      await pipeline(source, sink);
      const bytes = Buffer.concat(chunks);
      objects.set(key, bytes);
      return { size: bytes.length };
    },
    async get(key) {
      const bytes = objects.get(key);
      return bytes ? Buffer.from(bytes) : null;
    },
    getStream(key) {
      const bytes = objects.get(key);
      return bytes ? Readable.from([Buffer.from(bytes)]) : null;
    },
    async remove(key) {
      objects.delete(key);
    },
  };
}

/** Filesystem object store. Writes are isolated in unique temp files and published atomically. */
export function createFsObjectStore(dir) {
  const root = path.resolve(dir);
  const fileOf = (key) => {
    if (typeof key !== 'string' || !OBJECT_KEY.test(key)) throw new Error('object key must be a 32-character hex id');
    return path.join(root, key);
  };
  const syncDirectory = async () => {
    let directory;
    try {
      directory = await open(root, 'r');
      await directory.sync();
    } catch (error) {
      // Directory fsync is not supported by every platform/filesystem.
      if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(error.code)) throw error;
    } finally {
      await directory?.close().catch(() => {});
    }
  };
  return {
    root,
    async put(key, bytes) {
      const target = fileOf(key);
      await mkdir(root, { recursive: true, mode: 0o700 });
      const temp = `${target}.${randomBytes(8).toString('hex')}.tmp`;
      await writeFile(temp, bytes, { mode: 0o600, flag: 'wx' });
      await rename(temp, target);
      await syncDirectory();
    },
    async putStream(key, source) {
      const target = fileOf(key);
      await mkdir(root, { recursive: true, mode: 0o700 });
      const temp = `${target}.${randomBytes(8).toString('hex')}.tmp`;
      const handle = await open(temp, 'wx', 0o600);
      try {
        const sink = createWriteStream(temp, { fd: handle.fd, autoClose: false });
        await pipeline(source, sink);
        await handle.sync();
        await handle.close();
        await rename(temp, target);
        await syncDirectory();
        return { size: (await (await open(target, 'r')).stat()).size };
      } catch (error) {
        await handle.close().catch(() => {});
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
    getStream(key) {
      return createReadStream(fileOf(key));
    },
    async remove(key) {
      await rm(fileOf(key), { force: true });
      await syncDirectory();
    },
  };
}
