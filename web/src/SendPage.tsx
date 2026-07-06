import { useEffect, useState } from 'react'
import * as tus from 'tus-js-client'
import QRCode from 'qrcode'
import { Check, Copy, File as FileIcon, X } from 'lucide-react'
import { createTransfer, finalizeTransfer } from './api.js'
import { Dropzone } from '@/components/Dropzone'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'

const CHUNK = 50 * 1024 * 1024

function fmtSize(n: number) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

export function SendPage() {
  const [files, setFiles] = useState<File[]>([])
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ code: string; slug: string } | null>(null)
  const [error, setError] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [copied, setCopied] = useState(false)

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
      setError(e?.message ?? '업로드 실패')
    } finally {
      setBusy(false)
    }
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
    setResult(null); setFiles([]); setProgress(0); setError('')
  }

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
            <li key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
              <FileIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{f.name}</span>
              <span className="text-muted-foreground">{fmtSize(f.size)}</span>
              {!busy && (
                <button aria-label="제거" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                  <X className="size-4 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {busy && (
        <div className="flex flex-col gap-1">
          <Progress value={progress} />
          <span className="text-right text-xs text-muted-foreground">{progress}%</span>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button size="lg" onClick={send} disabled={busy || files.length === 0}>
        {busy ? `업로드 중… ${progress}%` : '보내기'}
      </Button>
    </div>
  )
}
