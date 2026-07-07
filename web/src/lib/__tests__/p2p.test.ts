import { describe, it, expect } from 'vitest'
import { buildManifest, parseControl, assembleBlob } from '../p2p.js'

describe('p2p 프로토콜 헬퍼', () => {
  it('manifest 직렬화/역직렬화', () => {
    const s = buildManifest([{ name: 'a.txt', size: 3 }, { name: 'b.bin', size: 10 }])
    const m = parseControl(s)
    expect(m.kind).toBe('manifest')
    expect(m.files).toHaveLength(2)
    expect(m.files[0]).toEqual({ name: 'a.txt', size: 3 })
  })

  it('assembleBlob가 청크를 합쳐 올바른 크기의 Blob을 만든다', async () => {
    const c1 = new Uint8Array([1, 2, 3]).buffer
    const c2 = new Uint8Array([4, 5]).buffer
    const blob = assembleBlob([c1, c2], 'application/octet-stream')
    expect(blob.size).toBe(5)
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
  })
})
