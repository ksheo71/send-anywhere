# WebRTC P2P 실시간 전송 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 브라우저 간 WebRTC DataChannel 직접 전송(P2P) 모드를 추가한다. 자체 WebSocket 시그널링(인메모리 방, 6자리 코드) + STUN. 기존 릴레이는 무변경.

**Architecture:** 기존 Fastify에 `@fastify/websocket`으로 `/ws` 시그널링을 추가한다. 순수 로직인 방 레지스트리/중계(`src/signaling.ts`)는 소켓 추상화로 단위 테스트한다. 프론트는 WS 클라이언트(`web/src/lib/signaling.ts`)와 WebRTC 전송(`web/src/lib/p2p.ts`)을 만들고, 보내기/받기에 [🔗 링크(릴레이)]/[⚡ 실시간(P2P)] 토글을 추가한다. 서버는 SDP/ICE만 중계하고 파일은 저장하지 않는다.

**Tech Stack:** Fastify 5.10 + @fastify/websocket 11, WebRTC(RTCPeerConnection/RTCDataChannel), STUN, React 18 + shadcn, vitest. 기존 tus/relay 무관.

## Global Constraints

- **추가만.** 릴레이 코드/스토어/API(`src/store.ts`, `src/routes/{transfers,resolve,download}.ts`, `src/tus.ts`, `web/src/api.ts`)와 릴레이 UI 흐름은 변경 금지. 기존 44개 테스트는 계속 통과해야 한다.
- 시그널링 방은 **인메모리**(SQLite/디스크 미사용). P2P는 파일을 서버에 저장하지 않는다.
- P2P 6자리 코드는 활성 방에만 유효한 임시 코드(릴레이 코드와 별개).
- 시그널링 메시지(JSON): 클라→서버 `{type:'create'}` / `{type:'join',code}` / `{type:'signal',data}`. 서버→클라 `{type:'created',code}` / `{type:'peer-joined'}` / `{type:'peer-left'}` / `{type:'error',reason}` / `{type:'signal',data}`. reason은 `'not-found'|'busy'`.
- 방 규칙: sender 1 + receiver 1(1:1). 이미 receiver 있는 방 join → `busy`. sender 소켓 종료 → 방 삭제 + 상대에 `peer-left`. 미조인 방은 TTL 10분으로 청소.
- WebRTC: STUN만(`stun:stun.cloudflare.com:3478`, `stun:stun.l.google.com:19302`). 송신자가 offerer + DataChannel 생성. 20초 내 채널 open 실패 → 에러 → "릴레이로 보내세요" 안내.
- 파일 프로토콜(DataChannel): 제어는 JSON 문자열, 데이터는 ArrayBuffer(16KB 청크). `manifest` → 파일별 `file-begin`/청크/`file-end` → `done`. 백프레셔: bufferedAmount 상한(4MB) 초과 시 `bufferedamountlow`까지 대기.
- 프론트 P2P는 별도 컴포넌트/모드. 기본 모드는 링크(릴레이). WS URL은 `${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`.
- WebRTC 연결 자체는 단위 테스트 불가 → 순수 로직(방 레지스트리, 프로토콜 직렬화/재조립)만 단위 테스트하고 나머지는 **브라우저 2탭** 수동 검증.
- 커밋 메시지 한국어, 각 태스크 끝에 커밋.

---

## File Structure

```
send-anywhere/
├── package.json                       # 수정: @fastify/websocket 추가
├── src/
│   ├── signaling.ts                   # 신규: 인메모리 방 레지스트리 + 중계(순수, 테스트)
│   ├── __tests__/signaling.test.ts    # 신규
│   ├── routes/ws.ts                   # 신규: @fastify/websocket + /ws → signaling
│   ├── app.ts                         # 수정: ws 라우트 배선(AppDeps에 signaling)
│   └── server.ts                      # 수정: signaling 생성 + sweep 타이머
├── web/src/
│   ├── lib/
│   │   ├── signaling.ts               # 신규: WS 클라이언트
│   │   ├── p2p.ts                     # 신규: WebRTC 송/수신 + 프로토콜
│   │   └── __tests__/p2p.test.ts      # 신규: 순수 프로토콜 헬퍼 테스트
│   ├── P2PSend.tsx                    # 신규
│   ├── P2PReceive.tsx                 # 신규
│   ├── SendPage.tsx                   # 수정: 링크/실시간 토글
│   └── ReceivePage.tsx               # 수정: 링크/실시간 토글
```

---

## Task 1: 시그널링 방 레지스트리 (백엔드, 단위 테스트)

**Files:**
- Create: `src/signaling.ts`, `src/__tests__/signaling.test.ts`

**Interfaces:**
- Produces:
  - `interface Peer { send(msg: unknown): void }`
  - `interface Signaling { onMessage(peer: Peer, msg: any): void; onClose(peer: Peer): void; sweep(now: number, ttlMs: number): void; roomCount(): number }`
  - `createSignaling(randomCode: () => string): Signaling` — `randomCode`는 6자리 문자열 생성기(테스트에서 결정적 주입). 내부에서 활성 방과 충돌 안 나는 코드가 나올 때까지 재시도.

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/signaling.test.ts`:
```ts
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
    const s = createSignaling(() => '123456')
    const a = fakePeer()
    s.onMessage(a.peer, { type: 'create' })
    s.sweep(1_000_000, 10 * 60_000) // createdAt=0 가정 불가 → 아래 구현은 Date 미사용, now 인자 기반
    // 방 생성 시각을 0으로 두려면 구현에서 now를 받지 않으므로, 큰 now로 TTL 초과 유도
    expect(s.roomCount()).toBe(0)
  })
})
```
주의: sweep 테스트는 구현이 방 생성 시각을 어떻게 기록하는지에 의존한다. 구현에서 방 생성 시각을 `0`으로 초기화하지 말고, `onMessage`가 시각을 받지 않으므로 **생성 시각을 별도 인자 없이 기록**해야 한다. Date를 직접 쓰지 않기 위해, 방에 `createdAt`을 저장하되 값은 "직전 sweep에 전달된 now" 대신 **단조 증가 카운터**가 아니라, 실제로는 생성 시점을 알 수 없으므로 **sweep는 `now - createdAt > ttl`로 판정하고 createdAt은 생성 순간의 `performance.now()` 대신** — 아래 구현은 `createdAt`을 생성 시 `0`이 아니라 호출자가 넣는 방식이 아니다. 이 테스트를 결정적으로 만들기 위해, 구현은 방 생성 시 `createdAt`을 **생성 카운터가 아닌**, `onMessage`에 시각을 안 넘기는 한 알 수 없다 → 그러므로 **createSignaling에 `now: () => number`를 주입**하도록 시그니처를 바꾼다(아래 Step 3 반영). 이 테스트도 그에 맞춘다(Step 1을 Step 3 구현에 맞게 아래에서 조정).

- [ ] **Step 2: 실패 확인 + 시그니처 확정**

`createSignaling`에 시간 주입을 추가한다: `createSignaling(randomCode: () => string, now: () => number = () => 0): Signaling`. 방 생성 시 `createdAt = now()`. sweep는 `now - createdAt > ttlMs && room.receiver === null`인 방을 삭제(연결된 방은 소켓 close로만 정리). Step 1의 마지막 sweep 테스트를 다음으로 교체:
```ts
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
```
Run: `npm test -- signaling`
Expected: FAIL — `Cannot find module '../signaling.js'`

- [ ] **Step 3: signaling.ts 구현**

`src/signaling.ts`:
```ts
export interface Peer { send(msg: unknown): void }

interface Room { code: string; sender: Peer; receiver: Peer | null; createdAt: number }

export interface Signaling {
  onMessage(peer: Peer, msg: any): void
  onClose(peer: Peer): void
  sweep(now: number, ttlMs: number): void
  roomCount(): number
}

export function createSignaling(randomCode: () => string, now: () => number = () => 0): Signaling {
  const rooms = new Map<string, Room>()
  const peerRoom = new Map<Peer, Room>()

  function uniqueCode(): string {
    for (let i = 0; i < 100; i++) {
      const c = randomCode()
      if (!rooms.has(c)) return c
    }
    throw new Error('코드 공간 포화')
  }
  function other(room: Room, peer: Peer): Peer | null {
    if (room.sender === peer) return room.receiver
    if (room.receiver === peer) return room.sender
    return null
  }
  function destroy(room: Room) {
    rooms.delete(room.code)
    peerRoom.delete(room.sender)
    if (room.receiver) peerRoom.delete(room.receiver)
  }

  return {
    onMessage(peer, msg) {
      if (!msg || typeof msg.type !== 'string') return
      if (msg.type === 'create') {
        const code = uniqueCode()
        const room: Room = { code, sender: peer, receiver: null, createdAt: now() }
        rooms.set(code, room)
        peerRoom.set(peer, room)
        peer.send({ type: 'created', code })
      } else if (msg.type === 'join') {
        const room = rooms.get(String(msg.code))
        if (!room) { peer.send({ type: 'error', reason: 'not-found' }); return }
        if (room.receiver) { peer.send({ type: 'error', reason: 'busy' }); return }
        room.receiver = peer
        peerRoom.set(peer, room)
        room.sender.send({ type: 'peer-joined' })
        peer.send({ type: 'peer-joined' })
      } else if (msg.type === 'signal') {
        const room = peerRoom.get(peer)
        if (!room) return
        const dst = other(room, peer)
        if (dst) dst.send({ type: 'signal', data: msg.data })
      }
    },
    onClose(peer) {
      const room = peerRoom.get(peer)
      if (!room) return
      const dst = other(room, peer)
      if (dst) dst.send({ type: 'peer-left' })
      destroy(room)
    },
    sweep(nowMs, ttlMs) {
      for (const room of [...rooms.values()]) {
        if (room.receiver === null && nowMs - room.createdAt > ttlMs) destroy(room)
      }
    },
    roomCount() { return rooms.size },
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- signaling`
Expected: PASS (7 tests).

- [ ] **Step 5: 전체 회귀**

Run: `npm test`
Expected: 기존 44 + signaling 7 = 51 통과.

- [ ] **Step 6: 커밋**

```bash
git add src/signaling.ts src/__tests__/signaling.test.ts
git commit -m "P2P: 시그널링 방 레지스트리(인메모리) + 단위 테스트"
```

---

## Task 2: /ws 라우트 + 배선

**Files:**
- Create: `src/routes/ws.ts`
- Modify: `src/app.ts`, `src/server.ts`, `package.json`
- Test: `src/__tests__/ws.test.ts`

**Interfaces:**
- Consumes: `Signaling` (Task 1).
- Produces: `registerWs(app: FastifyInstance, signaling: Signaling): void` — `/ws` WebSocket 엔드포인트를 스코프 플러그인으로 등록. 각 소켓을 `Peer`로 감싸 `signaling.onMessage`/`onClose`에 연결.
- Modifies: `AppDeps`에 `signaling: Signaling` 추가. `buildApp`가 `registerWs(app, deps.signaling)` 호출. `server.ts`가 signaling 생성 + `setInterval`로 `sweep` 주기 실행.

- [ ] **Step 1: @fastify/websocket 설치**

Run: `npm install @fastify/websocket`
Expected: 설치 성공.

- [ ] **Step 2: 통합 테스트 작성 (실제 WS 왕복)**

`src/__tests__/ws.test.ts`:
```ts
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
```
(`ws`는 @fastify/websocket의 의존성으로 이미 node_modules에 있다. devDependency로 없으면 `npm i -D @types/ws` 후 import 타입만 필요; 런타임 `ws`는 존재.)

- [ ] **Step 3: 실패 확인**

Run: `npm test -- ws`
Expected: FAIL — `buildApp`가 `signaling` deps를 요구하지 않음 / `/ws` 없음.

- [ ] **Step 4: ws.ts 구현**

`src/routes/ws.ts`:
```ts
import websocket from '@fastify/websocket'
import type { FastifyInstance } from 'fastify'
import type { Signaling, Peer } from '../signaling.js'

export function registerWs(app: FastifyInstance, signaling: Signaling): void {
  app.register(async (scoped) => {
    await scoped.register(websocket)
    scoped.get('/ws', { websocket: true }, (socket) => {
      const peer: Peer = { send: (m) => { try { socket.send(JSON.stringify(m)) } catch { /* closed */ } } }
      socket.on('message', (raw: Buffer) => {
        try { signaling.onMessage(peer, JSON.parse(raw.toString())) } catch { /* ignore bad json */ }
      })
      socket.on('close', () => signaling.onClose(peer))
      socket.on('error', () => signaling.onClose(peer))
    })
  })
}
```
주의: @fastify/websocket v11의 핸들러 시그니처는 `(socket, request)`이며 `socket`이 곧 ws WebSocket이다(v8의 `connection.socket` 아님).

- [ ] **Step 5: app.ts 배선**

`src/app.ts`:
- import: `import { registerWs } from './routes/ws.js'`, `import type { Signaling } from './signaling.js'`
- `AppDeps` 확장: `export interface AppDeps { store: Store; signaling: Signaling }`
- `buildApp` 내 tus 등록 뒤(정적 서빙 앞)에 `registerWs(app, deps.signaling)` 추가.

- [ ] **Step 6: server.ts 배선**

`src/server.ts`를 다음으로(추가 부분만):
```ts
import { createSignaling } from './signaling.js'
import { generateCode } from './ids.js'
// ...
const signaling = createSignaling(() => generateCode(6, () => false), () => Date.now())
const app = buildApp(config, { store, signaling })

startSweeper(store, config)
setInterval(() => signaling.sweep(Date.now(), 10 * 60_000), 60_000).unref?.()
```
(`generateCode(6, () => false)`는 충돌 체크를 signaling 내부에 위임하려 항상 새 난수를 반환.)

- [ ] **Step 7: 기존 테스트의 buildApp 호출 갱신**

`buildApp`가 이제 `signaling`을 요구하므로, `signaling`을 넘기지 않던 기존 테스트가 타입 에러난다. 다음 테스트 파일들에서 `buildApp(config, { store })` → `buildApp(config, { store, signaling: createSignaling(() => '000000') })`로 갱신(파일 상단에 `import { createSignaling } from '../signaling.js'` 추가): `src/__tests__/health.test.ts`, `transfers.test.ts`, `resolve.test.ts`, `download.test.ts`, `tus.test.ts`, `spa.test.ts`. (해당 테스트들은 signaling을 실제로 쓰지 않으므로 더미로 충분.)

- [ ] **Step 8: 통과 확인**

Run: `npm test`
Expected: 기존 44 + signaling 7 + ws 1 = 52 통과, `tsc` 빌드 클린(`npm run build:server`).

- [ ] **Step 9: 커밋**

```bash
git add src/routes/ws.ts src/app.ts src/server.ts src/__tests__/ package.json package-lock.json
git commit -m "P2P: /ws 시그널링 라우트 + @fastify/websocket 배선"
```

---

## Task 3: 프론트 WS 시그널링 클라이언트

**Files:**
- Create: `web/src/lib/signaling.ts`

**Interfaces:**
- Produces:
  - `type SignalHandlers = { onCreated?: (code: string) => void; onPeerJoined?: () => void; onPeerLeft?: () => void; onSignal?: (data: any) => void; onError?: (reason: string) => void; onClose?: () => void }`
  - `interface SignalingClient { create(): void; join(code: string): void; signal(data: any): void; close(): void }`
  - `connectSignaling(handlers: SignalHandlers): SignalingClient` — `/ws`에 연결하고 서버 메시지를 핸들러로 라우팅. `create`/`join`은 소켓 open 후 전송(open 전이면 큐잉).

- [ ] **Step 1: signaling.ts 구현**

`web/src/lib/signaling.ts`:
```ts
export type SignalHandlers = {
  onCreated?: (code: string) => void
  onPeerJoined?: () => void
  onPeerLeft?: () => void
  onSignal?: (data: any) => void
  onError?: (reason: string) => void
  onClose?: () => void
}

export interface SignalingClient {
  create(): void
  join(code: string): void
  signal(data: any): void
  close(): void
}

export function connectSignaling(handlers: SignalHandlers): SignalingClient {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/ws`)
  const queue: string[] = []

  function raw(obj: unknown) {
    const s = JSON.stringify(obj)
    if (ws.readyState === WebSocket.OPEN) ws.send(s)
    else queue.push(s)
  }
  ws.onopen = () => { while (queue.length) ws.send(queue.shift()!) }
  ws.onclose = () => handlers.onClose?.()
  ws.onmessage = (e) => {
    let m: any
    try { m = JSON.parse(e.data) } catch { return }
    switch (m.type) {
      case 'created': handlers.onCreated?.(m.code); break
      case 'peer-joined': handlers.onPeerJoined?.(); break
      case 'peer-left': handlers.onPeerLeft?.(); break
      case 'signal': handlers.onSignal?.(m.data); break
      case 'error': handlers.onError?.(m.reason); break
    }
  }

  return {
    create: () => raw({ type: 'create' }),
    join: (code) => raw({ type: 'join', code }),
    signal: (data) => raw({ type: 'signal', data }),
    close: () => ws.close(),
  }
}
```

- [ ] **Step 2: 빌드 검증**

Run: `npm run build:web`
Expected: 성공(아직 미사용 — 컴파일만).

- [ ] **Step 3: 커밋**

```bash
git add web/src/lib/signaling.ts
git commit -m "P2P: 프론트 WS 시그널링 클라이언트"
```

---

## Task 4: WebRTC 전송 (p2p.ts) + 순수 헬퍼 테스트

**Files:**
- Create: `web/src/lib/p2p.ts`, `web/src/lib/__tests__/p2p.test.ts`

**Interfaces:**
- Consumes: `SignalingClient` (Task 3).
- Produces (순수, 테스트 대상):
  - `type FileMeta = { name: string; size: number }`
  - `buildManifest(files: FileMeta[]): string` — `JSON.stringify({ kind:'manifest', files })`
  - `parseControl(s: string): any` — `JSON.parse`
  - `assembleBlob(chunks: ArrayBuffer[], type?: string): Blob`
- Produces (WebRTC 글루):
  - `type SendHandlers = { onOpen?: () => void; onProgress?: (fileIndex: number, sentBytes: number) => void; onDone?: () => void; onError?: (e: string) => void }`
  - `startSender(sig: SignalingClient, files: File[], h: SendHandlers): { cancel(): void }` — peer-joined 대기 후 offer/DataChannel 생성, open 시 manifest+청크 전송(백프레셔), 완료 시 `done` + onDone.
  - `type RecvHandlers = { onManifest?: (files: FileMeta[]) => void; onFileProgress?: (index: number, received: number) => void; onFileComplete?: (index: number, name: string, blob: Blob) => void; onDone?: () => void; onError?: (e: string) => void }`
  - `startReceiver(sig: SignalingClient, h: RecvHandlers): { cancel(): void }` — answer, DataChannel 수신, manifest/청크/파일 재조립.
- 상수: `ICE = [{urls:'stun:stun.cloudflare.com:3478'},{urls:'stun:stun.l.google.com:19302'}]`, `CHUNK=16384`, `HIGH=4*1024*1024`, `OPEN_TIMEOUT=20000`.

- [ ] **Step 1: 순수 헬퍼 테스트 작성**

`web/src/lib/__tests__/p2p.test.ts`:
```ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- p2p`
Expected: FAIL — `Cannot find module '../p2p.js'`

- [ ] **Step 3: p2p.ts 구현**

`web/src/lib/p2p.ts` (최종 형태 — sender는 `begin()`으로 offer 생성, 시그널 수신은 반환된 `onSignal`로 처리):
```ts
import type { SignalingClient } from './signaling.js'

export type FileMeta = { name: string; size: number }

const ICE: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
]
const CHUNK = 16384
const HIGH = 4 * 1024 * 1024
const OPEN_TIMEOUT = 20000

export function buildManifest(files: FileMeta[]): string {
  return JSON.stringify({ kind: 'manifest', files })
}
export function parseControl(s: string): any { return JSON.parse(s) }
export function assembleBlob(chunks: ArrayBuffer[], type = 'application/octet-stream'): Blob {
  return new Blob(chunks, { type })
}

function waitDrain(ch: RTCDataChannel): Promise<void> {
  if (ch.bufferedAmount <= HIGH) return Promise.resolve()
  return new Promise((res) => {
    const onLow = () => { ch.removeEventListener('bufferedamountlow', onLow); res() }
    ch.bufferedAmountLowThreshold = HIGH / 2
    ch.addEventListener('bufferedamountlow', onLow)
  })
}

export type SenderConn = { begin(): void; onSignal(data: any): void; cancel(): void }
export type SendHandlers = {
  onOpen?: () => void
  onProgress?: (fileIndex: number, sentBytes: number) => void
  onDone?: () => void
  onError?: (e: string) => void
}

export function startSender(sig: SignalingClient, files: File[], h: SendHandlers): SenderConn {
  const pc = new RTCPeerConnection({ iceServers: ICE })
  const ch = pc.createDataChannel('file')
  ch.binaryType = 'arraybuffer'
  let done = false
  const timer = setTimeout(() => { if (!done && ch.readyState !== 'open') h.onError?.('연결 시간 초과') }, OPEN_TIMEOUT)

  pc.onicecandidate = (e) => { if (e.candidate) sig.signal({ candidate: e.candidate }) }

  async function run() {
    try {
      ch.send(buildManifest(files.map((f) => ({ name: f.name, size: f.size }))))
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        ch.send(JSON.stringify({ kind: 'file-begin', index: i, name: file.name, size: file.size }))
        let offset = 0
        while (offset < file.size) {
          const buf = await file.slice(offset, offset + CHUNK).arrayBuffer()
          await waitDrain(ch)
          ch.send(buf)
          offset += buf.byteLength
          h.onProgress?.(i, offset)
        }
        ch.send(JSON.stringify({ kind: 'file-end', index: i }))
      }
      ch.send(JSON.stringify({ kind: 'done' }))
      done = true
      h.onDone?.()
    } catch (e: any) {
      h.onError?.(e?.message ?? '전송 실패')
    }
  }
  ch.onopen = () => { clearTimeout(timer); h.onOpen?.(); run() }

  return {
    async begin() {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      sig.signal({ sdp: pc.localDescription })
    },
    async onSignal(data: any) {
      if (data.sdp) await pc.setRemoteDescription(data.sdp)
      else if (data.candidate) await pc.addIceCandidate(data.candidate).catch(() => {})
    },
    cancel() { done = true; clearTimeout(timer); try { ch.close() } catch {} pc.close() },
  }
}

export type ReceiverConn = { onSignal(data: any): void; cancel(): void }
export type RecvHandlers = {
  onManifest?: (files: FileMeta[]) => void
  onFileProgress?: (index: number, received: number) => void
  onFileComplete?: (index: number, name: string, blob: Blob) => void
  onDone?: () => void
  onError?: (e: string) => void
}

export function startReceiver(sig: SignalingClient, h: RecvHandlers): ReceiverConn {
  const pc = new RTCPeerConnection({ iceServers: ICE })
  let cur: { index: number; name: string; chunks: ArrayBuffer[]; received: number } | null = null

  pc.onicecandidate = (e) => { if (e.candidate) sig.signal({ candidate: e.candidate }) }
  pc.ondatachannel = (ev) => {
    const ch = ev.channel
    ch.binaryType = 'arraybuffer'
    ch.onmessage = (m) => {
      if (typeof m.data === 'string') {
        const ctrl = parseControl(m.data)
        if (ctrl.kind === 'manifest') h.onManifest?.(ctrl.files)
        else if (ctrl.kind === 'file-begin') cur = { index: ctrl.index, name: ctrl.name, chunks: [], received: 0 }
        else if (ctrl.kind === 'file-end' && cur) { h.onFileComplete?.(cur.index, cur.name, assembleBlob(cur.chunks)); cur = null }
        else if (ctrl.kind === 'done') h.onDone?.()
      } else if (cur) {
        const buf: ArrayBuffer = m.data
        cur.chunks.push(buf); cur.received += buf.byteLength
        h.onFileProgress?.(cur.index, cur.received)
      }
    }
  }

  return {
    async onSignal(data: any) {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp)
        if (data.sdp.type === 'offer') {
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          sig.signal({ sdp: pc.localDescription })
        }
      } else if (data.candidate) await pc.addIceCandidate(data.candidate).catch(() => {})
    },
    cancel() { pc.close() },
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- p2p`
Expected: 순수 헬퍼 2 tests PASS.
Run: `npm run build:web`
Expected: 컴파일 성공(WebRTC 타입은 tsconfig의 lib dom에 포함).

- [ ] **Step 5: 커밋**

```bash
git add web/src/lib/p2p.ts web/src/lib/__tests__/p2p.test.ts
git commit -m "P2P: WebRTC 송/수신 전송 + 프로토콜 헬퍼 테스트"
```

---

## Task 5: P2P 화면 + 모드 토글

**Files:**
- Create: `web/src/P2PSend.tsx`, `web/src/P2PReceive.tsx`
- Modify: `web/src/SendPage.tsx`, `web/src/ReceivePage.tsx`

**Interfaces:**
- Consumes: `connectSignaling` (Task 3), `startSender`/`startReceiver` (Task 4/5), shadcn Button/Input/Progress/Badge, `qrcode`, `fmtSize`.

- [ ] **Step 1: P2PSend.tsx 구현**

`web/src/P2PSend.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Dropzone } from '@/components/Dropzone'
import { FileRow, type UploadStatus } from '@/components/FileRow'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { connectSignaling, type SignalingClient } from '@/lib/signaling'
import { startSender } from '@/lib/p2p'

type Phase = 'select' | 'waiting' | 'sending' | 'done' | 'error'

export function P2PSend() {
  const [files, setFiles] = useState<File[]>([])
  const [phase, setPhase] = useState<Phase>('select')
  const [code, setCode] = useState('')
  const [qr, setQr] = useState('')
  const [progress, setProgress] = useState<number[]>([])
  const [err, setErr] = useState('')
  const sigRef = useRef<SignalingClient | null>(null)
  const connRef = useRef<ReturnType<typeof startSender> | null>(null)

  function start() {
    if (!files.length) return
    setErr(''); setProgress(files.map(() => 0))
    // 순서 주의: sig를 먼저 만들고(그 콜백은 호출 시점에 conn이 채워져 있음), conn을 만든 뒤 create.
    let conn: ReturnType<typeof startSender>
    const sig = connectSignaling({
      onCreated: (c) => { setCode(c); setPhase('waiting') },
      onPeerJoined: () => conn.begin(),
      onPeerLeft: () => { if (phase !== 'done') { setErr('상대가 연결을 끊었습니다'); setPhase('error') } },
      onSignal: (d) => conn.onSignal(d),
      onError: (r) => { setErr(r === 'busy' ? '이미 사용 중인 코드' : '연결 오류'); setPhase('error') },
    })
    conn = startSender(sig, files, {
      onOpen: () => setPhase('sending'),
      onProgress: (i, sent) => setProgress((p) => p.map((v, j) => (j === i ? Math.round((sent / files[i].size) * 100) : v))),
      onDone: () => setPhase('done'),
      onError: (e) => { setErr(e); setPhase('error') },
    })
    connRef.current = conn; sigRef.current = sig
    sig.create()
  }

  useEffect(() => {
    if (!code) { setQr(''); return }
    let c = false
    QRCode.toDataURL(`${location.origin}/#p2p=${code}`, { margin: 1, width: 200 }).then((u) => { if (!c) setQr(u) }).catch(() => {})
    return () => { c = true }
  }, [code])

  useEffect(() => () => { connRef.current?.cancel(); sigRef.current?.close() }, [])

  if (phase === 'select') {
    return (
      <div className="flex flex-col gap-4 py-2">
        <Dropzone onFiles={(fs) => setFiles((p) => [...p, ...fs])} />
        <ul className="flex flex-col gap-2">
          {files.map((f, i) => (
            <FileRow key={`${f.name}-${i}`} name={f.name} size={f.size} status={'queued' as UploadStatus} progress={0}
              onRemove={() => setFiles((p) => p.filter((_, j) => j !== i))} />
          ))}
        </ul>
        <Button size="lg" onClick={start} disabled={!files.length}>실시간 전송 시작</Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      {(phase === 'waiting' || phase === 'sending') && (
        <>
          <p className="text-sm text-muted-foreground">받는 사람이 이 코드를 입력하면 바로 전송됩니다</p>
          <div className="font-mono text-5xl font-bold tracking-[0.2em]">{code}</div>
          {qr && <img src={qr} width={200} height={200} alt="QR" className="rounded-lg border p-2" />}
          <Badge variant="secondary">{phase === 'waiting' ? '상대 연결 대기 중…' : '전송 중…'}</Badge>
          {phase === 'sending' && files.map((f, i) => (
            <FileRow key={i} name={f.name} size={f.size} status={'uploading'} progress={progress[i] ?? 0} />
          ))}
        </>
      )}
      {phase === 'done' && <Badge variant="secondary">전송 완료 ✅</Badge>}
      {phase === 'error' && <p className="text-sm text-destructive">{err} — 링크(릴레이) 모드로 보내보세요.</p>}
      <Button variant="ghost" onClick={() => { connRef.current?.cancel(); sigRef.current?.close(); setPhase('select'); setCode(''); setFiles([]) }}>새 전송</Button>
    </div>
  )
}
```
- [ ] **Step 2: P2PReceive.tsx 구현**

`web/src/P2PReceive.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { FileRow } from '@/components/FileRow'
import { fmtSize } from '@/lib/format'
import { connectSignaling, type SignalingClient } from '@/lib/signaling'
import { startReceiver, type FileMeta } from '@/lib/p2p'

type Phase = 'input' | 'connecting' | 'receiving' | 'done' | 'error'
type Got = { name: string; size: number; url: string }

export function P2PReceive({ initialCode }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode ?? '')
  const [phase, setPhase] = useState<Phase>('input')
  const [manifest, setManifest] = useState<FileMeta[]>([])
  const [progress, setProgress] = useState<number[]>([])
  const [got, setGot] = useState<Got[]>([])
  const [err, setErr] = useState('')
  const sigRef = useRef<SignalingClient | null>(null)
  const connRef = useRef<ReturnType<typeof startReceiver> | null>(null)

  function join(c: string) {
    if (!c) return
    setErr(''); setPhase('connecting')
    let conn: ReturnType<typeof startReceiver>
    const sig = connectSignaling({
      onPeerJoined: () => {},
      onPeerLeft: () => { if (phase !== 'done') { setErr('상대가 연결을 끊었습니다'); setPhase('error') } },
      onSignal: (d) => conn.onSignal(d),
      onError: (r) => { setErr(r === 'not-found' ? '없는 코드입니다' : '연결 오류'); setPhase('error') },
    })
    conn = startReceiver(sig, {
      onManifest: (fs) => { setManifest(fs); setProgress(fs.map(() => 0)); setPhase('receiving') },
      onFileProgress: (i, recv) => setProgress((p) => p.map((v, j) => (j === i ? Math.round((recv / (manifest[i]?.size || 1)) * 100) : v))),
      onFileComplete: (i, name, blob) => setGot((g) => [...g, { name, size: blob.size, url: URL.createObjectURL(blob) }]),
      onDone: () => setPhase('done'),
      onError: (e) => { setErr(e); setPhase('error') },
    })
    connRef.current = conn; sigRef.current = sig
    sig.join(c)
  }

  useEffect(() => { if (initialCode) join(initialCode) }, [initialCode])
  useEffect(() => () => { connRef.current?.cancel(); sigRef.current?.close() }, [])

  return (
    <div className="flex flex-col gap-4 py-2">
      {phase === 'input' && (
        <div className="flex flex-col items-center gap-4 py-6">
          <Input placeholder="6자리 코드" value={code} onChange={(e) => setCode(e.target.value.trim())}
            onKeyDown={(e) => { if (e.key === 'Enter') join(code) }} maxLength={6} inputMode="numeric"
            className="h-14 w-52 text-center font-mono text-2xl tracking-[0.3em]" />
          <Button size="lg" onClick={() => join(code)} disabled={!code}>실시간 받기</Button>
        </div>
      )}
      {phase === 'connecting' && <p className="text-center text-sm text-muted-foreground">연결 중…</p>}
      {(phase === 'receiving' || phase === 'done') && (
        <ul className="flex flex-col gap-2">
          {manifest.map((f, i) => {
            const g = got.find((x) => x.name === f.name)
            return g
              ? <li key={i} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                  <span className="flex-1 truncate">{f.name}</span><span className="text-muted-foreground">{fmtSize(f.size)}</span>
                  <a href={g.url} download={g.name} aria-label="내려받기"><Download className="size-4" /></a>
                </li>
              : <FileRow key={i} name={f.name} size={f.size} status={'uploading'} progress={progress[i] ?? 0} />
          })}
        </ul>
      )}
      {phase === 'done' && <p className="text-center text-sm text-muted-foreground">전송 완료 — 위에서 내려받으세요.</p>}
      {phase === 'error' && <p className="text-sm text-destructive">{err}</p>}
    </div>
  )
}
```

- [ ] **Step 3: SendPage/ReceivePage에 모드 토글 추가**

`web/src/SendPage.tsx` — 파일 상단에 `import { P2PSend } from './P2PSend.js'` 추가, `SendPage` 컴포넌트 최상단에 모드 상태와 토글을 추가하되 **기존 릴레이 로직/JSX는 그대로 유지**하고 감싸기만 한다:
```tsx
// SendPage 함수 본문 맨 앞:
const [mode, setMode] = useState<'relay' | 'p2p'>('relay')
// 그리고 컴포넌트가 반환하는 최상위를 다음으로 감싼다(기존 return을 relayView 변수로 추출):
```
구체적으로: 기존 `return (…relay UI…)`와 `if (result) return (…)`를 유지하되, 함수 맨 끝에서 모드에 따라 분기하는 래퍼를 반환하도록 다음 구조로 바꾼다 — 기존 반환 JSX 전체를 `renderRelay()` 내부 함수로 옮기고:
```tsx
  const toggle = (
    <div className="mb-4 flex justify-center gap-1 rounded-lg bg-muted p-1 text-sm">
      <button onClick={() => setMode('relay')} className={mode === 'relay' ? 'flex-1 rounded-md bg-background py-1 shadow-sm' : 'flex-1 py-1 text-muted-foreground'}>🔗 링크</button>
      <button onClick={() => setMode('p2p')} className={mode === 'p2p' ? 'flex-1 rounded-md bg-background py-1 shadow-sm' : 'flex-1 py-1 text-muted-foreground'}>⚡ 실시간</button>
    </div>
  )
  return <div>{toggle}{mode === 'p2p' ? <P2PSend /> : renderRelay()}</div>
```
`renderRelay()`는 기존 `if (result) {...}` 결과 카드와 그 아래 기본 반환 JSX를 그대로 담은 내부 함수다(로직/상태는 손대지 않는다).

`web/src/ReceivePage.tsx` — 동일 패턴. `import { P2PReceive } from './P2PReceive.js'`. `initialKey`(URL slug)는 릴레이용이므로 P2P에는 넘기지 않는다(P2P 코드 입력은 P2PReceive가 자체 처리). 토글 추가, `mode==='p2p' ? <P2PReceive /> : renderRelay()`.

- [ ] **Step 4: 빌드 + 백엔드 회귀**

Run: `npm run build:web && npm test`
Expected: 웹 빌드 성공, 백엔드 52 통과(무변경).

- [ ] **Step 5: 커밋**

```bash
git add web/src/P2PSend.tsx web/src/P2PReceive.tsx web/src/SendPage.tsx web/src/ReceivePage.tsx
git commit -m "P2P: 실시간 송/수신 화면 + 링크/실시간 모드 토글"
```

---

## Task 6: 검증 + 배포

**Files:** 없음(검증·배포).

- [ ] **Step 1: 전체 빌드 + 테스트**

Run: `npm run build && npm test`
Expected: 서버+웹 빌드 성공, 52 통과.

- [ ] **Step 2: 로컬 2탭 P2P 왕복(수동)**

로컬 프리뷰(빌드 후 `PORT=4599 STORAGE_PATH=/tmp/sa-preview/uploads DB_PATH=/tmp/sa-preview/db/x.sqlite node dist/server.js`). 브라우저 탭 A(보내기→⚡실시간→파일 선택→시작→코드 표시), 탭 B(받기→⚡실시간→코드 입력→받기). 확인:
- 탭 A 코드 발급 → 탭 B 입력 시 양쪽 연결 → 파일 전송 진행률 → 탭 B에서 다운로드.
- WS 프레임/DataChannel 동작(콘솔 에러 없음).
Expected: loopback에서 P2P 왕복 성공.

- [ ] **Step 3: 배포**

```bash
git push origin main
gh run watch "$(gh run list --repo ksheo71/send-anywhere --limit 1 --json databaseId -q '.[0].databaseId')" --repo ksheo71/send-anywhere --exit-status
```
Expected: 배포 성공.

- [ ] **Step 4: 프로덕션 WS + P2P 확인**

- `curl -sS https://sendfile.myazit.kr/api/health` → ok.
- 브라우저에서 https://sendfile.myazit.kr 두 탭(또는 두 기기)로 ⚡실시간 왕복. Cloudflare Tunnel + Caddy가 `wss://sendfile.myazit.kr/ws`를 통과하는지 확인.
- 실패 시(대칭 NAT 등) "릴레이로 보내세요" 안내가 뜨는지 확인.
Expected: WS 연결 성립, P2P 전송(같은 네트워크/loopback 기준) 성공.

---

## 최종 검증 체크리스트
- [ ] `npm test` 52 통과(기존 44 + signaling 7 + ws 1; p2p 헬퍼 2는 웹 글롭에 포함 → 54가 될 수 있음).
- [ ] 릴레이 무변경(기존 흐름 정상).
- [ ] 로컬 2탭 P2P 왕복 성공, 실패 시 릴레이 안내.
- [ ] 프로덕션 `wss://…/ws` 통과 + P2P 동작.

## 자기 검토 메모(작성자)
- 스펙 커버리지: §2 아키텍처(T1,T2) · §3 시그널링 프로토콜(T1,T2,T3) · §4 WebRTC/파일 프로토콜(T4,T5) · §5 UX/실패(T5) · §6 파일구조(전 태스크) · §7 검증(T1,T4,T6). 매핑됨.
- 불변식: 릴레이 코드/스토어/api.ts/tus 무변경. buildApp에 signaling deps 추가로 기존 테스트 호출부만 갱신(T2 Step7).
- 주의: (1) @fastify/websocket v11 핸들러는 `(socket, req)`. (2) `startSender/startReceiver`는 `connectSignaling`으로 만든 `sig`를 인자로 받고, 시그널 수신은 반환 `onSignal`로 처리(순환 회피, P2PSend/Receive의 start 순서 준수). (3) sender offer는 `onPeerJoined`에서 `begin()`으로. (4) 테스트 수는 웹 vitest 글롭 포함 여부에 따라 52~54.
