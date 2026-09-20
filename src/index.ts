import { readFile } from 'node:fs/promises'
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

export const name = 'dsh-discussion-workbench'
export const inject = ['tools', 'skills', 'sessions', 'webServer', 'webRuntime', 'systemPrompt', 'structuredDocument', 'sidebarController', 'structuredDocumentView']
export const Config = z.object({})
export const BRIDGE_PATH = '/discussion-workbench/ws'

export function apply(ctx: Context): void {
  const bridge = new WorkbenchBridge()
  const cwd = (sessionId: string): string => ctx.sessions.get(sessionId)?.header?.cwd || process.cwd()
  const store = new WorkbenchStore({ cwd, onChange: (sessionId, state) => bridge.state(sessionId, state) })
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

  const findNodeTitle = (root: { id: string, title: string, children: typeof root[] }, id: string | null): string | null => {
    if (id === null) return null
    const stack = [root]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.id === id) return node.title
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
      state.document = snapshot === null ? null : {
        title: snapshot.document.title, revision: snapshot.document.revision,
        selectedNodeId: snapshot.selectedNodeId, selectedNodeTitle: findNodeTitle(snapshot.document.root, snapshot.selectedNodeId),
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

  const toolsDisposer = registerWorkbenchTools(ctx, { store, setContext })
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
    })
    ws.on('close', () => { detach(); void store.mutateRuntime(sessionId, state => { state.connected = false }) })
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
