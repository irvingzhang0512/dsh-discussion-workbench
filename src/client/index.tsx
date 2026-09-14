import { useEffect, useMemo, useState } from 'react'
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
declare global { interface Window { __DSH_DISCUSSION_WORKBENCH__?: { getTarget(sessionId: string): string | null } } }

export function apply(ctx: ClientContext): void {
  window.__DSH_DISCUSSION_WORKBENCH__ = { getTarget: sessionId => targets.get(sessionId) ?? null }
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
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteLabel, setPasteLabel] = useState('粘贴材料')
  const [pasteContent, setPasteContent] = useState('')
  const socket = useMemo(() => ({ current: null as WebSocket | null }), [id])

  useEffect(() => {
    if (id === '') return
    let stopped = false
    let retry: number | undefined
    const connect = (): void => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${location.host}/discussion-workbench/ws?sessionId=${encodeURIComponent(id)}`)
      socket.current = ws
      ws.onopen = () => ws.send(JSON.stringify({ type: 'hello' }))
      ws.onmessage = event => {
        try {
          const message = JSON.parse(String(event.data)) as { type: string, state?: WorkbenchState, message?: string }
          if (message.type === 'state' && message.state !== undefined) {
            const previous = targets.get(id)
            targets.set(id, message.state.targetFile)
            setState(message.state); setTarget(message.state.targetFile ?? ''); setError('')
            if (previous !== message.state.targetFile) window.dispatchEvent(new Event('dsh-workbench:target'))
          } else if (message.type === 'error') setError(message.message ?? '工作台操作失败')
        } catch { setError('工作台返回了无法解析的状态。') }
      }
      ws.onclose = () => { if (!stopped) retry = window.setTimeout(connect, 1000) }
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
  const sceneLabel = state?.scene === 'project' ? '项目更新' : '会议整理'
  const selected = state?.document?.selectedNodeTitle || '无'
  const status = state?.task.phase === 'idle' ? '' : state?.task.label
  return (
    <div className="dwb-shell">
      <button className="dwb-summary" type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
        <span className={`dwb-dot ${state?.connected ? 'is-online' : ''}`} />
        <span>场景：{sceneLabel}</span><span className="dwb-sep">｜</span>
        <span>参考材料：{state?.materials.length ?? 0}</span><span className="dwb-sep">｜</span>
        <span className="dwb-ellipsis">整理目标：{shortName(state?.targetFile) || '未设置'}</span><span className="dwb-sep">｜</span>
        <span className="dwb-ellipsis">当前节点：{selected}</span>
        <span className="dwb-caret">{expanded ? '收起' : '展开'}</span>
      </button>
      {status && <div className={`dwb-task is-${state?.task.phase}`}>{status}</div>}
      {error && <div className="dwb-error">{error}</div>}
      {expanded && <div className="dwb-panel">
        <div className="dwb-row">
          <label>场景</label>
          <select value={state?.scene ?? 'meeting'} onChange={event => send({ type: 'set-context', scene: event.target.value as WorkbenchScene })}>
            <option value="meeting">会议整理</option><option value="project">项目更新</option>
          </select>
          <span className="dwb-meta">{state?.document ? `版本 ${state.document.revision} · ${state.document.dirty ? '未保存' : '已保存'}` : '文档未绑定'}</span>
        </div>
        <div className="dwb-row">
          <label>浏览状态</label>
          <span className="dwb-meta">{state?.browser ? `${state.browser.connected ? '已连接' : '已断线'} · ${shortName(state.browser.currentFile) || '未选择文件'}` : '侧边栏尚未连接'}</span>
          <span className="dwb-spacer" />
          <label>视图</label>
          {(['markdown', 'mindmap', 'table'] as const).map(view => <button className={state?.view?.currentView === view ? 'is-active' : ''} type="button" key={view} onClick={() => send({ type: 'set-view', view })}>{view === 'markdown' ? 'Markdown' : view === 'mindmap' ? '思维导图' : '表格'}</button>)}
        </div>
        <div className="dwb-row">
          <label>整理目标</label><input value={target} onChange={event => setTarget(event.target.value)} placeholder="工作区内的 .md 文件" />
          <button type="button" onClick={() => send({ type: 'set-context', targetFile: target })}>固定目标</button>
          {state?.targetFile && <button type="button" onClick={() => send({ type: 'set-context', targetFile: null })}>解除</button>}
        </div>
        <div className="dwb-row">
          <label>参考材料</label><input value={materialPath} onChange={event => setMaterialPath(event.target.value)} placeholder=".md 或 .txt 路径" />
          <button type="button" onClick={() => { send({ type: 'set-context', addPath: materialPath }); setMaterialPath('') }}>添加文件</button>
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
          <button type="button" disabled={!state.document?.undoDepth} onClick={() => send({ type: 'undo' })}>撤销整次修改</button>
        </div>}
        {state && <div className="dwb-metrics">耗时：首段模型文本 {metric(state.metrics.firstModelTextMs)} · 材料读取 {metric(state.metrics.materialReadMs)} · 工具轮次 {state.metrics.modelToolRounds} · 文档提交 {metric(state.metrics.documentCommitMs)} · 视图刷新 {metric(state.metrics.viewRefreshMs)}</div>}
        <div className="dwb-hints">可以说：{state?.targetFile ? state.scene === 'project' ? '“把刚才确认的变化更新进去” · “用表格只看任务”' : '“把刚才讨论整理成纪要” · “用表格只看待办”' : '“把这份材料整理成会议纪要” · “把项目计划设为整理目标”'}</div>
      </div>}
    </div>
  )
}

function shortName(path: string | null | undefined): string { return path?.split(/[\\/]/).at(-1) ?? '' }
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
`
  document.head.appendChild(style)
}
