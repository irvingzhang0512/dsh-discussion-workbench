import WebSocket from 'ws'
import { resolve } from 'node:path'

if (!process.argv[2] || !process.argv[3]) throw Error('用法：node tests/smoke/host-smoke.mjs <隔离宿主 URL> <样例工作区>')
const sessionId = 'dwb-host-smoke-' + Date.now()
const origin = new URL(process.argv[2]).origin
const target = resolve(process.argv[3], '固定目标.md')
const reference = resolve(process.argv[3], '参考材料.txt')
const messages = []

const open = path => new Promise((resolveOpen, reject) => {
  const ws = new WebSocket(`${origin.replace(/^http/, 'ws')}${path}?sessionId=${sessionId}`, { origin })
  ws.once('open', () => resolveOpen(ws))
  ws.once('error', reject)
})
const waitFor = (predicate, timeout = 8000) => new Promise((resolveWait, reject) => {
  const started = Date.now()
  const timer = setInterval(() => {
    const found = [...messages].reverse().find(predicate)
    if (found) { clearInterval(timer); resolveWait(found); return }
    if (Date.now() - started > timeout) { clearInterval(timer); reject(new Error(`Timed out waiting for host state. Messages: ${JSON.stringify(messages.slice(-8))}`)) }
  }, 25)
})

const workbench = await open('/discussion-workbench/ws')
const sidebar = await open('/sidebar-controller/ws')
const view = await open('/structured-document-view/ws')
workbench.on('message', data => messages.push(JSON.parse(String(data))))
view.on('message', data => {
  const message = JSON.parse(String(data))
  if (message.type === 'command') {
    if (message.command.name === 'set_view') {
      view.send(JSON.stringify({ type: 'state', state: viewState(message.command.view) }))
    }
    view.send(JSON.stringify({ type: 'command-result', result: { id: message.id, ok: true, code: 'OK', message: 'smoke ack' } }))
  }
})

workbench.send(JSON.stringify({ type: 'hello' }))
sidebar.send(JSON.stringify({ type: 'hello', sessionId }))
sidebar.send(JSON.stringify({ type: 'state', state: {
  sessionId, sidebarVisible: true, currentFile: reference, previousFile: null,
  openedFiles: [reference], expandedFolders: [], updatedAt: Date.now(),
} }))
view.send(JSON.stringify({ type: 'hello', sessionId }))
view.send(JSON.stringify({ type: 'state', state: viewState('markdown') }))
workbench.send(JSON.stringify({ type: 'set-context', scene: 'meeting', targetFile: target, addPath: reference }))

const bound = await waitFor(message => message.type === 'state' && message.state.targetFile === target && message.state.document?.title === '固定目标' && message.state.browser?.currentFile === reference && message.state.view?.currentView === 'markdown')
workbench.send(JSON.stringify({ type: 'set-view', view: 'mindmap' }))
const switched = await waitFor(message => message.type === 'state' && message.state.view?.currentView === 'mindmap')
workbench.send(JSON.stringify({ type: 'set-context', targetFile: null }))
const unpinned = await waitFor(message => message.type === 'state' && message.state.targetFile === null && message.state.document === null && message.state.browser?.currentFile === reference)

console.log(JSON.stringify({
  targetStayedPinned: switched.state.targetFile === target,
  browsingFile: switched.state.browser.currentFile,
  documentTitle: bound.state.document.title,
  documentRevision: bound.state.document.revision,
  view: switched.state.view.currentView,
  materialCount: switched.state.materials.length,
  connected: switched.state.connected,
  unpinShowsEmpty: unpinned.state.document === null,
}, null, 2))

workbench.close(); sidebar.close(); view.close()

function viewState(currentView) {
  return {
    sessionId, currentView, expandedNodeIds: [], collapsedNodeIds: [], depth: null,
    zoom: 1, pan: { x: 0, y: 0 }, layout: 'right', filter: null,
    outline: [], updatedAt: Date.now(),
  }
}
