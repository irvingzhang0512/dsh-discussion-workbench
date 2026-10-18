import { useEffect, useMemo, useRef, useState } from 'react'
import type { WorkbenchScene, WorkbenchState } from '../shared/types.ts'
import { SETTINGS_NAMESPACE } from '../shared/settings.ts'
import { hostWebSocketUrl } from './host-websocket.ts'

export const inject = ['slots']

/**
 * 插件版本号：由构建期 `define` 注入（读本包 `package.json` 的 `version`，见 tsdown.config.ts）。
 *
 * 取自构建时读入的 `package.json` 的 `version`，因此不会随包版本漂移；客户端 bundle 里
 * 只剩一个字符串字面量，运行时不读文件、不引入 Node 内建、也不违反纯度门禁。未注入时
 * （例如直接跑未打包的源码）回退为 `'0.0.0-dev'`，只影响显示，不影响任何行为。
 * 做法与 `dsh-structured-document` 一致。
 */
declare const __DWB_VERSION__: string | undefined

/** 卡片头部显示的版本号。 */
const PLUGIN_VERSION: string = typeof __DWB_VERSION__ === 'string' && __DWB_VERSION__ !== ''
  ? __DWB_VERSION__
  : '0.0.0-dev'

interface SlotDefinition {
  name: string
  id?: string
  /** keyed slot（如 settings.plugin.item）的键；设置页按 namespace 派发卡片。 */
  key?: string
  order?: number
  label?: () => string
}

/** 绑定后的设置 scope 快照；形状见 docs/architecture.md 的「设置页卡片」。 */
interface SettingsSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  value?: { dock?: unknown }
  base?: { dock?: unknown }
  user?: { dock?: unknown }
  revision?: number
  writable?: boolean
  mode?: string
}

type SettingsOperation = { op: 'set', path: string[], value: unknown } | { op: 'unset', path: string[] }

interface BoundSettingsScope {
  getSnapshot(): SettingsSnapshot
  subscribe(listener: () => void): () => void
  /** 单操作写入以 revision 作栅栏；`set`／`unset` 是它的单操作形式，不能带栅栏。 */
  mutate(operations: SettingsOperation[], expectedRevision?: number): Promise<unknown>
}

interface ClientContext {
  slots: {
    inject(name: string, register: () => (() => void)): void
    register(definition: SlotDefinition, component: (props: DockProps) => React.ReactElement | null): () => void
  }
  effect(fn: () => (() => void), label?: string): void
  /** settingsScope 是软依赖：不写进 exports.inject，缺失时只少一张设置卡。 */
  inject(deps: string[], callback: (ctx: ClientContext) => void): void
  settingsScope?: { bind(spec: { namespace: string }): BoundSettingsScope }
}

interface DockProps { sessionId?: string }

const targets = new Map<string, string | null>()
declare global { interface Window { __DSH_DISCUSSION_WORKBENCH__?: { getTarget(sessionId: string): string | null, ownsDocumentBinding: true } } }

export function apply(ctx: ClientContext): void {
  window.__DSH_DISCUSSION_WORKBENCH__ = { getTarget: sessionId => targets.get(sessionId) ?? null, ownsDocumentBinding: true }
  injectStyle()
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    { name: 'conversation.input.dock', id: 'dsh-discussion-workbench', order: -20, label: () => '讨论工作台' },
    props => <WorkbenchBar sessionId={props.sessionId} />,
  ))
  // 设置卡是可选 UI：settingsScope 缺失时不注册，摘要栏与工作台其他功能照常（F010）。
  ctx.inject(['settingsScope'], sctx => {
    const settingsScope = sctx.settingsScope
    if (settingsScope === undefined) return
    const bound = settingsScope.bind({ namespace: SETTINGS_NAMESPACE })
    ctx.slots.inject('settings.plugin.item', () => ctx.slots.register(
      { name: 'settings.plugin.item', key: SETTINGS_NAMESPACE, order: 100 },
      () => <DockSettingsCard scope={bound} />,
    ))
  })
  ctx.effect(() => () => {
    delete window.__DSH_DISCUSSION_WORKBENCH__
    targets.clear()
  }, 'dsh-discussion-workbench: client')
}

function WorkbenchBar({ sessionId }: DockProps): React.ReactElement | null {
  const id = String(sessionId ?? '')
  const [state, setState] = useState<WorkbenchState | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [target, setTarget] = useState('')
  const [materialPath, setMaterialPath] = useState('')
  const [connected, setConnected] = useState(false)
  const [pending, setPending] = useState<{ id: string, label: string, clearMaterial?: boolean } | null>(null)
  const [notice, setNotice] = useState('')
  const targetDirtyRef = useRef(false)
  const pendingRef = useRef<{ id: string, label: string, clearMaterial?: boolean } | null>(null)
  const uncertainRef = useRef(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteLabel, setPasteLabel] = useState('粘贴材料')
  const [pasteContent, setPasteContent] = useState('')
  const [meetingFolder, setMeetingFolder] = useState('')
  const [docxPath, setDocxPath] = useState('')
  const [sourceQuery, setSourceQuery] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const socket = useMemo(() => ({ current: null as WebSocket | null }), [id])

  useEffect(() => {
    if (id === '') return
    setState(null); setConnected(false); setError(''); setNotice(''); setPending(null)
    pendingRef.current = null; uncertainRef.current = false; targetDirtyRef.current = false
    let stopped = false
    let retry: number | undefined
    const connect = (): void => {
      let ws: WebSocket
      try { ws = new WebSocket(hostWebSocketUrl('/discussion-workbench/ws', id)) }
      catch { setError('宿主连接地址尚未就绪。'); if (!stopped) retry = window.setTimeout(connect, 1000); return }
      socket.current = ws
      ws.onopen = () => { setConnected(true); ws.send(JSON.stringify({ type: 'hello' })) }
      ws.onmessage = event => {
        if (stopped || socket.current !== ws) return
        try {
          const message = JSON.parse(String(event.data)) as { type: string, state?: WorkbenchState, message?: string, requestId?: string, ok?: boolean, label?: string, content?: string }
          if (message.type === 'state' && message.state !== undefined) {
            const previous = targets.get(id)
            targets.set(id, message.state.targetFile)
            setState(message.state)
            if (uncertainRef.current) {
              uncertainRef.current = false; pendingRef.current = null; setPending(null)
              setNotice('连接已恢复，请根据当前目标和材料状态核实上次操作结果。')
            }
            if (!targetDirtyRef.current) setTarget(message.state.targetFile ?? '')
            if (previous !== message.state.targetFile) window.dispatchEvent(new Event('dsh-workbench:target'))
          } else if (message.type === 'operation-result') {
            const result = message as { requestId?: string, ok?: boolean, message?: string }
            if (pendingRef.current?.id !== result.requestId) return
            const completed = pendingRef.current
            pendingRef.current = null
            uncertainRef.current = false
            setPending(null)
            if (result.ok) {
              setNotice(result.message ?? '操作已完成。'); setError(''); targetDirtyRef.current = false
              if (completed?.clearMaterial) setMaterialPath('')
            }
            else setError(result.message ?? '工作台操作失败')
          } else if (message.type === 'error') setError(message.message ?? '工作台操作失败')
          else if (message.type === 'source-content') {
            if (message.ok) { setSourceText(`${message.label ?? '原文'}\n\n${message.content ?? ''}`); setError('') }
            else setError(message.message ?? '读取原文失败')
          }
        } catch { setError('工作台返回了无法解析的状态。') }
      }
      ws.onclose = () => {
        setConnected(false)
        setPending(value => {
          if (value === null) return null
          uncertainRef.current = true
          const uncertain = { ...value, label: `${value.label}（结果待核实）` }
          pendingRef.current = uncertain
          return uncertain
        })
        if (!stopped) retry = window.setTimeout(connect, 1000)
      }
      ws.onerror = () => ws.close()
    }
    connect()
    return () => { stopped = true; if (retry !== undefined) clearTimeout(retry); socket.current?.close(); targets.delete(id) }
  }, [id, socket])

  if (id === '') return null
  // 宿主按配置与使用痕迹下发显示判定（F009）：未判定为显示时不渲染，也不占用输入区。
  if (state?.dock !== true) return null
  const send = (message: object): void => {
    if (socket.current?.readyState !== WebSocket.OPEN) { setError('工作台尚未连接。'); return }
    socket.current.send(JSON.stringify(message))
  }
  const submitContext = (message: object, label: string, clearMaterial = false): void => {
    if (pending !== null) return
    if (socket.current?.readyState !== WebSocket.OPEN) { setError('工作台尚未连接。'); return }
    const requestId = globalThis.crypto.randomUUID()
    const operation = { id: requestId, label, ...(clearMaterial ? { clearMaterial: true } : {}) }
    pendingRef.current = operation; setPending(operation); setNotice(''); setError('')
    socket.current.send(JSON.stringify({ ...message, type: 'set-context', requestId }))
  }
  const sceneLabel = state?.scene === 'project' ? '项目更新' : '会议整理'
  const selected = state?.document?.selectedNodeTitle || '无'
  const targetName = shortName(state?.targetFile) || '未设置'
  const panelId = `dwb-panel-${id}`
  const status = state?.task.phase === 'idle' ? '' : state?.task.label
  return (
    <div className="dwb-shell">
      <button className="dwb-summary" type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls={expanded ? panelId : undefined}>
        <span className="dwb-scene" title={`场景：${sceneLabel} · ${connected ? '工作台已连接' : '工作台未连接'}`}>
          <span className={`dwb-dot ${connected ? 'is-online' : ''}`} aria-hidden="true" />
          <span className="dwb-scene-label">场景</span>
          <span className="dwb-scene-name">{sceneLabel}</span>
        </span>
        <span className="dwb-summary-details">
          <span className="dwb-summary-item dwb-summary-materials">
            <span className="dwb-summary-label">参考材料</span>
            <span className="dwb-count">{state?.materials.length ?? 0}</span>
          </span>
          <span className="dwb-summary-item" title={state?.targetFile ?? '尚未设置整理目标'}>
            <span className="dwb-summary-label">整理目标</span>
            <span className={`dwb-summary-value ${state?.targetFile ? '' : 'is-empty'}`}>{targetName}</span>
          </span>
          <span className="dwb-summary-item" title={state?.document?.selectedNodeTitle || '尚未选择节点'}>
            <span className="dwb-summary-label">当前节点</span>
            <span className={`dwb-summary-value ${state?.document?.selectedNodeTitle ? '' : 'is-empty'}`}>{selected}</span>
          </span>
        </span>
        <span className="dwb-caret">
          <span>{expanded ? '收起' : '展开'}</span>
          <svg className="dwb-chevron" viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      </button>
      {status && <div className={`dwb-task is-${state?.task.phase}`}>{status}</div>}
      {error && <div className="dwb-error">{error}</div>}
      {pending && <div className="dwb-task is-saving">{pending.label}</div>}
      {notice && <div className="dwb-notice">{notice}</div>}
      {expanded && <div className="dwb-panel" id={panelId}>
        <div className="dwb-meeting">
          <label>会议文件夹</label><input value={meetingFolder} onChange={event => setMeetingFolder(event.target.value)} placeholder="工作区内的会议文件夹" />
          <button type="button" disabled={!connected || pending !== null} onClick={() => submitMeeting(send, 'open-meeting', { folder: meetingFolder }, '正在打开会议…')}>打开会议</button>
          {state?.meeting && <><button className={state.meeting.activeDocument === 'record' ? 'is-active' : ''} type="button" onClick={() => submitMeeting(send, 'select-record', {}, '正在切换会议记录…')}>会议记录</button><button className={state.meeting.activeDocument === 'minutes' ? 'is-active' : ''} type="button" disabled={state.meeting.minutesFile === null} onClick={() => submitMeeting(send, 'select-minutes', {}, '正在切换会议纪要…')}>会议纪要</button><button type="button" onClick={() => submitMeeting(send, 'toggle-reference', {}, '正在切换原文对照…')}>{state.meeting.referencePanelOpen ? '收起原文' : '查看原文'}</button></>}
        </div>
        {state?.meeting && <MeetingPanel state={state} send={send} docxPath={docxPath} setDocxPath={setDocxPath} sourceQuery={sourceQuery} setSourceQuery={setSourceQuery} sourceText={sourceText} />}
        {state?.document?.selectedNodeId && <div className="dwb-node-editor">
          {!editorOpen ? <button type="button" onClick={() => { setEditTitle(state.document!.selectedNodeTitle ?? ''); setEditContent(state.document!.selectedNodeContent ?? ''); setEditorOpen(true) }}>编辑当前节点</button> : <><input value={editTitle} onChange={event => setEditTitle(event.target.value)} aria-label="节点标题" /><textarea value={editContent} onChange={event => setEditContent(event.target.value)} aria-label="节点正文" /><button type="button" onClick={() => { send({ type: 'edit-node', requestId: globalThis.crypto.randomUUID(), nodeId: state.document!.selectedNodeId, title: editTitle, content: editContent, expectedRevision: state.document!.revision }); setEditorOpen(false) }}>保存当前节点</button><button type="button" onClick={() => setEditorOpen(false)}>取消</button></>}
        </div>}
        <div className="dwb-row">
          <label>场景</label>
          <select value={state?.scene ?? 'meeting'} onChange={event => send({ type: 'set-context', scene: event.target.value as WorkbenchScene })}>
            <option value="meeting">会议整理</option><option value="project">项目更新</option>
          </select>
          <span className="dwb-meta">{state?.targetBinding === 'error' ? '目标绑定异常，文档写入已禁用' : state?.document ? `版本 ${state.document.revision} · ${state.document.dirty ? '未保存' : '已保存'}` : state?.targetFile && state?.view?.connected === false ? '目标已设置，视图待连接' : '文档未绑定'}</span>
        </div>
        <div className="dwb-row">
          <label>浏览状态</label>
          <FileCandidate state={state} connected={connected} pending={pending !== null} submit={submitContext} />
          <span className="dwb-spacer" />
          <label>视图</label>
          {(['markdown', 'mindmap', 'table'] as const).map(view => <button className={state?.view?.currentView === view ? 'is-active' : ''} type="button" key={view} onClick={() => send({ type: 'set-view', view })}>{view === 'markdown' ? 'Markdown' : view === 'mindmap' ? '思维导图' : '表格'}</button>)}
        </div>
        <div className="dwb-row">
          <label>整理目标</label><input value={target} onChange={event => { setTarget(event.target.value); targetDirtyRef.current = true }} placeholder="工作区内的 .md 文件" />
          <button type="button" disabled={pending !== null || !connected} onClick={() => submitContext({ targetFile: target }, '正在设置整理目标…')}>固定目标</button>
          {state?.targetFile && <button type="button" disabled={pending !== null || !connected} onClick={() => submitContext({ targetFile: null }, '正在解除整理目标…')}>解除</button>}
        </div>
        <div className="dwb-row">
          <label>参考材料</label><input value={materialPath} onChange={event => setMaterialPath(event.target.value)} placeholder=".md / .txt / .json 路径" />
          <button type="button" disabled={pending !== null || !connected} onClick={() => submitContext({ addPath: materialPath }, '正在添加参考材料…', true)}>添加文件</button>
          <button type="button" onClick={() => setPasteOpen(value => !value)}>粘贴文字</button>
        </div>
        {pasteOpen && <div className="dwb-paste">
          <input value={pasteLabel} onChange={event => setPasteLabel(event.target.value)} aria-label="材料名称" />
          <textarea value={pasteContent} onChange={event => setPasteContent(event.target.value)} placeholder="粘贴转写文本或初步纪要" />
          <button type="button" disabled={!pasteContent.trim()} onClick={() => { send({ type: 'set-context', paste: { label: pasteLabel, content: pasteContent } }); setPasteContent(''); setPasteOpen(false) }}>保存为材料</button>
        </div>}
        {(state?.materials.length ?? 0) > 0 && <div className="dwb-materials">{state?.materials.map(material => <span className="dwb-chip" key={material.id} title={material.path}>{material.label}<button type="button" aria-label={`移除 ${material.label}`} onClick={() => send({ type: 'set-context', removeMaterialId: material.id })}>×</button></span>)}</div>}
        {state?.lastChange && <div className="dwb-change">
          <div><strong>最近改动</strong> · 版本 {state.lastChange.revision}</div>
          <div>{changeText(state.lastChange)}</div>
          <button type="button" disabled={state.targetBinding !== 'bound' || !state.document?.undoDepth} onClick={() => send({ type: 'undo' })}>撤销整次修改</button>
        </div>}
        {state && <div className="dwb-metrics">耗时：首段模型文本 {metric(state.metrics.firstModelTextMs)} · 材料读取 {metric(state.metrics.materialReadMs)} · 工具轮次 {state.metrics.modelToolRounds} · 文档提交 {metric(state.metrics.documentCommitMs)} · 视图刷新 {metric(state.metrics.viewRefreshMs)}</div>}
        <div className="dwb-hints">可以说：{state?.targetFile ? state.scene === 'project' ? '“把刚才确认的变化更新进去” · “用表格只看任务”' : '“把刚才讨论整理成纪要” · “用表格只看待办”' : '“把这份材料整理成会议纪要” · “把项目计划设为整理目标”'}</div>
      </div>}
    </div>
  )
}

const DOCK_VALUES = ['always', 'auto', 'off'] as const
type DockValue = typeof DOCK_VALUES[number]

/** 分段控件的显示顺序与中文标签；默认高亮「按需」（F011）。 */
const DOCK_SEGMENTS: ReadonlyArray<{ value: DockValue, label: string }> = [
  { value: 'auto', label: '按需' },
  { value: 'always', label: '始终' },
  { value: 'off', label: '不显示' },
]

const DOCK_HINTS: Record<DockValue, string> = {
  always: '任何会话都显示摘要栏；未使用工作台的会话仍不注入模型上下文。',
  auto: '只有已使用工作台（已有固定整理目标、参考材料或已打开会议）的会话显示摘要栏。',
  off: '任何会话都不显示摘要栏；工具、技能与模型上下文不受影响。',
}

function isDockValue(value: unknown): value is DockValue {
  return typeof value === 'string' && (DOCK_VALUES as readonly string[]).includes(value)
}

/** 当前生效值；namespace 尚未就绪或取值异常时按 schema 默认 `auto`。 */
function effectiveDock(snapshot: SettingsSnapshot): DockValue {
  return isDockValue(snapshot.value?.dock) ? snapshot.value.dock : 'auto'
}

/** 字段出现在 `user` 层即视为用户覆盖，即使取值与组装层相同。 */
function dockOverridden(snapshot: SettingsSnapshot): boolean {
  return snapshot.user !== undefined && snapshot.user !== null && Object.prototype.hasOwnProperty.call(snapshot.user, 'dock')
}

/**
 * 设置页「插件 → 插件配置」的 `dock` 卡片（F010 语义 + F011 外观）。
 *
 * 配置语义仍是 F010 的草稿 + 保存：写入按 revision 栅栏走 `mutate`，清除该字段回退组装层。
 * 外观按宿主 `PluginCard` 的语法自绘（客户端纯度门禁禁止 import 它的值，因此逐类对齐而不是复用）：
 * 可折叠头部（名称 + 版本 + 副标题 + 覆盖徽标 + chevron）、带分隔线的设置行、行内右对齐的分段控件、
 * 右下角操作行。收起只隐藏主体，组件保持挂载，未保存草稿不因收起丢失。
 * namespace 未对本客户端服务时渲染为空，而不是渲染一张无法操作的卡。
 */
function DockSettingsCard({ scope }: { scope: BoundSettingsScope }): React.ReactElement | null {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>(() => scope.getSnapshot())
  const [draft, setDraft] = useState<DockValue>(() => effectiveDock(scope.getSnapshot()))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  // 展开是卡片的本地阅读状态：收起不卸载组件，因此草稿与栅栏都留在 state 里。
  const [open, setOpen] = useState(false)
  const dirtyRef = useRef(false)
  // 开始草拟时读取的 revision 作为固定栅栏：过期保存被拒绝，而不是覆盖并发修改。
  const fence = useRef<number | undefined>(scope.getSnapshot().revision)
  const bodyId = `dwb-dock-settings-body-${SETTINGS_NAMESPACE}`

  useEffect(() => {
    const sync = (): void => {
      const next = scope.getSnapshot()
      setSnapshot(next)
      if (!dirtyRef.current) { setDraft(effectiveDock(next)); fence.current = next.revision }
    }
    const stop = scope.subscribe(sync)
    sync()
    return stop
  }, [scope])

  if (snapshot.status === 'unavailable') return null
  if (snapshot.status !== 'ready') return <section className="dwb-card"><p className="dwb-card-hint">正在读取插件设置…</p></section>

  const covered = dockOverridden(snapshot)
  const readonly = snapshot.writable === false
  const commit = (operations: SettingsOperation[], message: string): void => {
    setBusy(true); setError(''); setNotice('')
    void scope.mutate(operations, fence.current).then(() => {
      dirtyRef.current = false
      setDirty(false)
      const next = scope.getSnapshot()
      fence.current = next.revision
      setSnapshot(next); setDraft(effectiveDock(next))
      setNotice(message)
    }, (cause: unknown) => {
      setError(`保存失败：${cause instanceof Error ? cause.message : String(cause)}`)
    }).finally(() => setBusy(false))
  }
  const inherit = isDockValue(snapshot.base?.dock) ? snapshot.base.dock : 'auto'
  return <section className={`dwb-card ${open ? 'is-open' : ''}`}>
    <button
      className="dwb-card-header"
      type="button"
      aria-expanded={open}
      aria-controls={bodyId}
      onClick={() => setOpen(value => !value)}
    >
      <span className="dwb-card-head-text">
        <span className="dwb-card-name">Irving · 办公讨论工作台<span className="dwb-card-version">v{PLUGIN_VERSION}</span></span>
        <span className="dwb-card-subtitle">摘要栏显示策略</span>
      </span>
      <span className={`dwb-card-badge ${covered ? 'is-override' : ''}`}>{covered ? '用户覆盖' : '继承组装层'}</span>
      <svg className="dwb-card-chevron" viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    <div className="dwb-card-body" id={bodyId} hidden={!open}>
      <div className="dwb-card-field">
        <div className="dwb-card-field-text">
          <span className="dwb-card-field-label">摘要栏显示策略</span>
          <span className="dwb-card-field-desc">{DOCK_HINTS[draft]}</span>
        </div>
        <div className="dwb-segmented" role="group" aria-label="摘要栏显示策略">
          {DOCK_SEGMENTS.map(segment => <button
            key={segment.value}
            type="button"
            className={`dwb-segment ${draft === segment.value ? 'is-active' : ''}`}
            aria-pressed={draft === segment.value}
            disabled={busy || readonly}
            onClick={() => {
              dirtyRef.current = true; setDirty(true); setDraft(segment.value); setNotice(''); setError('')
            }}
          >{segment.label}</button>)}
        </div>
      </div>
      <p className="dwb-card-meta">当前生效：{effectiveDock(snapshot)}（{covered ? `覆盖组装层 ${inherit}` : `组装层 ${inherit}`}）。这里保存即时生效；组装层 <code>cordis.patch.yml</code> 的改动仍需重载插件。</p>
      {!readonly && dirty && <p className="dwb-card-hint">有未保存的修改。</p>}
      {notice && <p className="dwb-card-notice" role="status">{notice}</p>}
      {error && <p className="dwb-card-error" role="status">{error}</p>}
      <div className="dwb-card-footer">
        <button
          className="dwb-card-button"
          type="button"
          disabled={busy || readonly || !covered}
          onClick={() => commit([{ op: 'unset', path: ['dock'] }], '已清除用户覆盖，回退到组装层配置。')}
        >恢复组装层</button>
        <button
          className="dwb-card-button is-primary"
          type="button"
          disabled={busy || readonly || !dirty}
          onClick={() => commit([{ op: 'set', path: ['dock'], value: draft }], '已保存，摘要栏策略立即生效（不需要重载插件）。')}
        >保存</button>
      </div>
    </div>
  </section>
}

function submitMeeting(send: (message: object) => void, action: 'open-meeting' | 'select-record' | 'select-minutes' | 'toggle-reference' | 'save-info' | 'import-docx' | 'export-pdf', fields: object, _label: string): void {
  send({ type: 'meeting-action', requestId: globalThis.crypto.randomUUID(), action, ...fields })
}

function MeetingPanel({ state, send, docxPath, setDocxPath, sourceQuery, setSourceQuery, sourceText }: { state: WorkbenchState, send: (message: object) => void, docxPath: string, setDocxPath: (value: string) => void, sourceQuery: string, setSourceQuery: (value: string) => void, sourceText: string }): React.ReactElement {
  const meeting = state.meeting!
  const [info, setInfo] = useState(meeting.info)
  useEffect(() => setInfo(meeting.info), [meeting.info])
  const readSource = (): void => {
    const source = state.materials[0]
    if (source === undefined) return
    send({ type: 'read-source', requestId: globalThis.crypto.randomUUID(), materialId: source.id, query: sourceQuery })
  }
  return <>
    <div className="dwb-meeting-info"><label>主题</label><input value={info.topic} onChange={event => setInfo({ ...info, topic: event.target.value })} placeholder="会议主题" /><input value={info.date} onChange={event => setInfo({ ...info, date: event.target.value })} placeholder="日期 YYYY-MM-DD" /><input value={info.time} onChange={event => setInfo({ ...info, time: event.target.value })} placeholder="时间" /><input value={info.location} onChange={event => setInfo({ ...info, location: event.target.value })} placeholder="地点" /><input value={info.attendees} onChange={event => setInfo({ ...info, attendees: event.target.value })} placeholder="参会人" /><input value={info.recorder} onChange={event => setInfo({ ...info, recorder: event.target.value })} placeholder="记录人" /><button type="button" onClick={() => submitMeeting(send, 'save-info', { info }, '正在保存会议信息…')}>保存信息</button></div>
    <div className="dwb-row"><label>导入 DOCX</label><input value={docxPath} onChange={event => setDocxPath(event.target.value)} placeholder="会议文件夹内的 .docx" /><button type="button" onClick={() => submitMeeting(send, 'import-docx', { docxPath }, '正在导入 DOCX…')}>转换并添加</button><button type="button" disabled={meeting.minutesFile === null} onClick={() => submitMeeting(send, 'export-pdf', {}, '正在导出 PDF…')}>导出 PDF</button></div>
    {meeting.referencePanelOpen && <div className="dwb-source"><div><strong>原文对照</strong><input value={sourceQuery} onChange={event => setSourceQuery(event.target.value)} placeholder="输入关键词或时间戳" /><button type="button" disabled={state.materials.length === 0} onClick={readSource}>显示原文</button></div><pre>{sourceText || '选择参考材料后，可按关键词或时间戳查看原文。'}</pre></div>}
  </>
}

function shortName(path: string | null | undefined): string { return path?.split(/[\\/]/).at(-1) ?? '' }
function samePath(left: string | null | undefined, right: string | null | undefined): boolean {
  return typeof left === 'string' && typeof right === 'string' && left.replace(/\\/g, '/').toLowerCase() === right.replace(/\\/g, '/').toLowerCase()
}
function displayPath(path: string, root: string | null | undefined): string {
  if (root !== null && root !== undefined) {
    const normalizedPath = path.replace(/\\/g, '/')
    const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '')
    if (normalizedPath.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) return normalizedPath.slice(normalizedRoot.length + 1)
  }
  return path
}
function FileCandidate({ state, connected, pending, submit }: {
  state: WorkbenchState | null
  connected: boolean
  pending: boolean
  submit: (message: object, label: string) => void
}): React.ReactElement {
  const browser = state?.browser
  const hasContract = browser !== null && browser !== undefined && Object.prototype.hasOwnProperty.call(browser, 'fileCandidate')
  const candidate = hasContract ? browser?.fileCandidate ?? null : null
  const source = browser?.fileCandidateSource === 'recent' ? '最近浏览' : '当前浏览'
  const extension = candidate?.match(/\.[^.\\/]+$/)?.[0].toLowerCase() ?? ''
  const targetAllowed = extension === '.md' || extension === '.markdown'
  const materialAllowed = targetAllowed || extension === '.txt' || extension === '.json'
  const isTarget = samePath(candidate, state?.targetFile)
  const isMaterial = state?.materials.some(item => samePath(item.path, candidate)) ?? false
  const baseDisabled = !connected || browser?.connected !== true || candidate === null || pending
  const reason = !connected ? '工作台已断线' : browser?.connected !== true ? '侧边栏未连接' : !hasContract ? '请升级侧边栏控制器；仍可使用下方路径输入' : candidate === null ? '请先打开或激活一个文件' : ''
  const formatReason = candidate !== null && !materialAllowed ? '该文件类型不能设为目标或材料' : candidate !== null && !targetAllowed ? 'TXT/JSON 只能添加为参考材料' : ''
  return <div className="dwb-file-candidate" title={candidate ?? reason}>
    <span className="dwb-meta"><strong>{source}：</strong>{candidate === null ? (reason || '未选择文件') : displayPath(candidate, browser?.workspaceRoot)}</span>
    <button type="button" disabled={baseDisabled || !targetAllowed || isTarget} title={reason || (!targetAllowed ? '整理目标仅支持 Markdown' : '')} onClick={() => submit({ targetFile: candidate }, '正在设置整理目标…')}>{isTarget ? '当前目标' : '设为整理目标'}</button>
    <button type="button" disabled={baseDisabled || !materialAllowed || isMaterial} title={reason || (!materialAllowed ? '参考材料支持 Markdown、TXT 和 JSON' : '')} onClick={() => submit({ addPath: candidate }, '正在添加参考材料…')}>{isMaterial ? '已添加' : '添加为参考材料'}</button>
    {formatReason && <span className="dwb-file-reason">{formatReason}</span>}
  </div>
}
function metric(value: number | undefined): string { return value === undefined ? '—' : `${value} ms` }
function changeText(change: NonNullable<WorkbenchState['lastChange']>): string {
  if (change.action === 'undo') return '已恢复整次修改。'
  const counts = change.counts
  return counts === undefined ? `已完成 ${change.action}。` : `新增 ${counts.added} 个、修改 ${counts.updated} 个、删除 ${counts.deleted} 个节点。`
}

function injectStyle(): void {
  if (document.getElementById('dwb-style')) return
  const style = document.createElement('style'); style.id = 'dwb-style'; style.textContent = `
.dwb-shell{--dwb-text:var(--dsw-alias-label-primary,#242933);--dwb-muted:var(--dsw-alias-label-secondary,#697180);--dwb-faint:var(--dsw-alias-label-tertiary,#9098a5);--dwb-accent:var(--dsw-alias-brand-primary,#4f6ef7);--dwb-border:var(--dsw-alias-border-l2,#e9ebef)}
.dwb-shell{box-sizing:border-box;width:calc(100% - 2 * var(--dsh-composer-side-clearance,16px));max-width:var(--dsh-composer-card-max-width,720px);min-width:0;margin:0 auto;font-size:12px;line-height:1.5;font-family:inherit;border:1px solid var(--dwb-border);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dwb-text);overflow:hidden;container-type:inline-size;container-name:dwb}
.dwb-shell *{box-sizing:border-box}
.dwb-summary{display:grid;grid-template-columns:auto minmax(0,1fr) auto;width:100%;gap:14px;align-items:center;border:0;border-radius:11px;background:transparent;color:inherit;font:inherit;padding:9px 12px;text-align:left;cursor:pointer;transition:background-color .15s}
.dwb-summary:hover,.dwb-summary[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.06))}
.dwb-summary:focus-visible{outline:2px solid var(--dwb-accent);outline-offset:-2px}
.dwb-scene{display:inline-flex;gap:6px;align-items:center;min-width:0;padding:3px 8px;border-radius:7px;background:color-mix(in srgb,var(--dwb-accent) 9%,transparent);white-space:nowrap}
.dwb-scene-label{font-size:11px;color:var(--dwb-muted)}.dwb-scene-name{font-weight:600;color:var(--dwb-accent)}
.dwb-dot{width:6px;height:6px;border-radius:50%;background:var(--dwb-faint);flex:none}.dwb-dot.is-online{background:var(--dsw-alias-state-success-primary,#35a45b)}
.dwb-summary-details{display:flex;gap:12px;align-items:center;min-width:0}.dwb-summary-item{display:flex;gap:6px;align-items:center;min-width:0;flex:1}.dwb-summary-materials{flex:none}.dwb-summary-label{color:var(--dwb-muted);white-space:nowrap;flex:none}.dwb-summary-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}.dwb-summary-value.is-empty{color:var(--dwb-faint);font-weight:400}.dwb-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;padding:0 5px;border-radius:5px;background:var(--dsw-alias-bg-layer-2,#f2f4f7);color:var(--dwb-muted);font-size:11px;font-variant-numeric:tabular-nums;line-height:20px}
.dwb-caret{display:flex;gap:4px;align-items:center;color:var(--dwb-muted);white-space:nowrap;font-size:11px}.dwb-chevron{flex:none;transition:transform .15s}.dwb-summary[aria-expanded="true"] .dwb-chevron{transform:rotate(180deg)}
@container dwb (max-width:580px){.dwb-summary{grid-template-columns:minmax(0,1fr) auto;gap:8px 12px}.dwb-scene{justify-self:start}.dwb-caret{grid-column:2;grid-row:1}.dwb-summary-details{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.dwb-summary-item{gap:5px}.dwb-summary-item+.dwb-summary-item{border-left:1px solid var(--dwb-border);padding-left:12px}}
@container dwb (max-width:420px){.dwb-summary-item{align-items:flex-start;flex-direction:column;gap:2px}.dwb-summary-label{font-size:11px}.dwb-summary-value{max-width:100%}.dwb-count{line-height:18px}}
@media(prefers-reduced-motion:reduce){.dwb-summary,.dwb-chevron{transition:none}}
.dwb-meta{opacity:.5}.dwb-panel{display:grid;gap:7px;padding:9px 12px;border-top:1px solid var(--dwb-border)}.dwb-row{display:flex;gap:6px;align-items:center}.dwb-row label{width:58px;opacity:.7}.dwb-row input{min-width:100px;flex:1}.dwb-row input,.dwb-row select,.dwb-paste input,.dwb-paste textarea{border:1px solid rgba(128,128,128,.35);border-radius:5px;background:transparent;color:inherit;padding:5px}.dwb-row button,.dwb-paste button,.dwb-change button{border:1px solid rgba(128,128,128,.35);border-radius:5px;background:transparent;color:inherit;padding:4px 8px;cursor:pointer}.dwb-row button.is-active{border-color:#4f6ef7;background:rgba(79,110,247,.12)}.dwb-spacer{flex:1}.dwb-paste{display:grid;grid-template-columns:150px 1fr auto;gap:6px}.dwb-paste textarea{min-height:54px;resize:vertical}.dwb-materials{display:flex;gap:5px;flex-wrap:wrap}.dwb-chip{background:rgba(79,110,247,.1);padding:3px 7px;border-radius:10px}.dwb-chip button{border:0;background:transparent;color:inherit;cursor:pointer;margin-left:4px}.dwb-task{padding:5px 10px;background:rgba(79,110,247,.09);border-top:1px solid rgba(128,128,128,.14)}.dwb-task.is-failed,.dwb-error{padding:5px 10px;background:rgba(220,50,50,.1);color:#b52828}.dwb-change{display:grid;grid-template-columns:1fr auto;gap:3px 8px;padding:7px;border:1px solid rgba(53,164,91,.25);border-radius:7px;background:rgba(53,164,91,.06)}.dwb-change div:nth-child(2){grid-column:1}.dwb-change button{grid-column:2;grid-row:1/3}.dwb-metrics,.dwb-hints{opacity:.65;border-top:1px solid rgba(128,128,128,.15);padding-top:6px}
.dwb-file-candidate{display:flex;align-items:center;gap:6px;min-width:0;flex:1}.dwb-file-candidate .dwb-meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.8}.dwb-file-candidate button{white-space:nowrap;border:1px solid rgba(128,128,128,.35);border-radius:5px;background:transparent;color:inherit;padding:4px 8px;cursor:pointer}.dwb-file-reason{font-size:11px;opacity:.62;white-space:nowrap}.dwb-row button:disabled,.dwb-file-candidate button:disabled{cursor:not-allowed;opacity:.45}.dwb-notice{padding:5px 10px;background:rgba(53,164,91,.08);color:#287a43}@media(max-width:680px){.dwb-file-candidate{flex-wrap:wrap}.dwb-file-candidate .dwb-meta{flex-basis:100%}}
.dwb-meeting,.dwb-meeting-info{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:7px;border:1px solid rgba(79,110,247,.24);border-radius:7px}.dwb-meeting input{flex:1;min-width:180px}.dwb-meeting-info input{min-width:100px;flex:1}.dwb-meeting button,.dwb-meeting-info button,.dwb-source button{border:1px solid rgba(128,128,128,.35);border-radius:5px;background:transparent;color:inherit;padding:4px 8px;cursor:pointer}.dwb-meeting button.is-active{border-color:#4f6ef7;background:rgba(79,110,247,.12)}.dwb-source{border:1px solid rgba(128,128,128,.25);border-radius:7px;padding:7px}.dwb-source>div{display:flex;gap:6px;align-items:center}.dwb-source input{flex:1;min-width:120px}.dwb-source pre{max-height:260px;overflow:auto;white-space:pre-wrap;line-height:1.45;margin:7px 0 0;background:rgba(128,128,128,.06);padding:7px}
.dwb-node-editor{display:grid;grid-template-columns:1fr auto auto;gap:6px;border:1px solid rgba(53,164,91,.26);border-radius:7px;padding:7px}.dwb-node-editor input,.dwb-node-editor textarea{border:1px solid rgba(128,128,128,.35);border-radius:5px;background:transparent;color:inherit;padding:5px}.dwb-node-editor textarea{grid-column:1/-1;min-height:88px;resize:vertical}.dwb-node-editor button{border:1px solid rgba(128,128,128,.35);border-radius:5px;background:transparent;color:inherit;padding:4px 8px;cursor:pointer}
@container dwb (max-width:580px){.dwb-row{flex-wrap:wrap}.dwb-row label{flex:none}.dwb-row .dwb-spacer{display:none}.dwb-file-candidate{flex-basis:calc(100% - 70px);flex-wrap:wrap}.dwb-file-candidate .dwb-meta{flex-basis:100%}.dwb-file-reason{white-space:normal}.dwb-paste{grid-template-columns:minmax(0,1fr)}.dwb-paste input,.dwb-paste textarea{min-width:0;width:100%}.dwb-source>div{flex-wrap:wrap}.dwb-node-editor{grid-template-columns:minmax(0,1fr) auto}.dwb-node-editor input{grid-column:1/-1;min-width:0}}
.dwb-card{--dwb-card-text:var(--dsw-alias-label-primary,#242933);--dwb-card-muted:var(--dsw-alias-label-secondary,#697180);--dwb-card-faint:var(--dsw-alias-label-tertiary,#9098a5);--dwb-card-border:var(--dsw-alias-border-l2,#e9ebef);--dwb-card-strong:var(--dsw-alias-border-l4,#dcdfe5);--dwb-card-accent:var(--dsw-alias-brand-primary,#4f6ef7);display:flex;flex-direction:column;border:.5px solid var(--dwb-card-strong);border-radius:16px;background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dwb-card-text);list-style:none;transition:border-color .16s,background .16s}
.dwb-card *{box-sizing:border-box}
.dwb-card:hover{border-color:var(--dsw-alias-label-dimmed,rgba(128,128,128,.4))}
.dwb-card.is-open{background:var(--dsw-alias-bg-layer-2,#f7f8fa);border-color:var(--dsw-alias-label-dimmed,rgba(128,128,128,.4))}
.dwb-card-header{display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;border:0;border-radius:12px;background:0 0;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dwb-card-header:focus-visible{outline:2px solid var(--dwb-card-accent);outline-offset:-2px}
.dwb-card-head-text{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}
.dwb-card-name{display:flex;align-items:baseline;gap:6px;color:var(--dwb-card-text);font-size:15px;font-weight:600;line-height:1.4;min-width:0}
.dwb-card-version{color:var(--dwb-card-faint);font-size:12px;font-weight:400;white-space:nowrap}
.dwb-card-subtitle{color:var(--dwb-card-faint);font-size:13px;line-height:1.5}
.dwb-card-badge{flex:none;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#f2f4f7);color:var(--dwb-card-muted);font-size:11px;line-height:18px;white-space:nowrap}
.dwb-card-badge.is-override{background:color-mix(in srgb,var(--dwb-card-accent) 12%,transparent);color:var(--dwb-card-accent)}
.dwb-card-chevron{flex:none;color:var(--dwb-card-faint);transition:transform .16s}
.dwb-card-chevron.is-open,.dwb-card.is-open .dwb-card-chevron{transform:rotate(180deg)}
.dwb-card-body{display:flex;flex-direction:column;border-top:1px solid var(--dwb-card-border);margin:0 16px;padding-bottom:8px}
.dwb-card-body[hidden]{display:none}
.dwb-card-field{display:flex;align-items:center;gap:12px;padding:12px 0;min-width:0}
.dwb-card-field+.dwb-card-field{border-top:1px solid var(--dwb-card-border)}
.dwb-card-field-text{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}
.dwb-card-field-label{color:var(--dwb-card-text);font-size:13px;line-height:20px;font-weight:500}
.dwb-card-field-desc{color:var(--dwb-card-faint);font-size:12px;line-height:18px}
.dwb-segmented{display:inline-flex;flex:none;gap:0;padding:2px;border:1px solid var(--dwb-card-strong);border-radius:8px;background:transparent}
.dwb-segment{border:0;border-radius:6px;background:transparent;color:var(--dwb-card-muted);font:inherit;font-size:12px;line-height:18px;padding:3px 10px;cursor:pointer;white-space:nowrap}
.dwb-segment:hover:not(:disabled){color:var(--dwb-card-text)}
.dwb-segment.is-active{background:var(--dsw-alias-bg-layer-2,#f2f4f7);color:var(--dwb-card-text);font-weight:600}
.dwb-segment:focus-visible{outline:2px solid var(--dwb-card-accent);outline-offset:-2px}
.dwb-segment:disabled{cursor:not-allowed;opacity:.45}
.dwb-card-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;border-top:1px solid var(--dwb-card-border);padding:12px 0 4px;margin-top:12px}
.dwb-card-button{border:1px solid var(--dwb-card-border);border-radius:8px;background:0 0;color:var(--dwb-card-muted);font:inherit;font-size:13px;line-height:1.5;padding:5px 14px;cursor:pointer}
.dwb-card-button:hover:not(:disabled){color:var(--dwb-card-text);border-color:var(--dsw-alias-label-dimmed,rgba(128,128,128,.4))}
.dwb-card-button.is-primary{border-color:transparent;background:var(--dwb-card-text);color:var(--dsw-alias-bg-layer-3,#fff)}
.dwb-card-button:disabled{cursor:not-allowed;opacity:.4}
.dwb-card-button:focus-visible{outline:2px solid var(--dwb-card-accent);outline-offset:1px}
.dwb-card-hint,.dwb-card-meta{margin:0;color:var(--dwb-card-faint);font-size:12px;line-height:18px}
.dwb-card-hint{padding-top:6px}
.dwb-card-meta{color:var(--dwb-card-muted)}
.dwb-card-meta code{font-family:ui-monospace,Consolas,monospace}
.dwb-card-notice{margin:0;padding-top:6px;color:var(--dsw-alias-state-success-primary,#35a45b);font-size:12px;line-height:18px}
.dwb-card-error{margin:0;padding-top:6px;color:var(--dsw-alias-state-error-primary,#dc2626);font-size:12px;line-height:18px}
@container dwb (max-width:520px){.dwb-card-field{flex-wrap:wrap}.dwb-card-field-text{flex-basis:100%}.dwb-segmented{flex-wrap:wrap;max-width:100%}.dwb-card-header{flex-wrap:wrap;gap:8px 12px}.dwb-card-head-text{flex-basis:100%}}
@media(prefers-reduced-motion:reduce){.dwb-card,.dwb-card-chevron{transition:none}}
`
  document.head.appendChild(style)
}
