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
