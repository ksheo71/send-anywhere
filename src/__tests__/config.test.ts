import { describe, it, expect } from 'vitest'
import { loadConfig } from '../config.js'

describe('loadConfig', () => {
  it('빈 env에서 기본값을 채운다', () => {
    const c = loadConfig({})
    expect(c.retentionHours).toBe(24)
    expect(c.maxFileSize).toBe(2147483648)
    expect(c.chunkSize).toBe(52428800)
    expect(c.codeLength).toBe(6)
    expect(c.port).toBe(4500)
  })

  it('env 값을 숫자로 파싱한다', () => {
    const c = loadConfig({ RETENTION_HOURS: '48', PORT: '5000' })
    expect(c.retentionHours).toBe(48)
    expect(c.port).toBe(5000)
  })
})
