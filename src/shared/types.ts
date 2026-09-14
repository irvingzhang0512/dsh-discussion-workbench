export type WorkbenchScene = 'meeting' | 'project'
export type MaterialKind = 'file' | 'paste'

export interface WorkbenchMaterial {
  id: string
  label: string
  kind: MaterialKind
  path: string
  addedAt: number
}

export interface WorkbenchTask {
  phase: 'idle' | 'reading' | 'saving' | 'complete' | 'failed' | 'interrupted'
  label: string
  startedAt?: number
  finishedAt?: number
  elapsedMs?: number
}

export interface WorkbenchMetrics {
  turn?: number
  firstModelTextMs?: number
  materialReadMs?: number
  modelToolRounds: number
  documentCommitMs?: number
  viewRefreshMs?: number
}

export interface WorkbenchChange {
  action: string
  revision: number
  counts?: { added: number, updated: number, deleted: number }
  affectedNodeIds: string[]
  at: number
  elapsedMs?: number
}

export interface WorkbenchState {
  sessionId: string
  scene: WorkbenchScene
  targetFile: string | null
  materials: WorkbenchMaterial[]
  task: WorkbenchTask
  lastChange: WorkbenchChange | null
  document: {
    title: string
    revision: number
    selectedNodeId: string | null
    selectedNodeTitle: string | null
    dirty: boolean
    undoDepth: number
  } | null
  browser: { currentFile: string | null, connected: boolean } | null
  view: { currentView: 'markdown' | 'mindmap' | 'table', connected: boolean } | null
  metrics: WorkbenchMetrics
  connected: boolean
  updatedAt: number
}

export type ClientMessage =
  | { type: 'hello' }
  | { type: 'set-context', scene?: WorkbenchScene, targetFile?: string | null, addPath?: string, paste?: { label: string, content: string }, removeMaterialId?: string }
  | { type: 'undo' }
  | { type: 'set-view', view: 'markdown' | 'mindmap' | 'table' }

export type HostMessage =
  | { type: 'state', state: WorkbenchState }
  | { type: 'error', message: string }
