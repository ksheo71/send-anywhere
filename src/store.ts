import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Db } from './db.js'
import type { Config } from './config.js'
import { generateCode, generateSlug } from './ids.js'

export interface TransferRecord {
  id: string; code: string; slug: string
  createdAt: number; expiresAt: number; status: string
}
export interface FileRecord {
  id: string; filename: string; size: number
  storedPath: string; uploadComplete: boolean
}
export interface TransferView extends TransferRecord { files: FileRecord[] }

export interface Store {
  createTransfer(files: { filename: string; size: number }[]): TransferRecord
  markFileComplete(fileId: string): void
  finalizeTransfer(id: string): void
  resolve(codeOrSlug: string): TransferView | null
  getById(id: string): TransferView | null
  incrementDownload(id: string): void
  listExpired(now: number): TransferRecord[]
  deleteTransfer(id: string): void
  findPendingFile(fileId: string): FileRecord | null
}

function rowToTransfer(r: any): TransferRecord {
  return { id: r.id, code: r.code, slug: r.slug, createdAt: r.created_at, expiresAt: r.expires_at, status: r.status }
}
function rowToFile(r: any): FileRecord {
  return { id: r.id, filename: r.filename, size: r.size, storedPath: r.stored_path, uploadComplete: !!r.upload_complete }
}

export function createStore(db: Db, config: Config): Store {
  const filesOf = (id: string): FileRecord[] =>
    db.prepare('SELECT * FROM files WHERE transfer_id=?').all(id).map(rowToFile)

  const viewFromRow = (r: any): TransferView => ({ ...rowToTransfer(r), files: filesOf(r.id) })

  return {
    createTransfer(files) {
      const id = randomUUID()
      const code = generateCode(config.codeLength, (c) =>
        !!db.prepare('SELECT 1 FROM transfers WHERE code=?').get(c))
      const slug = generateSlug()
      const now = Date.now()
      const expiresAt = now + config.retentionHours * 3600_000
      const insertT = db.prepare(
        'INSERT INTO transfers(id,code,slug,created_at,expires_at,status) VALUES(?,?,?,?,?,?)')
      const insertF = db.prepare(
        'INSERT INTO files(id,transfer_id,filename,size,stored_path,upload_complete) VALUES(?,?,?,?,?,0)')
      const tx = db.transaction(() => {
        insertT.run(id, code, slug, now, expiresAt, 'uploading')
        for (const f of files) {
          const fid = randomUUID()
          const storedPath = join(config.storagePath, fid) // tus uploadId == fileId, flat 저장
          insertF.run(fid, id, f.filename, f.size, storedPath)
        }
      })
      tx()
      return { id, code, slug, createdAt: now, expiresAt, status: 'uploading' }
    },
    markFileComplete(fileId) {
      db.prepare('UPDATE files SET upload_complete=1 WHERE id=?').run(fileId)
    },
    finalizeTransfer(id) {
      db.prepare("UPDATE transfers SET status='ready' WHERE id=?").run(id)
    },
    resolve(codeOrSlug) {
      const r: any = db.prepare(
        "SELECT * FROM transfers WHERE (code=? OR slug=?) AND status='ready' AND expires_at > ?")
        .get(codeOrSlug, codeOrSlug, Date.now())
      return r ? viewFromRow(r) : null
    },
    getById(id) {
      const r: any = db.prepare('SELECT * FROM transfers WHERE id=?').get(id)
      return r ? viewFromRow(r) : null
    },
    incrementDownload(id) {
      db.prepare('UPDATE transfers SET download_count=download_count+1 WHERE id=?').run(id)
    },
    listExpired(now) {
      return db.prepare('SELECT * FROM transfers WHERE expires_at <= ?').all(now).map(rowToTransfer)
    },
    deleteTransfer(id) {
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM files WHERE transfer_id=?').run(id)
        db.prepare('DELETE FROM transfers WHERE id=?').run(id)
      })
      tx()
    },
    findPendingFile(fileId) {
      const r: any = db.prepare('SELECT * FROM files WHERE id=? AND upload_complete=0').get(fileId)
      return r ? rowToFile(r) : null
    },
  }
}
