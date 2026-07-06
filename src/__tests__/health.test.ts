import { describe, it, expect } from 'vitest'
import { buildApp } from '../app.js'
import { loadConfig } from '../config.js'

describe('GET /api/health', () => {
  it('200 ok 를 반환한다', async () => {
    const app = buildApp(loadConfig({}))
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
    await app.close()
  })
})
