import { describe, it, expect, beforeEach } from 'vitest'
import { buildApp } from '../app.js'
import { loadConfig } from '../config.js'
import { openDb } from '../db.js'
import { createStore, type Store } from '../store.js'
import type { FastifyInstance } from 'fastify'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
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

  it('아직 완료되지 않은(uploading) 전송은 404', async () => {
    const t = store.createTransfer([{ filename: 'a.txt', size: 5 }])
    const res = await app.inject({ method: 'GET', url: `/api/transfers/${t.id}/download` })
    expect(res.statusCode).toBe(404)
  })

  it('만료된 전송은 404', async () => {
    const expiredConfig = loadConfig({ STORAGE_PATH: tmp, RETENTION_HOURS: '-1' })
    const expiredStore = createStore(openDb(':memory:'), expiredConfig)
    const expiredApp = buildApp(expiredConfig, { store: expiredStore })
    await expiredApp.ready()

    const t = expiredStore.createTransfer([{ filename: 'a.txt', size: 5 }])
    const view = expiredStore.getById(t.id)!
    writeFileSync(view.files[0].storedPath, 'hello')
    expiredStore.markFileComplete(view.files[0].id)
    expiredStore.finalizeTransfer(t.id)

    const res = await expiredApp.inject({ method: 'GET', url: `/api/transfers/${t.id}/download` })
    expect(res.statusCode).toBe(404)
  })

  it('디스크에서 blob이 사라진 경우 404 (사전 존재 확인)', async () => {
    const v = seedReady([{ filename: 'a.txt', body: 'hello' }])
    rmSync(v.files[0].storedPath)
    const res = await app.inject({ method: 'GET', url: `/api/transfers/${v.id}/download` })
    expect(res.statusCode).toBe(404)
  })

  it('fileId로 여러 파일 중 하나를 선택하면 단일 파일로 내려준다', async () => {
    const v = seedReady([
      { filename: 'a.txt', body: 'A' },
      { filename: 'b.txt', body: 'B' },
    ])
    const second = v.files[1]
    const res = await app.inject({
      method: 'GET',
      url: `/api/transfers/${v.id}/download?fileId=${second.id}`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('B')
    expect(res.headers['content-disposition']).toContain(second.filename)
    expect(res.headers['content-type']).not.toContain('zip')
  })
})
