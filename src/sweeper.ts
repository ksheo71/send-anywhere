import { rm } from 'node:fs/promises'
import type { Store } from './store.js'
import type { Config } from './config.js'

export async function sweepOnce(store: Store): Promise<number> {
  const expired = store.listExpired(Date.now())
  let deleted = 0
  for (const t of expired) {
    try {
      const view = store.getById(t.id)
      if (view) {
        for (const f of view.files) {
          await rm(f.storedPath, { force: true })
        }
      }
      store.deleteTransfer(t.id)
      deleted++
    } catch (err) {
      console.error('[sweeper] cleanup failed for', t.id, err)
    }
  }
  return deleted
}

export function startSweeper(store: Store, config: Config): () => void {
  const ms = config.sweepIntervalMin * 60_000
  const timer = setInterval(() => {
    sweepOnce(store).catch((err) => console.error('[sweeper] sweep failed', err))
  }, ms)
  timer.unref?.()
  return () => clearInterval(timer)
}
