import z from '@deepseek-ai/schemastery';
import type { Context } from './context-types.ts';
import { type DockMode } from './host/dock.ts';
export declare const name = "dsh-discussion-workbench";
export declare const inject: string[];
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    dock: z<"always" | "auto" | "off", "always" | "auto" | "off", "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    dock: z<"always" | "auto" | "off", "always" | "auto" | "off", "defined">;
}>>, "plain">;
export type PluginConfig = {
    dock?: DockMode;
};
export declare const BRIDGE_PATH = "/discussion-workbench/ws";
export declare function apply(ctx: Context, baseConfig?: PluginConfig): void;
export default apply;
