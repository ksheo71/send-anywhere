import Fastify, { type FastifyInstance } from 'fastify'
import type { Config } from './config.js'
import { registerHealth } from './routes/health.js'

export function buildApp(config: Config): FastifyInstance {
  const app = Fastify({ logger: false })
  registerHealth(app)
  return app
}
