import { loadConfig } from './config.js'
import { openDb } from './db.js'
import { createStore } from './store.js'
import { buildApp } from './app.js'
import { startSweeper } from './sweeper.js'

const config = loadConfig(process.env)
const db = openDb(config.dbPath)
const store = createStore(db, config)
const app = buildApp(config, { store })

startSweeper(store, config)

app.listen({ port: config.port, host: '0.0.0.0' })
  .then(() => console.log(`send-anywhere on :${config.port}`))
  .catch((err) => { console.error(err); process.exit(1) })
