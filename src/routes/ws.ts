import websocket from '@fastify/websocket'
import type { FastifyInstance } from 'fastify'
import type { Signaling, Peer } from '../signaling.js'

export function registerWs(app: FastifyInstance, signaling: Signaling): void {
  app.register(async (scoped) => {
    await scoped.register(websocket, { options: { maxPayload: 65536 } })
    scoped.get('/ws', { websocket: true }, (socket) => {
      const peer: Peer = { send: (m) => { try { socket.send(JSON.stringify(m)) } catch { /* closed */ } } }
      socket.on('message', (raw: Buffer) => {
        try { signaling.onMessage(peer, JSON.parse(raw.toString())) } catch { /* ignore bad json */ }
      })
      socket.on('close', () => signaling.onClose(peer))
      socket.on('error', () => signaling.onClose(peer))
    })
  })
}
