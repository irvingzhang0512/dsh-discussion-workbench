import type { MeetingInfo, MeetingWorkspace, WorkbenchMaterial, WorkbenchScene, WorkbenchState } from '../shared/types.ts';
export interface StoreOptions {
    cwd(sessionId: string): string | Promise<string>;
    onChange(sessionId: string, state: WorkbenchState): void;
}
export declare class WorkbenchStore {
    private readonly options;
    private states;
    private loads;
    constructor(options: StoreOptions);
    get(sessionId: string): Promise<WorkbenchState>;
    peek(sessionId: string): WorkbenchState | undefined;
    mutateRuntime(sessionId: string, mutate: (state: WorkbenchState) => void, persist?: boolean): Promise<WorkbenchState>;
    update(sessionId: string, patch: {
        scene?: WorkbenchScene;
        targetFile?: string | null;
        addPath?: string;
        paste?: {
            label: string;
            content: string;
        };
        removeMaterialId?: string;
    }): Promise<WorkbenchState>;
    resolveTarget(sessionId: string, raw: string): Promise<string>;
    openMeeting(sessionId: string, rawFolder: string): Promise<WorkbenchState>;
    updateMeeting(sessionId: string, patch: {
        activeDocument?: 'record' | 'minutes';
        referencePanelOpen?: boolean;
        info?: Partial<MeetingInfo>;
        pdf?: MeetingWorkspace['pdf'];
    }): Promise<WorkbenchState>;
    importDocx(sessionId: string, rawDocx: string): Promise<{
        state: WorkbenchState;
        material: WorkbenchMaterial;
        converted: boolean;
    }>;
    readMaterial(sessionId: string, materialId: string, offset: number, maxChars: number): Promise<{
        material: WorkbenchMaterial;
        content: string;
        offset: number;
        nextOffset: number;
        truncated: boolean;
    }>;
    persist(state: WorkbenchState): Promise<void>;
    private load;
    private statePath;
    private persistMeeting;
    private resolveFolder;
    private resolveAllowed;
    private assertInside;
}
