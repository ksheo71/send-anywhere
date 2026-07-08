import { loadConfig } from './config.js'
import { openDb } from './db.js'
import { createStore } from './store.js'
import { buildApp } from './app.js'
import { startSweeper } from './sweeper.js'
import { createSignaling } from './signaling.js'
import { generateCode } from './ids.js'

const config = loadConfig(process.env)
const db = openDb(config.dbPath)
const store = createStore(db, config)
const signaling = createSignaling(() => generateCode(6, () => false), () => Date.now())
const app = buildApp(config, { store, signaling })

startSweeper(store, config)
setInterval(() => signaling.sweep(Date.now(), 10 * 60_000), 60_000).unref?.()

app.listen({ port: config.port, host: '0.0.0.0' })
  .then(() => console.log(`send-anywhere on :${config.port}`))
  .catch((err) => { console.error(err); process.exit(1) })
