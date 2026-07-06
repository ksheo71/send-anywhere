# 업로드 UX(병렬 + 파일별 진행률 + 전체 취소) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SendPage 업로드를 순차→동시 3개 병렬 풀로 바꾸고, 파일별 진행률/상태 + 전체 취소 + 에러 파일 재시도를 추가한다. 백엔드/api.ts 무변경.

**Architecture:** 순수 동시성 풀 유틸(`web/src/lib/uploadPool.ts`, 단위 테스트)로 최대 N개 파일을 동시에 tus 업로드한다. 파일별 상태를 React 상태로 관리하고, `FileRow` 컴포넌트가 행별 진행률/상태를 그린다. tus.Upload 참조를 모아 두었다가 "전체 취소" 시 abort한다. createTransfer→metadata.fileId→finalize→로컬 QR 로직은 그대로 유지한다.

**Tech Stack:** React 18, TypeScript, tus-js-client, qrcode, shadcn(Button/Progress/Badge), lucide-react, vitest. 기존 Tailwind v4 + `@` 별칭.

## Global Constraints

- 프론트엔드만 변경. `web/src/api.ts`와 백엔드 `src/**` 는 **수정 금지**. 백엔드 40개 테스트는 그대로 통과해야 한다.
- 업로드 로직 불변식 유지: `createTransfer(files)` → 파일 i는 tus `metadata.fileId = t.files[i].id`(서버 namingFunction이 이 매핑에 의존), `endpoint: '/files'`, `chunkSize = 50*1024*1024`, `retryDelays: [0,1000,3000,5000]`. 전 파일 완료 후에만 `finalizeTransfer(t.transferId)`.
- 로컬 QR(`qrcode` `toDataURL`) 유지. 링크 = `${window.location.origin}/${slug}`.
- 동시 실행 상한 상수 `CONCURRENCY = 3`.
- 전체 취소 = 진행 중 tus 모두 `abort()` + 파일 선택 상태 복귀(파일 유지, 진행률 리셋). 반쯤 올라간 전송은 24h 스위퍼가 정리.
- 에러(재시도까지 실패) 파일은 error 표시, finalize 보류, "다시 시도"(에러 파일만 tus 재개) / "전체 취소" 제공.
- vitest는 백엔드(`src/`)만 include하므로 web 테스트 글롭을 추가해야 새 단위 테스트가 `npm test`에 잡힌다.
- 순수 프레젠테이션 컴포넌트(FileRow)와 SendPage 마크업은 단위 테스트를 만들지 않고 `npm run build:web` + 브라우저로 검증한다. 단, `uploadPool`은 순수 로직이라 vitest 단위 테스트를 만든다.
- 커밋 메시지 한국어, 각 태스크 끝에 커밋.

---

## File Structure

```
send-anywhere/
├── vitest.config.ts                        # 수정: include에 web 테스트 글롭 추가
├── web/src/
│   ├── lib/
│   │   ├── uploadPool.ts                    # 신규: runPool 동시성 풀
│   │   └── __tests__/uploadPool.test.ts     # 신규: vitest 단위 테스트
│   ├── components/
│   │   └── FileRow.tsx                       # 신규: 파일 행(상태/진행률)
│   └── SendPage.tsx                          # 재작성: 병렬 + 파일별 진행률 + 취소 + 재시도
```

`uploadPool`은 tus/DOM에 의존하지 않는 순수 함수라 노드 환경에서 테스트된다. `FileRow`는 표시 전용. `SendPage`가 오케스트레이션을 담당한다.

---

## Task 1: 동시성 풀 유틸 + vitest 설정 + 단위 테스트

**Files:**
- Create: `web/src/lib/uploadPool.ts`
- Create: `web/src/lib/__tests__/uploadPool.test.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Produces: `runPool<T>(items: T[], concurrency: number, run: (item: T, index: number) => Promise<void>): Promise<void>` — 최대 `concurrency`개를 동시에 실행. 한 항목이 끝나면 다음 시작. 모든 항목 실행 후 resolve. `run`이 throw해도 그 항목만 실패로 넘기고 나머지는 계속 실행(풀은 reject하지 않음).

- [ ] **Step 1: vitest include에 web 글롭 추가**

`vitest.config.ts` 전체를 다음으로 교체:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'web/src/**/*.test.ts'],
    pool: 'forks', // better-sqlite3 native 모듈 호환
  },
})
```

- [ ] **Step 2: 실패 테스트 작성**

`web/src/lib/__tests__/uploadPool.test.ts`:
```ts
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
```

- [ ] **Step 3: 실패 확인**

Run: `npm test -- uploadPool`
Expected: FAIL — `Cannot find module '../uploadPool.js'`

- [ ] **Step 4: uploadPool.ts 구현**

`web/src/lib/uploadPool.ts`:
```ts
// 최대 `concurrency`개를 동시에 실행하는 순수 비동기 풀.
// - 한 작업이 끝나면 대기열의 다음 작업을 시작한다.
// - 개별 작업이 throw해도 그 작업만 실패로 넘기고 나머지는 계속 실행한다(풀 전체는 reject하지 않음).
//   개별 실패/성공 처리는 `run` 안에서 하도록 맡긴다.
export async function runPool<T>(
  items: T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      try {
        await run(items[i], i)
      } catch {
        // 개별 작업 실패는 무시하고 다음으로 진행 (호출자가 run 내부에서 상태를 기록)
      }
    }
  }
  const workers = Math.max(1, Math.min(concurrency, items.length))
  if (items.length === 0) return
  await Promise.all(Array.from({ length: workers }, worker))
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm test -- uploadPool`
Expected: PASS (4 tests)

- [ ] **Step 6: 백엔드 회귀 확인**

Run: `npm test`
Expected: 백엔드 40 + uploadPool 4 = 44 통과.

- [ ] **Step 7: 커밋**

```bash
git add vitest.config.ts web/src/lib/uploadPool.ts web/src/lib/__tests__/uploadPool.test.ts
git commit -m "업로드: 동시성 풀 유틸 + 단위 테스트 + vitest web 글롭"
```

---

## Task 2: FileRow 컴포넌트

**Files:**
- Create: `web/src/components/FileRow.tsx`

**Interfaces:**
- Consumes: `cn` (`@/lib/utils`), `fmtSize` (`@/lib/format`), `Progress` (`@/components/ui/progress`), lucide `File`/`Loader2`/`CheckCircle2`/`AlertCircle`/`X`.
- Produces: `type UploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'canceled'` (export).
- Produces: `<FileRow name={string} size={number} status={UploadStatus} progress={number} onRemove?={() => void} />` — 파일명·용량·상태 아이콘 표시. `uploading`일 때 개별 진행률 바 + %. `onRemove`가 있으면 제거 버튼(선택 단계에서만 전달).

- [ ] **Step 1: FileRow.tsx 구현**

`web/src/components/FileRow.tsx`:
```tsx
import { AlertCircle, CheckCircle2, File as FileIcon, Loader2, X } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { fmtSize } from '@/lib/format'

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'canceled'

function StatusIcon({ status }: { status: UploadStatus }) {
  if (status === 'uploading') return <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
  if (status === 'done') return <CheckCircle2 className="size-4 shrink-0 text-primary" />
  if (status === 'error') return <AlertCircle className="size-4 shrink-0 text-destructive" />
  return <FileIcon className="size-4 shrink-0 text-muted-foreground" />
}

export function FileRow({
  name, size, status, progress, onRemove,
}: {
  name: string
  size: number
  status: UploadStatus
  progress: number
  onRemove?: () => void
}) {
  return (
    <li className="flex flex-col gap-1 rounded-md border px-3 py-2 text-sm">
      <div className="flex items-center gap-3">
        <StatusIcon status={status} />
        <span className="flex-1 truncate">{name}</span>
        <span className="text-muted-foreground">{fmtSize(size)}</span>
        {onRemove && (
          <button aria-label="제거" onClick={onRemove}>
            <X className="size-4 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>
      {status === 'uploading' && (
        <div className="flex items-center gap-2">
          <Progress value={progress} className="h-1.5" />
          <span className="w-9 text-right text-xs text-muted-foreground">{progress}%</span>
        </div>
      )}
    </li>
  )
}
```

- [ ] **Step 2: 빌드 검증**

Run: `npm run build:web`
Expected: 성공(아직 SendPage에 연결 전 — 컴파일만 확인).

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/FileRow.tsx
git commit -m "업로드: 파일 행 컴포넌트(상태/진행률)"
```

---

## Task 3: SendPage 재작성 (병렬 + 파일별 진행률 + 취소 + 재시도)

**Files:**
- Modify: `web/src/SendPage.tsx`

**Interfaces:**
- Consumes: `runPool` (`@/lib/uploadPool`), `FileRow`/`UploadStatus` (`@/components/FileRow`), `createTransfer`/`finalizeTransfer` (`./api.js`), `tus`, `QRCode`, `Dropzone`, `Button`, `Progress`, `Badge`, `fmtSize`, lucide `Check`/`Copy`.

- [ ] **Step 1: SendPage.tsx 재작성**

`web/src/SendPage.tsx` 전체 교체:
```tsx
import { useEffect, useRef, useState } from 'react'
import * as tus from 'tus-js-client'
import QRCode from 'qrcode'
import { Check, Copy } from 'lucide-react'
import { createTransfer, finalizeTransfer } from './api.js'
import { runPool } from '@/lib/uploadPool'
import { FileRow, type UploadStatus } from '@/components/FileRow'
import { Dropzone } from '@/components/Dropzone'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'

const CHUNK = 50 * 1024 * 1024
const CONCURRENCY = 3

interface FileState { status: UploadStatus; progress: number }

export function SendPage() {
  const [files, setFiles] = useState<File[]>([])
  const [states, setStates] = useState<FileState[]>([])
  const [overall, setOverall] = useState(0)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ code: string; slug: string } | null>(null)
  const [error, setError] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [copied, setCopied] = useState(false)

  const uploadsRef = useRef<(tus.Upload | undefined)[]>([])
  const canceledRef = useRef(false)
  // createTransfer 응답(transferId/code/slug + 파일별 서버 id)을 재시도 때 재사용하기 위해 보관
  const transferRef = useRef<{ transferId: string; code: string; slug: string; fileIds: string[] } | null>(null)

  function setFileState(i: number, patch: Partial<FileState>) {
    setStates((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  }

  // 단일 파일 업로드(성공 시 resolve, 실패 시 reject). tus 참조를 uploadsRef에 저장.
  function uploadOne(file: File, i: number, fileId: string, uploadedBytes: number[], totals: number) {
    return new Promise<void>((resolve, reject) => {
      setFileState(i, { status: 'uploading' })
      const upload = new tus.Upload(file, {
        endpoint: '/files',
        chunkSize: CHUNK,
        retryDelays: [0, 1000, 3000, 5000],
        metadata: { fileId, filename: file.name },
        onError: (e) => {
          if (canceledRef.current) { resolve(); return } // 취소로 인한 abort는 에러로 표시하지 않음
          setFileState(i, { status: 'error' })
          reject(e)
        },
        onProgress: (sent) => {
          uploadedBytes[i] = sent
          setFileState(i, { progress: Math.round((sent / file.size) * 100) })
          setOverall(Math.round((uploadedBytes.reduce((a, b) => a + b, 0) / totals) * 100))
        },
        onSuccess: () => {
          uploadedBytes[i] = file.size
          setFileState(i, { status: 'done', progress: 100 })
          setOverall(Math.round((uploadedBytes.reduce((a, b) => a + b, 0) / totals) * 100))
          resolve()
        },
      })
      uploadsRef.current[i] = upload
      upload.start()
    })
  }

  async function send() {
    if (files.length === 0) return
    setBusy(true); setError(''); setOverall(0)
    canceledRef.current = false
    setStates(files.map(() => ({ status: 'queued', progress: 0 })))
    uploadsRef.current = new Array(files.length)
    try {
      const t = await createTransfer(files.map((f) => ({ filename: f.name, size: f.size })))
      transferRef.current = { transferId: t.transferId, code: t.code, slug: t.slug, fileIds: t.files.map((f) => f.id) }
      const totals = files.reduce((s, f) => s + f.size, 0)
      const uploadedBytes = new Array(files.length).fill(0)
      const failed: boolean[] = new Array(files.length).fill(false)

      await runPool(files, CONCURRENCY, async (file, i) => {
        try {
          await uploadOne(file, i, t.files[i].id, uploadedBytes, totals)
        } catch {
          failed[i] = true
        }
      })

      if (canceledRef.current) return
      if (failed.some(Boolean)) {
        setError('일부 파일 업로드에 실패했습니다. 다시 시도하거나 취소하세요.')
        setBusy(false)
        return
      }
      await finalizeTransfer(t.transferId)
      setResult({ code: t.code, slug: t.slug })
    } catch (e: any) {
      if (!canceledRef.current) setError(e?.message ?? '업로드 실패')
      setBusy(false)
    }
  }

  // 에러난 파일만 같은 transfer로 재개(tus가 오프셋부터 이어받음). 전부 성공하면 finalize.
  async function retryFailed() {
    const t = transferRef.current
    if (!t) return
    setError(''); setBusy(true)
    canceledRef.current = false
    const totals = files.reduce((s, f) => s + f.size, 0)
    const uploadedBytes = files.map((f, i) => (states[i]?.status === 'done' ? f.size : 0))
    const targets = states.map((s, i) => (s.status === 'error' ? i : -1)).filter((i) => i >= 0)
    const failed: boolean[] = new Array(files.length).fill(false)

    await runPool(targets, CONCURRENCY, async (i) => {
      try {
        await uploadOne(files[i], i, t.fileIds[i], uploadedBytes, totals)
      } catch {
        failed[i] = true
      }
    })

    if (canceledRef.current) return
    if (failed.some(Boolean)) { setError('일부 파일이 여전히 실패했습니다.'); setBusy(false); return }
    await finalizeTransfer(t.transferId)
    setResult({ code: t.code, slug: t.slug }) // t = transferRef.current 이므로 code/slug 존재
  }

  function cancelAll() {
    canceledRef.current = true
    uploadsRef.current.forEach((u) => { try { u?.abort() } catch { /* noop */ } })
    uploadsRef.current = []
    setBusy(false); setOverall(0); setError('')
    setStates(files.map(() => ({ status: 'queued', progress: 0 })))
  }

  const link = result ? `${window.location.origin}/${result.slug}` : ''

  useEffect(() => {
    if (!link) { setQrDataUrl(''); return }
    let cancelled = false
    QRCode.toDataURL(link, { margin: 1, width: 200 })
      .then((url) => { if (!cancelled) setQrDataUrl(url) })
      .catch(() => { if (!cancelled) setQrDataUrl('') })
    return () => { cancelled = true }
  }, [link])

  function copy() {
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function reset() {
    setResult(null); setFiles([]); setStates([]); setOverall(0); setError('')
    transferRef.current = null
    uploadsRef.current = []
  }

  const hasError = states.some((s) => s.status === 'error')

  if (result) {
    return (
      <div className="flex flex-col items-center gap-5 py-4 text-center">
        <p className="text-sm text-muted-foreground">받는 사람에게 이 코드나 링크를 전달하세요</p>
        <div className="font-mono text-5xl font-bold tracking-[0.2em]">{result.code}</div>
        {qrDataUrl && (
          <img src={qrDataUrl} alt="QR" width={200} height={200} className="rounded-lg border p-2" />
        )}
        <div className="flex w-full max-w-md items-center gap-2">
          <div className="flex-1 truncate rounded-md border bg-muted px-3 py-2 text-left text-sm">{link}</div>
          <Button variant="outline" size="icon" onClick={copy} aria-label="링크 복사">
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
        <Badge variant="secondary">24시간 후 자동 삭제</Badge>
        <Button variant="ghost" onClick={reset}>새 전송</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <Dropzone onFiles={(fs) => setFiles((prev) => [...prev, ...fs])} disabled={busy} />

      {files.length > 0 && (
        <ul className="flex flex-col gap-2">
          {files.map((f, i) => (
            <FileRow
              key={`${f.name}-${i}`}
              name={f.name}
              size={f.size}
              status={states[i]?.status ?? 'queued'}
              progress={states[i]?.progress ?? 0}
              onRemove={!busy && !result ? () => setFiles((prev) => prev.filter((_, j) => j !== i)) : undefined}
            />
          ))}
        </ul>
      )}

      {busy && (
        <div className="flex flex-col gap-1">
          <Progress value={overall} />
          <span className="text-right text-xs text-muted-foreground">{overall}%</span>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {busy ? (
        <Button size="lg" variant="outline" onClick={cancelAll}>전체 취소</Button>
      ) : hasError ? (
        <div className="flex gap-2">
          <Button size="lg" className="flex-1" onClick={retryFailed}>다시 시도</Button>
          <Button size="lg" variant="outline" onClick={cancelAll}>취소</Button>
        </div>
      ) : (
        <Button size="lg" onClick={send} disabled={files.length === 0}>보내기</Button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 빌드 검증**

Run: `npm run build:web`
Expected: 성공(타입 에러 0).

- [ ] **Step 3: 백엔드 회귀 확인**

Run: `npm test`
Expected: 44 통과(백엔드 40 + uploadPool 4). api.ts/백엔드 무변경.

- [ ] **Step 4: 브라우저 확인**

Run(수동): 로컬 프리뷰(빌드 후 `PORT=4599 STORAGE_PATH=/tmp/sa-preview/uploads DB_PATH=/tmp/sa-preview/db/x.sqlite node dist/server.js`) 또는 dev 서버 2개. 확인:
- 파일 여러 개 선택 → "보내기" → **여러 파일 바가 동시에** 진행(최대 3개), 전체 바도 진행.
- "전체 취소" → 즉시 중단, 파일 선택 상태로 복귀(파일 유지).
- 완료 → 6자리 코드 + QR + 링크.
Expected: 병렬 진행·취소·완료 정상.

- [ ] **Step 5: 커밋**

```bash
git add web/src/SendPage.tsx
git commit -m "업로드: 병렬 업로드 + 파일별 진행률 + 전체 취소/재시도"
```

---

## Task 4: 전체 검증 + 배포

**Files:** 없음(검증·배포만).

- [ ] **Step 1: 전체 빌드 + 테스트**

Run: `npm run build && npm test`
Expected: 서버(tsc) + 웹(vite) 빌드 성공, 44/44 통과.

- [ ] **Step 2: 브라우저 종합 스모크**

Run(수동): 로컬 프리뷰. 다중 파일 병렬 업로드(파일별 바 동시 진행) → 완료→코드/QR/링크→(받기 탭에서 코드로 조회→다운로드) 왕복, 전체 취소 동작, 라이트/다크, 모바일 폭. 스크린샷 기록.
Expected: 전 항목 정상.

- [ ] **Step 3: 배포(main push → 러너 자동 배포)**

```bash
git push origin main
gh run watch "$(gh run list --repo ksheo71/send-anywhere --limit 1 --json databaseId -q '.[0].databaseId')" --repo ksheo71/send-anywhere --exit-status
```
Expected: 배포 성공.

- [ ] **Step 4: 프로덕션 확인**

```bash
curl -sS https://sendfile.myazit.kr/api/health
```
그리고 브라우저로 https://sendfile.myazit.kr 에서 다중 파일 병렬 업로드 확인.
Expected: `{"status":"ok"}` + 병렬 업로드 동작.

---

## 최종 검증 체크리스트
- [ ] `npm test` 44/44(백엔드 40 무변경 + uploadPool 4).
- [ ] `npm run build:web` 그린.
- [ ] 다중 파일이 동시 3개까지 병렬 업로드, 파일별 진행률 표시.
- [ ] 전체 취소 즉시 중단 + 파일 선택 복귀. 에러 파일 재시도 동작.
- [ ] 프로덕션 배포 후 https://sendfile.myazit.kr 정상.

## 자기 검토 메모(작성자)
- 스펙 커버리지: §2 병렬 풀/진행률/취소/재시도(T1,T3) · §3 구조 uploadPool/FileRow/SendPage(T1,T2,T3) · §5 단위테스트+검증(T1,T4). 전부 매핑.
- 불변식: SendPage의 tus 옵션(endpoint/chunkSize/retryDelays/metadata.fileId=t.files[i].id)·finalize·로컬 QR을 그대로 유지. api.ts/백엔드 무변경.
- 주의: (1) vitest include에 `web/src/**/*.test.ts` 추가 안 하면 새 테스트가 안 돌아감(T1 Step1). (2) 취소로 인한 tus abort의 onError는 `canceledRef`로 걸러 에러 표시 안 함. (3) 재시도는 같은 transfer(transferRef)로 tus 재개 → transferRef에 code/slug/transferId/fileIds 모두 저장(T3 Step2). (4) uploadPool은 개별 throw를 삼키므로 SendPage는 `failed[]` 배열로 실패를 별도 추적.
```
