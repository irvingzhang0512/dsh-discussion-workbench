import { useEffect, useMemo, useRef, useState } from 'react'
import type { WorkbenchScene, WorkbenchState } from '../shared/types.ts'

export const inject = ['slots']

interface ClientContext {
  slots: {
    inject(name: string, register: () => (() => void)): void
    register(definition: { name: string, id: string, order: number, label: () => string }, component: (props: DockProps) => React.ReactElement | null): () => void
  }
  effect(fn: () => (() => void), label?: string): void
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
  const socket = useMemo(() => ({ current: null as WebSocket | null }), [id])

  useEffect(() => {
    if (id === '') return
    setState(null); setConnected(false); setError(''); setNotice(''); setPending(null)
    pendingRef.current = null; uncertainRef.current = false; targetDirtyRef.current = false
    let stopped = false
    let retry: number | undefined
    const connect = (): void => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${location.host}/discussion-workbench/ws?sessionId=${encodeURIComponent(id)}`)
      socket.current = ws
      ws.onopen = () => { setConnected(true); ws.send(JSON.stringify({ type: 'hello' })) }
      ws.onmessage = event => {
        if (stopped || socket.current !== ws) return
        try {
          const message = JSON.parse(String(event.data)) as { type: string, state?: WorkbenchState, message?: string }
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
  const status = state?.task.phase === 'idle' ? '' : state?.task.label
  return (
    <div className="dwb-shell">
      <button className="dwb-summary" type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
        <span className={`dwb-dot ${connected ? 'is-online' : ''}`} />
        <span>场景：{sceneLabel}</span><span className="dwb-sep">｜</span>
        <span>参考材料：{state?.materials.length ?? 0}</span><span className="dwb-sep">｜</span>
        <span className="dwb-ellipsis">整理目标：{shortName(state?.targetFile) || '未设置'}</span><span className="dwb-sep">｜</span>
        <span className="dwb-ellipsis">当前节点：{selected}</span>
        <span className="dwb-caret">{expanded ? '收起' : '展开'}</span>
      </button>
      {status && <div className={`dwb-task is-${state?.task.phase}`}>{status}</div>}
      {error && <div className="dwb-error">{error}</div>}
      {pending && <div className="dwb-task is-saving">{pending.label}</div>}
      {notice && <div className="dwb-notice">{notice}</div>}
      {expanded && <div className="dwb-panel">
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
          <label>参考材料</label><input value={materialPath} onChange={event => setMaterialPath(event.target.value)} placeholder=".md 或 .txt 路径" />
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
  const materialAllowed = targetAllowed || extension === '.txt'
  const isTarget = samePath(candidate, state?.targetFile)
  const isMaterial = state?.materials.some(item => samePath(item.path, candidate)) ?? false
  const baseDisabled = !connected || browser?.connected !== true || candidate === null || pending
  const reason = !connected ? '工作台已断线' : browser?.connected !== true ? '侧边栏未连接' : !hasContract ? '请升级侧边栏控制器；仍可使用下方路径输入' : candidate === null ? '请先打开或激活一个文件' : ''
  const formatReason = candidate !== null && !materialAllowed ? '该文件类型不能设为目标或材料' : candidate !== null && !targetAllowed ? 'TXT 只能添加为参考材料' : ''
  return <div className="dwb-file-candidate" title={candidate ?? reason}>
    <span className="dwb-meta"><strong>{source}：</strong>{candidate === null ? (reason || '未选择文件') : displayPath(candidate, browser?.workspaceRoot)}</span>
    <button type="button" disabled={baseDisabled || !targetAllowed || isTarget} title={reason || (!targetAllowed ? '整理目标仅支持 Markdown' : '')} onClick={() => submit({ targetFile: candidate }, '正在设置整理目标…')}>{isTarget ? '当前目标' : '设为整理目标'}</button>
    <button type="button" disabled={baseDisabled || !materialAllowed || isMaterial} title={reason || (!materialAllowed ? '参考材料支持 Markdown 和 TXT' : '')} onClick={() => submit({ addPath: candidate }, '正在添加参考材料…')}>{isMaterial ? '已添加' : '添加为参考材料'}</button>
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
.dwb-shell{font-size:12px;border:1px solid rgba(128,128,128,.24);border-radius:10px;background:var(--background,#fff);color:inherit;overflow:hidden;margin-bottom:6px}
.dwb-summary{display:flex;width:100%;gap:4px;align-items:center;border:0;background:transparent;color:inherit;padding:7px 10px;text-align:left;cursor:pointer}.dwb-dot{width:7px;height:7px;border-radius:50%;background:#aaa;flex:none}.dwb-dot.is-online{background:#35a45b}.dwb-sep,.dwb-meta{opacity:.5}.dwb-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dwb-caret{margin-left:auto;opacity:.55}.dwb-panel{display:grid;gap:7px;padding:9px 10px;border-top:1px solid rgba(128,128,128,.2)}.dwb-row{display:flex;gap:6px;align-items:center}.dwb-row label{width:58px;opacity:.7}.dwb-row input{min-width:100px;flex:1}.dwb-row input,.dwb-row select,.dwb-paste input,.dwb-paste textarea{border:1px solid rgba(128,128,128,.35);border-radius:5px;background:transparent;color:inherit;padding:5px}.dwb-row button,.dwb-paste button,.dwb-change button{border:1px solid rgba(128,128,128,.35);border-radius:5px;background:transparent;color:inherit;padding:4px 8px;cursor:pointer}.dwb-row button.is-active{border-color:#4f6ef7;background:rgba(79,110,247,.12)}.dwb-spacer{flex:1}.dwb-paste{display:grid;grid-template-columns:150px 1fr auto;gap:6px}.dwb-paste textarea{min-height:54px;resize:vertical}.dwb-materials{display:flex;gap:5px;flex-wrap:wrap}.dwb-chip{background:rgba(79,110,247,.1);padding:3px 7px;border-radius:10px}.dwb-chip button{border:0;background:transparent;color:inherit;cursor:pointer;margin-left:4px}.dwb-task{padding:5px 10px;background:rgba(79,110,247,.09);border-top:1px solid rgba(128,128,128,.14)}.dwb-task.is-failed,.dwb-error{padding:5px 10px;background:rgba(220,50,50,.1);color:#b52828}.dwb-change{display:grid;grid-template-columns:1fr auto;gap:3px 8px;padding:7px;border:1px solid rgba(53,164,91,.25);border-radius:7px;background:rgba(53,164,91,.06)}.dwb-change div:nth-child(2){grid-column:1}.dwb-change button{grid-column:2;grid-row:1/3}.dwb-metrics,.dwb-hints{opacity:.65;border-top:1px solid rgba(128,128,128,.15);padding-top:6px}
.dwb-file-candidate{display:flex;align-items:center;gap:6px;min-width:0;flex:1}.dwb-file-candidate .dwb-meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.8}.dwb-file-candidate button{white-space:nowrap;border:1px solid rgba(128,128,128,.35);border-radius:5px;background:transparent;color:inherit;padding:4px 8px;cursor:pointer}.dwb-file-reason{font-size:11px;opacity:.62;white-space:nowrap}.dwb-row button:disabled,.dwb-file-candidate button:disabled{cursor:not-allowed;opacity:.45}.dwb-notice{padding:5px 10px;background:rgba(53,164,91,.08);color:#287a43}@media(max-width:680px){.dwb-file-candidate{flex-wrap:wrap}.dwb-file-candidate .dwb-meta{flex-basis:100%}}
`
  document.head.appendChild(style)
}
