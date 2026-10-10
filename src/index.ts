import { readFile, writeFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket } from 'ws'
import z from '@deepseek-ai/schemastery'
import type { Context, SidebarControllerServiceShape, StructuredDocumentServiceShape, StructuredDocumentViewServiceShape } from './context-types.ts'
import type { ClientMessage, WorkbenchState } from './shared/types.ts'
import { WorkbenchStore } from './host/store.ts'
import { WorkbenchBridge } from './host/bridge.ts'
import { registerWorkbenchTools } from './host/tools.ts'
import { trustedRequest } from './host/trust-fence.ts'
import { DockVisibility, isWorkbenchUsed, resolveDockMode, type DockMode } from './host/dock.ts'

export const name = 'dsh-discussion-workbench'
export const inject = ['tools', 'skills', 'sessions', 'webServer', 'webRuntime', 'systemPrompt', 'structuredDocument', 'sidebarController', 'structuredDocumentView']
export const Config = z.object({
  dock: z.union([z.const('always'), z.const('auto'), z.const('off')]).default('auto')
    .description('输入区上方工作台摘要栏的显示策略：always 所有会话都显示；auto（默认）只在该会话已使用工作台时显示；off 任何会话都不显示。'),
})
export type PluginConfig = { dock?: DockMode }
export const BRIDGE_PATH = '/discussion-workbench/ws'
const execFileAsync = promisify(execFile)

export function apply(ctx: Context, baseConfig?: PluginConfig): void {
  const resolvedDock = resolveDockMode(baseConfig?.dock)
  const dockMode = resolvedDock.mode
  if (resolvedDock.invalid) {
    ctx.logger?.warn?.(`[discussion-workbench] 无法识别的 dock 配置取值 ${JSON.stringify(baseConfig?.dock)}，按 auto 处理。`)
  }
  const dockVisibility = new DockVisibility()
  const bridge = new WorkbenchBridge()
  const cwd = (sessionId: string): string => ctx.sessions.get(sessionId)?.header?.cwd || process.cwd()
  const store = new WorkbenchStore({ cwd, onChange: (sessionId, state) => bridge.state(sessionId, { ...state, dock: dockVisibility.visible(dockMode, sessionId, isWorkbenchUsed(state)) }) })
  const documentService = ctx.get('structuredDocument') as StructuredDocumentServiceShape | undefined
  const sidebarService = ctx.get('sidebarController') as SidebarControllerServiceShape | undefined
  const viewService = ctx.get('structuredDocumentView') as StructuredDocumentViewServiceShape | undefined
  const subscriptions = new Map<string, () => void>()
  const sidebarSubscriptions = new Map<string, () => void>()
  const viewSubscriptions = new Map<string, () => void>()
  const pendingViewRefresh = new Map<string, number>()
  const turnTimings = new Map<string, { turn: number, startedAt: number, toolSteps: Set<number>, firstTextRecorded: boolean }>()
  const documentCalls = new Map<string, string>()
  const contextQueues = new Map<string, Promise<void>>()
  const contextTransitions = new Set<string>()
  const contextRequestResults = new Map<string, { ok: boolean, message: string }>()
  const contextRequestTasks = new Map<string, Promise<{ ok: boolean, message: string }>>()

  const findNode = (root: { id: string, title: string, content: string, children: typeof root[] }, id: string | null): { title: string, content: string } | null => {
    if (id === null) return null
    const stack = [root]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.id === id) return { title: node.title, content: node.content }
      stack.push(...node.children)
    }
    return null
  }

  const syncDocument = async (sessionId: string, change?: { action?: string, elapsedMs?: number, summary?: { counts: { added: number, updated: number, deleted: number }, added_node_ids: string[], updated_node_ids: string[], deleted_node_ids: string[] } }): Promise<void> => {
    if (contextTransitions.has(sessionId)) return
    const targetFile = (await store.get(sessionId)).targetFile
    const candidate = targetFile === null ? null : documentService?.getDocumentSnapshot(sessionId) ?? null
    const snapshot = candidate?.currentFile === targetFile ? candidate : null
    if (change?.action !== undefined) pendingViewRefresh.set(sessionId, Date.now())
    await store.mutateRuntime(sessionId, state => {
      const selectedNode = snapshot === null ? null : findNode(snapshot.document.root, snapshot.selectedNodeId)
      state.document = snapshot === null ? null : {
        title: snapshot.document.title, revision: snapshot.document.revision,
        selectedNodeId: snapshot.selectedNodeId, selectedNodeTitle: selectedNode?.title ?? null, selectedNodeContent: selectedNode?.content ?? null,
        dirty: snapshot.dirty, undoDepth: snapshot.undoDepth,
      }
      if (change?.action !== undefined && snapshot !== null) {
        const ids = change.summary === undefined ? [snapshot.selectedNodeId].filter((id): id is string => id !== null) : [...change.summary.added_node_ids, ...change.summary.updated_node_ids, ...change.summary.deleted_node_ids]
        state.lastChange = { action: change.action, revision: snapshot.document.revision, ...(change.summary !== undefined ? { counts: change.summary.counts } : {}), affectedNodeIds: ids, at: Date.now(), ...(change.elapsedMs !== undefined ? { elapsedMs: change.elapsedMs } : {}) }
        if (change.elapsedMs !== undefined) state.metrics.documentCommitMs = change.elapsedMs
        state.task = { phase: 'complete', label: change.action === 'undo' ? '已撤销上次文档修改' : '文档已保存并同步到视图', finishedAt: Date.now(), ...(change.elapsedMs !== undefined ? { elapsedMs: change.elapsedMs } : {}) }
      }
    }, change?.action !== undefined)
    const focusId = change?.summary === undefined ? null : [...change.summary.added_node_ids, ...change.summary.updated_node_ids].at(-1) ?? null
    if (focusId !== null && viewService !== undefined) {
      await viewService.dispatch(sessionId, { name: 'focus_node', node: focusId, mode: 'visible' }).catch(() => undefined)
    }
  }

  const ensureSubscription = (sessionId: string): void => {
    if (documentService !== undefined && !subscriptions.has(sessionId)) {
      subscriptions.set(sessionId, documentService.subscribe(sessionId, change => { void syncDocument(sessionId, change) }))
    }
    if (sidebarService !== undefined && !sidebarSubscriptions.has(sessionId)) {
      sidebarSubscriptions.set(sessionId, sidebarService.subscribe(sessionId, sidebar => {
        void store.mutateRuntime(sessionId, state => { state.browser = {
          currentFile: sidebar.currentFile,
          fileCandidate: sidebar.fileCandidate,
          fileCandidateSource: sidebar.fileCandidateSource,
          workspaceRoot: sidebar.workspaceRoot,
          connected: sidebar.connected,
        } })
      }))
    }
    if (viewService !== undefined && !viewSubscriptions.has(sessionId)) {
      viewSubscriptions.set(sessionId, viewService.subscribe(sessionId, mirror => {
        void store.mutateRuntime(sessionId, state => {
          state.view = mirror?.state === null || mirror === undefined ? null : { currentView: mirror.state.currentView, connected: mirror.connected }
          const startedAt = pendingViewRefresh.get(sessionId)
          if (startedAt !== undefined && mirror?.state !== null && mirror !== undefined) {
            state.metrics.viewRefreshMs = Date.now() - startedAt
            pendingViewRefresh.delete(sessionId)
          }
        })
      }))
    }
  }

  const reconcileContext = async (sessionId: string): Promise<void> => {
    const state = await store.get(sessionId)
    ensureSubscription(sessionId)
    if (documentService !== undefined && state.targetFile !== null) {
      const bound = await documentService.bindCurrentFile(sessionId, state.targetFile)
      await store.mutateRuntime(sessionId, current => { current.targetBinding = bound ? 'bound' : 'error' }, true)
      if (!bound) throw new Error(`无法绑定整理目标:${state.targetFile}`)
    } else if (state.targetFile === null) {
      await store.mutateRuntime(sessionId, current => { current.targetBinding = 'unbound'; current.document = null })
    }
    await syncDocument(sessionId)
  }

  const enqueueContext = <T,>(sessionId: string, operation: () => Promise<T>): Promise<T> => {
    const previous = contextQueues.get(sessionId) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(operation)
    const tail = result.then(() => undefined, () => undefined)
    contextQueues.set(sessionId, tail)
    void tail.finally(() => { if (contextQueues.get(sessionId) === tail) contextQueues.delete(sessionId) })
    return result
  }
  const queueReconcile = (sessionId: string): Promise<void> => enqueueContext(sessionId, () => reconcileContext(sessionId))

  const setContext = (sessionId: string, patch: Parameters<WorkbenchStore['update']>[1]) => enqueueContext(sessionId, async () => {
    ensureSubscription(sessionId)
    if (patch.targetFile === undefined) return store.update(sessionId, patch)
    if (documentService === undefined) throw new Error('结构化文档服务不可用。')
    const before = await store.get(sessionId)
    const oldTarget = before.targetFile
    const target = patch.targetFile === null || patch.targetFile === '' ? null : await store.resolveTarget(sessionId, patch.targetFile)
    contextTransitions.add(sessionId)
    try {
      const bound = target === null
        ? (await documentService.unbindCurrentFile(sessionId), true)
        : await documentService.bindCurrentFile(sessionId, target)
      if (!bound) throw new Error(`无法绑定整理目标:${target}`)
      await store.update(sessionId, { ...patch, targetFile: target })
    } catch (error) {
      const recovered = oldTarget === null
        ? documentService.unbindCurrentFile(sessionId).then(() => true, () => false)
        : documentService.bindCurrentFile(sessionId, oldTarget)
      if (!await recovered) {
        await documentService.unbindCurrentFile(sessionId).catch(() => undefined)
        await store.mutateRuntime(sessionId, current => { current.targetBinding = 'error'; current.document = null })
      }
      contextTransitions.delete(sessionId)
      await syncDocument(sessionId).catch(() => undefined)
      throw error
    }
    contextTransitions.delete(sessionId)
    await syncDocument(sessionId)
    if (target !== null && viewService !== undefined) await viewService.dispatch(sessionId, { name: 'open_tab' }).catch(() => undefined)
    return store.get(sessionId)
  })

  const toolsDisposer = registerWorkbenchTools(ctx, { store, setContext, openMeeting: async (sessionId, folder) => {
    const state = await store.openMeeting(sessionId, folder)
    await queueReconcile(sessionId)
    return state
  } })
  const removeService = ctx.provide('discussionWorkbench', {
    id: 'dsh-discussion-workbench' as const,
    getContext: (sessionId: string) => store.get(sessionId),
    setContext: async (sessionId: string, patch: Parameters<WorkbenchStore['update']>[1]) => {
      return setContext(sessionId, patch)
    },
    readMaterial: (sessionId: string, materialId: string, offset = 0, maxChars = 12000) => store.readMaterial(sessionId, materialId, offset, maxChars),
  })
  const removeTelemetry = (ctx as unknown as { on(name: 'session/event', listener: (session: { id: string }, event: { type: string, time: number, data: Record<string, unknown> }) => void): () => void }).on('session/event', (session, event) => {
    const sessionId = String(session.id)
    if (event.type === 'turn/start') {
      const turn = Number(event.data.turn)
      turnTimings.set(sessionId, { turn, startedAt: event.time, toolSteps: new Set(), firstTextRecorded: false })
      void store.mutateRuntime(sessionId, state => { state.metrics = { turn, modelToolRounds: 0 } })
      return
    }
    const timing = turnTimings.get(sessionId)
    if (timing === undefined) return
    if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk as { type?: unknown, text?: unknown } | undefined
      if (!timing.firstTextRecorded && chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text !== '') {
        timing.firstTextRecorded = true
        void store.mutateRuntime(sessionId, state => { state.metrics.firstModelTextMs = Math.max(0, event.time - timing.startedAt) })
      }
      return
    }
    if (event.type === 'tool/call') {
      const step = Number(event.data.step)
      timing.toolSteps.add(step)
      void store.mutateRuntime(sessionId, state => { state.metrics.modelToolRounds = timing.toolSteps.size })
      const name = String(event.data.name ?? '')
      if (['create_document', 'replace_document', 'apply_document_patch'].includes(name)) {
        const callId = String(event.data.callId ?? '')
        if (callId !== '') documentCalls.set(`${sessionId}:${callId}`, name)
        void store.mutateRuntime(sessionId, state => { state.task = { phase: 'saving', label: name === 'create_document' ? '正在创建并保存文档' : name === 'replace_document' ? '正在整理并保存整篇文档' : '正在提交批量修改', startedAt: Date.now() } })
      }
      return
    }
    if (event.type === 'tool/result') {
      const resultBlock = (event.data.message as { content?: Array<{ toolCallId?: unknown, isError?: boolean, content?: Array<{ type?: unknown, text?: unknown }> }> } | undefined)?.content?.[0]
      const callId = String(resultBlock?.toolCallId ?? '')
      const key = `${sessionId}:${callId}`
      if (!documentCalls.has(key)) return
      documentCalls.delete(key)
      const rendered = resultBlock?.content?.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => String(block.text)).join('\n') ?? ''
      if (event.data.error !== undefined || resultBlock?.isError === true || (rendered !== '' && !rendered.startsWith('[OK]'))) {
        void store.mutateRuntime(sessionId, state => { state.task = { phase: 'failed', label: '文档提交失败，请查看工具结果', finishedAt: Date.now() } })
      }
    }
  })
  const contextDisposer = ctx.systemPrompt.context({
    name: 'discussion-workbench:context', order: 130,
    text: context => {
      const id = context.agent?.session?.id
      if (typeof id !== 'string' || id === '') return ''
      const state = store.peek(id)
      if (state === undefined) return ''
      // 未使用工作台的会话不注入任何工作台文本（F009）；注入条件只跟随使用痕迹，不跟随 dock。
      if (!isWorkbenchUsed(state)) return ''
      const materialList = state.materials.map(item => `${item.id}:${item.label}`).join('、') || '无'
      const lines = [
        '[讨论工作台上下文]',
        `场景:${state.scene === 'meeting' ? '会议整理' : '项目更新'}`,
        `固定整理目标:${state.targetFile ?? '未设置'}`,
        `目标版本:${state.document?.revision ?? '未绑定'}`,
        `当前节点:${state.document?.selectedNodeTitle ?? '无'}${state.document?.selectedNodeId ? `(${state.document.selectedNodeId})` : ''}`,
        `参考材料:${materialList}`,
        '普通讨论不要写文档；明确整理或修改时先锁定以上目标与版本。',
      ]
      if (state.scene === 'project') {
        lines.push(
          '项目更新规则:保留用户没有要求改变的节点及其 ID;负责人、日期、进度与结论缺失依据时写「待确认」,不编造;状态仅用 未开始/进行中/已完成/已取消/有风险/阻塞/暂停;修改主文档业务数据后提醒同步 Excel 视图(uv run python scripts/pm_doc_bridge.py to-excel)。',
        )
      }
      return lines.join('\n')
    },
  })

  let disposed = false
  let skillDisposer: (() => void) | undefined
  void readFile(new URL('../skills/discussion-workbench/SKILL.md', import.meta.url), 'utf8').then(raw => {
    if (disposed) return
    const body = raw.replace(/^---[\s\S]*?---\s*/, '')
    skillDisposer = ctx.skills.register({
      name: 'discussion-workbench', description: '会议整理与项目更新的统一讨论工作台。',
      whenToUse: '用户要讨论、整理会议纪要、维护项目计划或管理参考材料时。', content: body,
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled',
    })
  }).catch(error => ctx.logger?.warn?.(`[discussion-workbench] Skill 加载失败:${String(error)}`))

  const wss = new WebSocketServer({ noServer: true })
  const removeUpgrade = ctx.webServer.registerUpgrade({ path: BRIDGE_PATH, handler: (request, socket, head) => {
    const duplex = socket as unknown as Duplex
    if (!trustedRequest(request, ctx.webRuntime.trustedHosts)) { duplex.destroy(); return }
    const sessionId = new URL(request.url ?? '', 'http://localhost').searchParams.get('sessionId')
    if (sessionId === null || sessionId === '') { duplex.destroy(); return }
    wss.handleUpgrade(request as IncomingMessage, duplex, head, ws => attach(ws, sessionId))
  } })

  function attach(ws: WebSocket, sessionId: string): void {
    const detach = bridge.attach(sessionId, ws)
    void store.mutateRuntime(sessionId, state => { state.connected = true }).then(() => queueReconcile(sessionId)).catch(error => bridge.error(sessionId, String(error)))
    ws.on('message', data => {
      let message: ClientMessage
      try { message = JSON.parse(data.toString()) as ClientMessage } catch { return }
      if (message.type === 'hello') { void queueReconcile(sessionId).catch(error => bridge.error(sessionId, String(error))); return }
      if (message.type === 'set-context') {
        if (message.requestId === undefined) {
          void setContext(sessionId, message).catch(error => bridge.error(sessionId, error instanceof Error ? error.message : String(error)))
          return
        }
        const key = `${sessionId}:${message.requestId}`
        const known = contextRequestResults.get(key)
        if (known !== undefined) { bridge.result(sessionId, message.requestId, known.ok, known.message); return }
        let task = contextRequestTasks.get(key)
        if (task === undefined) {
          task = setContext(sessionId, message).then(
            () => ({ ok: true, message: '工作台上下文已更新。' }),
            error => ({ ok: false, message: error instanceof Error ? error.message : String(error) }),
          )
          contextRequestTasks.set(key, task)
          void task.then(result => { contextRequestTasks.delete(key); contextRequestResults.set(key, result) })
        }
        void task.then(result => bridge.result(sessionId, message.requestId!, result.ok, result.message))
        return
      }
      if (message.type === 'undo') {
        if (documentService === undefined) { bridge.error(sessionId, '结构化文档服务不可用。'); return }
        void store.mutateRuntime(sessionId, state => { state.task = { phase: 'saving', label: '正在撤销文档修改', startedAt: Date.now() } })
          .then(() => documentService.undo(sessionId)).catch(async error => {
            await store.mutateRuntime(sessionId, state => { state.task = { phase: 'failed', label: `撤销失败:${error instanceof Error ? error.message : String(error)}`, finishedAt: Date.now() } })
            bridge.error(sessionId, String(error))
          })
        return
      }
      if (message.type === 'set-view') {
        if (viewService === undefined) { bridge.error(sessionId, '结构化文档视图服务不可用。'); return }
        void viewService.dispatch(sessionId, { name: 'set_view', view: message.view }).catch(error => bridge.error(sessionId, String(error)))
      }
      if (message.type === 'edit-node') {
        if (documentService === undefined) { bridge.error(sessionId, '结构化文档服务不可用。'); return }
        const target = store.peek(sessionId)?.targetFile
        if (target === null || target === undefined) { bridge.error(sessionId, '没有可编辑的整理目标。'); return }
        void documentService.updateNode(sessionId, { nodeId: message.nodeId, title: message.title, content: message.content, expectedFile: target, expectedRevision: message.expectedRevision })
          .then(() => message.requestId !== undefined && bridge.result(sessionId, message.requestId, true, '节点已保存。'))
          .catch(error => message.requestId !== undefined ? bridge.result(sessionId, message.requestId, false, error instanceof Error ? error.message : String(error)) : bridge.error(sessionId, String(error)))
        return
      }
      if (message.type === 'read-source') {
        void (async () => {
          try {
            const state = await store.get(sessionId)
            const material = state.materials.find(item => item.id === message.materialId)
            if (material === undefined) throw new Error('未找到原文材料。')
            const full = await store.readMaterial(sessionId, material.id, 0, 20_000)
            const query = message.query?.trim()
            const content = query === undefined || query === '' ? full.content : locateSource(full.content, query)
            bridge.source(sessionId, message.requestId, { ok: true, label: material.label, content })
          } catch (error) { bridge.source(sessionId, message.requestId, { ok: false, message: error instanceof Error ? error.message : String(error) }) }
        })()
        return
      }
      if (message.type === 'meeting-action') {
        const run = async (): Promise<string> => {
          switch (message.action) {
            case 'open-meeting':
              if (message.folder === undefined || message.folder === '') throw new Error('请选择会议文件夹。')
              await store.openMeeting(sessionId, message.folder); await queueReconcile(sessionId); return '会议已打开。'
            case 'select-record': await store.updateMeeting(sessionId, { activeDocument: 'record' }); await queueReconcile(sessionId); return '已切换到会议记录。'
            case 'select-minutes': await store.updateMeeting(sessionId, { activeDocument: 'minutes' }); await queueReconcile(sessionId); return '已切换到会议纪要。'
            case 'toggle-reference': {
              const current = (await store.get(sessionId)).meeting
              if (current === null) throw new Error('请先打开会议文件夹。')
              await store.updateMeeting(sessionId, { referencePanelOpen: !current.referencePanelOpen }); return current.referencePanelOpen ? '已收起原文对照。' : '已打开原文对照。'
            }
            case 'save-info': await store.updateMeeting(sessionId, { info: message.info }); return '会议信息已保存。'
            case 'import-docx': {
              if (message.docxPath === undefined || message.docxPath === '') throw new Error('请选择 DOCX 文件。')
              const result = await store.importDocx(sessionId, message.docxPath)
              return result.converted ? `已转换并添加材料：${result.material.label}` : `已复用并添加材料：${result.material.label}`
            }
            case 'export-pdf': return exportMinutesPdf(sessionId, store, message.overwrite === true)
          }
        }
        void run().then(value => {
          if (message.requestId !== undefined) bridge.result(sessionId, message.requestId, true, value)
        }, error => {
          const value = error instanceof Error ? error.message : String(error)
          if (message.requestId !== undefined) bridge.result(sessionId, message.requestId, false, value)
          else bridge.error(sessionId, value)
        })
      }
    })
    ws.on('close', () => { detach(); dockVisibility.release(sessionId); void store.mutateRuntime(sessionId, state => { state.connected = false }) })
    ws.on('error', () => detach())
  }

  ctx.effect(() => () => {
    disposed = true
    toolsDisposer(); contextDisposer(); skillDisposer?.(); removeUpgrade(); removeService(); removeTelemetry()
    for (const unsubscribe of subscriptions.values()) unsubscribe()
    for (const unsubscribe of sidebarSubscriptions.values()) unsubscribe()
    for (const unsubscribe of viewSubscriptions.values()) unsubscribe()
    subscriptions.clear(); sidebarSubscriptions.clear(); viewSubscriptions.clear(); pendingViewRefresh.clear(); turnTimings.clear(); documentCalls.clear(); contextQueues.clear(); contextTransitions.clear(); contextRequestResults.clear(); contextRequestTasks.clear(); bridge.close(); wss.close()
  }, 'dsh-discussion-workbench: teardown')
}

export default apply

async function exportMinutesPdf(sessionId: string, store: WorkbenchStore, overwrite: boolean): Promise<string> {
  const state = await store.get(sessionId)
  const meeting = state.meeting
  if (meeting === null || meeting.minutesFile === null) throw new Error('请先生成并保存会议纪要。')
  const markdown = await readFile(meeting.minutesFile, 'utf8')
  const title = meeting.info.topic || basename(meeting.minutesFile, '.md').replace(/会议纪要$/, '') || '会议纪要'
  const date = meeting.info.date || new Date().toISOString().slice(0, 10)
  const stem = `${date}_${title}`.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
  let output = join(meeting.folder, `${stem}.pdf`)
  if (!overwrite) {
    let index = 2
    while (await stat(output).then(() => true, () => false)) output = join(meeting.folder, `${stem}_${index++}.pdf`)
  }
  const htmlPath = join(meeting.folder, `.meeting-preview-${process.pid}.html`)
  await writeFile(htmlPath, renderPdfHtml(title, markdown), 'utf8')
  const browser = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']
  let executable: string | undefined
  for (const candidate of browser) if (await stat(candidate).then(() => true, () => false)) { executable = candidate; break }
  if (executable === undefined) throw new Error('未找到 Microsoft Edge，无法导出 PDF。')
  try {
    await execFileAsync(executable, ['--headless=new', '--disable-gpu', `--print-to-pdf=${output}`, `file:///${htmlPath.replace(/\\/g, '/')}`], { windowsHide: true, timeout: 60_000 })
  } finally {
    await import('node:fs/promises').then(fs => fs.unlink(htmlPath)).catch(() => undefined)
  }
  await store.updateMeeting(sessionId, { pdf: { path: output, revision: state.document?.revision ?? 0 } })
  return `PDF 已导出：${output}`
}

function renderPdfHtml(title: string, markdown: string): string {
  const escaped = markdown.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const body = escaped.split(/\r?\n/).map(line => {
    if (/^# /.test(line)) return `<h1>${line.slice(2)}</h1>`
    if (/^## /.test(line)) return `<h2>${line.slice(3)}</h2>`
    if (/^### /.test(line)) return `<h3>${line.slice(4)}</h3>`
    if (/^[-*] /.test(line)) return `<p class="item">${line.slice(2)}</p>`
    if (line.trim() === '') return ''
    return `<p>${line}</p>`
  }).join('\n')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title><style>@page{size:A4;margin:22mm 22mm 20mm}body{font-family:SimSun,"宋体",serif;font-size:12pt;line-height:1.5;color:#111}h1{font-family:SimHei,"黑体",sans-serif;font-size:22pt;text-align:center;margin:0 0 18pt}h2{font-family:SimHei,"黑体",sans-serif;font-size:16pt;margin:18pt 0 9pt}h3{font-family:SimHei,"黑体",sans-serif;font-size:13pt;margin:12pt 0 6pt}p{margin:0 0 6pt;white-space:pre-wrap}.item{padding-left:2em;text-indent:-1em}</style></head><body>${body}</body></html>`
}

function locateSource(content: string, query: string): string {
  const position = content.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
  if (position < 0) return `未在已读取的原文中找到“${query}”。\n\n${content}`
  return content.slice(Math.max(0, position - 800), Math.min(content.length, position + query.length + 1_800))
}
