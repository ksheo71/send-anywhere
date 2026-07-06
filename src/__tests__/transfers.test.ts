import { describe, it, expect, beforeEach } from 'vitest'
import { buildApp } from '../app.js'
import { loadConfig } from '../config.js'
import { openDb } from '../db.js'
import { createStore, type Store } from '../store.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
let store: Store
const config = loadConfig({ MAX_FILE_SIZE: '1000', MAX_TOTAL_SIZE: '1500' })

beforeEach(() => {
  store = createStore(openDb(':memory:'), config)
  app = buildApp(config, { store })
})

describe('POST /api/transfers', () => {
  it('세션을 생성하고 code/slug를 반환한다', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/transfers',
      payload: { files: [{ filename: 'a.txt', size: 10 }] },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.code).toMatch(/^\d{6}$/)
    expect(body.files[0].id).toBeTruthy()
  })

  it('파일이 없으면 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/transfers', payload: { files: [] } })
    expect(res.statusCode).toBe(400)
  })

  it('파일이 상한을 넘으면 413', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/transfers',
      payload: { files: [{ filename: 'big', size: 2000 }] },
    })
    expect(res.statusCode).toBe(413)
  })
})

describe('POST /api/transfers/:id/finalize', () => {
  it('완료 안 된 파일이 있으면 409', async () => {
    const t = store.createTransfer([{ filename: 'a', size: 5 }])
    const res = await app.inject({ method: 'POST', url: `/api/transfers/${t.id}/finalize` })
    expect(res.statusCode).toBe(409)
  })

  it('모든 파일 완료 후 finalize하면 ready', async () => {
    const t = store.createTransfer([{ filename: 'a', size: 5 }])
    store.markFileComplete(store.getById(t.id)!.files[0].id)
    const res = await app.inject({ method: 'POST', url: `/api/transfers/${t.id}/finalize` })
    expect(res.statusCode).toBe(200)
    expect(store.getById(t.id)!.status).toBe('ready')
  })

  it('없는 id는 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/transfers/nope/finalize' })
    expect(res.statusCode).toBe(404)
  })
})
