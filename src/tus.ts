import { Server } from '@tus/server'
import { FileStore } from '@tus/file-store'
import { mkdirSync } from 'node:fs'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Store } from './store.js'
import type { Config } from './config.js'

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// @tus/server는 catch한 error의 `status_code`/`body` 필드를 그대로 응답에 사용한다
// (없으면 500 UNKNOWN_ERROR로 취급). namingFunction에서 클라이언트 입력 검증 실패를
// 4xx로 매핑하려면 이 형태로 던져야 한다 (ERRORS.INVALID_METADATA 등과 동일한 패턴).
function tusClientError(body: string): { status_code: number; body: string } {
  return { status_code: 400, body: `${body}\n` }
}

export function createTusServer(store: Store, config: Config): Server {
  // storagePath는 실제 배포 환경(컨테이너의 /data 볼륨 등)에서는 항상 쓰기 가능하다.
  // 여기서 미리 만들어두면 @tus/file-store의 FileStore가 내부적으로 시도하는
  // (실패 시 uncaughtException을 던지는) 디렉터리 생성이 EEXIST로 조용히 넘어간다.
  mkdirSync(config.storagePath, { recursive: true })
  const server = new Server({
    path: '/files',
    datastore: new FileStore({ directory: config.storagePath }),
    maxSize: config.maxFileSize,
    // Cloudflare가 TLS를 종단하고 Caddy는 평문 HTTP로 서빙하므로, 절대 Location을
    // 만들면 http:// 로 나가 브라우저에서 https 페이지 → http 업로드가 mixed-content로
    // 차단된다. 상대 Location(`/files/<id>`)을 쓰면 브라우저가 현재 https 오리진으로
    // 해석하므로 프록시 뒤에서도 안전하다.
    relativeLocation: true,
    // uploadId를 클라이언트 metadata.fileId로 강제 → stored_path와 일치
    // fileId는 반드시 (1) UUID v4 형식이고 (2) DB에 존재하는 미완료 파일 레코드여야 한다.
    // 그렇지 않으면 경로 조작(예: "../../etc/passwd")으로 STORAGE_PATH 밖에
    // 쓰는 것을 허용하게 되므로 즉시 거부한다.
    namingFunction(_req, metadata) {
      const fileId = metadata?.fileId
      if (!fileId) throw tusClientError('fileId metadata 필요')
      if (!UUID_V4_RE.test(fileId)) throw tusClientError('잘못된 fileId 형식')
      if (!store.findPendingFile(fileId)) throw tusClientError('알 수 없는 fileId')
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
