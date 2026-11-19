/**
 * 摘要栏显示策略（F009）协议冒烟：连接真实 DSH 宿主的讨论工作台桥，核对 dock 判定。
 *
 * 用法：node tests/smoke/dock-smoke.mjs <隔离宿主 URL> <样例工作区>
 *
 * 只用一次性会话 id，不打开浏览器、不调用模型、不读取或修改真实会话；会写入一条
 * 粘贴材料与会话状态（路径在结束时打印），结束时清理本次生成的粘贴材料。
 * 退出码 0 表示全部断言通过。
 */
import {realpath,readFile,unlink} from 'node:fs/promises'
import {relative,sep} from 'node:path'
import WebSocket from 'ws'

if (!process.argv[2] || !process.argv[3]) throw Error('请指定隔离宿主 URL 和样例工作区')
const workspace = await realpath(process.argv[3])
const base = process.argv[2].replace(/\/$/, '')
const origin = new URL(base).origin
const socketUrl = `${base.replace(/^http/, 'ws')}/discussion-workbench/ws`
const stamp = Date.now()
const failures = []
const created = []

function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failures.push(label)
}

function connect(sessionId) {
  const ws = new WebSocket(`${socketUrl}?sessionId=${encodeURIComponent(sessionId)}`, { origin })
  const states = []
  ws.on('message', data => { try { states.push(JSON.parse(String(data))) } catch { /* 忽略非 JSON 帧 */ } })
  const ready = new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  const wait = (predicate, timeout = 8000) => new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      const found = [...states].reverse().find(predicate)
      if (found !== undefined) { clearInterval(timer); resolve(found); return }
      if (Date.now() - started > timeout) { clearInterval(timer); reject(new Error(`等待超时，最近状态：${JSON.stringify(states.slice(-5))}`)) }
    }, 25)
  })
  return { ws, states, ready, wait }
}

const sessionA = `dwb-dock-smoke-a-${stamp}`
const sessionB = `dwb-dock-smoke-b-${stamp}`
const a = connect(sessionA)
const b = connect(sessionB)

try {
  await Promise.all([a.ready, b.ready])
  a.ws.send(JSON.stringify({ type: 'hello' }))
  b.ws.send(JSON.stringify({ type: 'hello' }))

  const firstA = await a.wait(message => message.type === 'state' && message.state.sessionId === sessionA)
  if (typeof firstA.state.dock !== 'boolean') {
    check('宿主已下发 dock 判定', false, '缺少 dock 字段：插件宿主半侧尚未重载（旧代码不发送该判定）')
    throw new Error('宿主未重载，冒烟无法继续')
  }
  check('宿主已下发 dock 判定', true)
  check('新会话默认不显示摘要栏', firstA.state.dock === false, `dock=${firstA.state.dock} 目标=${firstA.state.targetFile ?? 'null'} 材料=${firstA.state.materials.length}`)

  const firstB = await b.wait(message => message.type === 'state' && message.state.sessionId === sessionB)
  check('会话隔离：另一个新会话同样不显示', firstB.state.dock === false, `dock=${firstB.state.dock}`)

  a.ws.send(JSON.stringify({ type: 'set-context', paste: { label: '冒烟材料', content: `dock smoke ${stamp}` } }))
  const used = await a.wait(message => message.type === 'state' && message.state.materials.length > 0)
  check('添加参考材料（已使用工作台）后显示摘要栏', used.state.dock === true, `dock=${used.state.dock}`)
  const material = used.state.materials[0]
  if (material !== undefined) created.push(material.path)

  a.ws.send(JSON.stringify({ type: 'set-context', removeMaterialId: material.id }))
  const cleared = await a.wait(message => message.type === 'state' && message.state.materials.length === 0)
  check('痕迹清空后本次连接内仍保持显示', cleared.state.dock === true, `dock=${cleared.state.dock}`)

  const lastB = [...b.states].reverse().find(message => message.type === 'state')
  check('未使用的另一会话不受影响', lastB.state.dock === false, `dock=${lastB.state.dock}`)

  console.log(`\n摘要栏显示:${cleared.state.dock ? '显示（已激活）' : '隐藏'}；会话状态与粘贴材料路径：${created.join('、') || '无'}`)
} catch (error) {
  check('冒烟执行完成', false, error instanceof Error ? error.message : String(error))
} finally {
  a.ws.close()
  b.ws.close()
  for (const file of created) {
    const actual = await realpath(file)
    const parts = relative(workspace,actual).split(sep)
    if (parts.length === 4 && parts[0] === '.dsh-workbench' && parts[1] === 'materials' &&
        parts[2].startsWith(sessionA+'-') && await readFile(actual,'utf8') === `dock smoke ${stamp}`) await unlink(actual)
  }
}

console.log(failures.length === 0 ? '\n全部断言通过。' : `\n失败 ${failures.length} 项：${failures.join('；')}`)
process.exitCode = failures.length === 0 ? 0 : 1
