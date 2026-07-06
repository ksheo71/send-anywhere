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
