import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'
import type { IncomingMessage } from 'node:http'

export interface StructuredDocumentServiceShape {
  setCurrentFile(sessionId: string, filePath: string | null): void
  bindCurrentFile(sessionId: string, filePath: string): Promise<boolean>
  unbindCurrentFile(sessionId: string): Promise<void>
  ensureBound(sessionId: string): Promise<boolean>
  getDocumentSnapshot(sessionId: string): null | {
    document: { title: string, revision: number, root: DocNodeShape }
    selectedNodeId: string | null
    currentFile: string | null
    lastEditedNodeId: string | null
    lastCreatedNodeId: string | null
    dirty: boolean
    undoDepth: number
  }
  subscribe(sessionId: string, listener: (change: { kind: string, revision?: number, action?: string, elapsedMs?: number, summary?: { counts: { added: number, updated: number, deleted: number }, added_node_ids: string[], updated_node_ids: string[], deleted_node_ids: string[] } }) => void): () => void
  undo(sessionId: string): Promise<{ revision: number, saved: boolean, sidecarSaved: boolean, undoneAction: string }>
  updateNode(sessionId: string, args: { nodeId: string, title: string, content: string, expectedFile: string, expectedRevision: number }): Promise<{ revision: number, saved: boolean, sidecarSaved: boolean }>
}

export interface SidebarControllerServiceShape {
  getState(sessionId: string): SidebarControllerStateShape | undefined
  subscribe(sessionId: string, listener: (state: SidebarControllerStateShape) => void): () => void
}

export interface SidebarControllerStateShape {
  currentFile: string | null
  fileCandidate?: string | null
  fileCandidateSource?: 'current' | 'recent' | null
  workspaceRoot?: string | null
  connected: boolean
}

export interface StructuredDocumentViewServiceShape {
  getState(sessionId: string): { connected: boolean, state: { currentView: 'markdown' | 'mindmap' | 'table' } | null } | undefined
  subscribe(sessionId: string, listener: (state: { connected: boolean, state: { currentView: 'markdown' | 'mindmap' | 'table' } | null } | undefined) => void): () => void
  dispatch(sessionId: string, command: { name: 'set_view', view: 'markdown' | 'mindmap' | 'table' } | { name: 'focus_node', node: string, mode: 'visible' | 'center' } | { name: 'open_tab' }): Promise<unknown>
}

interface DocNodeShape { id: string, title: string, content: string, children: DocNodeShape[] }

/**
 * 设置服务面（软依赖）：缺失时不注册 namespace，`dock` 只用组装层配置。
 * 只声明本插件用到的部分——`get()` 返回当前解析值（用户层 > base > schema 默认）。
 */
export interface WorkbenchSettingsScope {
  get(): unknown
  watch(callback: (next: unknown) => void): () => void
}

export interface WorkbenchSettingsService {
  register(namespace: string, schema: unknown, options?: { base?: unknown, applies?: 'live' | 'restart' }): WorkbenchSettingsScope
}

export interface WorkbenchContextShape {
  tools: { register(tool: ToolDefinition): () => void }
  skills: { register(skill: SkillRegistration): () => void }
  sessions: { get(sessionId: string): { header?: { cwd?: string } } | undefined }
  webServer: { registerUpgrade(options: { path: string, handler: (req: IncomingMessage, socket: unknown, head: Buffer) => void }): () => void }
  webRuntime: { trustedHosts: readonly string[] }
  systemPrompt: {
    context(value: { name: string, order: number, text: (context: { agent?: { session?: { id?: unknown } } }) => string }): () => void
  }
  effect(fn: () => (() => void) | void, label?: string): void
  /** settings 是软依赖：不写进入口 inject，用 ctx.inject(['settings'], …) 挂载。 */
  settings?: WorkbenchSettingsService
  inject<T = unknown>(deps: string[], callback: (ctx: Context) => T): T | undefined
  logger?: { warn?(message: string): void }
}

export type Context = CordisContext & WorkbenchContextShape
