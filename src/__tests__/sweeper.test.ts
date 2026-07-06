import { describe, it, expect } from 'vitest'
import { openDb } from '../db.js'
import { createStore } from '../store.js'
import { loadConfig } from '../config.js'
import { sweepOnce } from '../sweeper.js'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('sweepOnce', () => {
  it('만료된 전송의 파일과 레코드를 지운다', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'sws-'))
    const config = loadConfig({ STORAGE_PATH: tmp, RETENTION_HOURS: '-1' }) // 즉시 만료
    const store = createStore(openDb(':memory:'), config)
    const t = store.createTransfer([{ filename: 'a', size: 1 }])
    const f = store.getById(t.id)!.files[0]
    writeFileSync(f.storedPath, 'x')

    const n = await sweepOnce(store)
    expect(n).toBe(1)
    expect(existsSync(f.storedPath)).toBe(false)
    expect(store.getById(t.id)).toBeNull()
  })

  it('만료 안 된 전송은 남긴다', async () => {
    const config = loadConfig({ STORAGE_PATH: mkdtempSync(join(tmpdir(), 'sws-')) })
    const store = createStore(openDb(':memory:'), config)
    const t = store.createTransfer([{ filename: 'a', size: 1 }])
    expect(await sweepOnce(store)).toBe(0)
    expect(store.getById(t.id)).not.toBeNull()
  })
})
