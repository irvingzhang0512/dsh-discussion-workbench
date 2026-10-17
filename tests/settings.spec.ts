import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { apply } from '../src/index.ts'
import { SETTINGS_NAMESPACE } from '../src/shared/settings.ts'
import type { HostMessage, WorkbenchState } from '../src/shared/types.ts'

type ApplyContext = Parameters<typeof apply>[0]
type ApplyConfig = Parameters<typeof apply>[1]
type FakeTool = { name: string, execute(args: Record<string, unknown>, exec: unknown): Promise<Record<string, unknown>> }
type SchemaFn = (value: unknown) => Record<string, unknown>

const roots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  while (servers.length > 0) servers.pop()!.closeAllConnections()
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true }).catch(() => undefined)
})

/**
 * 设置服务假实现：按真实 dsh-settings 的分层语义解析 namespace ——
 * schema 默认值 < 组装层 base < 用户层；注册时用 schema 校验 base（非法 base 拒绝注册），
 * 写入前校验候选解析值（非法取值不落盘），提交后按 `settings/updated` 语义通知观察者。
 */
class FakeSettings {
  registrations: Array<{ namespace: string, schema: unknown, base: Record<string, unknown>, applies: string | undefined }> = []
  user: Record<string, unknown> = {}
  revision = 1
  private watchers: Array<(next: unknown) => void> = []

  register = (
    namespace: string,
    schema: unknown,
    options?: { base?: Record<string, unknown>, applies?: 'live' | 'restart' },
  ): { get(): unknown, watch(callback: (next: unknown) => void): () => void } => {
    const base = options?.base ?? {}
    ;(schema as SchemaFn)(structuredClone(base))
    this.registrations.push({ namespace, schema, base, applies: options?.applies })
    return {
      get: (): unknown => this.resolve(this.user),
      watch: (callback: (next: unknown) => void): (() => void) => {
        this.watchers.push(callback)
        return () => { this.watchers = this.watchers.filter(item => item !== callback) }
      },
    }
  }

  /** 用户层写入；非法取值在落盘前被 schema 拒绝。 */
  set(field: string, value: unknown): void {
    const candidate = { ...this.user, [field]: value }
    this.resolve(candidate)
    this.user = candidate
    this.bump()
  }

  /** 清除用户覆盖，回退组装层 base 与 schema 默认值。 */
  unset(field: string): void {
    const candidate = { ...this.user }
    delete candidate[field]
    this.resolve(candidate)
    this.user = candidate
    this.bump()
  }

  private resolve(user: Record<string, unknown>): Record<string, unknown> {
    const registration = this.registrations[0]
    if (registration === undefined) throw new Error(`namespace 尚未注册:${SETTINGS_NAMESPACE}`)
    return (registration.schema as SchemaFn)({ ...registration.base, ...structuredClone(user) })
  }

  private bump(): void {
    this.revision += 1
    const next = this.resolve(this.user)
    for (const watcher of [...this.watchers]) watcher(next)
  }
}

/**
 * 假 ctx 宿主 + 真实 WebSocket 桥：settings 假实现驱动配置层，浏览器侧用真实 ws 客户端
 * 接收宿主下发的状态快照，用来断言快照里的 `dock` 判定是否跟随配置与使用痕迹。
 */
async function harness(options: { config?: unknown, withSettings?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dwb-settings-'))
  roots.push(root)
  const tools: FakeTool[] = []
  const warnings: string[] = []
  const disposers: Array<() => void> = []
  const clients: WebSocket[] = []
  const injected: string[][] = []
  const settings = options.withSettings === false ? undefined : new FakeSettings()
  let upgrade: ((request: IncomingMessage, socket: unknown, head: Buffer) => void) | undefined
  let contextText: ((context: { agent?: { session?: { id?: string } } }) => string) | undefined

  const structuredDocument = {
    bindCurrentFile: async () => true,
    unbindCurrentFile: async () => undefined,
    getDocumentSnapshot: () => null,
    subscribe: () => () => undefined,
  }

  const ctx = {
    sessions: { get: (id: string) => ({ header: { cwd: root, id } }) },
    get: (name: string) => (name === 'structuredDocument' ? structuredDocument : undefined),
    tools: { register: (tool: FakeTool) => { tools.push(tool); return () => undefined } },
    skills: { register: () => () => undefined },
    provide: () => () => undefined,
    on: () => () => undefined,
    systemPrompt: { context: (spec: { text: typeof contextText }) => { contextText = spec.text; return () => undefined } },
    webServer: { registerUpgrade: (spec: { handler: (request: IncomingMessage, socket: unknown, head: Buffer) => void }) => { upgrade = spec.handler; return () => undefined } },
    connection: { requestRejection: () => undefined },
    logger: { warn: (message: string) => { warnings.push(message) } },
    effect: (fn: () => (() => void)) => { const cleanup = fn(); disposers.push(cleanup); return cleanup },
    settings,
    // 与 cordis 的软依赖一致：settings 不存在时不执行回调，插件照常挂载。
    inject: (deps: string[], callback: (inner: unknown) => unknown) => {
      injected.push(deps)
      if (!deps.includes('settings')) return callback(ctx)
      return settings === undefined ? undefined : callback(ctx)
    },
  }

  apply(ctx as unknown as ApplyContext, options.config as ApplyConfig)
  await new Promise(resolve => setTimeout(resolve, 50))

  const server = createServer()
  server.on('upgrade', (request, socket, head) => { upgrade?.(request, socket as unknown as never, head) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port

  const stateMessages = (messages: HostMessage[]): WorkbenchState[] =>
    messages.flatMap(message => (message.type === 'state' ? [message.state] : []))

  const connect = async (sessionId: string) => {
    const messages: HostMessage[] = []
    const ws = new WebSocket(`ws://127.0.0.1:${port}/discussion-workbench/ws?sessionId=${encodeURIComponent(sessionId)}`)
    clients.push(ws)
    ws.on('message', data => { try { messages.push(JSON.parse(String(data)) as HostMessage) } catch { /* 忽略非 JSON 帧 */ } })
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
    const states = (): WorkbenchState[] => stateMessages(messages)
    const mark = (): number => states().length - 1
    const waitState = async (predicate: (state: WorkbenchState) => boolean, after = -1, timeoutMs = 5000): Promise<WorkbenchState> => {
      const started = Date.now()
      for (;;) {
        const found = states().slice(after + 1).find(predicate)
        if (found !== undefined) return found
        if (Date.now() - started > timeoutMs) throw new Error(`等待状态超时;最近状态:${JSON.stringify(states().slice(-3))}`)
        await new Promise(resolve => setTimeout(resolve, 15))
      }
    }
    return { ws, messages, states, mark, waitState }
  }

  return {
    root, tools, warnings, settings, injected, connect,
    tool: (name: string): FakeTool => {
      const found = tools.find(item => item.name === name)
      if (found === undefined) throw new Error(`未注册工具:${name}`)
      return found
    },
    exec: (sessionId: string) => ({ agent: { session: { id: sessionId } } }),
    text: (sessionId: string): string => contextText!({ agent: { session: { id: sessionId } } }),
    dispose: async () => {
      for (const client of clients) client.close()
      for (const cleanup of disposers) cleanup()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true }).catch(() => undefined)
    },
  }
}

describe('设置层注册（F010）', () => {
  it('注册 namespace：base 取组装层配置、applies 为 live、schema 只声明 dock', async () => {
    const host = await harness({ config: { dock: 'always' } })
    try {
      expect(host.tools).toHaveLength(6)
      expect(host.settings!.registrations).toHaveLength(1)
      const registration = host.settings!.registrations[0]!
      expect(registration.namespace).toBe(SETTINGS_NAMESPACE)
      expect(registration.applies).toBe('live')
      expect(registration.base).toEqual({ dock: 'always' })
      const schema = registration.schema as SchemaFn
      expect(schema({})).toEqual({ dock: 'auto' })
      expect(schema({ dock: 'off' })).toEqual({ dock: 'off' })
      expect(() => schema({ dock: 'sometimes' })).toThrow()
      expect(host.warnings).toEqual([])
    } finally { await host.dispose() }
  })

  it('组装层未配置 dock 时 base 为空分节，由 schema 默认值补齐 auto', async () => {
    const host = await harness({ config: {} })
    try {
      const registration = host.settings!.registrations[0]!
      expect(registration.base).toEqual({})
      expect((registration.schema as SchemaFn)({ ...registration.base })).toEqual({ dock: 'auto' })
    } finally { await host.dispose() }
  })

  it('组装层非法取值：仍挂载并告警，不把非法值写进 base 触发注册失败', async () => {
    const host = await harness({ config: { dock: 'sometimes' } })
    try {
      expect(host.tools).toHaveLength(6)
      expect(host.settings!.registrations).toHaveLength(1)
      expect(host.settings!.registrations[0]!.base).toEqual({})
      expect(host.warnings.some(message => message.includes('sometimes'))).toBe(true)
    } finally { await host.dispose() }
  })

  it('settings 服务缺失：仍把 settings 作为软依赖请求、照常挂载并使用组装层配置', async () => {
    const host = await harness({ config: { dock: 'always' }, withSettings: false })
    try {
      expect(host.tools).toHaveLength(6)
      expect(host.injected.some(deps => deps.includes('settings'))).toBe(true)
      expect(host.warnings).toEqual([])
      const client = await host.connect('s1')
      const state = await client.waitState(item => item.sessionId === 's1')
      expect(state.dock).toBe(true)
      // F009：未使用工作台的会话即使显示摘要栏也不注入空上下文块。
      expect(host.text('s1')).toBe('')
    } finally { await host.dispose() }
  })
})

describe('判定跟随设置层写入（F010）', () => {
  it('写入 off 后已使用会话的快照 dock 变为 false，不需要重载插件', async () => {
    const host = await harness({ config: {} })
    try {
      await writeFile(join(host.root, '纪要.md'), '# 纪要\n', 'utf8')
      const client = await host.connect('s1')
      expect((await client.waitState(state => state.sessionId === 's1')).dock).toBe(false)
      await host.tool('set_workbench_context').execute({ target_file: '纪要.md' }, host.exec('s1'))
      expect((await client.waitState(state => state.targetFile !== null)).dock).toBe(true)
      const mark = client.mark()
      host.settings!.set('dock', 'off')
      const hidden = await client.waitState(state => state.dock === false, mark)
      expect(hidden.dock).toBe(false)
      // 设置只改变显示判定，不改动会话痕迹。
      expect(hidden.targetFile).not.toBeNull()
    } finally { await host.dispose() }
  })

  it('写入 off 后未使用会话仍不显示，切回 auto 保持使用痕迹判定', async () => {
    const host = await harness({ config: {} })
    try {
      const client = await host.connect('s1')
      expect((await client.waitState(state => state.sessionId === 's1')).dock).toBe(false)
      let mark = client.mark()
      host.settings!.set('dock', 'off')
      expect((await client.waitState(state => state.sessionId === 's1', mark)).dock).toBe(false)
      mark = client.mark()
      host.settings!.unset('dock')
      expect((await client.waitState(state => state.sessionId === 's1', mark)).dock).toBe(false)
    } finally { await host.dispose() }
  })

  it('F009 语义不变：使用痕迹、会话内记忆与上下文注入都不因配置变化被清除', async () => {
    const host = await harness({ config: {} })
    try {
      const client = await host.connect('s1')
      expect((await client.waitState(state => state.sessionId === 's1')).dock).toBe(false)
      // 添加参考材料即已使用：摘要栏出现，且下一个模型步骤能看到上下文块。
      client.ws.send(JSON.stringify({ type: 'set-context', paste: { label: '设置用例材料', content: 'dock settings' } }))
      const used = await client.waitState(state => state.materials.length > 0)
      expect(used.dock).toBe(true)
      expect(host.text('s1')).toContain('[讨论工作台上下文]')
      // 清空痕迹后本次连接内仍保持显示（会话内记忆）。
      let mark = client.mark()
      client.ws.send(JSON.stringify({ type: 'set-context', removeMaterialId: used.materials[0]!.id }))
      const cleared = await client.waitState(state => state.materials.length === 0, mark)
      expect(cleared.dock).toBe(true)
      // 设置层 off：隐藏；清除覆盖回到 auto 时记忆仍在，不因配置变化被清除。
      mark = client.mark()
      host.settings!.set('dock', 'off')
      expect((await client.waitState(state => state.dock === false, mark)).dock).toBe(false)
      mark = client.mark()
      host.settings!.unset('dock')
      expect((await client.waitState(state => state.dock === true, mark)).dock).toBe(true)
    } finally { await host.dispose() }
  })
})
