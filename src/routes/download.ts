import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'node:fs'
import archiver from 'archiver'
import type { Store } from '../store.js'

export function registerDownload(app: FastifyInstance, store: Store): void {
  app.get<{ Params: { id: string }; Querystring: { fileId?: string } }>(
    '/api/transfers/:id/download',
    async (req, reply) => {
      const view = store.getById(req.params.id)
      if (!view || view.status !== 'ready' || view.expiresAt <= Date.now())
        return reply.code(404).send({ error: '없거나 만료된 전송입니다' })

      const complete = view.files.filter((f) => f.uploadComplete)
      const target = req.query.fileId
        ? complete.filter((f) => f.id === req.query.fileId)
        : complete
      if (target.length === 0) return reply.code(404).send({ error: '파일이 없습니다' })

      store.incrementDownload(view.id)

      if (target.length === 1) {
        const f = target[0]
        reply.header('Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`)
        reply.type('application/octet-stream')
        return reply.send(createReadStream(f.storedPath))
      }

      reply.header('Content-Disposition',
        `attachment; filename="send-anywhere-${view.code}.zip"`)
      reply.type('application/zip')
      const archive = archiver('zip', { zlib: { level: 0 } })
      for (const f of target) archive.file(f.storedPath, { name: f.filename })
      archive.finalize()
      return reply.send(archive)
    },
  )
}
