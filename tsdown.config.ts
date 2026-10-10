/**
 * tsdown 构建配置：只负责浏览器客户端 bundle（`lib/client.js`）。
 *
 * 宿主半边（`lib/index.js` 等）由 tsc 编译（见 tsconfig.json）；本配置产出 DSH
 * 官方客户端 bundle 形态：
 *
 *   window.__ModuleLoader__.load({ id, factory })
 *
 * 其中 **id = npm 包名**（client-modules 以包名为 compose key），它同时是设置命名空间
 * 与设置卡片 slot 的 key，三者必须一致（见 src/shared/settings.ts 的 `SETTINGS_NAMESPACE`）。
 *
 * 依赖策略：平台外部依赖（react / react/jsx-runtime / cordis）由 shell 的模块表提供，
 * 保持 external；客户端闭包不得 value import `@deepseek-ai/*`（纯度门禁），跨半边协作
 * 一律走 cordis 服务。
 */
import { readFileSync } from 'node:fs'
import type { UserConfig } from 'tsdown'

/** 注册的 bundle id：npm 包名（module-loader compose key，必须等于包名）。 */
const BUNDLE_ID = 'dsh-discussion-workbench'

/**
 * 卡片头部显示的插件版本号，构建期从本包 `package.json` 的 `version` 读入并内联为
 * 字符串字面量（见下面的 `define`）。版本号因此只有一个事实源，不会随发版漂移；
 * 浏览器闭包运行时不需要读文件，也不引入 Node 内建。
 *
 * 做法与 `dsh-structured-document` 一致。源码里以 `declare const __DWB_VERSION__` 声明，
 * 未打包直接运行时回退为 `'0.0.0-dev'`（只影响显示，不影响任何行为）。
 */
function readOwnVersion(): string {
  const raw = readFileSync(new URL('./package.json', import.meta.url), 'utf8')
  const version = (JSON.parse(raw) as { version?: unknown }).version
  if (typeof version !== 'string' || version === '') {
    throw new Error('tsdown: package.json 缺少可用于卡片头部的 version 字段')
  }
  return version
}

export default {
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib', format: 'cjs', platform: 'browser', dts: false, clean: false,
  deps: { neverBundle: ['react', 'react/jsx-runtime', 'cordis'] },
  define: { __DWB_VERSION__: JSON.stringify(readOwnVersion()) },
  outputOptions: {
    entryFileNames: 'client.js', codeSplitting: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(BUNDLE_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
} satisfies UserConfig
