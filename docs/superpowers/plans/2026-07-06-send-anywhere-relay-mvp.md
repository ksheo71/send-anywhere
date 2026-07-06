# Send Anywhere 릴레이 MVP 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서버 릴레이 방식으로 동작하는 익명 파일 전송 서비스(6자리 코드 + 공유 링크, 청크 업로드, 24시간 만료)를 만들고 맥미니 인프라에 배포한다.

**Architecture:** 단일 Node.js(Fastify) 컨테이너가 REST API·tus 청크 업로드·정적 프론트엔드를 함께 서빙한다. 메타데이터는 SQLite, 파일 blob은 로컬 디스크. 프론트엔드는 Vite+React(빌드 산출물을 Fastify가 정적 서빙). 24시간 후 스위퍼가 만료 파일을 정리한다.

**Tech Stack:** Node 22, TypeScript, Fastify 5, @tus/server 2 + @tus/file-store 2, better-sqlite3 12, archiver 8, @fastify/rate-limit, @fastify/static, Vite + React 18, tus-js-client 4, vitest. Docker(OrbStack, arm64).

## Global Constraints

- Node.js 22 (인프라 arm64, OrbStack). TypeScript strict.
- 모든 트래픽이 Cloudflare 프록시를 지나므로 **단일 요청 본문 100MB 미만**. 업로드는 반드시 tus 청크(기본 50MB)로 분할.
- 자체 TURN 불가. 이 계획에는 **P2P/WebRTC 없음** (1단계 릴레이만).
- 설정값은 전부 env, 기본값: `RETENTION_HOURS=24`, `MAX_FILE_SIZE=2147483648`(2GB), `MAX_TOTAL_SIZE=4294967296`(4GB), `CHUNK_SIZE=52428800`(50MB), `CODE_LENGTH=6`, `STORAGE_PATH=/data/uploads`, `DB_PATH=/data/db/send-anywhere.sqlite`, `SWEEP_INTERVAL_MIN=10`, `RATE_LIMIT_PER_MIN=30`, `PORT=4500`.
- 다운로드 정책: 24시간 동안 횟수 제한 없이 다운로드 가능. **다운로드 후 삭제하지 않음.** 만료 시에만 스위퍼가 삭제.
- 컨테이너명 `send-anywhere`, 도메인 `send.myazit.kr`, `edge_shared` 네트워크 external 합류, 호스트 포트 외부 미노출, `/api/health` 제공.
- 시크릿·`.env`는 git에 넣지 않음.
- 커밋 메시지는 한국어, 각 태스크 끝에 커밋.

---

## File Structure

```
send-anywhere/
├── package.json
├── tsconfig.json              # 백엔드(src) 컴파일
├── vitest.config.ts           # 백엔드 테스트(node env)
├── vite.config.ts             # 프론트엔드 빌드 (root: web/)
├── src/
│   ├── config.ts              # env 파싱 → 타입 있는 config 객체
│   ├── db.ts                  # sqlite 연결 + 스키마 마이그레이션
│   ├── ids.ts                 # 6자리 코드 + slug 생성(충돌 재시도)
│   ├── store.ts               # transfers/files 데이터 접근 계층
│   ├── tus.ts                 # @tus/server 설정 + onUploadFinish 훅
│   ├── sweeper.ts             # 만료 정리 루프
│   ├── app.ts                 # Fastify 인스턴스 빌드(플러그인·라우트 등록)
│   ├── server.ts              # 부트스트랩(listen + 스위퍼 시작)
│   └── routes/
│       ├── health.ts
│       ├── transfers.ts       # POST /api/transfers, POST /:id/finalize
│       ├── resolve.ts         # GET /api/resolve/:codeOrSlug
│       └── download.ts        # GET /api/transfers/:id/download
├── src/__tests__/             # *.test.ts (vitest)
├── web/
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx            # 라우팅(보내기/받기)
│       ├── api.ts            # fetch 래퍼
│       ├── SendPage.tsx
│       └── ReceivePage.tsx
├── Dockerfile
├── docker-compose.yml
├── scripts/deploy.sh
├── .github/workflows/deploy.yml
├── .env.example
└── .dockerignore
```

각 파일은 단일 책임을 갖는다. `store.ts`는 SQL만, `routes/*`는 HTTP만, `tus.ts`는 업로드만.

---

## Task 1: 프로젝트 스캐폴드 + config + health 엔드포인트

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/config.ts`, `src/routes/health.ts`, `src/app.ts`
- Test: `src/__tests__/config.test.ts`, `src/__tests__/health.test.ts`

**Interfaces:**
- Produces: `loadConfig(env: NodeJS.ProcessEnv): Config` where
  `Config = { retentionHours:number; maxFileSize:number; maxTotalSize:number; chunkSize:number; codeLength:number; storagePath:string; dbPath:string; sweepIntervalMin:number; rateLimitPerMin:number; port:number }`
- Produces: `buildApp(config: Config, deps: { store: Store; tus: TusHandler }): FastifyInstance` (deps 인자는 이후 태스크에서 확장; Task 1에서는 `buildApp(config)` 시그니처로 시작하고 Task 4에서 deps 추가)

- [ ] **Step 1: package.json 작성**

```json
{
  "name": "send-anywhere",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build:server": "tsc -p tsconfig.json",
    "build:web": "vite build",
    "build": "npm run build:server && npm run build:web",
    "start": "node dist/server.js",
    "dev:server": "tsx watch src/server.ts",
    "dev:web": "vite",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@fastify/rate-limit": "^10.0.0",
    "@fastify/static": "^8.0.0",
    "@tus/file-store": "^2.1.0",
    "@tus/server": "^2.4.1",
    "archiver": "^8.0.0",
    "better-sqlite3": "^12.11.1",
    "fastify": "^5.10.0"
  },
  "devDependencies": {
    "@types/archiver": "^6.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "tus-js-client": "^4.3.1",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: tsconfig.json 및 vitest.config.ts 작성**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "src/__tests__/**"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    pool: 'forks', // better-sqlite3 native 모듈 호환
  },
})
```

- [ ] **Step 3: install**

Run: `npm install`
Expected: 의존성 설치 완료, `node_modules/` 생성.

- [ ] **Step 4: config 테스트 작성 (실패 확인용)**

`src/__tests__/config.test.ts`:
```ts
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
```

- [ ] **Step 5: 테스트 실패 확인**

Run: `npm test -- config`
Expected: FAIL — `Cannot find module '../config.js'`

- [ ] **Step 6: config.ts 구현**

`src/config.ts`:
```ts
export interface Config {
  retentionHours: number
  maxFileSize: number
  maxTotalSize: number
  chunkSize: number
  codeLength: number
  storagePath: string
  dbPath: string
  sweepIntervalMin: number
  rateLimitPerMin: number
  port: number
}

function num(v: string | undefined, def: number): number {
  const n = v === undefined ? def : Number(v)
  return Number.isFinite(n) ? n : def
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return {
    retentionHours: num(env.RETENTION_HOURS, 24),
    maxFileSize: num(env.MAX_FILE_SIZE, 2147483648),
    maxTotalSize: num(env.MAX_TOTAL_SIZE, 4294967296),
    chunkSize: num(env.CHUNK_SIZE, 52428800),
    codeLength: num(env.CODE_LENGTH, 6),
    storagePath: env.STORAGE_PATH ?? '/data/uploads',
    dbPath: env.DB_PATH ?? '/data/db/send-anywhere.sqlite',
    sweepIntervalMin: num(env.SWEEP_INTERVAL_MIN, 10),
    rateLimitPerMin: num(env.RATE_LIMIT_PER_MIN, 30),
    port: num(env.PORT, 4500),
  }
}
```

- [ ] **Step 7: config 테스트 통과 확인**

Run: `npm test -- config`
Expected: PASS (2 tests)

- [ ] **Step 8: health 라우트 + app 빌더 테스트 작성**

`src/__tests__/health.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app.js'
import { loadConfig } from '../config.js'

describe('GET /api/health', () => {
  it('200 ok 를 반환한다', async () => {
    const app = buildApp(loadConfig({}))
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
    await app.close()
  })
})
```

- [ ] **Step 9: 테스트 실패 확인**

Run: `npm test -- health`
Expected: FAIL — `Cannot find module '../app.js'`

- [ ] **Step 10: health.ts 와 app.ts 구현**

`src/routes/health.ts`:
```ts
import type { FastifyInstance } from 'fastify'

export function registerHealth(app: FastifyInstance): void {
  app.get('/api/health', async () => ({ status: 'ok' }))
}
```

`src/app.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify'
import type { Config } from './config.js'
import { registerHealth } from './routes/health.js'

export function buildApp(config: Config): FastifyInstance {
  const app = Fastify({ logger: false })
  registerHealth(app)
  return app
}
```

- [ ] **Step 11: 테스트 통과 확인**

Run: `npm test`
Expected: PASS (config 2 + health 1)

- [ ] **Step 12: 커밋**

```bash
git add package.json tsconfig.json vitest.config.ts src/ package-lock.json
git commit -m "기반: 프로젝트 스캐폴드 + config + health 엔드포인트"
```

---

## Task 2: SQLite 연결 + 스키마

**Files:**
- Create: `src/db.ts`
- Test: `src/__tests__/db.test.ts`

**Interfaces:**
- Produces: `openDb(path: string): Database` (better-sqlite3 `Database` 인스턴스; `:memory:` 허용). 스키마(transfers, files 테이블)를 생성하고 반환.

- [ ] **Step 1: 테스트 작성**

`src/__tests__/db.test.ts`:
```ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- db`
Expected: FAIL — `Cannot find module '../db.js'`

- [ ] **Step 3: db.ts 구현**

`src/db.ts`:
```ts
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type Db = Database.Database

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS transfers (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE,
      slug TEXT UNIQUE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      download_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      transfer_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      size INTEGER NOT NULL,
      stored_path TEXT NOT NULL,
      upload_complete INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (transfer_id) REFERENCES transfers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_files_transfer ON files(transfer_id);
    CREATE INDEX IF NOT EXISTS idx_transfers_expires ON transfers(expires_at);
  `)
  return db
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- db`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/db.ts src/__tests__/db.test.ts
git commit -m "기반: SQLite 스키마(transfers, files)"
```

---

## Task 3: 코드 + slug 생성 (충돌 재시도)

**Files:**
- Create: `src/ids.ts`
- Test: `src/__tests__/ids.test.ts`

**Interfaces:**
- Produces: `generateSlug(): string` — URL-safe 22자 랜덤 토큰.
- Produces: `generateCode(length: number, exists: (code: string) => boolean): string` — `exists`가 true면 재시도해 유일한 숫자 코드 반환. 100회 시도 후 실패 시 throw.

- [ ] **Step 1: 테스트 작성**

`src/__tests__/ids.test.ts`:
```ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- ids`
Expected: FAIL — `Cannot find module '../ids.js'`

- [ ] **Step 3: ids.ts 구현**

`src/ids.ts`:
```ts
import { randomBytes, randomInt } from 'node:crypto'

export function generateSlug(): string {
  return randomBytes(16).toString('base64url') // 22자
}

export function generateCode(
  length: number,
  exists: (code: string) => boolean,
): string {
  const max = 10 ** length
  for (let i = 0; i < 100; i++) {
    const code = String(randomInt(0, max)).padStart(length, '0')
    if (!exists(code)) return code
  }
  throw new Error('코드 공간이 포화되었습니다')
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- ids`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/ids.ts src/__tests__/ids.test.ts
git commit -m "기반: 6자리 코드 + slug 생성기"
```

---

## Task 4: store 데이터 접근 계층

**Files:**
- Create: `src/store.ts`
- Test: `src/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `openDb` (Task 2), `generateCode`/`generateSlug` (Task 3).
- Produces: `createStore(db: Db, config: Config): Store` where `Store` has:
  - `createTransfer(files: {filename:string; size:number}[]): TransferRecord` — id/code/slug/expires 생성, files 행 삽입(stored_path = `${storagePath}/${transferId}/${fileId}`, upload_complete=0), status='uploading'.
  - `markFileComplete(fileId: string): void`
  - `finalizeTransfer(id: string): void` — status='ready'.
  - `resolve(codeOrSlug: string): TransferView | null` — status='ready'이고 미만료인 것만. 파일 목록 포함.
  - `getById(id: string): TransferView | null`
  - `incrementDownload(id: string): void`
  - `listExpired(now: number): TransferRecord[]`
  - `deleteTransfer(id: string): void` — files + transfer 행 삭제.
- Types:
  - `TransferRecord = { id:string; code:string; slug:string; createdAt:number; expiresAt:number; status:string }`
  - `FileRecord = { id:string; filename:string; size:number; storedPath:string; uploadComplete:boolean }`
  - `TransferView = TransferRecord & { files: FileRecord[] }`

- [ ] **Step 1: 테스트 작성**

`src/__tests__/store.test.ts`:
```ts
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
    expect(view.files[0].storedPath).toContain(t.id)
    expect(view.files[0].uploadComplete).toBe(false)
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
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- store`
Expected: FAIL — `Cannot find module '../store.js'`

- [ ] **Step 3: store.ts 구현**

`src/store.ts`:
```ts
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Db } from './db.js'
import type { Config } from './config.js'
import { generateCode, generateSlug } from './ids.js'

export interface TransferRecord {
  id: string; code: string; slug: string
  createdAt: number; expiresAt: number; status: string
}
export interface FileRecord {
  id: string; filename: string; size: number
  storedPath: string; uploadComplete: boolean
}
export interface TransferView extends TransferRecord { files: FileRecord[] }

export interface Store {
  createTransfer(files: { filename: string; size: number }[]): TransferRecord
  markFileComplete(fileId: string): void
  finalizeTransfer(id: string): void
  resolve(codeOrSlug: string): TransferView | null
  getById(id: string): TransferView | null
  incrementDownload(id: string): void
  listExpired(now: number): TransferRecord[]
  deleteTransfer(id: string): void
}

function rowToTransfer(r: any): TransferRecord {
  return { id: r.id, code: r.code, slug: r.slug, createdAt: r.created_at, expiresAt: r.expires_at, status: r.status }
}
function rowToFile(r: any): FileRecord {
  return { id: r.id, filename: r.filename, size: r.size, storedPath: r.stored_path, uploadComplete: !!r.upload_complete }
}

export function createStore(db: Db, config: Config): Store {
  const filesOf = (id: string): FileRecord[] =>
    db.prepare('SELECT * FROM files WHERE transfer_id=?').all(id).map(rowToFile)

  const viewFromRow = (r: any): TransferView => ({ ...rowToTransfer(r), files: filesOf(r.id) })

  return {
    createTransfer(files) {
      const id = randomUUID()
      const code = generateCode(config.codeLength, (c) =>
        !!db.prepare('SELECT 1 FROM transfers WHERE code=?').get(c))
      const slug = generateSlug()
      const now = Date.now()
      const expiresAt = now + config.retentionHours * 3600_000
      const insertT = db.prepare(
        'INSERT INTO transfers(id,code,slug,created_at,expires_at,status) VALUES(?,?,?,?,?,?)')
      const insertF = db.prepare(
        'INSERT INTO files(id,transfer_id,filename,size,stored_path,upload_complete) VALUES(?,?,?,?,?,0)')
      const tx = db.transaction(() => {
        insertT.run(id, code, slug, now, expiresAt, 'uploading')
        for (const f of files) {
          const fid = randomUUID()
          const storedPath = join(config.storagePath, id, fid)
          insertF.run(fid, id, f.filename, f.size, storedPath)
        }
      })
      tx()
      return { id, code, slug, createdAt: now, expiresAt, status: 'uploading' }
    },
    markFileComplete(fileId) {
      db.prepare('UPDATE files SET upload_complete=1 WHERE id=?').run(fileId)
    },
    finalizeTransfer(id) {
      db.prepare("UPDATE transfers SET status='ready' WHERE id=?").run(id)
    },
    resolve(codeOrSlug) {
      const r: any = db.prepare(
        "SELECT * FROM transfers WHERE (code=? OR slug=?) AND status='ready' AND expires_at > ?")
        .get(codeOrSlug, codeOrSlug, Date.now())
      return r ? viewFromRow(r) : null
    },
    getById(id) {
      const r: any = db.prepare('SELECT * FROM transfers WHERE id=?').get(id)
      return r ? viewFromRow(r) : null
    },
    incrementDownload(id) {
      db.prepare('UPDATE transfers SET download_count=download_count+1 WHERE id=?').run(id)
    },
    listExpired(now) {
      return db.prepare('SELECT * FROM transfers WHERE expires_at <= ?').all(now).map(rowToTransfer)
    },
    deleteTransfer(id) {
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM files WHERE transfer_id=?').run(id)
        db.prepare('DELETE FROM transfers WHERE id=?').run(id)
      })
      tx()
    },
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- store`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/store.ts src/__tests__/store.test.ts
git commit -m "기반: transfers/files store 데이터 접근 계층"
```

---

## Task 5: transfers 라우트 (세션 생성 + finalize) + app에 store 주입

**Files:**
- Create: `src/routes/transfers.ts`
- Modify: `src/app.ts` (deps 인자 추가)
- Test: `src/__tests__/transfers.test.ts`

**Interfaces:**
- Consumes: `Store` (Task 4), `Config`.
- Modifies `buildApp`: 시그니처를 `buildApp(config: Config, deps: { store: Store })` 로 확장. Task 1의 `buildApp(config)` 호출부(health.test.ts)도 `buildApp(config, { store })` 로 갱신하되, health는 store를 쓰지 않으므로 테스트에서 `createStore(openDb(':memory:'), config)` 로 넘긴다.
- Produces (HTTP):
  - `POST /api/transfers` body `{ files: {filename:string; size:number}[] }` → 201 `{ transferId, code, slug, files: {id, filename, size}[], uploadUrlBase: '/files' }`. 검증: 파일 0개 → 400; 파일당 size > maxFileSize → 413; 합계 > maxTotalSize → 413.
  - `POST /api/transfers/:id/finalize` → 200 `{ status:'ready' }`. 존재하지 않으면 404. 완료 안 된 파일이 있으면 409 `{ error:'파일 업로드가 완료되지 않았습니다' }`.

- [ ] **Step 1: 테스트 작성**

`src/__tests__/transfers.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { buildApp } from '../app.js'
import { loadConfig } from '../config.js'
import { openDb } from '../db.js'
import { createStore, type Store } from '../store.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
let store: Store
const config = loadConfig({ MAX_FILE_SIZE: '1000', MAX_TOTAL_SIZE: '1500' })

beforeEach(() => {
  store = createStore(openDb(':memory:'), config)
  app = buildApp(config, { store })
})

describe('POST /api/transfers', () => {
  it('세션을 생성하고 code/slug를 반환한다', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/transfers',
      payload: { files: [{ filename: 'a.txt', size: 10 }] },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.code).toMatch(/^\d{6}$/)
    expect(body.files[0].id).toBeTruthy()
  })

  it('파일이 없으면 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/transfers', payload: { files: [] } })
    expect(res.statusCode).toBe(400)
  })

  it('파일이 상한을 넘으면 413', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/transfers',
      payload: { files: [{ filename: 'big', size: 2000 }] },
    })
    expect(res.statusCode).toBe(413)
  })
})

describe('POST /api/transfers/:id/finalize', () => {
  it('완료 안 된 파일이 있으면 409', async () => {
    const t = store.createTransfer([{ filename: 'a', size: 5 }])
    const res = await app.inject({ method: 'POST', url: `/api/transfers/${t.id}/finalize` })
    expect(res.statusCode).toBe(409)
  })

  it('모든 파일 완료 후 finalize하면 ready', async () => {
    const t = store.createTransfer([{ filename: 'a', size: 5 }])
    store.markFileComplete(store.getById(t.id)!.files[0].id)
    const res = await app.inject({ method: 'POST', url: `/api/transfers/${t.id}/finalize` })
    expect(res.statusCode).toBe(200)
    expect(store.getById(t.id)!.status).toBe('ready')
  })

  it('없는 id는 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/transfers/nope/finalize' })
    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- transfers`
Expected: FAIL — `buildApp`가 2번째 인자를 받지 않음 / 라우트 없음.

- [ ] **Step 3: transfers.ts 구현**

`src/routes/transfers.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import type { Store } from '../store.js'
import type { Config } from '../config.js'

interface CreateBody { files: { filename: string; size: number }[] }

export function registerTransfers(app: FastifyInstance, store: Store, config: Config): void {
  app.post<{ Body: CreateBody }>('/api/transfers', async (req, reply) => {
    const files = req.body?.files ?? []
    if (files.length === 0) return reply.code(400).send({ error: '파일이 없습니다' })
    let total = 0
    for (const f of files) {
      if (typeof f.size !== 'number' || f.size < 0) return reply.code(400).send({ error: '잘못된 크기' })
      if (f.size > config.maxFileSize) return reply.code(413).send({ error: '파일이 너무 큽니다' })
      total += f.size
    }
    if (total > config.maxTotalSize) return reply.code(413).send({ error: '총 용량 초과' })

    const t = store.createTransfer(files)
    const view = store.getById(t.id)!
    return reply.code(201).send({
      transferId: t.id, code: t.code, slug: t.slug,
      files: view.files.map((f) => ({ id: f.id, filename: f.filename, size: f.size })),
      uploadUrlBase: '/files',
    })
  })

  app.post<{ Params: { id: string } }>('/api/transfers/:id/finalize', async (req, reply) => {
    const view = store.getById(req.params.id)
    if (!view) return reply.code(404).send({ error: '없는 전송입니다' })
    if (view.files.some((f) => !f.uploadComplete))
      return reply.code(409).send({ error: '파일 업로드가 완료되지 않았습니다' })
    store.finalizeTransfer(view.id)
    return reply.send({ status: 'ready' })
  })
}
```

- [ ] **Step 4: app.ts 수정**

`src/app.ts` 를 다음으로 교체:
```ts
import Fastify, { type FastifyInstance } from 'fastify'
import type { Config } from './config.js'
import type { Store } from './store.js'
import { registerHealth } from './routes/health.js'
import { registerTransfers } from './routes/transfers.js'

export interface AppDeps { store: Store }

export function buildApp(config: Config, deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 1_048_576 })
  registerHealth(app)
  registerTransfers(app, deps.store, config)
  return app
}
```

- [ ] **Step 5: health.test.ts 갱신**

`src/__tests__/health.test.ts` 의 `buildApp(loadConfig({}))` 를 다음으로:
```ts
import { openDb } from '../db.js'
import { createStore } from '../store.js'
// ...
const cfg = loadConfig({})
const app = buildApp(cfg, { store: createStore(openDb(':memory:'), cfg) })
```

- [ ] **Step 6: 통과 확인**

Run: `npm test`
Expected: PASS (전체)

- [ ] **Step 7: 커밋**

```bash
git add src/routes/transfers.ts src/app.ts src/__tests__/
git commit -m "기능: 전송 세션 생성 + finalize 엔드포인트"
```

---

## Task 6: tus 청크 업로드 통합

**Files:**
- Create: `src/tus.ts`
- Modify: `src/app.ts`
- Test: `src/__tests__/tus.test.ts`

**Interfaces:**
- Consumes: `Store` (Task 4), `Config`. 세션 생성 시 파일 id가 곧 tus upload id가 되도록, 클라이언트는 tus 업로드를 만들 때 metadata에 `fileId`(생성 응답의 files[].id)를 넣는다.
- Produces: `createTusServer(store: Store, config: Config): TusServer` — `@tus/server`의 `Server`. `onUploadCreate`에서 metadata.fileId 존재를 검증, `onUploadFinish`에서 `store.markFileComplete(fileId)` 호출. datastore 디렉토리는 `config.storagePath`.
- Produces: `registerTus(app, tusServer)` — `/files` 및 `/files/*` 를 raw로 위임(`reply.hijack()` + `tusServer.handle(req.raw, reply.raw)`), `application/offset+octet-stream` content-type parser를 no-op으로 등록.
- Note: 파일은 `${storagePath}/${uploadId}` 에 저장된다(tus 기본). store의 stored_path는 Task 4에서 `${storagePath}/${transferId}/${fileId}` 였는데, **tus는 flat하게 저장**하므로 store의 stored_path 계산을 `${storagePath}/${fileId}` 로 맞춘다(아래 Step에서 store 수정). fileId를 tus uploadId로 사용해 경로 일치.

- [ ] **Step 1: store의 stored_path를 tus와 일치시키기**

`src/store.ts`의 createTransfer 내부 `storedPath` 계산을 다음으로 수정:
```ts
const storedPath = join(config.storagePath, fid) // tus uploadId == fileId, flat 저장
```
그리고 tus가 uploadId로 fileId를 쓰도록, 클라이언트가 upload 생성 시 그 id를 지정한다(Task 12 프론트에서 `metadata.fileId` + tus `Upload` 옵션). 서버는 `onUploadCreate`에서 uploadId를 metadata.fileId로 강제 정렬(아래 구현).

store.test.ts의 `expect(view.files[0].storedPath).toContain(t.id)` 를 `toContain(view.files[0].id)` 로 수정.

- [ ] **Step 2: tus 통합 테스트 작성**

`src/__tests__/tus.test.ts`:
```ts
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
```

- [ ] **Step 3: 실패 확인**

Run: `npm test -- tus`
Expected: FAIL — `Cannot find module '../tus.js'` / `/files` 라우트 없음.

- [ ] **Step 4: tus.ts 구현**

`src/tus.ts`:
```ts
import { Server } from '@tus/server'
import { FileStore } from '@tus/file-store'
import { mkdirSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import type { Store } from './store.js'
import type { Config } from './config.js'

export function createTusServer(store: Store, config: Config): Server {
  mkdirSync(config.storagePath, { recursive: true })
  const server = new Server({
    path: '/files',
    datastore: new FileStore({ directory: config.storagePath }),
    // uploadId를 클라이언트 metadata.fileId로 강제 → stored_path와 일치
    namingFunction(req, metadata) {
      const fileId = metadata?.fileId
      if (!fileId) throw new Error('fileId metadata 필요')
      return fileId
    },
    async onUploadFinish(req, upload) {
      if (upload.id) store.markFileComplete(upload.id)
      return {}
    },
  })
  return server
}

export function registerTus(app: FastifyInstance, tus: Server): void {
  app.addContentTypeParser('application/offset+octet-stream', (_req, _payload, done) => done(null))
  const handler = (req: any, reply: any) => {
    reply.hijack()
    tus.handle(req.raw, reply.raw)
  }
  app.all('/files', handler)
  app.all('/files/*', handler)
}
```

- [ ] **Step 5: app.ts에 tus 등록**

`src/app.ts`의 `AppDeps`와 `buildApp` 수정:
```ts
import { registerTus } from './tus.js'
import { createTusServer } from './tus.js'
// AppDeps에는 store만 유지. buildApp 내부에서 tus 생성:
export function buildApp(config: Config, deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 1_048_576 })
  registerHealth(app)
  registerTransfers(app, deps.store, config)
  const tus = createTusServer(deps.store, config)
  registerTus(app, tus)
  return app
}
```

- [ ] **Step 6: 통과 확인**

Run: `npm test`
Expected: PASS (tus 포함 전체). store.test.ts 수정 반영 확인.

- [ ] **Step 7: 커밋**

```bash
git add src/tus.ts src/app.ts src/store.ts src/__tests__/
git commit -m "기능: tus 청크 업로드 통합(100MB 벽 우회)"
```

---

## Task 7: resolve 라우트 + rate limit

**Files:**
- Create: `src/routes/resolve.ts`
- Modify: `src/app.ts` (`@fastify/rate-limit` 등록)
- Test: `src/__tests__/resolve.test.ts`

**Interfaces:**
- Consumes: `Store`.
- Produces (HTTP): `GET /api/resolve/:codeOrSlug` → 200 `{ transferId, expiresAt, files: {id, filename, size}[] }` (미완료/만료/없음 → 404 `{ error:'없거나 만료된 코드입니다' }`).
- rate limit: `/api/resolve/*` 에만 IP당 `config.rateLimitPerMin`/분 적용.

- [ ] **Step 1: 테스트 작성**

`src/__tests__/resolve.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { buildApp } from '../app.js'
import { loadConfig } from '../config.js'
import { openDb } from '../db.js'
import { createStore, type Store } from '../store.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
let store: Store
const config = loadConfig({})

beforeEach(async () => {
  store = createStore(openDb(':memory:'), config)
  app = buildApp(config, { store })
  await app.ready()
})

describe('GET /api/resolve/:x', () => {
  it('ready 전송을 code로 조회한다', async () => {
    const t = store.createTransfer([{ filename: 'a.txt', size: 5 }])
    store.markFileComplete(store.getById(t.id)!.files[0].id)
    store.finalizeTransfer(t.id)
    const res = await app.inject({ method: 'GET', url: `/api/resolve/${t.code}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().files[0].filename).toBe('a.txt')
  })

  it('없는 코드는 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/resolve/000000' })
    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- resolve`
Expected: FAIL — 라우트 없음.

- [ ] **Step 3: resolve.ts 구현**

`src/routes/resolve.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import type { Store } from '../store.js'

export function registerResolve(app: FastifyInstance, store: Store): void {
  app.get<{ Params: { key: string } }>('/api/resolve/:key', async (req, reply) => {
    const view = store.resolve(req.params.key)
    if (!view) return reply.code(404).send({ error: '없거나 만료된 코드입니다' })
    return reply.send({
      transferId: view.id,
      expiresAt: view.expiresAt,
      files: view.files.map((f) => ({ id: f.id, filename: f.filename, size: f.size })),
    })
  })
}
```

- [ ] **Step 4: app.ts에 rate-limit + resolve 등록**

`src/app.ts`의 `buildApp`를 async로 바꾸지 않기 위해 rate-limit은 `app.register` (지연 로드)로 등록하고, resolve는 그 뒤에 등록. `buildApp`은 동기 유지하되 내부에서 register를 호출하고 라우트 등록은 `app.register(async (scoped) => {...})`로 감싸 rate limit 스코프를 제한한다:
```ts
import rateLimit from '@fastify/rate-limit'
import { registerResolve } from './routes/resolve.js'
// buildApp 내부, registerTransfers 뒤에:
app.register(async (scoped) => {
  await scoped.register(rateLimit, {
    max: config.rateLimitPerMin, timeWindow: '1 minute',
  })
  registerResolve(scoped, deps.store)
})
```

- [ ] **Step 5: 통과 확인**

Run: `npm test`
Expected: PASS 전체.

- [ ] **Step 6: 커밋**

```bash
git add src/routes/resolve.ts src/app.ts src/__tests__/resolve.test.ts
git commit -m "기능: resolve 조회 + 브루트포스 rate limit"
```

---

## Task 8: download 라우트 (단일 + zip 스트림)

**Files:**
- Create: `src/routes/download.ts`
- Modify: `src/app.ts`
- Test: `src/__tests__/download.test.ts`

**Interfaces:**
- Consumes: `Store`.
- Produces (HTTP):
  - `GET /api/transfers/:id/download` → 파일 1개면 그 파일을 `Content-Disposition: attachment; filename` 로 스트리밍. 여러 개면 archiver로 zip 스트림(`send-anywhere-<code>.zip`). 조회 성공 시 `store.incrementDownload(id)`.
  - 미완료/만료/없음 → 404. (store.resolve로 검증하려면 code/slug가 필요하므로, 여기선 `getById` 후 status==='ready' && 미만료 확인.)
  - `GET /api/transfers/:id/download?fileId=<id>` → 특정 파일 1개만.

- [ ] **Step 1: 테스트 작성**

`src/__tests__/download.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { buildApp } from '../app.js'
import { loadConfig } from '../config.js'
import { openDb } from '../db.js'
import { createStore, type Store } from '../store.js'
import type { FastifyInstance } from 'fastify'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let app: FastifyInstance
let store: Store
const tmp = mkdtempSync(join(tmpdir(), 'sad-'))
const config = loadConfig({ STORAGE_PATH: tmp })

function seedReady(files: { filename: string; body: string }[]) {
  const t = store.createTransfer(files.map((f) => ({ filename: f.filename, size: f.body.length })))
  const view = store.getById(t.id)!
  view.files.forEach((f, i) => {
    writeFileSync(f.storedPath, files[i].body)
    store.markFileComplete(f.id)
  })
  store.finalizeTransfer(t.id)
  return store.getById(t.id)!
}

beforeEach(async () => {
  store = createStore(openDb(':memory:'), config)
  app = buildApp(config, { store })
  await app.ready()
})

describe('GET /api/transfers/:id/download', () => {
  it('단일 파일을 그대로 내려준다', async () => {
    const v = seedReady([{ filename: 'a.txt', body: 'hello' }])
    const res = await app.inject({ method: 'GET', url: `/api/transfers/${v.id}/download` })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('hello')
    expect(res.headers['content-disposition']).toContain('a.txt')
    expect(store.getById(v.id)!.status).toBe('ready')
  })

  it('여러 파일이면 zip을 내려준다', async () => {
    const v = seedReady([
      { filename: 'a.txt', body: 'A' },
      { filename: 'b.txt', body: 'B' },
    ])
    const res = await app.inject({ method: 'GET', url: `/api/transfers/${v.id}/download` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('zip')
    expect(res.rawPayload.slice(0, 2).toString()).toBe('PK') // zip 매직
  })

  it('없는 전송은 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/transfers/nope/download' })
    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- download`
Expected: FAIL — 라우트 없음.

- [ ] **Step 3: download.ts 구현**

`src/routes/download.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'node:fs'
import archiver from 'archiver'
import type { Store } from '../store.js'

export function registerDownload(app: FastifyInstance, store: Store): void {
  app.get<{ Params: { id: string }; Querystring: { fileId?: string } }>(
    '/api/transfers/:id/download',
    async (req, reply) => {
      const view = store.getById(req.params.id)
      if (!view || view.status !== 'ready' || view.expiresAt <= Date.now())
        return reply.code(404).send({ error: '없거나 만료된 전송입니다' })

      const complete = view.files.filter((f) => f.uploadComplete)
      const target = req.query.fileId
        ? complete.filter((f) => f.id === req.query.fileId)
        : complete
      if (target.length === 0) return reply.code(404).send({ error: '파일이 없습니다' })

      store.incrementDownload(view.id)

      if (target.length === 1) {
        const f = target[0]
        reply.header('Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`)
        reply.type('application/octet-stream')
        return reply.send(createReadStream(f.storedPath))
      }

      reply.header('Content-Disposition',
        `attachment; filename="send-anywhere-${view.code}.zip"`)
      reply.type('application/zip')
      const archive = archiver('zip', { zlib: { level: 0 } })
      for (const f of target) archive.file(f.storedPath, { name: f.filename })
      archive.finalize()
      return reply.send(archive)
    },
  )
}
```

- [ ] **Step 4: app.ts에 등록**

`src/app.ts`의 `registerTransfers` 뒤(rate-limit 스코프 밖)에:
```ts
import { registerDownload } from './routes/download.js'
// ...
registerDownload(app, deps.store)
```

- [ ] **Step 5: 통과 확인**

Run: `npm test`
Expected: PASS 전체.

- [ ] **Step 6: 커밋**

```bash
git add src/routes/download.ts src/app.ts src/__tests__/download.test.ts
git commit -m "기능: 다운로드(단일 + zip 스트림)"
```

---

## Task 9: 스위퍼 (만료 정리)

**Files:**
- Create: `src/sweeper.ts`
- Test: `src/__tests__/sweeper.test.ts`

**Interfaces:**
- Consumes: `Store`, `Config`.
- Produces: `sweepOnce(store: Store): Promise<number>` — 만료 transfer의 blob 디렉토리/파일 삭제 + `store.deleteTransfer`. 삭제 개수 반환.
- Produces: `startSweeper(store: Store, config: Config): () => void` — `sweepOnce`를 `sweepIntervalMin`마다 실행하는 setInterval. 반환값은 중지 함수.

- [ ] **Step 1: 테스트 작성**

`src/__tests__/sweeper.test.ts`:
```ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- sweeper`
Expected: FAIL — `Cannot find module '../sweeper.js'`

- [ ] **Step 3: sweeper.ts 구현**

`src/sweeper.ts`:
```ts
import { rm } from 'node:fs/promises'
import type { Store } from './store.js'
import type { Config } from './config.js'

export async function sweepOnce(store: Store): Promise<number> {
  const expired = store.listExpired(Date.now())
  for (const t of expired) {
    const view = store.getById(t.id)
    if (view) {
      for (const f of view.files) {
        await rm(f.storedPath, { force: true })
      }
    }
    store.deleteTransfer(t.id)
  }
  return expired.length
}

export function startSweeper(store: Store, config: Config): () => void {
  const ms = config.sweepIntervalMin * 60_000
  const timer = setInterval(() => {
    sweepOnce(store).catch(() => {})
  }, ms)
  timer.unref?.()
  return () => clearInterval(timer)
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: PASS 전체.

- [ ] **Step 5: 커밋**

```bash
git add src/sweeper.ts src/__tests__/sweeper.test.ts
git commit -m "기능: 만료 스위퍼"
```

---

## Task 10: server 부트스트랩 + 정적 서빙 배선

**Files:**
- Create: `src/server.ts`
- Modify: `src/app.ts` (@fastify/static 로 web 빌드 서빙 + SPA 폴백)
- Test: `src/__tests__/spa.test.ts`

**Interfaces:**
- Consumes: 모든 이전 모듈.
- Produces: `src/server.ts` — config 로드 → db 열기 → store 생성 → app 빌드 → listen → 스위퍼 시작. 프로세스 진입점.
- app.ts: `@fastify/static`으로 `web/dist`(존재 시) 서빙, API/`/files` 외 경로는 `index.html` 폴백(SPA). 정적 디렉토리가 없으면(테스트 등) 정적 등록을 건너뛴다.

- [ ] **Step 1: SPA 폴백 테스트 작성**

`src/__tests__/spa.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app.js'
import { loadConfig } from '../config.js'
import { openDb } from '../db.js'
import { createStore } from '../store.js'

describe('정적/SPA', () => {
  it('API 경로는 정적 폴백에 가리지 않는다', async () => {
    const cfg = loadConfig({})
    const app = buildApp(cfg, { store: createStore(openDb(':memory:'), cfg) })
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    await app.close()
  })
})
```

- [ ] **Step 2: 실패 확인 (정적 등록이 API를 깨지 않는지)**

Run: `npm test -- spa`
Expected: 현재는 PASS일 수도 있음(정적 미등록). 이 테스트는 정적 추가 후에도 API가 살아있음을 보장하는 회귀 가드.

- [ ] **Step 3: app.ts에 정적 서빙 추가**

`src/app.ts` buildApp 끝부분(return 직전)에:
```ts
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// ...
const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist')
if (existsSync(webDir)) {
  app.register(fastifyStatic, { root: webDir })
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/files')) {
      return reply.code(404).send({ error: 'not found' })
    }
    return reply.sendFile('index.html')
  })
}
```
(주의: `dist/server.js` 기준 `../web/dist`. 빌드 산출물 배치는 Task 14 Dockerfile에서 맞춘다.)

- [ ] **Step 4: server.ts 구현**

`src/server.ts`:
```ts
import { loadConfig } from './config.js'
import { openDb } from './db.js'
import { createStore } from './store.js'
import { buildApp } from './app.js'
import { startSweeper } from './sweeper.js'

const config = loadConfig(process.env)
const db = openDb(config.dbPath)
const store = createStore(db, config)
const app = buildApp(config, { store })

startSweeper(store, config)

app.listen({ port: config.port, host: '0.0.0.0' })
  .then(() => console.log(`send-anywhere on :${config.port}`))
  .catch((err) => { console.error(err); process.exit(1) })
```

- [ ] **Step 5: 통과 확인 + 빌드 스모크**

Run: `npm test && npm run build:server`
Expected: 테스트 PASS, `dist/` 생성(타입 에러 0).

- [ ] **Step 6: 커밋**

```bash
git add src/server.ts src/app.ts src/__tests__/spa.test.ts
git commit -m "기반: 서버 부트스트랩 + 정적/SPA 서빙"
```

---

## Task 11: 프론트엔드 스캐폴드 (Vite + React)

**Files:**
- Create: `vite.config.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/api.ts`

**Interfaces:**
- Produces: `web/dist`로 빌드되는 React SPA. 개발 시 `vite`가 `/api`·`/files`를 백엔드(`:4500`)로 프록시.
- `web/src/api.ts` exports: `createTransfer(files)`, `finalizeTransfer(id)`, `resolve(key)`, `downloadUrl(id, fileId?)`.

- [ ] **Step 1: vite.config.ts 작성**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: {
      '/api': 'http://localhost:4500',
      '/files': 'http://localhost:4500',
    },
  },
})
```

- [ ] **Step 2: index.html + main.tsx 작성**

`web/index.html`:
```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Send Anywhere</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
)
```

- [ ] **Step 3: api.ts 작성**

`web/src/api.ts`:
```ts
export interface FileMeta { id: string; filename: string; size: number }

export async function createTransfer(files: { filename: string; size: number }[]) {
  const res = await fetch('/api/transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  })
  if (!res.ok) throw new Error((await res.json()).error ?? '생성 실패')
  return res.json() as Promise<{ transferId: string; code: string; slug: string; files: FileMeta[] }>
}

export async function finalizeTransfer(id: string) {
  const res = await fetch(`/api/transfers/${id}/finalize`, { method: 'POST' })
  if (!res.ok) throw new Error('finalize 실패')
  return res.json()
}

export async function resolve(key: string) {
  const res = await fetch(`/api/resolve/${encodeURIComponent(key)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('조회 실패')
  return res.json() as Promise<{ transferId: string; expiresAt: number; files: FileMeta[] }>
}

export function downloadUrl(id: string, fileId?: string) {
  return `/api/transfers/${id}/download${fileId ? `?fileId=${fileId}` : ''}`
}
```

- [ ] **Step 4: App.tsx (라우팅 스켈레톤) 작성**

`web/src/App.tsx`:
```tsx
import { useState } from 'react'
import { SendPage } from './SendPage.js'
import { ReceivePage } from './ReceivePage.js'

export function App() {
  // slug/code가 URL 경로에 있으면 받기 화면으로.
  const path = window.location.pathname.replace(/^\//, '')
  const [tab, setTab] = useState<'send' | 'receive'>(path ? 'receive' : 'send')

  return (
    <main style={{ maxWidth: 560, margin: '40px auto', fontFamily: 'system-ui', padding: 16 }}>
      <h1>Send Anywhere</h1>
      <nav style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <button onClick={() => setTab('send')} disabled={tab === 'send'}>보내기</button>
        <button onClick={() => setTab('receive')} disabled={tab === 'receive'}>받기</button>
      </nav>
      {tab === 'send' ? <SendPage /> : <ReceivePage initialKey={path} />}
    </main>
  )
}
```

- [ ] **Step 5: 플레이스홀더 SendPage/ReceivePage 로 빌드 확인**

임시로 `web/src/SendPage.tsx`, `web/src/ReceivePage.tsx`에 최소 컴포넌트를 만들어 빌드가 되게 한다(Task 12/13에서 실제 구현):
```tsx
// SendPage.tsx
export function SendPage() { return <div>보내기</div> }
```
```tsx
// ReceivePage.tsx
export function ReceivePage({ initialKey }: { initialKey: string }) {
  return <div>받기 {initialKey}</div>
}
```

Run: `npm run build:web`
Expected: `web/dist/index.html` 생성.

- [ ] **Step 6: 커밋**

```bash
git add vite.config.ts web/
git commit -m "프론트: Vite+React 스캐폴드 + api 클라이언트"
```

---

## Task 12: 보내기 화면 (tus 업로드 + 코드/QR/링크)

**Files:**
- Modify: `web/src/SendPage.tsx`

**Interfaces:**
- Consumes: `createTransfer`, `finalizeTransfer` (api.ts), `tus-js-client`.
- 흐름: 파일 선택 → `createTransfer` → 각 파일마다 `tus.Upload`로 업로드(metadata.fileId = 응답 files[].id, chunkSize 50MB, endpoint `/files`) → 전체 완료 시 `finalizeTransfer` → 6자리 코드 + 링크 표시.

- [ ] **Step 1: SendPage 구현**

`web/src/SendPage.tsx`:
```tsx
import { useState } from 'react'
import * as tus from 'tus-js-client'
import { createTransfer, finalizeTransfer } from './api.js'

const CHUNK = 50 * 1024 * 1024

export function SendPage() {
  const [files, setFiles] = useState<File[]>([])
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ code: string; slug: string } | null>(null)
  const [error, setError] = useState('')

  async function send() {
    if (files.length === 0) return
    setBusy(true); setError(''); setProgress(0)
    try {
      const meta = files.map((f) => ({ filename: f.name, size: f.size }))
      const t = await createTransfer(meta)
      const totals = files.reduce((s, f) => s + f.size, 0)
      let uploaded = 0

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const fileId = t.files[i].id
        await new Promise<void>((resolve, reject) => {
          const upload = new tus.Upload(file, {
            endpoint: '/files',
            chunkSize: CHUNK,
            retryDelays: [0, 1000, 3000, 5000],
            metadata: { fileId, filename: file.name },
            onError: reject,
            onProgress: (sent) => setProgress(Math.round(((uploaded + sent) / totals) * 100)),
            onSuccess: () => { uploaded += file.size; resolve() },
          })
          upload.start()
        })
      }
      await finalizeTransfer(t.transferId)
      setResult({ code: t.code, slug: t.slug })
    } catch (e: any) {
      setError(e.message ?? '업로드 실패')
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    const link = `${window.location.origin}/${result.slug}`
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(link)}`
    return (
      <div>
        <p>받는 사람에게 이 6자리 코드나 링크를 전달하세요:</p>
        <div style={{ fontSize: 40, letterSpacing: 6, fontWeight: 700 }}>{result.code}</div>
        <p><a href={link}>{link}</a></p>
        <button onClick={() => navigator.clipboard.writeText(link)}>링크 복사</button>
        <div><img src={qr} alt="QR" width={180} height={180} /></div>
        <p>24시간 뒤 자동 삭제됩니다.</p>
        <button onClick={() => { setResult(null); setFiles([]) }}>새 전송</button>
      </div>
    )
  }

  return (
    <div>
      <input type="file" multiple disabled={busy}
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
      <ul>{files.map((f) => <li key={f.name}>{f.name} ({Math.round(f.size / 1024)} KB)</li>)}</ul>
      {busy && <progress value={progress} max={100} style={{ width: '100%' }} />}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <button onClick={send} disabled={busy || files.length === 0}>
        {busy ? `업로드 중… ${progress}%` : '보내기'}
      </button>
    </div>
  )
}
```

- 참고: QR은 외부 이미지 서비스를 씁니다. 외부 의존을 피하려면 `qrcode` npm 패키지로 로컬 생성으로 바꿀 수 있음(선택). 기본은 위 방식.

- [ ] **Step 2: 빌드 확인**

Run: `npm run build:web`
Expected: 타입 에러 없이 빌드.

- [ ] **Step 3: 수동 스모크(로컬)**

Run(터미널 2개): `npm run dev:server` 와 `npm run dev:web`. 브라우저에서 작은 파일 업로드 → 코드/링크 표시 확인.
Expected: 코드 6자리 + 링크 노출.

- [ ] **Step 4: 커밋**

```bash
git add web/src/SendPage.tsx
git commit -m "프론트: 보내기 화면(tus 업로드 + 코드/QR/링크)"
```

---

## Task 13: 받기 화면 (조회 + 다운로드)

**Files:**
- Modify: `web/src/ReceivePage.tsx`

**Interfaces:**
- Consumes: `resolve`, `downloadUrl` (api.ts).
- 흐름: `initialKey`(URL 경로의 slug) 있으면 자동 조회. 없으면 6자리 코드 입력 → 조회 → 파일 목록 + 다운로드(전체/개별) 버튼.

- [ ] **Step 1: ReceivePage 구현**

`web/src/ReceivePage.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { resolve, downloadUrl, type FileMeta } from './api.js'

export function ReceivePage({ initialKey }: { initialKey: string }) {
  const [key, setKey] = useState(initialKey)
  const [data, setData] = useState<{ transferId: string; files: FileMeta[] } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function lookup(k: string) {
    if (!k) return
    setLoading(true); setError(''); setData(null)
    try {
      const r = await resolve(k)
      if (!r) setError('없거나 만료된 코드입니다')
      else setData(r)
    } catch { setError('조회 실패') }
    finally { setLoading(false) }
  }

  useEffect(() => { if (initialKey) lookup(initialKey) }, [initialKey])

  return (
    <div>
      {!data && (
        <div>
          <input placeholder="6자리 코드" value={key}
            onChange={(e) => setKey(e.target.value.trim())} maxLength={6}
            style={{ fontSize: 24, letterSpacing: 4, width: 160 }} />
          <button onClick={() => lookup(key)} disabled={loading}>받기</button>
        </div>
      )}
      {loading && <p>조회 중…</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {data && (
        <div>
          <ul>{data.files.map((f) => (
            <li key={f.id}>
              {f.filename} ({Math.round(f.size / 1024)} KB){' '}
              <a href={downloadUrl(data.transferId, f.id)}>내려받기</a>
            </li>
          ))}</ul>
          {data.files.length > 1 && (
            <a href={downloadUrl(data.transferId)}>
              <button>전체 zip 받기</button>
            </a>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build:web`
Expected: 타입 에러 없이 빌드.

- [ ] **Step 3: 수동 스모크(로컬 전체 흐름)**

Run: `npm run dev:server` + `npm run dev:web`. 보내기로 코드 발급 → 받기 탭에 코드 입력 → 파일 목록·다운로드 동작 확인. 링크 접속(`/<slug>`) 자동 조회 확인.
Expected: 업로드→코드→다운로드 왕복 성공.

- [ ] **Step 4: 커밋**

```bash
git add web/src/ReceivePage.tsx
git commit -m "프론트: 받기 화면(조회 + 다운로드)"
```

---

## Task 14: 배포 (Dockerfile + compose + deploy.sh + CI + Caddy)

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `scripts/deploy.sh`, `.github/workflows/deploy.yml`, `.env.example`, `README.md`

**Interfaces:**
- 산출: `git push origin main` → 맥미니 self-hosted 러너가 `deploy.sh` 실행 → `send-anywhere` 컨테이너 재기동. Caddy에 1줄 추가 후 `send.myazit.kr` 로 접속.
- 컨테이너 내부 배치: `dist/`(서버) + `web/dist/`(프론트) → Task 10의 `../web/dist` 경로와 일치하도록 `WORKDIR /app`, 서버는 `/app/dist/server.js`, 프론트는 `/app/web/dist`.

- [ ] **Step 1: Dockerfile 작성 (multi-stage, arm64)**

```dockerfile
# build stage
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY web ./web
RUN npm run build   # dist/ (server) + web/dist (frontend)

# runtime stage
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
EXPOSE 4500
CMD ["node", "dist/server.js"]
```

주의: `better-sqlite3`는 네이티브 모듈이라 runtime 스테이지에서 `npm ci --omit=dev`로 재빌드된다. slim 이미지에 빌드 툴이 없으면 실패할 수 있으므로, 필요 시 runtime 스테이지에 `RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*`를 `npm ci` 앞에 추가한다.

- [ ] **Step 2: .dockerignore + .env.example**

`.dockerignore`:
```
node_modules
dist
web/dist
.git
data
*.log
```

`.env.example`:
```
RETENTION_HOURS=24
MAX_FILE_SIZE=2147483648
MAX_TOTAL_SIZE=4294967296
CHUNK_SIZE=52428800
CODE_LENGTH=6
STORAGE_PATH=/data/uploads
DB_PATH=/data/db/send-anywhere.sqlite
SWEEP_INTERVAL_MIN=10
RATE_LIMIT_PER_MIN=30
PORT=4500
```

- [ ] **Step 3: docker-compose.yml 작성**

인프라 규약: 고유 `name:`, `edge_shared` external 합류, 호스트 포트 미노출, 볼륨 바인드.
```yaml
name: send-anywhere

services:
  send-anywhere:
    build:
      context: ./repo
      dockerfile: Dockerfile
    container_name: send-anywhere
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - /opt/stack/data/send-anywhere/uploads:/data/uploads
      - /opt/stack/data/send-anywhere/db:/data/db
    networks:
      - edge_shared

networks:
  edge_shared:
    external: true
```
주의: 운영 트리 규약상 compose는 `repo/docker-compose.yml`에 있고 `.env`는 상위 `../.env`에서 주입된다. 위 `build.context: ./repo`는 운영 트리에서 실행할 때 기준이며, repo 안에서 로컬 테스트 시에는 `context: .`로 바꿔 쓴다. (deploy.sh가 `--env-file ../.env -f repo/docker-compose.yml`로 호출)

- [ ] **Step 4: scripts/deploy.sh 작성 (인프라 표준 패턴)**

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/stack/services/public/myazit.kr/send-anywhere"
cd "$APP_DIR"

git -C repo fetch --prune origin
git -C repo reset --hard origin/main

docker compose --env-file .env -f repo/docker-compose.yml up -d --build --force-recreate --remove-orphans
docker image prune -f

# health check (최대 60초)
for i in $(seq 1 30); do
  if docker exec send-anywhere wget -q --spider http://localhost:4500/api/health; then
    echo "healthy"; exit 0
  fi
  sleep 2
done
echo "health check 실패"; exit 1
```
`chmod +x scripts/deploy.sh`.

- [ ] **Step 5: .github/workflows/deploy.yml 작성**

```yaml
name: deploy
on:
  push: { branches: [main] }
  workflow_dispatch:
jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - run: /opt/stack/services/public/myazit.kr/send-anywhere/repo/scripts/deploy.sh
```

- [ ] **Step 6: README.md 작성 (배포 절차 요약)**

README에 다음을 기록:
- 로컬 실행: `npm install && npm run build && STORAGE_PATH=./data/uploads DB_PATH=./data/db/x.sqlite npm start` (또는 `dev:server`+`dev:web`).
- 맥미니 최초 배포(한 번만): `/opt/stack/services/public/myazit.kr/send-anywhere/` 생성 → `repo/` clone → `.env`(0600) 작성 → 앱 전용 self-hosted 러너 등록 → deploy key + `~/.ssh/config` 별칭.
- Caddyfile(`edge-caddy` repo)에 아래 1줄 추가 후 push:
  ```
  http://send.myazit.kr {
      import common
      reverse_proxy send-anywhere:4500
  }
  ```
- `*.myazit.kr` 와일드카드가 이미 서브도메인을 흡수하므로 Cloudflare 대시보드 작업 불필요.

- [ ] **Step 7: 로컬 Docker 빌드 스모크**

Run: `docker build -t send-anywhere-test -f Dockerfile .`
Expected: 이미지 빌드 성공. (better-sqlite3 네이티브 빌드 실패 시 Step 1 주석대로 빌드 툴 추가.)

- [ ] **Step 8: 커밋**

```bash
git add Dockerfile .dockerignore docker-compose.yml scripts/ .github/ .env.example README.md
git commit -m "배포: Dockerfile + compose + deploy.sh + CI + Caddy 안내"
```

---

## 최종 검증

- [ ] `npm test` — 전체 통과.
- [ ] `npm run build` — 서버(dist) + 프론트(web/dist) 빌드 성공.
- [ ] `docker build` — 이미지 빌드 성공.
- [ ] 로컬 end-to-end: dev 서버 2개 띄우고 업로드→코드→다운로드 왕복, 링크 접속 자동 조회, 만료(작은 RETENTION으로) 스위핑 확인.

---

## 자기 검토 메모 (계획 작성자)

- **스펙 커버리지**: §3 스택(T1,2,4,11) · §4 데이터모델(T2,4) · §5 tus/API(T5,6,7,8) · §6 UX(T12,13) · §7 만료/rate limit/용량(T7,8,9, 검증 T5) · §8 배포(T14) · §9 테스트(각 태스크 TDD). 모두 태스크에 매핑됨.
- **주의점(구현자 유의)**:
  1. tus + Fastify는 `reply.hijack()` + no-op content-type parser가 핵심. 이게 없으면 Fastify가 body를 소비해 tus가 깨진다.
  2. tus uploadId를 클라이언트 `metadata.fileId`로 고정(namingFunction)해야 store의 stored_path(`storagePath/fileId`)와 일치한다.
  3. better-sqlite3 네이티브 모듈 → Docker runtime 스테이지 재빌드 시 빌드 툴 필요할 수 있음(Dockerfile 주석).
  4. Cloudflare 100MB 벽 때문에 `CHUNK_SIZE`는 반드시 100MB 미만(기본 50MB) 유지.
