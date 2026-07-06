import { Server } from '@tus/server'
import { FileStore } from '@tus/file-store'
import { mkdirSync } from 'node:fs'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Store } from './store.js'
import type { Config } from './config.js'

export function createTusServer(store: Store, config: Config): Server {
  // storagePath는 실제 배포 환경(컨테이너의 /data 볼륨 등)에서는 항상 쓰기 가능하다.
  // 여기서 미리 만들어두면 @tus/file-store의 FileStore가 내부적으로 시도하는
  // (실패 시 uncaughtException을 던지는) 디렉터리 생성이 EEXIST로 조용히 넘어간다.
  mkdirSync(config.storagePath, { recursive: true })
  const server = new Server({
    path: '/files',
    datastore: new FileStore({ directory: config.storagePath }),
    // uploadId를 클라이언트 metadata.fileId로 강제 → stored_path와 일치
    namingFunction(_req, metadata) {
      const fileId = metadata?.fileId
      if (!fileId) throw new Error('fileId metadata 필요')
      return fileId
    },
    async onUploadFinish(_req, upload) {
      if (upload.id) store.markFileComplete(upload.id)
      return {}
    },
  })
  return server
}

export function registerTus(app: FastifyInstance, tus: Server): void {
  app.addContentTypeParser('application/offset+octet-stream', (_req, _payload, done) => done(null))
  const handler = (req: FastifyRequest, reply: FastifyReply) => {
    reply.hijack()
    tus.handle(req.raw, reply.raw)
  }
  app.all('/files', handler)
  app.all('/files/*', handler)
}
