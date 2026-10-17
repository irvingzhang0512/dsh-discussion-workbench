import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { MeetingInfo, MeetingWorkspace, WorkbenchMaterial, WorkbenchScene, WorkbenchState } from '../shared/types.ts'

const execFileAsync = promisify(execFile)
const EMPTY_MEETING_INFO: MeetingInfo = { date: '', time: '', location: '', attendees: '', topic: '', recorder: '' }

export interface StoreOptions {
  cwd(sessionId: string): string | Promise<string>
  onChange(sessionId: string, state: WorkbenchState): void
}

export class WorkbenchStore {
  private states = new Map<string, WorkbenchState>()
  private loads = new Map<string, Promise<WorkbenchState>>()
  constructor(private readonly options: StoreOptions) {}

  async get(sessionId: string): Promise<WorkbenchState> {
    const known = this.states.get(sessionId)
    if (known !== undefined) return known
    let load = this.loads.get(sessionId)
    if (load === undefined) {
      load = this.load(sessionId)
      this.loads.set(sessionId, load)
    }
    return load
  }

  peek(sessionId: string): WorkbenchState | undefined { return this.states.get(sessionId) }

  async mutateRuntime(sessionId: string, mutate: (state: WorkbenchState) => void, persist = false): Promise<WorkbenchState> {
    const current = await this.get(sessionId)
    const state = persist ? structuredClone(current) : current
    mutate(state)
    state.updatedAt = Date.now()
    if (persist) { await this.persist(state); this.states.set(sessionId, state) }
    this.options.onChange(sessionId, structuredClone(state))
    return state
  }

  async update(sessionId: string, patch: { scene?: WorkbenchScene, targetFile?: string | null, addPath?: string, paste?: { label: string, content: string }, removeMaterialId?: string }): Promise<WorkbenchState> {
    const state = structuredClone(await this.get(sessionId))
    if (patch.scene !== undefined) state.scene = patch.scene
    if (patch.targetFile !== undefined) {
      state.targetFile = patch.targetFile === null || patch.targetFile === '' ? null : await this.resolveAllowed(sessionId, patch.targetFile, ['.md', '.markdown'])
      state.targetBinding = state.targetFile === null ? 'unbound' : 'bound'
      if (state.targetFile === null) { state.document = null; state.lastChange = null }
    }
    if (patch.addPath !== undefined && patch.addPath !== '') {
      const path = await this.resolveAllowed(sessionId, patch.addPath, ['.md', '.markdown', '.txt', '.json'])
      if (!state.materials.some(material => material.path === path)) state.materials.push({ id: randomUUID(), label: path.split(/[\\/]/).at(-1) ?? path, kind: 'file', path, addedAt: Date.now() })
    }
    if (patch.paste !== undefined) {
      const label = safeLabel(patch.paste.label || '粘贴材料')
      const folder = join(await this.options.cwd(sessionId), '.dsh-workbench', 'materials', safeSession(sessionId))
      await mkdir(folder, { recursive: true })
      const path = join(folder, `${Date.now()}-${randomUUID()}-${label}.txt`)
      await writeFile(path, patch.paste.content, 'utf8')
      state.materials.push({ id: randomUUID(), label, kind: 'paste', path, addedAt: Date.now() })
    }
    if (patch.removeMaterialId !== undefined) state.materials = state.materials.filter(material => material.id !== patch.removeMaterialId)
    state.updatedAt = Date.now()
    await this.persist(state)
    this.states.set(sessionId, state)
    this.options.onChange(sessionId, structuredClone(state))
    return state
  }

  resolveTarget(sessionId: string, raw: string): Promise<string> {
    return this.resolveAllowed(sessionId, raw, ['.md', '.markdown'])
  }

  async openMeeting(sessionId: string, rawFolder: string): Promise<WorkbenchState> {
    const folder = await this.resolveFolder(sessionId, rawFolder)
    const metadataPath = join(folder, '.meeting-workbench.json')
    let meeting: MeetingWorkspace = {
      folder, recordFile: null, minutesFile: null, activeDocument: 'record', phase: 'materials',
      info: { ...EMPTY_MEETING_INFO }, sourceLinks: [], pendingSync: [], referencePanelOpen: false, pdf: null,
    }
    try {
      const saved = JSON.parse(await readFile(metadataPath, 'utf8')) as Partial<MeetingWorkspace>
      meeting = { ...meeting, ...saved, folder, info: { ...EMPTY_MEETING_INFO, ...saved.info }, sourceLinks: saved.sourceLinks ?? [], pendingSync: saved.pendingSync ?? [] }
    } catch { /* existing folders do not require metadata */ }
    for (const candidate of ['会议记录.md', '会议纪要.md']) {
      try {
        const path = await this.resolveAllowed(sessionId, join(folder, candidate), ['.md', '.markdown'])
        if (candidate === '会议记录.md') meeting.recordFile = path
        else meeting.minutesFile = path
      } catch { /* file has not been generated yet */ }
    }
    const state = structuredClone(await this.get(sessionId))
    state.scene = 'meeting'; state.meeting = meeting
    const preferred = meeting.activeDocument === 'minutes' ? meeting.minutesFile : meeting.recordFile
    if (preferred !== null) { state.targetFile = preferred; state.targetBinding = 'bound' }
    state.updatedAt = Date.now(); await this.persistMeeting(meeting); await this.persist(state)
    this.states.set(sessionId, state); this.options.onChange(sessionId, structuredClone(state))
    return state
  }

  async updateMeeting(sessionId: string, patch: { activeDocument?: 'record' | 'minutes', referencePanelOpen?: boolean, info?: Partial<MeetingInfo>, pdf?: MeetingWorkspace['pdf'] }): Promise<WorkbenchState> {
    const state = structuredClone(await this.get(sessionId))
    if (state.meeting === null) throw new Error('请先打开会议文件夹。')
    const meeting = state.meeting
    if (patch.activeDocument !== undefined) {
      meeting.activeDocument = patch.activeDocument
      const target = patch.activeDocument === 'record' ? meeting.recordFile : meeting.minutesFile
      if (target === null) throw new Error(patch.activeDocument === 'record' ? '会议记录尚未生成。' : '会议纪要尚未生成。')
      state.targetFile = target; state.targetBinding = 'bound'
    }
    if (patch.referencePanelOpen !== undefined) meeting.referencePanelOpen = patch.referencePanelOpen
    if (patch.info !== undefined) meeting.info = { ...meeting.info, ...patch.info }
    if (patch.pdf !== undefined) meeting.pdf = patch.pdf
    state.updatedAt = Date.now(); await this.persistMeeting(meeting); await this.persist(state)
    this.states.set(sessionId, state); this.options.onChange(sessionId, structuredClone(state))
    return state
  }

  async importDocx(sessionId: string, rawDocx: string): Promise<{ state: WorkbenchState, material: WorkbenchMaterial, converted: boolean }> {
    const docx = await this.resolveAllowed(sessionId, rawDocx, ['.docx'])
    const state = await this.get(sessionId)
    if (state.meeting === null) throw new Error('请先打开会议文件夹。')
    if (dirname(docx) !== state.meeting.folder) throw new Error('DOCX 必须位于当前会议文件夹。')
    const output = docx.replace(/\.docx$/i, '.md')
    let converted = false
    try { await stat(output) } catch {
      const script = join(await this.options.cwd(sessionId), 'convert-docx-to-md.ps1')
      await execFileAsync('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-InputPath', docx, '-OutputPath', output], { windowsHide: true })
      converted = true
    }
    const next = await this.update(sessionId, { addPath: output })
    const material = next.materials.find(item => item.path.toLowerCase() === output.toLowerCase())
    if (material === undefined) throw new Error('转换完成，但无法登记材料。')
    return { state: next, material, converted }
  }

  async readMaterial(sessionId: string, materialId: string, offset: number, maxChars: number): Promise<{ material: WorkbenchMaterial, content: string, offset: number, nextOffset: number, truncated: boolean }> {
    const state = await this.get(sessionId)
    const material = state.materials.find(item => item.id === materialId)
    if (material === undefined) throw new Error(`未找到参考材料:${materialId}`)
    await this.assertInside(sessionId, material.path)
    state.task = { phase: 'reading', label: `正在读取 ${material.label}`, startedAt: Date.now() }
    this.options.onChange(sessionId, structuredClone(state))
    try {
      const text = await readFile(material.path, 'utf8')
      const content = text.slice(offset, offset + maxChars)
      const nextOffset = offset + content.length
      const finishedAt = Date.now()
      const elapsedMs = finishedAt - (state.task.startedAt ?? finishedAt)
      state.task = { phase: 'complete', label: `已读取 ${material.label}`, startedAt: state.task.startedAt, finishedAt, elapsedMs }
      state.metrics.materialReadMs = elapsedMs
      this.options.onChange(sessionId, structuredClone(state))
      return { material, content, offset, nextOffset, truncated: nextOffset < text.length }
    } catch (error) {
      state.task = { phase: 'failed', label: `读取失败:${error instanceof Error ? error.message : String(error)}`, startedAt: state.task.startedAt, finishedAt: Date.now() }
      this.options.onChange(sessionId, structuredClone(state))
      throw error
    }
  }

  async persist(state: WorkbenchState): Promise<void> {
    const path = await this.statePath(state.sessionId)
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.tmp-${process.pid}-${randomUUID()}`
    await writeFile(temp, JSON.stringify({ ...state, connected: false, task: state.task.phase === 'idle' || state.task.phase === 'complete' || state.task.phase === 'failed' ? state.task : { phase: 'interrupted', label: '上次任务因宿主停止而中断' } }, null, 2) + '\n', 'utf8')
    try { await rename(temp, path) } catch (error) { await unlink(temp).catch(() => {}); throw error }
  }

  private async load(sessionId: string): Promise<WorkbenchState> {
    let state: WorkbenchState = { sessionId, scene: 'meeting', targetFile: null, targetBinding: 'unbound', materials: [], meeting: null, task: { phase: 'idle', label: '' }, lastChange: null, document: null, browser: null, view: null, metrics: { modelToolRounds: 0 }, connected: false, updatedAt: Date.now() }
    try {
      const parsed = JSON.parse(await readFile(await this.statePath(sessionId), 'utf8')) as WorkbenchState
      if (parsed.sessionId === sessionId) state = { ...state, ...parsed, browser: null, view: null, metrics: { ...parsed.metrics, modelToolRounds: parsed.metrics?.modelToolRounds ?? 0 }, connected: false }
    } catch { /* first use or invalid state: start clean */ }
    if (state.targetFile !== null) {
      try { state.targetFile = await this.resolveAllowed(sessionId, state.targetFile, ['.md', '.markdown']) } catch { state.targetFile = null }
    }
    state.targetBinding = 'unbound'
    state.materials = (await Promise.all(state.materials.map(async material => {
      try { await this.resolveAllowed(sessionId, material.path, ['.md', '.markdown', '.txt', '.json']); return material } catch { return null }
    }))).filter((material): material is WorkbenchMaterial => material !== null)
    this.states.set(sessionId, state)
    this.loads.delete(sessionId)
    return state
  }

  private async statePath(sessionId: string): Promise<string> { return join(await this.options.cwd(sessionId), '.dsh-workbench', 'sessions', `${safeSession(sessionId)}.json`) }

  private async persistMeeting(meeting: MeetingWorkspace): Promise<void> {
    const path = join(meeting.folder, '.meeting-workbench.json')
    const temp = `${path}.tmp-${process.pid}-${randomUUID()}`
    await writeFile(temp, JSON.stringify(meeting, null, 2) + '\n', 'utf8')
    try { await rename(temp, path) } catch (error) { await unlink(temp).catch(() => {}); throw error }
  }

  private async resolveFolder(sessionId: string, raw: string): Promise<string> {
    const root = resolve(await this.options.cwd(sessionId)); const path = resolve(isAbsolute(raw) ? raw : join(root, raw))
    await this.assertInside(sessionId, path)
    const canonical = await realpath(path); await this.assertInside(sessionId, canonical)
    if (!(await stat(canonical)).isDirectory()) throw new Error(`不是会议文件夹:${path}`)
    return canonical
  }

  private async resolveAllowed(sessionId: string, raw: string, extensions: string[]): Promise<string> {
    const root = resolve(await this.options.cwd(sessionId))
    const path = resolve(isAbsolute(raw) ? raw : join(root, raw))
    await this.assertInside(sessionId, path)
    if (!extensions.some(extension => path.toLowerCase().endsWith(extension))) throw new Error(`不支持的文件格式:${path}`)
    const canonical = await realpath(path)
    await this.assertInside(sessionId, canonical)
    const info = await stat(canonical)
    if (!info.isFile()) throw new Error(`不是文件:${path}`)
    return canonical
  }

  private async assertInside(sessionId: string, path: string): Promise<void> {
    const root = resolve(await this.options.cwd(sessionId))
    const rel = relative(root, resolve(path))
    if (rel === '..' || rel.startsWith(`..\\`) || rel.startsWith('../') || isAbsolute(rel)) throw new Error(`路径超出会话工作区:${path}`)
  }
}

function safeSession(id: string): string { return `${id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48)}-${createHash('sha256').update(id).digest('hex').slice(0, 8)}` }
function safeLabel(label: string): string { return label.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').slice(0, 80) || '粘贴材料' }
