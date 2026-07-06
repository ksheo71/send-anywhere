import { describe, it, expect } from 'vitest'
import { openDb } from '../db.js'

describe('openDb', () => {
  it('transfers, files 테이블을 생성한다', () => {
    const db = openDb(':memory:')
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: any) => r.name)
    expect(tables).toContain('transfers')
    expect(tables).toContain('files')
    db.close()
  })

  it('code 컬럼에 UNIQUE 제약이 있다', () => {
    const db = openDb(':memory:')
    db.prepare(
      "INSERT INTO transfers(id,code,slug,created_at,expires_at,status) VALUES('a','111111','s1',0,0,'ready')"
    ).run()
    expect(() =>
      db.prepare(
        "INSERT INTO transfers(id,code,slug,created_at,expires_at,status) VALUES('b','111111','s2',0,0,'ready')"
      ).run()
    ).toThrow()
    db.close()
  })
})
