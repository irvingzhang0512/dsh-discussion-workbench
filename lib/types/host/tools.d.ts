import type { WorkbenchStore } from './store.ts';
export interface ToolOptions {
    store: WorkbenchStore;
    setContext(sessionId: string, patch: Parameters<WorkbenchStore['update']>[1]): Promise<Awaited<ReturnType<WorkbenchStore['update']>>>;
    openMeeting(sessionId: string, folder: string): Promise<unknown>;
}
export declare function registerWorkbenchTools(ctx: {
    tools: {
        register(tool: unknown): () => void;
    };
}, options: ToolOptions): () => void;
