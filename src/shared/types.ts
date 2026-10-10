export type WorkbenchScene = 'meeting' | 'project'
export type MaterialKind = 'file' | 'paste'

export interface WorkbenchMaterial {
  id: string
  label: string
  kind: MaterialKind
  path: string
  addedAt: number
}

export interface MeetingInfo {
  date: string
  time: string
  location: string
  attendees: string
  topic: string
  recorder: string
}

export interface MeetingSourceLink {
  nodeId: string
  materialId: string
  offset: number
  length: number
  status: 'verified' | 'needs_review'
}

export interface MeetingWorkspace {
  folder: string
  recordFile: string | null
  minutesFile: string | null
  activeDocument: 'record' | 'minutes'
  phase: 'materials' | 'draft' | 'review' | 'minutes' | 'published'
  info: MeetingInfo
  sourceLinks: MeetingSourceLink[]
  pendingSync: Array<'record' | 'minutes'>
  referencePanelOpen: boolean
  pdf: { path: string, revision: number } | null
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
  meeting: MeetingWorkspace | null
  task: WorkbenchTask
  lastChange: WorkbenchChange | null
  document: {
    title: string
    revision: number
    selectedNodeId: string | null
    selectedNodeTitle: string | null
    selectedNodeContent: string | null
    dirty: boolean
    undoDepth: number
  } | null
  browser: {
    currentFile: string | null
    fileCandidate?: string | null
    fileCandidateSource?: 'current' | 'recent' | null
    workspaceRoot?: string | null
    connected: boolean
  } | null
  targetBinding: 'unbound' | 'bound' | 'error'
  view: { currentView: 'markdown' | 'mindmap' | 'table', connected: boolean } | null
  metrics: WorkbenchMetrics
  connected: boolean
  updatedAt: number
  /** 宿主按配置与使用痕迹下发的摘要栏显示判定；只随快照下发，不写入持久文件。 */
  dock?: boolean
}

export type ClientMessage =
  | { type: 'hello' }
  | { type: 'set-context', requestId?: string, scene?: WorkbenchScene, targetFile?: string | null, addPath?: string, paste?: { label: string, content: string }, removeMaterialId?: string }
  | { type: 'meeting-action', requestId?: string, action: 'open-meeting' | 'select-record' | 'select-minutes' | 'toggle-reference' | 'save-info' | 'import-docx' | 'export-pdf', folder?: string, info?: Partial<MeetingInfo>, docxPath?: string, overwrite?: boolean }
  | { type: 'edit-node', requestId?: string, nodeId: string, title: string, content: string, expectedRevision: number }
  | { type: 'read-source', requestId: string, materialId: string, query?: string }
  | { type: 'undo' }
  | { type: 'set-view', view: 'markdown' | 'mindmap' | 'table' }

export type HostMessage =
  | { type: 'state', state: WorkbenchState }
  | { type: 'error', message: string }
  | { type: 'operation-result', requestId: string, ok: boolean, message: string }
  | { type: 'source-content', requestId: string, ok: boolean, label?: string, content?: string, message?: string }
