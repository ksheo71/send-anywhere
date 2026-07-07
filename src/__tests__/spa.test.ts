import { describe, it, expect } from 'vitest'
import { buildApp } from '../app.js'
import { loadConfig } from '../config.js'
import { openDb } from '../db.js'
import { createStore } from '../store.js'
import { createSignaling } from '../signaling.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('정적/SPA', () => {
  it('API 경로는 정적 폴백에 가리지 않는다', async () => {
    const cfg = loadConfig({ STORAGE_PATH: mkdtempSync(join(tmpdir(), 'sa-')) })
    const app = buildApp(cfg, { store: createStore(openDb(':memory:'), cfg), signaling: createSignaling(() => '000000') })
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    await app.close()
  })
})
