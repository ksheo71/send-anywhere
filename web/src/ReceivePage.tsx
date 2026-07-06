import { useEffect, useState } from 'react'
import { Download, File as FileIcon } from 'lucide-react'
import { resolve, downloadUrl, type FileMeta } from './api.js'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

function fmtSize(n: number) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

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
