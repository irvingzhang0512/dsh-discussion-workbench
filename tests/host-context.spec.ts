import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.ts'

type ApplyContext = Parameters<typeof apply>[0]
type ApplyConfig = Parameters<typeof apply>[1]
type FakeTool = { name: string, execute(args: Record<string, unknown>, exec: unknown): Promise<Record<string, unknown>> }

const roots: string[] = []

afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true }).catch(() => undefined)
})

/**
 * 假 ctx 宿主:只提供 apply 需要的服务面,用于验证配置解析与上下文注入条件,
 * 不启动 WebSocket、不写运行配置、不调用模型。
 */
async function harness(config?: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'dwb-host-'))
  roots.push(root)
  const tools: FakeTool[] = []
  const warnings: string[] = []
  const disposers: Array<() => void> = []
  const injected: string[][] = []
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
    webServer: { registerUpgrade: () => () => undefined },
    connection: { requestRejection: () => undefined },
    logger: { warn: (message: string) => { warnings.push(message) } },
    effect: (fn: () => (() => void)) => { const cleanup = fn(); disposers.push(cleanup); return cleanup },
    // settings 是软依赖：本 harness 不提供 settings 服务，回调不发生（等同设置服务缺失）。
    inject: (deps: string[], callback: (inner: unknown) => unknown) => {
      injected.push(deps)
      if (!deps.includes('settings')) return callback(ctx)
    },
  }

  apply(ctx as unknown as ApplyContext, config as ApplyConfig)
  // 让 skill 的异步读取落地,避免它的加载失败混进配置告警。
  await new Promise(resolve => setTimeout(resolve, 50))
  const text = (sessionId: string): string => contextText!({ agent: { session: { id: sessionId } } })
  const tool = (name: string): FakeTool => {
    const found = tools.find(item => item.name === name)
    if (found === undefined) throw new Error(`未注册工具:${name}`)
    return found
  }
  const exec = (sessionId: string) => ({ agent: { session: { id: sessionId } } })
  return { root, tools, warnings, injected, text, tool, exec, dispose: () => { for (const cleanup of disposers) cleanup() } }
}

describe('宿主配置与上下文注入条件', () => {
  it('空配置对象按默认 auto 处理:注册 6 个工具且不告警', async () => {
    const host = await harness({})
    try {
      expect(host.tools).toHaveLength(6)
      expect(host.warnings).toEqual([])
    } finally { host.dispose() }
  })

  it('未提供配置时不告警', async () => {
    const host = await harness()
    try {
      expect(host.tools).toHaveLength(6)
      expect(host.warnings).toEqual([])
    } finally { host.dispose() }
  })

  it('settings 缺失时仍挂载：把 settings 作为软依赖请求，不写进入口 inject', async () => {
    const host = await harness({ dock: 'always' })
    try {
      // 六工具与技能照常注册，说明 settings 缺失没有推迟或中断挂载。
      expect(host.tools).toHaveLength(6)
      expect(host.injected.some(deps => deps.includes('settings'))).toBe(true)
      expect(host.warnings).toEqual([])
      // 无 settings 时判定只用组装层配置：always 下未使用的会话也不注入空上下文（F009）。
      await host.tool('get_workbench_context').execute({}, host.exec('s1'))
      expect(host.text('s1')).toBe('')
    } finally { host.dispose() }
  })

  it('未使用工作台的会话不注入工作台上下文,即使状态已经建立', async () => {
    const host = await harness({})
    try {
      expect(host.text('s1')).toBe('')
      // 读取上下文会建立会话状态(无目标、无材料、无会议),注入条件仍应为不注入。
      const read = await host.tool('get_workbench_context').execute({}, host.exec('s1'))
      expect(read.success).toBe(true)
      expect(host.text('s1')).toBe('')
    } finally { host.dispose() }
  })

  it('设置固定整理目标后,下一个模型步骤能看到工作台上下文', async () => {
    const host = await harness({})
    try {
      await writeFile(join(host.root, '纪要.md'), '# 纪要\n', 'utf8')
      const result = await host.tool('set_workbench_context').execute({ target_file: '纪要.md' }, host.exec('s1'))
      expect(result.success).toBe(true)
      const injected = host.text('s1')
      expect(injected).toContain('[讨论工作台上下文]')
      expect(injected).toContain('固定整理目标:')
      expect(injected).toContain('纪要.md')
      // 会话隔离:另一个未使用的会话不受影响。
      expect(host.text('s2')).toBe('')
    } finally { host.dispose() }
  })

  it('仅添加参考材料也算已使用,同样会注入', async () => {
    const host = await harness({})
    try {
      await writeFile(join(host.root, '转写.txt'), '会议转写内容', 'utf8')
      const result = await host.tool('set_workbench_context').execute({ add_material_path: '转写.txt' }, host.exec('s1'))
      expect(result.success).toBe(true)
      expect(host.text('s1')).toContain('[讨论工作台上下文]')
    } finally { host.dispose() }
  })

  it('dock=always 只保证摘要栏策略,未使用时不注入空上下文', async () => {
    const host = await harness({ dock: 'always' })
    try {
      expect(host.tools).toHaveLength(6)
      await host.tool('get_workbench_context').execute({}, host.exec('s1'))
      expect(host.text('s1')).toBe('')
    } finally { host.dispose() }
  })

  it('dock=off 不影响工具注册,已使用的会话仍注入', async () => {
    const host = await harness({ dock: 'off' })
    try {
      expect(host.tools).toHaveLength(6)
      await host.tool('get_workbench_context').execute({}, host.exec('s1'))
      expect(host.text('s1')).toBe('')
      await writeFile(join(host.root, '纪要.md'), '# 纪要\n', 'utf8')
      await host.tool('set_workbench_context').execute({ target_file: '纪要.md' }, host.exec('s1'))
      expect(host.text('s1')).toContain('[讨论工作台上下文]')
    } finally { host.dispose() }
  })

  it('无法识别的取值按 auto 处理并记录警告,不中断挂载', async () => {
    const host = await harness({ dock: 'sometimes' })
    try {
      expect(host.tools).toHaveLength(6)
      expect(host.warnings.some(message => message.includes('sometimes'))).toBe(true)
      await host.tool('get_workbench_context').execute({}, host.exec('s1'))
      expect(host.text('s1')).toBe('')
    } finally { host.dispose() }
  })
})
