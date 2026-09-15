import WebSocket from 'ws'
import type { HostMessage, WorkbenchState } from '../shared/types.ts'

export class WorkbenchBridge {
  private sockets = new Map<string, Set<WebSocket>>()

  attach(sessionId: string, socket: WebSocket): () => void {
    const set = this.sockets.get(sessionId) ?? new Set<WebSocket>()
    set.add(socket)
    this.sockets.set(sessionId, set)
    return () => {
      set.delete(socket)
      if (set.size === 0) this.sockets.delete(sessionId)
    }
  }

  state(sessionId: string, state: WorkbenchState): void { this.send(sessionId, { type: 'state', state }) }
  error(sessionId: string, message: string): void { this.send(sessionId, { type: 'error', message }) }
  result(sessionId: string, requestId: string, ok: boolean, message: string): void {
    this.send(sessionId, { type: 'operation-result', requestId, ok, message })
  }

  private send(sessionId: string, message: HostMessage): void {
    const body = JSON.stringify(message)
    for (const socket of this.sockets.get(sessionId) ?? []) if (socket.readyState === WebSocket.OPEN) socket.send(body)
  }

  close(): void {
    for (const sockets of this.sockets.values()) for (const socket of sockets) socket.close()
    this.sockets.clear()
  }
}
