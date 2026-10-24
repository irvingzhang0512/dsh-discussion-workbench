export declare const inject: string[];
interface SlotDefinition {
    name: string;
    id?: string;
    /** keyed slot（如 settings.plugin.item）的键；设置页按 namespace 派发卡片。 */
    key?: string;
    order?: number;
    label?: () => string;
}
/** 绑定后的设置 scope 快照；形状见 docs/architecture.md 的「设置页卡片」。 */
interface SettingsSnapshot {
    status: 'loading' | 'ready' | 'unavailable';
    value?: {
        dock?: unknown;
    };
    base?: {
        dock?: unknown;
    };
    user?: {
        dock?: unknown;
    };
    revision?: number;
    writable?: boolean;
    mode?: string;
}
type SettingsOperation = {
    op: 'set';
    path: string[];
    value: unknown;
} | {
    op: 'unset';
    path: string[];
};
interface BoundSettingsScope {
    getSnapshot(): SettingsSnapshot;
    subscribe(listener: () => void): () => void;
    /** 单操作写入以 revision 作栅栏；`set`／`unset` 是它的单操作形式，不能带栅栏。 */
    mutate(operations: SettingsOperation[], expectedRevision?: number): Promise<unknown>;
}
interface ClientContext {
    slots: {
        inject(name: string, register: () => (() => void)): void;
        register(definition: SlotDefinition, component: (props: DockProps) => React.ReactElement | null): () => void;
    };
    effect(fn: () => (() => void), label?: string): void;
    /** settingsScope 是软依赖：不写进 exports.inject，缺失时只少一张设置卡。 */
    inject(deps: string[], callback: (ctx: ClientContext) => void): void;
    settingsScope?: {
        bind(spec: {
            namespace: string;
        }): BoundSettingsScope;
    };
}
interface DockProps {
    sessionId?: string;
}
declare global {
    interface Window {
        __DSH_DISCUSSION_WORKBENCH__?: {
            getTarget(sessionId: string): string | null;
            ownsDocumentBinding: true;
        };
    }
}
export declare function apply(ctx: ClientContext): void;
export {};
