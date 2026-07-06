import { describe, it, expect } from 'vitest'
import { buildApp } from '../app.js'
import { loadConfig } from '../config.js'
import { openDb } from '../db.js'
import { createStore } from '../store.js'

describe('GET /api/health', () => {
  it('200 ok 를 반환한다', async () => {
    const cfg = loadConfig({})
    const app = buildApp(cfg, { store: createStore(openDb(':memory:'), cfg) })
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
    await app.close()
  })
})
