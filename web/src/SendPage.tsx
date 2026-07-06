import { useEffect, useState } from 'react'
import * as tus from 'tus-js-client'
import QRCode from 'qrcode'
import { createTransfer, finalizeTransfer } from './api.js'

const CHUNK = 50 * 1024 * 1024

export function SendPage() {
  const [files, setFiles] = useState<File[]>([])
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ code: string; slug: string } | null>(null)
  const [error, setError] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')

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

  const link = result ? `${window.location.origin}/${result.slug}` : ''

  // QR은 공유 링크(=파일 접근 권한을 가진 비밀 URL)를 담고 있으므로
  // 외부 QR 생성 서비스로 전송하지 않고 브라우저에서 로컬로 생성한다.
  useEffect(() => {
    if (!link) {
      setQrDataUrl('')
      return
    }
    let cancelled = false
    QRCode.toDataURL(link)
      .then((url) => { if (!cancelled) setQrDataUrl(url) })
      .catch(() => { if (!cancelled) setQrDataUrl('') })
    return () => { cancelled = true }
  }, [link])

  if (result) {
    return (
      <div>
        <p>받는 사람에게 이 6자리 코드나 링크를 전달하세요:</p>
        <div style={{ fontSize: 40, letterSpacing: 6, fontWeight: 700 }}>{result.code}</div>
        <p><a href={link}>{link}</a></p>
        <button onClick={() => navigator.clipboard.writeText(link)}>링크 복사</button>
        <div>{qrDataUrl && <img src={qrDataUrl} alt="QR" width={180} height={180} />}</div>
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
