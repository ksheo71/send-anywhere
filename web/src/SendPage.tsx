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
import { P2PSend } from './P2PSend.js'

const CHUNK = 50 * 1024 * 1024
const CONCURRENCY = 3

interface FileState { status: UploadStatus; progress: number }

export function SendPage() {
  const [mode, setMode] = useState<'relay' | 'p2p'>('relay')
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
          setFileState(i, { progress: Math.round((sent / (file.size || 1)) * 100) })
          setOverall(Math.round((uploadedBytes.reduce((a, b) => a + b, 0) / (totals || 1)) * 100))
        },
        onSuccess: () => {
          uploadedBytes[i] = file.size
          setFileState(i, { status: 'done', progress: 100 })
          setOverall(Math.round((uploadedBytes.reduce((a, b) => a + b, 0) / (totals || 1)) * 100))
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
    try {
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
    } catch (e: any) {
      if (!canceledRef.current) setError(e?.message ?? '업로드 실패')
      setBusy(false)
    }
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

  function renderRelay() {
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

  const toggle = (
    <div className="mb-4 flex justify-center gap-1 rounded-lg bg-muted p-1 text-sm">
      <button onClick={() => setMode('relay')} className={mode === 'relay' ? 'flex-1 rounded-md bg-background py-1 shadow-sm' : 'flex-1 py-1 text-muted-foreground'}>🔗 링크</button>
      <button onClick={() => setMode('p2p')} className={mode === 'p2p' ? 'flex-1 rounded-md bg-background py-1 shadow-sm' : 'flex-1 py-1 text-muted-foreground'}>⚡ 실시간</button>
    </div>
  )
  return <div>{toggle}{mode === 'p2p' ? <P2PSend /> : renderRelay()}</div>
}
