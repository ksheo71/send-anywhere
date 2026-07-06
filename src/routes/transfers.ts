import type { FastifyInstance } from 'fastify'
import type { Store } from '../store.js'
import type { Config } from '../config.js'

interface CreateBody { files: { filename: string; size: number }[] }

export function registerTransfers(app: FastifyInstance, store: Store, config: Config): void {
  app.post<{ Body: CreateBody }>('/api/transfers', async (req, reply) => {
    const files = req.body?.files ?? []
    if (files.length === 0) return reply.code(400).send({ error: '파일이 없습니다' })
    let total = 0
    const sanitized: { filename: string; size: number }[] = []
    for (const f of files) {
      if (typeof f.size !== 'number' || f.size < 0) return reply.code(400).send({ error: '잘못된 크기' })
      if (f.size > config.maxFileSize) return reply.code(413).send({ error: '파일이 너무 큽니다' })
      // 경로 구분자(/, \)를 제거해 zip-slip이나 Content-Disposition 경로 조작을 방지한다.
      const filename = f.filename.replace(/^.*[\\/]/, '')
      if (!filename) return reply.code(400).send({ error: '잘못된 파일명' })
      sanitized.push({ filename, size: f.size })
      total += f.size
    }
    if (total > config.maxTotalSize) return reply.code(413).send({ error: '총 용량 초과' })

    const t = store.createTransfer(sanitized)
    const view = store.getById(t.id)!
    return reply.code(201).send({
      transferId: t.id, code: t.code, slug: t.slug,
      files: view.files.map((f) => ({ id: f.id, filename: f.filename, size: f.size })),
      uploadUrlBase: '/files',
    })
  })

  app.post<{ Params: { id: string } }>('/api/transfers/:id/finalize', async (req, reply) => {
    const view = store.getById(req.params.id)
    if (!view) return reply.code(404).send({ error: '없는 전송입니다' })
    if (view.files.some((f) => !f.uploadComplete))
      return reply.code(409).send({ error: '파일 업로드가 완료되지 않았습니다' })
    store.finalizeTransfer(view.id)
    return reply.send({ status: 'ready' })
  })
}
