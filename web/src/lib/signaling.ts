export type SignalHandlers = {
  onCreated?: (code: string) => void
  onPeerJoined?: () => void
  onPeerLeft?: () => void
  onSignal?: (data: any) => void
  onError?: (reason: string) => void
  onClose?: () => void
}

export interface SignalingClient {
  create(): void
  join(code: string): void
  signal(data: any): void
  close(): void
}

export function connectSignaling(handlers: SignalHandlers): SignalingClient {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/ws`)
  const queue: string[] = []

  function raw(obj: unknown) {
    const s = JSON.stringify(obj)
    if (ws.readyState === WebSocket.OPEN) ws.send(s)
    else queue.push(s)
  }
  ws.onopen = () => { while (queue.length) ws.send(queue.shift()!) }
  ws.onclose = () => handlers.onClose?.()
  ws.onmessage = (e) => {
    let m: any
    try { m = JSON.parse(e.data) } catch { return }
    switch (m.type) {
      case 'created': handlers.onCreated?.(m.code); break
      case 'peer-joined': handlers.onPeerJoined?.(); break
      case 'peer-left': handlers.onPeerLeft?.(); break
      case 'signal': handlers.onSignal?.(m.data); break
      case 'error': handlers.onError?.(m.reason); break
    }
  }

  return {
    create: () => raw({ type: 'create' }),
    join: (code) => raw({ type: 'join', code }),
    signal: (data) => raw({ type: 'signal', data }),
    close: () => ws.close(),
  }
}
