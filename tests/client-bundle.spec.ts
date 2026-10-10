import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createContext, runInContext } from 'node:vm'
import { fileURLToPath } from 'node:url'

/**
 * 浏览器半边冒烟：在 Node 里用 vm + React 桩执行构建产物 lib/client.js，
 * 验证 ModuleLoader 入口 id、slot 注册（摘要栏 + 设置卡）、软依赖回退与无会话时不抛错。
 *
 * 这不是浏览器测试，不能替代真机页面验收；它的价值是让拼错的标识符、漏定义的函数
 * 以及与 DSH 客户端 API 不匹配的注册形状在这里直接暴露。`npm test` 会先重建 bundle。
 */

const bundlePath = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const LOADER_ID = 'dsh-discussion-workbench'
const NAMESPACE = 'dsh-discussion-workbench'

interface CapturedEntry {
  id: string
  factory(require: (name: string) => unknown): { apply(ctx: unknown): void, inject?: unknown }
}

function reactStub() {
  const noop = (): void => {}
  const effectErrors: unknown[] = []
  // useEffect 立即执行回调：让冒烟测试连副作用一起跑，异常收集后统一断言为空。
  const useEffect = (fn: () => unknown): unknown => {
    try { return fn() } catch (error) { effectErrors.push(error); return undefined }
  }
  const stub: Record<string, unknown> = {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
    useState: (value: unknown) => [typeof value === 'function' ? (value as () => unknown)() : value, noop],
    useEffect,
    useLayoutEffect: useEffect,
    useRef: (value: unknown) => ({ current: value === undefined ? null : value }),
    useMemo: (factory: () => unknown) => factory(),
    useCallback: (fn: unknown) => fn,
    useReducer: (reducer: unknown, initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, noop],
    effectErrors,
  }
  return stub
}

function jsxRuntimeStub() {
  const element = (type: unknown, props: unknown, key?: unknown) => ({ type, props, key })
  return { jsx: element, jsxs: element, Fragment: Symbol('Fragment') }
}

async function loadClientBundle() {
  const source = await readFile(bundlePath, 'utf8')
  let captured: CapturedEntry | undefined
  const styles: Array<{ id: string, textContent: string }> = []
  const document = {
    getElementById: (id: string) => styles.find(item => item.id === id) ?? null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: (node: { id: string, textContent: string }) => { styles.push(node) } },
  }
  const window: Record<string, unknown> = { __ModuleLoader__: { load: (entry: CapturedEntry) => { captured = entry } } }
  const sandbox: Record<string, unknown> = { window, document, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, crypto: { randomUUID: () => 'uuid' } }
  sandbox.globalThis = sandbox
  runInContext(source, createContext(sandbox), { filename: 'lib/client.js' })
  if (captured === undefined) throw new Error('客户端 bundle 必须调用 window.__ModuleLoader__.load')
  return captured
}

function fakeScope(overrides: Record<string, unknown> = {}) {
  return {
    getSnapshot: () => ({ status: 'ready', value: { dock: 'always' }, base: {}, user: {}, revision: 3, writable: true, mode: 'host', ...overrides }),
    subscribe: () => () => {},
    mutate: async () => undefined,
  }
}

/** 收集 slot 注册；`withScope` 为 false 时模拟 settingsScope 缺失。 */
function clientHarness(options: { withScope?: boolean, scope?: ReturnType<typeof fakeScope> } = {}) {
  type Registration = { spec: { name: string, key?: string, id?: string }, component: (props: unknown) => unknown }
  const slots: Registration[] = []
  const bound: Array<{ namespace: string }> = []
  const ctx: Record<string, unknown> = {
    slots: {
      inject: (_name: string, register: () => void) => register(),
      register: (spec: Registration['spec'], component: Registration['component']) => { slots.push({ spec, component }); return () => {} },
    },
    effect: (fn: () => (() => void)) => fn(),
    inject: (deps: string[], callback: (inner: unknown) => void) => {
      if (!deps.includes('settingsScope')) return callback(ctx)
      if (options.withScope === false) return
      callback({
        ...ctx,
        settingsScope: {
          bind: (spec: { namespace: string }) => { bound.push(spec); return options.scope ?? fakeScope() },
        },
      })
    },
  }
  return { ctx, slots, bound }
}

function loadModule(entry: CapturedEntry) {
  const stub = reactStub()
  const runtime = jsxRuntimeStub()
  const mod = entry.factory(name => {
    if (name === 'react') return stub
    if (name === 'react/jsx-runtime') return runtime
    throw new Error(`unexpected require: ${name}`)
  })
  return { mod, stub }
}

describe('客户端 bundle 冒烟（F010）', () => {
  it('loader id 为包名，exports.inject 只声明 slots，注册摘要栏与设置卡两个 slot', async () => {
    const entry = await loadClientBundle()
    expect(entry.id).toBe(LOADER_ID)
    const { mod, stub } = loadModule(entry)
    expect(typeof mod.apply).toBe('function')
    // bundle 在 vm 里执行，数组来自另一个 realm，比较前先转成宿主数组。
    expect(Array.from(mod.inject as string[])).toEqual(['slots'])

    const harness = clientHarness()
    mod.apply(harness.ctx)

    expect(harness.slots.map(item => item.spec.name).sort()).toEqual(['conversation.input.dock', 'settings.plugin.item'])
    const bar = harness.slots.find(item => item.spec.name === 'conversation.input.dock')!
    expect(bar.spec.id).toBe(LOADER_ID)
    const card = harness.slots.find(item => item.spec.name === 'settings.plugin.item')!
    // 设置页按 namespace 派发卡片：key 必须等于宿主注册的 namespace。
    expect(card.spec.key).toBe(NAMESPACE)
    expect(harness.bound).toEqual([{ namespace: NAMESPACE }])
    expect(stub.effectErrors).toEqual([])
  })

  it('无会话时摘要栏返回 null（不建立连接、不抛错），设置卡可渲染', async () => {
    const entry = await loadClientBundle()
    const { mod, stub } = loadModule(entry)
    const harness = clientHarness()
    mod.apply(harness.ctx)

    const bar = harness.slots.find(item => item.spec.name === 'conversation.input.dock')!
    // 包装组件返回元素描述，最内层组件才是摘要栏；无会话 id 时必须返回 null。
    const wrapper = bar.component({ sessionId: '' }) as { type: (props: unknown) => unknown, props: unknown }
    expect(typeof wrapper.type).toBe('function')
    expect(wrapper.type(wrapper.props)).toBeNull()

    const card = harness.slots.find(item => item.spec.name === 'settings.plugin.item')!
    const rendered = card.component({}) as { type: unknown } | null
    expect(rendered).not.toBeNull()
    expect(typeof (rendered as { type: unknown }).type).toBe('function')
    expect(stub.effectErrors).toEqual([])
  })

  it('namespace 未对客户端服务时设置卡渲染为空', async () => {
    const entry = await loadClientBundle()
    const { mod, stub } = loadModule(entry)
    const harness = clientHarness({ scope: fakeScope({ status: 'unavailable', value: undefined }) })
    mod.apply(harness.ctx)

    const card = harness.slots.find(item => item.spec.name === 'settings.plugin.item')!
    const wrapper = card.component({}) as { type: (props: unknown) => unknown, props: unknown }
    expect(wrapper.type(wrapper.props)).toBeNull()
    expect(stub.effectErrors).toEqual([])
  })

  it('settingsScope 缺失时只少一张设置卡，摘要栏照常挂载', async () => {
    const entry = await loadClientBundle()
    const { mod, stub } = loadModule(entry)
    const harness = clientHarness({ withScope: false })
    mod.apply(harness.ctx)

    expect(harness.slots.map(item => item.spec.name)).toEqual(['conversation.input.dock'])
    expect(harness.bound).toEqual([])
    expect(Array.from(mod.inject as string[])).toEqual(['slots'])
    expect(stub.effectErrors).toEqual([])
  })

  it('设置卡按 revision 栅栏写入用户层，未改动时保存按钮禁用', async () => {
    const entry = await loadClientBundle()
    const { mod, stub } = loadModule(entry)
    const writes: Array<{ operations: unknown, revision: unknown }> = []
    const scope = {
      ...fakeScope({ value: { dock: 'off' }, user: { dock: 'off' }, base: {}, revision: 3 }),
      mutate: async (operations: unknown, revision: unknown) => { writes.push({ operations, revision }) },
    }
    const harness = clientHarness({ scope })
    mod.apply(harness.ctx)

    const card = harness.slots.find(item => item.spec.name === 'settings.plugin.item')!
    const wrapper = card.component({}) as { type: (props: unknown) => unknown, props: unknown }
    const tree = wrapper.type(wrapper.props)
    // 卡片自绘：从元素树里取出「保存」「恢复组装层」两个按钮（React 桩不做重渲染，
    // 因此直接调用 props.onClick 验证写入形状与栅栏，disabled 只单独断言）。
    const buttons = collectByType(tree, 'button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]!.props.disabled).toBe(true)

    ;(buttons[0]!.props.onClick as () => void)()
    ;(buttons[1]!.props.onClick as () => void)()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(writes).toEqual([
      { operations: [{ op: 'set', path: ['dock'], value: 'off' }], revision: 3 },
      { operations: [{ op: 'unset', path: ['dock'] }], revision: 3 },
    ])
    expect(stub.effectErrors).toEqual([])
  })
})

/** 深度遍历 React 元素描述，收集指定类型的节点（仅用于冒烟断言）。 */
function collectByType(node: unknown, type: string): Array<{ props: Record<string, unknown> }> {
  const found: Array<{ props: Record<string, unknown> }> = []
  const walk = (current: unknown): void => {
    if (current === null || current === undefined || typeof current !== 'object') return
    const element = current as { type?: unknown, props?: unknown, children?: unknown }
    if (element.type === type && typeof element.props === 'object' && element.props !== null) found.push({ props: element.props as Record<string, unknown> })
    const props = element.props as { children?: unknown } | undefined
    if (props !== undefined) walkChildren(props.children, walk)
    walkChildren(element.children, walk)
  }
  walk(node)
  return found
}

function walkChildren(children: unknown, walk: (value: unknown) => void): void {
  if (Array.isArray(children)) { for (const child of children) walk(child); return }
  walk(children)
}
