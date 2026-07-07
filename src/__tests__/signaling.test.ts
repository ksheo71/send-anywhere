import { describe, it, expect } from 'vitest'
import { createSignaling, type Peer } from '../signaling.js'

function fakePeer() {
  const sent: any[] = []
  return { peer: { send: (m: unknown) => sent.push(m) } as Peer, sent }
}

describe('signaling', () => {
  it('create가 유일 코드를 발급하고 created를 보낸다', () => {
    let n = 0
    const s = createSignaling(() => ['111111', '111111', '222222'][n++])
    const a = fakePeer()
    s.onMessage(a.peer, { type: 'create' })
    expect(a.sent[0]).toEqual({ type: 'created', code: '111111' })
    const b = fakePeer()
    s.onMessage(b.peer, { type: 'create' }) // 111111 충돌 → 222222로 재시도
    expect(b.sent[0]).toEqual({ type: 'created', code: '222222' })
    expect(s.roomCount()).toBe(2)
  })

  it('join 성공 시 양쪽에 peer-joined', () => {
    const s = createSignaling(() => '123456')
    const a = fakePeer(); const b = fakePeer()
    s.onMessage(a.peer, { type: 'create' })
    s.onMessage(b.peer, { type: 'join', code: '123456' })
    expect(a.sent).toContainEqual({ type: 'peer-joined' })
    expect(b.sent).toContainEqual({ type: 'peer-joined' })
  })

  it('없는 코드 join → error not-found', () => {
    const s = createSignaling(() => '123456')
    const b = fakePeer()
    s.onMessage(b.peer, { type: 'join', code: '000000' })
    expect(b.sent).toContainEqual({ type: 'error', reason: 'not-found' })
  })

  it('이미 receiver 있는 방 join → error busy', () => {
    const s = createSignaling(() => '123456')
    const a = fakePeer(); const b = fakePeer(); const c = fakePeer()
    s.onMessage(a.peer, { type: 'create' })
    s.onMessage(b.peer, { type: 'join', code: '123456' })
    s.onMessage(c.peer, { type: 'join', code: '123456' })
    expect(c.sent).toContainEqual({ type: 'error', reason: 'busy' })
  })

  it('signal은 방의 상대에게만 중계된다', () => {
    const s = createSignaling(() => '123456')
    const a = fakePeer(); const b = fakePeer()
    s.onMessage(a.peer, { type: 'create' })
    s.onMessage(b.peer, { type: 'join', code: '123456' })
    s.onMessage(a.peer, { type: 'signal', data: { sdp: 'x' } })
    expect(b.sent).toContainEqual({ type: 'signal', data: { sdp: 'x' } })
    s.onMessage(b.peer, { type: 'signal', data: { ice: 'y' } })
    expect(a.sent).toContainEqual({ type: 'signal', data: { ice: 'y' } })
  })

  it('sender 종료 시 방 삭제 + 상대에 peer-left', () => {
    const s = createSignaling(() => '123456')
    const a = fakePeer(); const b = fakePeer()
    s.onMessage(a.peer, { type: 'create' })
    s.onMessage(b.peer, { type: 'join', code: '123456' })
    s.onClose(a.peer)
    expect(b.sent).toContainEqual({ type: 'peer-left' })
    expect(s.roomCount()).toBe(0)
  })

  it('sweep가 TTL 지난 미조인 방을 청소한다', () => {
    let t = 0
    const s = createSignaling(() => '123456', () => t)
    const a = fakePeer()
    s.onMessage(a.peer, { type: 'create' }) // createdAt=0
    t = 5 * 60_000
    s.sweep(t, 10 * 60_000)
    expect(s.roomCount()).toBe(1) // 아직 TTL 안 지남
    t = 11 * 60_000
    s.sweep(t, 10 * 60_000)
    expect(s.roomCount()).toBe(0)
  })
})
