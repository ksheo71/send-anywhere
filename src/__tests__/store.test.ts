import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from '../db.js'
import { createStore, type Store } from '../store.js'
import { loadConfig } from '../config.js'

const config = loadConfig({ STORAGE_PATH: '/data/uploads', RETENTION_HOURS: '24' })
let db: Db
let store: Store

beforeEach(() => {
  db = openDb(':memory:')
  store = createStore(db, config)
})

describe('store', () => {
  it('전송을 생성하면 code/slug/파일이 채워지고 stored_path가 계산된다', () => {
    const t = store.createTransfer([{ filename: 'a.txt', size: 10 }])
    expect(t.code).toMatch(/^\d{6}$/)
    expect(t.slug.length).toBeGreaterThanOrEqual(20)
    expect(t.status).toBe('uploading')
    const view = store.getById(t.id)!
    expect(view.files).toHaveLength(1)
    expect(view.files[0].storedPath).toContain(view.files[0].id)
    expect(view.files[0].uploadComplete).toBe(false)
  })

  it('이름을 지정하면 저장되고, 없으면 null이다', () => {
    const named = store.createTransfer([{ filename: 'a.txt', size: 10 }], '여행 사진')
    expect(named.name).toBe('여행 사진')
    expect(store.getById(named.id)!.name).toBe('여행 사진')

    const anon = store.createTransfer([{ filename: 'b.txt', size: 10 }])
    expect(anon.name).toBeNull()
    expect(store.getById(anon.id)!.name).toBeNull()
  })

  it('uploading 상태는 resolve로 안 나오고, finalize 후 나온다', () => {
    const t = store.createTransfer([{ filename: 'a.txt', size: 10 }])
    expect(store.resolve(t.code)).toBeNull()
    store.finalizeTransfer(t.id)
    expect(store.resolve(t.code)).not.toBeNull()
    expect(store.resolve(t.slug)).not.toBeNull()
  })

  it('markFileComplete가 반영된다', () => {
    const t = store.createTransfer([{ filename: 'a.txt', size: 10 }])
    const fid = store.getById(t.id)!.files[0].id
    store.markFileComplete(fid)
    expect(store.getById(t.id)!.files[0].uploadComplete).toBe(true)
  })

  it('만료된 전송은 resolve되지 않고 listExpired에 잡힌다', () => {
    const past = loadConfig({ RETENTION_HOURS: '-1' }) // 이미 만료
    const s2 = createStore(openDb(':memory:'), past)
    const t = s2.createTransfer([{ filename: 'a.txt', size: 10 }])
    s2.finalizeTransfer(t.id)
    expect(s2.resolve(t.code)).toBeNull()
    expect(s2.listExpired(Date.now())).toHaveLength(1)
  })

  it('deleteTransfer가 transfer와 files를 모두 지운다', () => {
    const t = store.createTransfer([{ filename: 'a.txt', size: 10 }])
    store.deleteTransfer(t.id)
    expect(store.getById(t.id)).toBeNull()
  })

  it('findPendingFile은 대기 중인 파일을 반환하고, 알 수 없는 id나 완료된 파일에는 null을 반환한다', () => {
    const t = store.createTransfer([{ filename: 'a.txt', size: 10 }])
    const fid = store.getById(t.id)!.files[0].id

    const pending = store.findPendingFile(fid)
    expect(pending).not.toBeNull()
    expect(pending!.id).toBe(fid)

    expect(store.findPendingFile('00000000-0000-4000-8000-000000000000')).toBeNull()

    store.markFileComplete(fid)
    expect(store.findPendingFile(fid)).toBeNull()
  })
})
