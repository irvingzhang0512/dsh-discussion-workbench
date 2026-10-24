import type { WorkbenchState } from '../shared/types.ts';
/** 摘要栏显示策略；取值与 [docs/architecture.md](../../docs/architecture.md) 的配置契约一致。 */
export type DockMode = 'always' | 'auto' | 'off';
export declare const DOCK_MODES: readonly DockMode[];
/**
 * 解析配置取值。宿主可能传入空对象 `{}`（插件自带 cordis.patch.yml 的
 * `config: {}`），因此未提供与空字符串都按默认 `auto` 处理；无法识别的取值同样
 * 按 `auto` 处理并标记非法，由调用方记录警告，不使插件挂载失败。
 */
export declare function resolveDockMode(value: unknown): {
    mode: DockMode;
    invalid: boolean;
};
/** 会话是否已使用工作台：已有固定整理目标、参考材料或已打开会议。 */
export declare function isWorkbenchUsed(state: Pick<WorkbenchState, 'targetFile' | 'materials' | 'meeting'>): boolean;
/**
 * 摘要栏显示的会话内记忆：`auto` 下会话一旦显示过就保持显示，避免解除目标或删空
 * 材料时面板中途收起；`release` 在连接断开时清除，重开会话按当时的痕迹重新判定。
 * 只存在于运行时，不写入持久文件。
 */
export declare class DockVisibility {
    private shown;
    visible(mode: DockMode, sessionId: string, used: boolean): boolean;
    release(sessionId: string): void;
}
