import { describe, it, expect, beforeEach } from 'vitest'
import { buildApp } from '../app.js'
import { loadConfig } from '../config.js'
import { openDb } from '../db.js'
import { createStore, type Store } from '../store.js'
import type { FastifyInstance } from 'fastify'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let app: FastifyInstance
let store: Store
const config = loadConfig({
  STORAGE_PATH: mkdtempSync(join(tmpdir(), 'sa-')),
})

beforeEach(async () => {
  store = createStore(openDb(':memory:'), config)
  app = buildApp(config, { store })
  await app.ready()
})

describe('GET /api/resolve/:x', () => {
  it('ready 전송을 code로 조회한다', async () => {
    const t = store.createTransfer([{ filename: 'a.txt', size: 5 }])
    store.markFileComplete(store.getById(t.id)!.files[0].id)
    store.finalizeTransfer(t.id)
    const res = await app.inject({ method: 'GET', url: `/api/resolve/${t.code}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().files[0].filename).toBe('a.txt')
  })

  it('없는 코드는 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/resolve/000000' })
    expect(res.statusCode).toBe(404)
  })
})

describe('rate limit 스코프', () => {
  const rlConfig = loadConfig({
    STORAGE_PATH: mkdtempSync(join(tmpdir(), 'sa-')),
    RATE_LIMIT_PER_MIN: '3',
  })
  let rlApp: FastifyInstance

  beforeEach(async () => {
    const rlStore = createStore(openDb(':memory:'), rlConfig)
    rlApp = buildApp(rlConfig, { store: rlStore })
    await rlApp.ready()
  })

  it('/api/resolve/*는 한도를 넘으면 429가 발생한다', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) {
      const res = await rlApp.inject({ method: 'GET', url: '/api/resolve/000000' })
      statuses.push(res.statusCode)
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0)
  })

  it('/api/health는 같은 한도를 넘겨도 429가 발생하지 않는다 (rate limit이 resolve에만 스코프됨)', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 10; i++) {
      const res = await rlApp.inject({ method: 'GET', url: '/api/health' })
      statuses.push(res.statusCode)
    }
    expect(statuses.every((s) => s === 200)).toBe(true)
  })
})
