import Fastify, { type FastifyInstance } from 'fastify'
import type { Config } from './config.js'
import type { Store } from './store.js'
import { registerHealth } from './routes/health.js'
import { registerTransfers } from './routes/transfers.js'

export interface AppDeps { store: Store }

export function buildApp(config: Config, deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 1_048_576 })
  registerHealth(app)
  registerTransfers(app, deps.store, config)
  return app
}
