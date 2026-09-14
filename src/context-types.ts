import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'
import type { IncomingMessage } from 'node:http'

export interface StructuredDocumentServiceShape {
  setCurrentFile(sessionId: string, filePath: string | null): void
  bindCurrentFile(sessionId: string, filePath: string): Promise<boolean>
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
}

export interface SidebarControllerServiceShape {
  getState(sessionId: string): { currentFile: string | null, connected: boolean } | undefined
  subscribe(sessionId: string, listener: (state: { currentFile: string | null, connected: boolean }) => void): () => void
}

export interface StructuredDocumentViewServiceShape {
  getState(sessionId: string): { connected: boolean, state: { currentView: 'markdown' | 'mindmap' | 'table' } | null } | undefined
  subscribe(sessionId: string, listener: (state: { connected: boolean, state: { currentView: 'markdown' | 'mindmap' | 'table' } | null } | undefined) => void): () => void
  dispatch(sessionId: string, command: { name: 'set_view', view: 'markdown' | 'mindmap' | 'table' } | { name: 'focus_node', node: string, mode: 'visible' | 'center' }): Promise<unknown>
}

interface DocNodeShape { id: string, title: string, children: DocNodeShape[] }

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
  logger?: { warn?(message: string): void }
}

export type Context = CordisContext & WorkbenchContextShape
