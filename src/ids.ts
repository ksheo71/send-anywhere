import { randomBytes, randomInt } from 'node:crypto'

export function generateSlug(): string {
  return randomBytes(16).toString('base64url') // 22자
}

export function generateCode(
  length: number,
  exists: (code: string) => boolean,
): string {
  const max = 10 ** length
  for (let i = 0; i < 100; i++) {
    const code = String(randomInt(0, max)).padStart(length, '0')
    if (!exists(code)) return code
  }
  throw new Error('코드 공간이 포화되었습니다')
}
