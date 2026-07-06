import type { FastifyInstance } from 'fastify'
import type { Store } from '../store.js'

export function registerResolve(app: FastifyInstance, store: Store): void {
  app.get<{ Params: { key: string } }>('/api/resolve/:key', async (req, reply) => {
    const view = store.resolve(req.params.key)
    if (!view) return reply.code(404).send({ error: '없거나 만료된 코드입니다' })
    return reply.send({
      transferId: view.id,
      expiresAt: view.expiresAt,
      files: view.files.map((f) => ({ id: f.id, filename: f.filename, size: f.size })),
    })
  })
}
