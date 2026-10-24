import WebSocket from 'ws';
import type { WorkbenchState } from '../shared/types.ts';
export declare class WorkbenchBridge {
    private sockets;
    attach(sessionId: string, socket: WebSocket): () => void;
    state(sessionId: string, state: WorkbenchState): void;
    error(sessionId: string, message: string): void;
    result(sessionId: string, requestId: string, ok: boolean, message: string): void;
    source(sessionId: string, requestId: string, result: {
        ok: boolean;
        label?: string;
        content?: string;
        message?: string;
    }): void;
    private send;
    close(): void;
}
