import { useEffect, useState } from 'react'
import { Download, File as FileIcon } from 'lucide-react'
import { resolve, downloadUrl, type FileMeta } from './api.js'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { fmtSize } from '@/lib/format'
import { P2PReceive } from './P2PReceive.js'

export function ReceivePage({ initialKey, p2pCode }: { initialKey: string; p2pCode?: string }) {
  const [mode, setMode] = useState<'relay' | 'p2p'>(p2pCode ? 'p2p' : 'relay')
  const [key, setKey] = useState(initialKey)
  const [data, setData] = useState<{ transferId: string; name: string | null; files: FileMeta[] } | null>(null)
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

  function renderRelay() {
    return (
      <div className="flex flex-col gap-4 py-2">
        {!data && (
          <div className="flex flex-col items-center gap-4 py-6">
            <Input
              placeholder="6자리 코드"
              value={key}
              onChange={(e) => setKey(e.target.value.trim())}
              onKeyDown={(e) => { if (e.key === 'Enter') lookup(key) }}
              maxLength={6}
              inputMode="numeric"
              className="h-14 w-52 text-center font-mono text-2xl tracking-[0.3em]"
            />
            <Button size="lg" onClick={() => lookup(key)} disabled={loading || !key}>
              {loading ? '조회 중…' : '받기'}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {data && (
          <div className="flex flex-col gap-3">
            {data.name && (
              <div className="text-center text-lg font-semibold">{data.name}</div>
            )}
            <ul className="flex flex-col gap-2">
              {data.files.map((f) => (
                <li key={f.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                  <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{f.filename}</span>
                  <span className="text-muted-foreground">{fmtSize(f.size)}</span>
                  <a href={downloadUrl(data.transferId, f.id)} aria-label="내려받기">
                    <Download className="size-4 text-muted-foreground hover:text-foreground" />
                  </a>
                </li>
              ))}
            </ul>
            {data.files.length > 1 && (
              <a href={downloadUrl(data.transferId)}>
                <Button className="w-full" size="lg">전체 zip 받기</Button>
              </a>
            )}
          </div>
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
  return <div>{toggle}{mode === 'p2p' ? <P2PReceive initialCode={p2pCode} /> : renderRelay()}</div>
}
