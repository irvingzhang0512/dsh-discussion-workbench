import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createContext, runInContext } from 'node:vm'
import { fileURLToPath } from 'node:url'

/**
 * 浏览器半边冒烟：在 Node 里用 vm + React 桩执行构建产物 lib/client.js，
 * 验证 ModuleLoader 入口 id、slot 注册（摘要栏 + 设置卡）、软依赖回退、无会话时不抛错，
 * 以及 F011 的卡片外观标记（可折叠头部、分段控件、覆盖徽标、右下角操作行）。
 *
 * 这不是浏览器测试，不能替代真机页面验收；它的价值是让拼错的标识符、漏定义的函数
 * 以及与 DSH 客户端 API 不匹配的注册形状在这里直接暴露。`npm test` 会先重建 bundle。
 */

const bundlePath = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const PACKAGE_PATH = fileURLToPath(new URL('../package.json', import.meta.url))
const SOURCE_PATH = fileURLToPath(new URL('../src/client/index.tsx', import.meta.url))
const LOADER_ID = 'dsh-discussion-workbench'
const NAMESPACE = 'dsh-discussion-workbench'
/** 卡片头部的版本号由构建期从 package.json 注入，因此产物里必须是这个值（F011）。 */
const PACKAGE_VERSION = JSON.parse(await readFile(PACKAGE_PATH, 'utf8')).version as string

interface CapturedEntry {
  id: string
  factory(require: (name: string) => unknown): { apply(ctx: unknown): void, inject?: unknown }
}

/**
 * React 桩。默认不重渲染（`useState` 的 setter 是空操作）——够用来断言首屏元素树；
 * `stateful: true` 时实现真实的重渲染循环，用来验证「点一下 → 状态变化 → 重渲染」的行为
 * （收起不丢草稿那条用例必须走这条路径）。
 */
function reactStub(options: { stateful?: boolean } = {}) {
  const noop = (): void => {}
  const effectErrors: unknown[] = []
  // 每个 hook 槽位一份状态；重渲染时按调用顺序取回，与 React 的 hook 顺序规则一致。
  const hooks: Array<{ value: unknown }> = []
  const ranEffects = new Set<number>()
  let cursor = 0
  let rerender: (() => unknown) | undefined
  // useEffect 立即执行回调：让冒烟测试连副作用一起跑，异常收集后统一断言为空。
  // 重渲染时按槽位只跑一次（真实 React 只在依赖变化时重跑；这里依赖恒为空数组）。
  const useEffect = (fn: () => unknown): unknown => {
    const slot = cursor++
    if (ranEffects.has(slot)) return undefined
    ranEffects.add(slot)
    try { return fn() } catch (error) { effectErrors.push(error); return undefined }
  }
  const useState = (value: unknown) => {
    const slot = cursor++
    if (hooks[slot] === undefined) hooks[slot] = { value: typeof value === 'function' ? (value as () => unknown)() : value }
    const current = hooks[slot]!
    if (options.stateful !== true) return [current.value, noop]
    const setter = (next: unknown): void => {
      const resolved = typeof next === 'function' ? (next as (prev: unknown) => unknown)(current.value) : next
      // 与 React 一致：值不变就不重渲染。否则组件里 `sync()` 里的 setState 会自激成死循环。
      if (Object.is(current.value, resolved)) return
      current.value = resolved
      rerender?.()
    }
    return [current.value, setter]
  }
  const stub: Record<string, unknown> = {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
    useState,
    useEffect,
    useLayoutEffect: useEffect,
    useRef: (value: unknown) => {
      const slot = cursor++
      if (hooks[slot] === undefined) hooks[slot] = { value: { current: value === undefined ? null : value } }
      return hooks[slot]!.value
    },
    useMemo: (factory: () => unknown) => { cursor++; return factory() },
    useCallback: (fn: unknown) => { cursor++; return fn },
    useReducer: (reducer: unknown, initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, noop],
    effectErrors,
    /** 重新执行渲染函数；只有 stateful 模式下 setter 会调用它。 */
    __rerender(render: () => unknown): unknown {
      // 每次渲染都从第一个 hook 槽位开始，并先把 rerender 指好（渲染期间的 setState 也要能触发下一次）。
      rerender = () => stub.__rerender(render)
      cursor = 0
      return render()
    },
    __setRerender(fn: () => unknown): void { rerender = fn },
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

/** 假 settings scope。快照按引用缓存：真实 scope 只在 revision 变化时才给新对象，
 *  稳定引用同时让 stateful React 桩的 setState 能正确 bail out（否则会自激重渲染）。 */
function fakeScope(overrides: Record<string, unknown> = {}) {
  const snapshot = { status: 'ready', value: { dock: 'always' }, base: {}, user: {}, revision: 3, writable: true, mode: 'host', ...overrides }
  return {
    getSnapshot: () => snapshot,
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

function loadModule(entry: CapturedEntry, options: { stateful?: boolean } = {}) {
  const stub = reactStub(options)
  const runtime = jsxRuntimeStub()
  const mod = entry.factory(name => {
    if (name === 'react') return stub
    if (name === 'react/jsx-runtime') return runtime
    throw new Error(`unexpected require: ${name}`)
  })
  return { mod, stub }
}

describe('客户端 bundle 冒烟（F010）', () => {  it('loader id 为包名，exports.inject 只声明 slots，注册摘要栏与设置卡两个 slot', async () => {
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
    // 卡片自绘：操作行里是「恢复组装层」「保存」两个按钮（React 桩不做重渲染，
    // 因此直接调用 props.onClick 验证写入形状与栅栏，disabled 只单独断言）。
    const footer = collectByClass(tree, 'dwb-card-footer')[0]!
    const buttons = footer.children as Array<{ props: Record<string, unknown> }>
    expect(buttons).toHaveLength(2)
    // 恢复组装层在左、保存在右（与宿主 PluginCard 的 footer 一致）；未改动时保存禁用。
    expect(buttons[1]!.props.disabled).toBe(true)

    ;(buttons[0]!.props.onClick as () => void)()
    ;(buttons[1]!.props.onClick as () => void)()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(writes).toEqual([
      { operations: [{ op: 'unset', path: ['dock'] }], revision: 3 },
      { operations: [{ op: 'set', path: ['dock'], value: 'off' }], revision: 3 },
    ])
    expect(stub.effectErrors).toEqual([])
  })
})

describe('设置卡外观对齐宿主卡片（F011）', () => {
  /** 渲染一张卡并返回元素树；`scope` 缺省时用「继承组装层」的默认快照。 */
  async function renderCard(scope?: ReturnType<typeof fakeScope>) {
    const entry = await loadClientBundle()
    const { mod, stub } = loadModule(entry)
    const harness = clientHarness(scope === undefined ? {} : { scope })
    mod.apply(harness.ctx)
    const card = harness.slots.find(item => item.spec.name === 'settings.plugin.item')!
    const wrapper = card.component({}) as { type: (props: unknown) => unknown, props: unknown }
    return { tree: wrapper.type(wrapper.props), stub }
  }

  it('卡片 chrome：section 外框 + 头部按钮（aria-expanded / aria-controls）+ 主体 id 关联', async () => {
    const { tree, stub } = await renderCard()
    // 外框是 section，展开态由 is-open 类切换（对应宿主的 cardOpen）。
    const sections = collectByType(tree, 'section')
    expect(sections).toHaveLength(1)
    expect(sections[0]!.props.className).toContain('dwb-card')

    const headers = collectByClass(tree, 'dwb-card-header')
    expect(headers).toHaveLength(1)
    const header = headers[0]!
    expect(header.type).toBe('button')
    // 初始收起：aria-expanded 为 false，aria-controls 指向主体 id（关联在收起态就必须成立）。
    expect(header.props['aria-expanded']).toBe(false)
    expect(typeof header.props['aria-controls']).toBe('string')
    expect(typeof header.props.onClick).toBe('function')

    const bodies = collectByClass(tree, 'dwb-card-body')
    expect(bodies).toHaveLength(1)
    expect(bodies[0]!.props.id).toBe(header.props['aria-controls'])
    // 收起只隐藏主体：组件仍挂载，主体靠 hidden 属性隐藏而不是不渲染。
    expect(bodies[0]!.props.hidden).toBe(true)

    // 头部文字列：插件名 + 版本号（与 package.json 一致）+ 副标题。
    const text = collectText(tree).join('')
    expect(text).toContain('讨论工作台')
    expect(text).toContain(`v${PACKAGE_VERSION}`)
    expect(text).toContain('摘要栏显示策略')

    // chevron 是 16px 的 SVG，展开态由 CSS 的 rotate(180deg) 承担。
    const chevrons = collectByClass(tree, 'dwb-card-chevron')
    expect(chevrons).toHaveLength(1)
    expect(chevrons[0]!.type).toBe('svg')
    expect(chevrons[0]!.props.width).toBe('16')
    expect(stub.effectErrors).toEqual([])
  })

  it('分段控件三个中文选项齐备，选中态与当前生效值一致（未设置时为「按需」）', async () => {
    // 未设置（继承组装层、组装配置也无取值）时生效值按 schema 默认 auto → 高亮「按需」。
    const { tree, stub } = await renderCard(fakeScope({ value: { dock: 'auto' }, base: {}, user: {}, revision: 3 }))
    const segmented = collectByClass(tree, 'dwb-segmented')
    expect(segmented).toHaveLength(1)
    expect(segmented[0]!.props.role).toBe('group')

    const segments = collectByClass(tree, 'dwb-segment')
    expect(segments).toHaveLength(3)
    expect(segments.map(item => collectText(item).join(''))).toEqual(['按需', '始终', '不显示'])
    // 选中的是「按需」（生效值 auto），另两个未选中。
    expect(segments.map(item => item.props['aria-pressed'])).toEqual([true, false, false])
    expect(segments.map(item => String(item.props.className).includes('is-active'))).toEqual([true, false, false])
    // 控件在行的右侧：文字列 flex:1，控件 flex:none（由类承担，断言标记存在）。
    expect(collectByClass(tree, 'dwb-card-field-text')).toHaveLength(1)
    expect(stub.effectErrors).toEqual([])
  })

  it('生效值为 always 时对应「始终」选中；未覆盖时默认项仍是「按需」而非空选', async () => {
    const { tree } = await renderCard(fakeScope({ value: { dock: 'always' }, base: {}, user: {}, revision: 1 }))
    const segments = collectByClass(tree, 'dwb-segment')
    expect(segments.map(item => item.props['aria-pressed'])).toEqual([false, true, false])
    // 类名也必须跟着生效值走（不能只断言 aria-pressed，否则写死某一项的选中态测不出来）。
    expect(segments.map(item => String(item.props.className).includes('is-active'))).toEqual([false, true, false])
    // 未覆盖：徽标显示「继承组装层」，恢复按钮禁用。
    expect(collectText(collectByClass(tree, 'dwb-card-badge')[0]!).join('')).toBe('继承组装层')
    const buttons = collectByClass(tree, 'dwb-card-footer')[0]!.children as Array<{ props: Record<string, unknown> }>
    expect(buttons[0]!.props.disabled).toBe(true)
  })

  it('生效值为 off 时对应「不显示」选中（第三项）', async () => {
    const { tree } = await renderCard(fakeScope({ value: { dock: 'off' }, base: { dock: 'off' }, user: { dock: 'off' }, revision: 4 }))
    const segments = collectByClass(tree, 'dwb-segment')
    expect(segments.map(item => item.props['aria-pressed'])).toEqual([false, false, true])
    expect(segments.map(item => String(item.props.className).includes('is-active'))).toEqual([false, false, true])
  })

  it('覆盖徽标文案随用户层变化：字段出现在 user 层即为「用户覆盖」', async () => {
    const inherited = await renderCard(fakeScope({ value: { dock: 'auto' }, base: { dock: 'auto' }, user: {}, revision: 2 }))
    expect(collectText(collectByClass(inherited.tree, 'dwb-card-badge')[0]!).join('')).toBe('继承组装层')

    const covered = await renderCard(fakeScope({ value: { dock: 'off' }, base: { dock: 'auto' }, user: { dock: 'off' }, revision: 2 }))
    const badge = collectByClass(covered.tree, 'dwb-card-badge')[0]!
    expect(collectText(badge).join('')).toBe('用户覆盖')
    expect(String(badge.props.className)).toContain('is-override')
    // 覆盖时恢复组装层可用。
    const buttons = collectByClass(covered.tree, 'dwb-card-footer')[0]!.children as Array<{ props: Record<string, unknown> }>
    expect(buttons[0]!.props.disabled).toBe(false)
    expect(collectText(covered.tree).join('')).toContain('覆盖组装层 auto')
  })

  it('收起只隐藏主体：草稿与写入路径都不因收起丢失', async () => {
    const entry = await loadClientBundle()
    // 这条用例要观察「点一下 → 重渲染」，因此用会重渲染的 React 桩。
    const { mod, stub } = loadModule(entry, { stateful: true })
    const writes: Array<{ operations: unknown, revision: unknown }> = []
    const scope = {
      ...fakeScope({ value: { dock: 'auto' }, base: {}, user: {}, revision: 7 }),
      mutate: async (operations: unknown, revision: unknown) => { writes.push({ operations, revision }) },
    }
    const harness = clientHarness({ scope })
    mod.apply(harness.ctx)
    const card = harness.slots.find(item => item.spec.name === 'settings.plugin.item')!
    const wrapper = card.component({}) as { type: (props: unknown) => unknown, props: unknown }
    // 每次重渲染都重新执行组件函数；渲染结果放进 ref 供后续断言读取。
    let tree = (stub.__rerender as (render: () => unknown) => unknown)(() => wrapper.type(wrapper.props))
    const render = (): unknown => (stub.__rerender as (render: () => unknown) => unknown)(() => wrapper.type(wrapper.props))
    const at = (current: unknown, help: string): void => { if (current === undefined) throw new Error(help) }

    at(tree, '首屏渲染失败')
    const body = (): Record<string, unknown> => collectByClass(tree, 'dwb-card-body')[0]!.props
    const header = (): Record<string, unknown> => collectByClass(tree, 'dwb-card-header')[0]!.props
    // 收起态：主体仍在树上，只是 hidden；分段控件依然可达（草稿不会因收起被重置）。
    expect(body().hidden).toBe(true)
    expect(collectByClass(tree, 'dwb-segment')).toHaveLength(3)

    // 点第三段「不显示」草拟 off（重渲染后选中态与保存可用性都要跟着变）。
    ;(collectByClass(tree, 'dwb-segment')[2]!.props.onClick as () => void)()
    tree = render()
    expect(collectByClass(tree, 'dwb-segment').map(item => item.props['aria-pressed'])).toEqual([false, false, true])
    expect(body().hidden).toBe(true)
    expect((collectByClass(tree, 'dwb-card-footer')[0]!.children as Array<{ props: Record<string, unknown> }>)[1]!.props.disabled).toBe(false)

    // 展开再收起：草稿 off 不因两次切换被重置。
    ;(header().onClick as () => void)()
    tree = render()
    expect(body().hidden).toBe(false)
    expect((body().id)).toBe(header()['aria-controls'])
    expect(collectByClass(tree, 'dwb-segment').map(item => item.props['aria-pressed'])).toEqual([false, false, true])
    ;(header().onClick as () => void)()
    tree = render()
    expect(body().hidden).toBe(true)

    // 保存写出的仍是草拟的 off，栅栏仍是开始草拟时的 revision。
    const footerButtons = collectByClass(tree, 'dwb-card-footer')[0]!.children as Array<{ props: Record<string, unknown> }>
    ;(footerButtons[1]!.props.onClick as () => void)()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(writes).toEqual([{ operations: [{ op: 'set', path: ['dock'], value: 'off' }], revision: 7 }])
    expect(stub.effectErrors).toEqual([])
  })

  it('版本号由构建期注入：产物内联 package.json 的 version，源码里不出现该字面量', async () => {
    const { tree } = await renderCard()
    // 渲染出来的头部文本用的是注入值。
    expect(collectText(tree).join('')).toContain(`v${PACKAGE_VERSION}`)

    // 产物里确实内联了这个字符串（构建期 `define` 把它替换成字面量）。
    const bundle = await readFile(bundlePath, 'utf8')
    expect(bundle).toContain(JSON.stringify(PACKAGE_VERSION))
    // 运行时内联，闭包内不留注入标识符，也不引 Node 内建读文件。
    expect(bundle).not.toContain('__DWB_VERSION__')
    expect(bundle).not.toContain('node:fs')

    // 反向断言：源码里不得出现与 package.json 相同的版本字面量，否则就是又手写了一份会漂移的常量。
    const source = await readFile(SOURCE_PATH, 'utf8')
    expect(source).not.toContain(PACKAGE_VERSION)
    // 未注入时的回退值只在源码里（不在产物里，因为产物有注入值）。
    expect(source).toContain('0.0.0-dev')
  })

  it('样式只用真实存在的 --dsw-alias-* 令牌并给兜底值', async () => {
    const source = await readFile(bundlePath, 'utf8')
    const tokens = [...source.matchAll(/var\((--dsw-alias-[a-z0-9-]+)/g)].map(match => match[1]!)
    // 主题包实测存在的令牌（dsh-client-ui-theme 的 client.js 全量清单）之内。
    const known = new Set([
      '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary',
      '--dsw-alias-label-dimmed', '--dsw-alias-border-l2', '--dsw-alias-border-l4',
      '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
      '--dsw-alias-brand-primary', '--dsw-alias-state-success-primary', '--dsw-alias-state-error-primary',
      '--dsw-alias-interactive-bg-hover',
    ])
    expect(tokens.length).toBeGreaterThan(0)
    expect(tokens.filter(token => !known.has(token))).toEqual([])
    // 每个令牌都带兜底值（`var(--x, …)`），主题变量缺失时不会落成无效颜色。
    for (const token of new Set(tokens)) {
      expect(new RegExp(`var\\(${token},`).test(source)).toBe(true)
    }
  })
})

/** 深度遍历 React 元素描述，收集指定类型的节点（仅用于冒烟断言）。 */
function collectByType(node: unknown, type: string): Array<{ type: unknown, props: Record<string, unknown> }> {
  const found: Array<{ type: unknown, props: Record<string, unknown> }> = []
  const walk = (current: unknown): void => {
    if (current === null || current === undefined || typeof current !== 'object') return
    const element = current as { type?: unknown, props?: unknown, children?: unknown }
    if (element.type === type && typeof element.props === 'object' && element.props !== null) found.push({ type: element.type, props: element.props as Record<string, unknown> })
    const props = element.props as { children?: unknown } | undefined
    if (props !== undefined) walkChildren(props.children, walk)
    walkChildren(element.children, walk)
  }
  walk(node)
  return found
}

/** 收集带指定类名的节点（类名可能含多个词，按空白切分后精确匹配）。 */
function collectByClass(node: unknown, className: string): Array<{ type: unknown, props: Record<string, unknown>, children: unknown }> {
  const found: Array<{ type: unknown, props: Record<string, unknown>, children: unknown }> = []
  const walk = (current: unknown): void => {
    if (current === null || current === undefined || typeof current !== 'object') return
    const element = current as { type?: unknown, props?: unknown, children?: unknown }
    if (typeof element.props === 'object' && element.props !== null) {
      const props = element.props as { className?: unknown, children?: unknown }
      if (typeof props.className === 'string' && props.className.split(/\s+/).includes(className)) {
        found.push({ type: element.type, props: props as Record<string, unknown>, children: props.children })
      }
    }
    const props = element.props as { children?: unknown } | undefined
    if (props !== undefined) walkChildren(props.children, walk)
    walkChildren(element.children, walk)
  }
  walk(node)
  return found
}

/** 拼接一棵元素树里的全部文本节点。元素描述里 children 只挂在 props 上，不重复遍历。 */
function collectText(node: unknown): string[] {
  const found: string[] = []
  const walk = (current: unknown): void => {
    if (current === null || current === undefined) return
    if (typeof current === 'string' || typeof current === 'number') { found.push(String(current)); return }
    if (typeof current !== 'object') return
    const props = (current as { props?: { children?: unknown } }).props
    if (props !== undefined) walkChildren(props.children, walk)
  }
  walk(node)
  return found
}

function walkChildren(children: unknown, walk: (value: unknown) => void): void {
  if (Array.isArray(children)) { for (const child of children) walk(child); return }
  walk(children)
}
