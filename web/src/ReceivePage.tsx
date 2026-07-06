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
