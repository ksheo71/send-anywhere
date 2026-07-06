import { describe, it, expect } from 'vitest'
import { generateSlug, generateCode } from '../ids.js'

describe('generateSlug', () => {
  it('URL-safe 토큰을 만들고 매번 다르다', () => {
    const a = generateSlug()
    const b = generateSlug()
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a.length).toBeGreaterThanOrEqual(20)
    expect(a).not.toBe(b)
  })
})

describe('generateCode', () => {
  it('지정 길이의 숫자 코드를 만든다', () => {
    const code = generateCode(6, () => false)
    expect(code).toMatch(/^\d{6}$/)
  })

  it('exists가 true면 다른 코드로 재시도한다', () => {
    const used = new Set(['000000'])
    let calls = 0
    const code = generateCode(6, (c) => {
      calls++
      return c === '000000' && calls === 1 ? true : used.has(c)
    })
    expect(code).toMatch(/^\d{6}$/)
  })

  it('계속 충돌하면 throw 한다', () => {
    expect(() => generateCode(6, () => true)).toThrow()
  })
})
