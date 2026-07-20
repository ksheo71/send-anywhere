import type { FastifyInstance } from 'fastify'
import { createReadStream, existsSync } from 'node:fs'
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

      // Pre-flight existence check: catches a blob missing on disk (e.g. a race
      // with the retention sweeper) before we commit to a response, turning a
      // mid-stream ENOENT into a clean 404 for both the single-file and zip paths.
      if (!target.every((f) => existsSync(f.storedPath)))
        return reply.code(404).send({ error: '없거나 만료된 전송입니다' })

      store.incrementDownload(view.id)

      if (target.length === 1) {
        const f = target[0]
        reply.header('Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`)
        reply.type('application/octet-stream')
        const stream = createReadStream(f.storedPath)
        stream.on('error', (err) => {
          req.log?.error?.(err)
          reply.raw.destroy(err)
        })
        return reply.send(stream)
      }

      // 공유건 이름이 있으면 zip 파일명으로 쓰되, 경로/제어문자를 제거해 헤더 조작을 막는다.
      const zipBase = (view.name ?? '').replace(/[\x00-\x1f\x7f\\/"]/g, '').trim() || `send-anywhere-${view.code}`
      reply.header('Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(zipBase)}.zip`)
      reply.type('application/zip')
      const archive = archiver('zip', { zlib: { level: 0 } })
      archive.on('error', (err) => {
        req.log?.error?.(err)
        reply.raw.destroy(err)
      })
      archive.on('warning', (err) => {
        req.log?.error?.(err)
      })
      for (const f of target) archive.file(f.storedPath, { name: f.filename })
      archive.finalize()
      return reply.send(archive)
    },
  )
}
