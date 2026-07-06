import { describe, it, expect, beforeEach } from 'vitest'
import { buildApp } from '../app.js'
import { loadConfig } from '../config.js'
import { openDb } from '../db.js'
import { createStore, type Store } from '../store.js'
import type { FastifyInstance } from 'fastify'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let app: FastifyInstance
let store: Store
const tmp = mkdtempSync(join(tmpdir(), 'sad-'))
const config = loadConfig({ STORAGE_PATH: tmp })

function seedReady(files: { filename: string; body: string }[]) {
  const t = store.createTransfer(files.map((f) => ({ filename: f.filename, size: f.body.length })))
  const view = store.getById(t.id)!
  view.files.forEach((f, i) => {
    writeFileSync(f.storedPath, files[i].body)
    store.markFileComplete(f.id)
  })
  store.finalizeTransfer(t.id)
  return store.getById(t.id)!
}

beforeEach(async () => {
  store = createStore(openDb(':memory:'), config)
  app = buildApp(config, { store })
  await app.ready()
})

describe('GET /api/transfers/:id/download', () => {
  it('단일 파일을 그대로 내려준다', async () => {
    const v = seedReady([{ filename: 'a.txt', body: 'hello' }])
    const res = await app.inject({ method: 'GET', url: `/api/transfers/${v.id}/download` })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('hello')
    expect(res.headers['content-disposition']).toContain('a.txt')
    expect(store.getById(v.id)!.status).toBe('ready')
  })

  it('여러 파일이면 zip을 내려준다', async () => {
    const v = seedReady([
      { filename: 'a.txt', body: 'A' },
      { filename: 'b.txt', body: 'B' },
    ])
    const res = await app.inject({ method: 'GET', url: `/api/transfers/${v.id}/download` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('zip')
    expect(res.rawPayload.slice(0, 2).toString()).toBe('PK') // zip 매직
  })

  it('없는 전송은 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/transfers/nope/download' })
    expect(res.statusCode).toBe(404)
  })
})
