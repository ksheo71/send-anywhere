import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    pool: 'forks', // better-sqlite3 native 모듈 호환
  },
})
