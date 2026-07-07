import { describe, it, expect } from 'vitest'
import { buildApp } from '../app.js'
import { loadConfig } from '../config.js'
import { openDb } from '../db.js'
import { createStore } from '../store.js'
import { createSignaling } from '../signaling.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('GET /api/health', () => {
  it('200 ok 를 반환한다', async () => {
    const cfg = loadConfig({ STORAGE_PATH: mkdtempSync(join(tmpdir(), 'sa-')) })
    const app = buildApp(cfg, { store: createStore(openDb(':memory:'), cfg), signaling: createSignaling(() => '000000') })
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
    await app.close()
  })
})
