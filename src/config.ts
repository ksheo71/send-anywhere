export interface Config {
  retentionHours: number
  maxFileSize: number
  maxTotalSize: number
  maxFiles: number
  chunkSize: number
  codeLength: number
  storagePath: string
  dbPath: string
  sweepIntervalMin: number
  rateLimitPerMin: number
  port: number
}

function num(v: string | undefined, def: number): number {
  const n = v === undefined ? def : Number(v)
  return Number.isFinite(n) ? n : def
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return {
    retentionHours: num(env.RETENTION_HOURS, 24),
    maxFileSize: num(env.MAX_FILE_SIZE, 2147483648),
    maxTotalSize: num(env.MAX_TOTAL_SIZE, 4294967296),
    maxFiles: num(env.MAX_FILES, 100),
    chunkSize: num(env.CHUNK_SIZE, 52428800),
    codeLength: num(env.CODE_LENGTH, 6),
    storagePath: env.STORAGE_PATH ?? '/data/uploads',
    dbPath: env.DB_PATH ?? '/data/db/send-anywhere.sqlite',
    sweepIntervalMin: num(env.SWEEP_INTERVAL_MIN, 10),
    rateLimitPerMin: num(env.RATE_LIMIT_PER_MIN, 30),
    port: num(env.PORT, 4500),
  }
}
