// 최대 `concurrency`개를 동시에 실행하는 순수 비동기 풀.
// - 한 작업이 끝나면 대기열의 다음 작업을 시작한다.
// - 개별 작업이 throw해도 그 작업만 실패로 넘기고 나머지는 계속 실행한다(풀 전체는 reject하지 않음).
//   개별 실패/성공 처리는 `run` 안에서 하도록 맡긴다.
export async function runPool<T>(
  items: T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      try {
        await run(items[i], i)
      } catch {
        // 개별 작업 실패는 무시하고 다음으로 진행 (호출자가 run 내부에서 상태를 기록)
      }
    }
  }
  const workers = Math.max(1, Math.min(concurrency, items.length))
  if (items.length === 0) return
  await Promise.all(Array.from({ length: workers }, worker))
}
