import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildApp } from '../app.js'
import { loadConfig } from '../config.js'
import { openDb } from '../db.js'
import { createStore } from '../store.js'
import { createSignaling } from '../signaling.js'
import type { FastifyInstance } from 'fastify'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'

let app: FastifyInstance
let base: string
const config = loadConfig({ STORAGE_PATH: mkdtempSync(join(tmpdir(), 'saws-')) })

beforeEach(async () => {
  const store = createStore(openDb(':memory:'), config)
  let n = 0
  const signaling = createSignaling(() => ['424242', '424242'][n++] ?? '999999')
  app = buildApp(config, { store, signaling })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const addr = app.server.address()
  base = typeof addr === 'object' && addr ? `ws://127.0.0.1:${addr.port}/ws` : ''
})
afterEach(async () => { await app.close() })

function once(ws: WebSocket, pred: (m: any) => boolean): Promise<any> {
  return new Promise((resolve) => {
    ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (pred(m)) resolve(m) })
  })
}

describe('/ws 시그널링', () => {
  it('create→join→signal 왕복', async () => {
    const s = new WebSocket(base)
    await new Promise((r) => s.on('open', r))
    s.send(JSON.stringify({ type: 'create' }))
    const created = await once(s, (m) => m.type === 'created')
    expect(created.code).toBe('424242')

    const r = new WebSocket(base)
    await new Promise((res) => r.on('open', res))
    const joinedS = once(s, (m) => m.type === 'peer-joined')
    const joinedR = once(r, (m) => m.type === 'peer-joined')
    r.send(JSON.stringify({ type: 'join', code: '424242' }))
    await Promise.all([joinedS, joinedR])

    const gotSignal = once(r, (m) => m.type === 'signal')
    s.send(JSON.stringify({ type: 'signal', data: { sdp: 'offer' } }))
    const sig = await gotSignal
    expect(sig.data).toEqual({ sdp: 'offer' })

    s.close(); r.close()
  })
})
