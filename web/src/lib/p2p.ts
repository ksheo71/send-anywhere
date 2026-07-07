import type { SignalingClient } from './signaling.js'

export type FileMeta = { name: string; size: number }

const ICE: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
]
const CHUNK = 16384
const HIGH = 4 * 1024 * 1024
const OPEN_TIMEOUT = 20000

export function buildManifest(files: FileMeta[]): string {
  return JSON.stringify({ kind: 'manifest', files })
}
export function parseControl(s: string): any { return JSON.parse(s) }
export function assembleBlob(chunks: ArrayBuffer[], type = 'application/octet-stream'): Blob {
  return new Blob(chunks, { type })
}

function waitDrain(ch: RTCDataChannel): Promise<void> {
  if (ch.bufferedAmount <= HIGH) return Promise.resolve()
  return new Promise((res) => {
    const onLow = () => { ch.removeEventListener('bufferedamountlow', onLow); res() }
    ch.bufferedAmountLowThreshold = HIGH / 2
    ch.addEventListener('bufferedamountlow', onLow)
  })
}

export type SenderConn = { begin(): void; onSignal(data: any): void; cancel(): void }
export type SendHandlers = {
  onOpen?: () => void
  onProgress?: (fileIndex: number, sentBytes: number) => void
  onDone?: () => void
  onError?: (e: string) => void
}

export function startSender(sig: SignalingClient, files: File[], h: SendHandlers): SenderConn {
  const pc = new RTCPeerConnection({ iceServers: ICE })
  const ch = pc.createDataChannel('file')
  ch.binaryType = 'arraybuffer'
  let done = false
  const pending: RTCIceCandidateInit[] = []
  const timer = setTimeout(() => { if (!done && ch.readyState !== 'open') h.onError?.('연결 시간 초과') }, OPEN_TIMEOUT)

  pc.onicecandidate = (e) => { if (e.candidate) sig.signal({ candidate: e.candidate }) }
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') h.onError?.('연결 실패') }

  async function run() {
    try {
      ch.send(buildManifest(files.map((f) => ({ name: f.name, size: f.size }))))
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        ch.send(JSON.stringify({ kind: 'file-begin', index: i, name: file.name, size: file.size }))
        let offset = 0
        while (offset < file.size) {
          const buf = await file.slice(offset, offset + CHUNK).arrayBuffer()
          await waitDrain(ch)
          ch.send(buf)
          offset += buf.byteLength
          h.onProgress?.(i, offset)
        }
        ch.send(JSON.stringify({ kind: 'file-end', index: i }))
      }
      ch.send(JSON.stringify({ kind: 'done' }))
      done = true
      h.onDone?.()
    } catch (e: any) {
      if (!done) h.onError?.(e?.message ?? '전송 실패')
    }
  }
  ch.onopen = () => { clearTimeout(timer); h.onOpen?.(); run() }

  return {
    async begin() {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      sig.signal({ sdp: pc.localDescription })
    },
    async onSignal(data: any) {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp)
        for (const c of pending.splice(0)) await pc.addIceCandidate(c).catch(() => {})
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {})
        else pending.push(data.candidate)
      }
    },
    cancel() { done = true; clearTimeout(timer); try { ch.close() } catch {} pc.close() },
  }
}

export type ReceiverConn = { onSignal(data: any): void; cancel(): void }
export type RecvHandlers = {
  onManifest?: (files: FileMeta[]) => void
  onFileProgress?: (index: number, received: number) => void
  onFileComplete?: (index: number, name: string, blob: Blob) => void
  onDone?: () => void
  onError?: (e: string) => void
}

export function startReceiver(sig: SignalingClient, h: RecvHandlers): ReceiverConn {
  const pc = new RTCPeerConnection({ iceServers: ICE })
  let cur: { index: number; name: string; chunks: ArrayBuffer[]; received: number } | null = null
  const pending: RTCIceCandidateInit[] = []

  pc.onicecandidate = (e) => { if (e.candidate) sig.signal({ candidate: e.candidate }) }
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') h.onError?.('연결 실패') }
  pc.ondatachannel = (ev) => {
    const ch = ev.channel
    ch.binaryType = 'arraybuffer'
    ch.onmessage = (m) => {
      if (typeof m.data === 'string') {
        const ctrl = parseControl(m.data)
        if (ctrl.kind === 'manifest') h.onManifest?.(ctrl.files)
        else if (ctrl.kind === 'file-begin') cur = { index: ctrl.index, name: ctrl.name, chunks: [], received: 0 }
        else if (ctrl.kind === 'file-end' && cur) { h.onFileComplete?.(cur.index, cur.name, assembleBlob(cur.chunks)); cur = null }
        else if (ctrl.kind === 'done') h.onDone?.()
      } else if (cur) {
        const buf: ArrayBuffer = m.data
        cur.chunks.push(buf); cur.received += buf.byteLength
        h.onFileProgress?.(cur.index, cur.received)
      }
    }
  }

  return {
    async onSignal(data: any) {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp)
        for (const c of pending.splice(0)) await pc.addIceCandidate(c).catch(() => {})
        if (data.sdp.type === 'offer') {
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          sig.signal({ sdp: pc.localDescription })
        }
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {})
        else pending.push(data.candidate)
      }
    },
    cancel() { pc.close() },
  }
}
