export interface Peer { send(msg: unknown): void }

interface Room { code: string; sender: Peer; receiver: Peer | null; createdAt: number }

export interface Signaling {
  onMessage(peer: Peer, msg: any): void
  onClose(peer: Peer): void
  sweep(now: number, ttlMs: number): void
  roomCount(): number
}

const MAX_ROOMS = 10000

export function createSignaling(randomCode: () => string, now: () => number = () => 0, maxRooms = MAX_ROOMS): Signaling {
  const rooms = new Map<string, Room>()
  const peerRoom = new Map<Peer, Room>()

  function uniqueCode(): string {
    for (let i = 0; i < 100; i++) {
      const c = randomCode()
      if (!rooms.has(c)) return c
    }
    throw new Error('코드 공간 포화')
  }
  function other(room: Room, peer: Peer): Peer | null {
    if (room.sender === peer) return room.receiver
    if (room.receiver === peer) return room.sender
    return null
  }
  function destroy(room: Room) {
    rooms.delete(room.code)
    peerRoom.delete(room.sender)
    if (room.receiver) peerRoom.delete(room.receiver)
  }

  return {
    onMessage(peer, msg) {
      if (!msg || typeof msg.type !== 'string') return
      if (msg.type === 'create') {
        if (rooms.size >= maxRooms) { peer.send({ type: 'error', reason: 'busy' }); return }
        const code = uniqueCode()
        const room: Room = { code, sender: peer, receiver: null, createdAt: now() }
        rooms.set(code, room)
        peerRoom.set(peer, room)
        peer.send({ type: 'created', code })
      } else if (msg.type === 'join') {
        const room = rooms.get(String(msg.code))
        if (!room) { peer.send({ type: 'error', reason: 'not-found' }); return }
        if (room.receiver) { peer.send({ type: 'error', reason: 'busy' }); return }
        room.receiver = peer
        peerRoom.set(peer, room)
        room.sender.send({ type: 'peer-joined' })
        peer.send({ type: 'peer-joined' })
      } else if (msg.type === 'signal') {
        const room = peerRoom.get(peer)
        if (!room) return
        const dst = other(room, peer)
        if (dst) dst.send({ type: 'signal', data: msg.data })
      }
    },
    onClose(peer) {
      const room = peerRoom.get(peer)
      if (!room) return
      const dst = other(room, peer)
      if (dst) dst.send({ type: 'peer-left' })
      destroy(room)
    },
    sweep(nowMs, ttlMs) {
      for (const room of [...rooms.values()]) {
        if (room.receiver === null && nowMs - room.createdAt > ttlMs) destroy(room)
      }
    },
    roomCount() { return rooms.size },
  }
}
