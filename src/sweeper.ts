import { rm } from 'node:fs/promises'
import type { Store } from './store.js'
import type { Config } from './config.js'

export async function sweepOnce(store: Store): Promise<number> {
  const expired = store.listExpired(Date.now())
  for (const t of expired) {
    const view = store.getById(t.id)
    if (view) {
      for (const f of view.files) {
        await rm(f.storedPath, { force: true })
      }
    }
    store.deleteTransfer(t.id)
  }
  return expired.length
}

export function startSweeper(store: Store, config: Config): () => void {
  const ms = config.sweepIntervalMin * 60_000
  const timer = setInterval(() => {
    sweepOnce(store).catch(() => {})
  }, ms)
  timer.unref?.()
  return () => clearInterval(timer)
}
