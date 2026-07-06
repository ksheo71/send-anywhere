import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type Db = Database.Database

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS transfers (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE,
      slug TEXT UNIQUE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      download_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      transfer_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      size INTEGER NOT NULL,
      stored_path TEXT NOT NULL,
      upload_complete INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (transfer_id) REFERENCES transfers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_files_transfer ON files(transfer_id);
    CREATE INDEX IF NOT EXISTS idx_transfers_expires ON transfers(expires_at);
  `)
  return db
}
