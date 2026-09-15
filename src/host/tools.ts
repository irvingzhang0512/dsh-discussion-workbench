import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { WorkbenchScene } from '../shared/types.ts'
import type { WorkbenchStore } from './store.ts'

function sessionId(exec: ToolRunContext): string | null {
  const id = exec.agent?.session?.id
  return typeof id === 'string' && id !== '' ? id : null
}

function output(extra: Record<string, unknown> = {}) {
  return { type: 'object' as const, additionalProperties: false, properties: {
    success: { type: 'boolean' as const, required: true as const },
    message: { type: 'string' as const, required: true as const }, ...extra,
  } }
}

function render(_args: unknown, value: unknown) {
  const row = value as { success: boolean, message: string }
  return [{ type: 'text' as const, text: `${row.success ? '[OK]' : '[ERROR]'} ${row.message}` }]
}

export interface ToolOptions {
  store: WorkbenchStore
  setContext(sessionId: string, patch: Parameters<WorkbenchStore['update']>[1]): Promise<Awaited<ReturnType<WorkbenchStore['update']>>>
}

export function registerWorkbenchTools(ctx: { tools: { register(tool: unknown): () => void } }, options: ToolOptions): () => void {
  const tools = [
    defineTool({
      name: 'get_workbench_context', description: '读取当前会议/项目工作台上下文。整理或修改前优先读取一次。', parameters: {}, isConcurrencySafe: () => true,
      output: { schema: output({ context: { type: 'json', description: '场景、目标、材料、文档状态与最近变更。' } }), render },
      async execute(_args, exec) {
        const id = sessionId(exec); if (id === null) return { success: false, message: '无法确定当前会话。' }
        const state = await options.store.get(id)
        return { success: true, message: describe(state), context: JSON.parse(JSON.stringify(state)) }
      },
    }),
    defineTool({
      name: 'set_workbench_context', description: '设置会议/项目场景、固定整理目标与参考材料。普通讨论不要调用。',
      parameters: {
        scene: { type: 'string', enum: ['meeting', 'project'], description: '场景。' },
        target_file: { type: 'string', description: '固定整理目标 Markdown；空字符串清除目标。' },
        add_material_path: { type: 'string', description: '添加一个工作区内的 Markdown/TXT 参考材料。' },
        pasted_material: { type: 'json', description: '保存粘贴材料：{label,content}。' },
        remove_material_id: { type: 'string', description: '移除参考材料 ID。' },
      },
      output: { schema: output({ context: { type: 'json' } }), render }, isConcurrencySafe: () => false,
      async execute(args, exec) {
        const id = sessionId(exec); if (id === null) return { success: false, message: '无法确定当前会话。' }
        try {
          const paste = args.pasted_material as null | { label?: unknown, content?: unknown } | undefined
          const state = await options.setContext(id, {
            ...(args.scene !== undefined ? { scene: args.scene as WorkbenchScene } : {}),
            ...(args.target_file !== undefined ? { targetFile: args.target_file === '' ? null : args.target_file } : {}),
            ...(args.add_material_path !== undefined ? { addPath: args.add_material_path } : {}),
            ...(paste !== undefined ? { paste: { label: typeof paste?.label === 'string' ? paste.label : '粘贴材料', content: typeof paste?.content === 'string' ? paste.content : '' } } : {}),
            ...(args.remove_material_id !== undefined ? { removeMaterialId: args.remove_material_id } : {}),
          })
          return { success: true, message: describe(state), context: JSON.parse(JSON.stringify(state)) }
        } catch (error) { return { success: false, message: error instanceof Error ? error.message : String(error) } }
      },
    }),
    defineTool({
      name: 'read_material', description: '分段读取工作台中的一份参考材料；返回是否还有后续，禁止把截断结果当作完整材料。',
      parameters: {
        material_id: { type: 'string', required: true },
        offset: { type: 'integer', description: '字符偏移，默认 0。' },
        max_chars: { type: 'integer', description: '本次最多读取字符数，默认 12000，最大 20000。' },
      },
      output: { schema: output({ material_id: { type: 'string' }, label: { type: 'string' }, content: { type: 'string' }, offset: { type: 'integer' }, next_offset: { type: 'integer' }, truncated: { type: 'boolean' } }), render },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const id = sessionId(exec); if (id === null) return { success: false, message: '无法确定当前会话。' }
        try {
          const offset = Math.max(0, Number(args.offset) || 0)
          const maxChars = Math.min(20_000, Math.max(1, Number(args.max_chars) || 12_000))
          const result = await options.store.readMaterial(id, args.material_id, offset, maxChars)
          return { success: true, message: `已读取「${result.material.label}」字符 ${result.offset}-${result.nextOffset}${result.truncated ? '，仍有后续。' : '，已读完。'}`, material_id: result.material.id, label: result.material.label, content: result.content, offset: result.offset, next_offset: result.nextOffset, truncated: result.truncated }
        } catch (error) { return { success: false, message: error instanceof Error ? error.message : String(error) } }
      },
    }),
  ]
  const disposers = tools.map(tool => ctx.tools.register(tool))
  return () => disposers.forEach(dispose => dispose())
}

function describe(state: { scene: WorkbenchScene, targetFile: string | null, materials: Array<{ label: string }>, document: { revision: number } | null }): string {
  return `场景:${state.scene === 'meeting' ? '会议整理' : '项目更新'}；目标:${state.targetFile ?? '未设置'}；参考材料:${state.materials.map(item => item.label).join('、') || '无'}；版本:${state.document?.revision ?? '未绑定'}。`
}
