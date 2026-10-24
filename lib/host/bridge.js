import WebSocket from 'ws';
export class WorkbenchBridge {
    sockets = new Map();
    attach(sessionId, socket) {
        const set = this.sockets.get(sessionId) ?? new Set();
        set.add(socket);
        this.sockets.set(sessionId, set);
        return () => {
            set.delete(socket);
            if (set.size === 0)
                this.sockets.delete(sessionId);
        };
    }
    state(sessionId, state) { this.send(sessionId, { type: 'state', state }); }
    error(sessionId, message) { this.send(sessionId, { type: 'error', message }); }
    result(sessionId, requestId, ok, message) {
        this.send(sessionId, { type: 'operation-result', requestId, ok, message });
    }
    source(sessionId, requestId, result) {
        this.send(sessionId, { type: 'source-content', requestId, ...result });
    }
    send(sessionId, message) {
        const body = JSON.stringify(message);
        for (const socket of this.sockets.get(sessionId) ?? [])
            if (socket.readyState === WebSocket.OPEN)
                socket.send(body);
    }
    close() {
        for (const sockets of this.sockets.values())
            for (const socket of sockets)
                socket.close();
        this.sockets.clear();
    }
}
