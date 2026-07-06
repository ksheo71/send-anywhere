import { describe, it, expect } from 'vitest'
import { runPool } from '../uploadPool.js'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('runPool', () => {
  it('동시 실행 수가 concurrency를 넘지 않는다', async () => {
    let active = 0
    let maxActive = 0
    const items = Array.from({ length: 7 }, (_, i) => i)
    await runPool(items, 3, async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await delay(10)
      active--
    })
    expect(maxActive).toBeLessThanOrEqual(3)
    expect(maxActive).toBe(3) // 항목이 충분하므로 상한까지 채운다
  })

  it('모든 항목을 실행한다', async () => {
    const seen: number[] = []
    await runPool([10, 20, 30, 40], 2, async (item) => {
      await delay(1)
      seen.push(item)
    })
    expect(seen.sort((a, b) => a - b)).toEqual([10, 20, 30, 40])
  })

  it('한 항목이 throw해도 나머지는 모두 실행된다', async () => {
    const done: number[] = []
    await runPool([0, 1, 2, 3], 2, async (item) => {
      if (item === 1) throw new Error('boom')
      await delay(1)
      done.push(item)
    })
    expect(done.sort((a, b) => a - b)).toEqual([0, 2, 3])
  })

  it('빈 배열이면 즉시 resolve한다', async () => {
    await expect(runPool([], 3, async () => {})).resolves.toBeUndefined()
  })
})
