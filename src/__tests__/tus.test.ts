import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildApp } from '../app.js'
import { loadConfig } from '../config.js'
import { openDb } from '../db.js'
import { createStore, type Store } from '../store.js'
import type { FastifyInstance } from 'fastify'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let app: FastifyInstance
let store: Store
let base: string
const tmp = mkdtempSync(join(tmpdir(), 'sa-'))
const config = loadConfig({ STORAGE_PATH: tmp })

beforeEach(async () => {
  store = createStore(openDb(':memory:'), config)
  app = buildApp(config, { store })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const addr = app.server.address()
  base = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : ''
})
afterEach(async () => { await app.close() })

describe('tus 업로드', () => {
  it('생성→PATCH로 파일을 저장하고 markFileComplete가 반영된다', async () => {
    const t = store.createTransfer([{ filename: 'a.txt', size: 5 }])
    const fileId = store.getById(t.id)!.files[0].id
    const meta = `fileId ${Buffer.from(fileId).toString('base64')}`

    // creation
    const create = await fetch(`${base}/files`, {
      method: 'POST',
      headers: { 'Tus-Resumable': '1.0.0', 'Upload-Length': '5', 'Upload-Metadata': meta },
    })
    expect(create.status).toBe(201)
    const location = create.headers.get('location')!
    const uploadUrl = location.startsWith('http') ? location : `${base}${location}`

    // PATCH bytes
    const patch = await fetch(uploadUrl, {
      method: 'PATCH',
      headers: {
        'Tus-Resumable': '1.0.0', 'Upload-Offset': '0',
        'Content-Type': 'application/offset+octet-stream',
      },
      body: Buffer.from('hello'),
    })
    expect(patch.status).toBe(204)

    expect(store.getById(t.id)!.files[0].uploadComplete).toBe(true)
    const saved = readFileSync(join(tmp, fileId))
    expect(saved.toString()).toBe('hello')
  })
})
