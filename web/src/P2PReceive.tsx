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
