import type { FastifyInstance } from 'fastify'
import type { Store } from '../store.js'
import type { Config } from '../config.js'

interface CreateBody { files: { filename: string; size: number }[]; name?: string }

const NAME_MAX = 100

export function registerTransfers(app: FastifyInstance, store: Store, config: Config): void {
  app.post<{ Body: CreateBody }>('/api/transfers', async (req, reply) => {
    const files = req.body?.files ?? []
    if (files.length === 0) return reply.code(400).send({ error: '파일이 없습니다' })
    if (files.length > config.maxFiles)
      return reply.code(400).send({ error: `파일은 한 번에 최대 ${config.maxFiles}개까지 보낼 수 있습니다` })
    // 개행/제어문자를 공백으로 바꾼 뒤 길이 제한. 빈 문자열이면 이름 없음(null)으로 처리한다.
    const rawName = typeof req.body?.name === 'string' ? req.body.name : ''
    const name = rawName.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, NAME_MAX) || null
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

    const t = store.createTransfer(sanitized, name)
    const view = store.getById(t.id)!
    return reply.code(201).send({
      transferId: t.id, code: t.code, slug: t.slug, name: t.name,
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
