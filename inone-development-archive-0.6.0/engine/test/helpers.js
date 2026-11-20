// Отдельная схема PostgreSQL на каждый тест: тесты не мешают друг другу и не оставляют мусора.
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createStore } from '../src/store.js';

const SCHEMA_SQL = new URL('../src/schema.sql', import.meta.url);

export async function testDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL не задан');
  const name = `t_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA ${name}`);
  const pool = new pg.Pool({ connectionString: url, max: 40, options: `-c search_path=${name}` });
  await pool.query(await readFile(SCHEMA_SQL, 'utf8'));
  return {
    pool,
    async close() {
      await pool.end();
      await admin.query(`DROP SCHEMA ${name} CASCADE`);
      await admin.end();
    },
  };
}

/** Хранилище на отдельной схеме PostgreSQL для одного теста, если задан DATABASE_URL. Иначе null: тест идёт в памяти. */
export async function storeForTest(pinPepper, storeOptions = {}) {
  if (!process.env.DATABASE_URL) return null;
  const db = await testDatabase();
  return { store: createStore({ pool: db.pool, pinPepper, ...storeOptions }), pool: db.pool, close: () => db.close() };
}
