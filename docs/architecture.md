# 文字工作台架构

## Desktop 三场景目标契约（待确认／待实现）

`discussion-desktop-workflows-20261014-v1` 的 [具体契约](DESKTOP-WORKFLOWS-20261014.md)承接 SPEC F012–F017 及 F001–F011 的目标适配，定义宿主绑定 lease、原生传输、thinking、材料与图片、12 工具、会议双稿／索引／PDF、项目 Skill 路由和旧配置迁移。与下方历史 settings／slot 说明冲突时，本版相关目标预期优先；具体文件待用户确认，没有源码或目标运行通过依据。

目标版技术契约：见 [DSH 0.2.0-rc.2 升级适配](DSH-UPGRADE-20261011.md)（`dsh-upgrade-20261011-v1`，待确认／待实现）。本文原宿主 API 和设置存储说明保留作为当前组合基线；目标版采用该补充中的接口、配置迁移与验收边界，不将旧 API 继续当作目标版可用接口。

工作台只协调会话状态，不保存第二份文档树，也不启动独立模型。DSH 原生会话负责讨论与流式回复；在使用工作台的会话里，工作台于每个模型步骤注入目标路径、版本、选中节点、最近变更和材料索引，未使用工作台的会话不注入该文本块（见「配置契约」）。

## 服务边界

- `sidebarController` 提供当前浏览文件、连接状态和按会话订阅。浏览文件不会改变工作台固定目标。
- `structuredDocument` 提供可等待的目标绑定、文档快照、节点选择、变更订阅和进程内事务撤销。
- `structuredDocumentView` 提供视图镜像、按会话订阅和直接视图命令。
- `discussionWorkbench` 提供上下文查询/设置和分页材料读取，供其他宿主插件复用。

Cordis 在上述三个协作服务就绪后挂载工作台，避免依赖插件包名或启动时序。

工作台监听 DSH 的会话事件记录每轮从开始到首段模型文本的时间，并按 step 去重统计模型工具轮次。材料读取、文档内核提交和提交后的视图镜像刷新分别记录实际毫秒值；没有观测值时界面显示“—”，不推算进度。

## 状态与持久化

持久状态位于会话工作区 `.dsh-workbench/sessions/`，粘贴材料位于 `.dsh-workbench/materials/`。场景、固定目标和材料列表按会话隔离；文档树、版本和节点状态始终来自结构化文档服务；浏览状态和视图状态只保留运行时镜像。

刷新时重新验证所有路径。宿主停止时尚未完成的任务恢复为“已中断”；撤销历史属于结构化文档宿主内存，重启后 `undoDepth` 为零。

## 配置契约

`dock` 有两层来源，解析顺序固定为：**用户层（设置文档）> 组装层（本插件 profile patch 的 `config`）> schema 默认值**。

### 组装层

| 字段 | 取值 | 默认 | 含义 |
| --- | --- | --- | --- |
| `dock` | `always` / `auto` / `off` | `auto` | 输入区上方工作台摘要栏的显示策略 |

- `always`：任何有会话 id 的会话都显示摘要栏；`auto`：只有本会话已使用工作台（已有固定整理目标、参考材料或已打开会议）时显示；`off`：任何会话都不显示。
- 默认值逐字段用 `?? ` 兜底：宿主可能传入空对象 `{}`（本插件自带 `cordis.patch.yml` 的 `config: {}`），整体 `??` 会跳过默认分支。同类问题见 `dsh-structured-document` 的场景模板默认值。
- 覆盖入口是 profile 的 `cordis.patch.yml` 顶层条目，形如 `- id: dsh-discussion-workbench` 加 `config: { dock: always }`；本插件自带的 `cordis.patch.yml` 保持 `config: {}`，不写入个人取值。
- 未识别的取值按 `auto` 处理并记录警告，不使插件挂载失败。
- 组装层取值在插件挂载时读取，**改动需要重载插件**才生效。

### 设置层

- 宿主在 `settings` 服务存在时注册 namespace `dsh-discussion-workbench`（合法的小写连字符标识，常量集中在 [../src/shared/settings.ts](../src/shared/settings.ts)，宿主与客户端共用），schema 只声明 `dock`（三值枚举，默认 `auto`），以组装层配置为 `base`，声明 `applies: 'live'`。注册位置：[../src/index.ts](../src/index.ts) 内 `ctx.inject(['settings'], …)`；settings 服务面（`register`／`get`／`watch`）的类型见 [../src/context-types.ts](../src/context-types.ts)，只声明本插件用到的部分。`SettingsProvider.register(ns, schema, { base, applies, validate? })` 与 `installSection(owner, ns, schema, entry, hooks)` 表达同一层语义：后者把组装层 `entry` 同时作为 base 与设置服务卸载后的回退，`hooks` 为 `{ setSource(current), onChange(), validate? }`；本插件用 `register`。
- `base` 取**归一化后的**组装层配置：只把合法的显式取值写进 `base`（如 `{ dock: 'off' }`），组装层未配置或取值非法时 `base` 为空分节、由 schema 默认值补齐 `auto`。归一化是必需的——注册时 `base` 会先过 schema，直接透传非法值会让注册失败、中断插件挂载。
- 注册是插件 fiber 上的 effect：插件卸载即移除 namespace 及其观察者；同名 namespace 重复注册会失败。卸载时判定回退到组装层配置，并对已连接会话重推一次状态。
- 写入落在设置文档（`<DSH_HOME>/settings.yaml`）的用户层；某字段出现在 `user` 层即视为用户覆盖（即使取值等于组装层默认值），清除该字段则回退组装层。写入按 namespace revision 设栅，过期写入被拒绝而不是覆盖并发修改。
- `applies: 'live'`：保存后立即生效（宿主每次判定读取当前解析值，不缓存挂载时的快照），**不需要重载插件**——这是与组装层的关键差异。为使已打开的页面无需刷新即可反映，宿主在变更通知里按现有快照通道对已知会话重算并推送一次状态。
- 设置服务是软依赖：缺失时不注册 namespace，`dock` 只用组装层配置，插件照常挂载。

### 判定（两层共用）

会话是否「已使用」由宿主判定，并只在状态快照里下发一个布尔值；客户端按该布尔值渲染，不做第二次判断，因此不存在两侧判定不一致。是否注入模型上下文不跟随 `dock`，只跟随会话是否已使用：`off` 下已使用的会话仍把目标、版本与材料索引交给模型，`always` 下未使用的会话不产生空上下文块。

实现位置：取值解析、使用痕迹判定和会话内记忆集中在 `src/host/dock.ts`；`src/index.ts` 负责逐字段兜底、解析两层配置（用户层优先，缺层时回退）、把判定写进快照（`WorkbenchState.dock`）、按使用痕迹决定是否注入上下文，并在 WebSocket 断开时释放会话内记忆，使重开会话按当时痕迹重新判定。设置层接入后，判定不再读挂载时捕获的常量：`readDockMode()` 每次判定都取当前解析值（设置路径直接 `scope.get()`），设置变更时由 `scope.watch` 触发 `republish()`，对已连接会话按现有快照通道重推一次；`release()` 只在连接断开时调用，配置变化不清除会话内显示记忆。`src/client/index.tsx` 只在快照判定为真时渲染摘要栏；未判定为真时仍保持连接以接收后续激活变化。`dock` 字段只随快照下发，不写入 `.dsh-workbench/sessions/` 的持久状态。

### 设置页卡片（客户端）

- 卡片注册在 keyed slot `settings.plugin.item` 上，key 为 namespace 本身，形状为 `{ name: 'settings.plugin.item', key: 'dsh-discussion-workbench', locale?, inject? }` 加卡片组件。该 slot 是 `keyed` 类型、作用域 root，`key` 必填、键域开放（由派发方决定具体键）；key 固定为 namespace 本身以保持唯一（同 key 重复注册的具体行为以实现为准，本版不依赖它）。「插件配置」标签页按 Host 服务的 namespace 派发该键（派发键即 `entryKey`），被服务却没有卡片认领的 namespace 什么都不渲染，因此卡片是该配置入口的必要条件。
- 官方给出的注册示例本身就是自绘元素：`ctx.slots.register({ name: 'settings.plugin.item', key: '<key>' }, () => React.createElement('div', null, 'hello'))`，即仓库外插件自绘卡片是被支持的形态；当前该 slot 的占用者只有官方包自带的四张卡片（bash／agent-loop／subagent-model-selection／web-search-deepseek），`dsh-discussion-workbench` 这个 key 尚未被占用。
- 读写在客户端经 `ctx.settingsScope.bind({ namespace: 'dsh-discussion-workbench' })`：快照为 `{ status: 'loading' | 'ready' | 'unavailable', value, base, user, revision, writable, mode }`，写经 scope 的 `mutate(operations, expectedRevision)`（带 revision 栅栏）。与宿主一致，客户端把「字段是否出现在 `user`」作为覆盖判定，而不是比较取值。实现位置：[../src/client/index.tsx](../src/client/index.tsx) 的 `DockSettingsCard`，软挂在 `ctx.inject(['settingsScope'], …)` 内。
- 写入必须走 `mutate`：`set(field, value)`／`unset(field)` 只是它的单操作形式，**不接受** `expectedRevision`；需要 revision 栅栏时调用 `mutate([{ op: 'set', path: ['dock'], value }])` 或 `mutate([{ op: 'unset', path: ['dock'] }], revision)`。卡片在开始草拟时记录快照 revision 作为固定栅栏，过期保存被拒绝而不是覆盖并发修改。
- 卡片字段：`dock` 一个三选一控件（`always` / `auto` / `off`，默认 `auto`）；编辑先暂存草稿，保存时才按序写入，并标明该字段是否被用户覆盖、清除后回退到组装层。namespace 对本客户端不可用（`unavailable`）时不渲染卡片，而不是渲染一张无法操作的卡。
- 卡片自绘内部：官方卡片外壳（`PluginCard` 及其 `CardShell`／`CardFieldSpec` 表单模型）与卡片文案键属于 `@deepseek-ai/dsh-client-ui-settings-plugins` 的包内 locale 字典（`PluginsSettingsLocaleKey`），客户端纯度门禁禁止跨插件值导入，因此本插件的卡片自绘标题、说明与控件样式，只经 cordis 服务（`slots`、`settingsScope`）与宿主协作。
- 客户端 `settingsScope` 是软依赖：缺失时只影响卡片，摘要栏与工作台其他功能照常。入口 `exports.inject` 只声明 `slots`，设置卡在 `apply` 内用 `ctx.inject(['settingsScope'], …)` 挂载；卡片自绘样式声明在 `.dwb-card` 上（与摘要栏的 `.dwb-shell` 各自独立，设置页不在摘要栏容器内）。
- **外观约定（F011）**：卡片不得自创"扁平、常展开的盒子"，必须镜像宿主 `PluginCard` 的视觉语法——可折叠头部（`<button>` 带 `aria-expanded`／`aria-controls`，收起只隐藏主体、组件保持挂载，草稿不因收起丢失）、带分隔线的设置行（标签与说明在左、控件行内右对齐）、右下角操作行；卡片外框取**宿主自己的数值** `.5px solid var(--dsw-alias-border-l4)` + `border-radius:16px` + `background:var(--dsw-alias-bg-layer-3)`，展开态 `bg-layer-2` + `border-color:label-dimmed`（不使用插件市场对宿主的近似值 `1px` + `border-l2` + `radius:12px`，以免同页卡片边框粗细与圆角不一致）。完整配方与数值来源见 [开发 Skill 的卡片外观配方](../../.agents/skills/dsh-plugin-develop/references/config-ui.md) §8；颜色只用 `dsh-client-ui-theme` 中真实存在的 `--dsw-alias-*` 令牌并给兜底值。头部展示插件名 + 版本号 + 一句副标题（版本号取自 [../src/shared/settings.ts](../src/shared/settings.ts) 的 `PLUGIN_VERSION`，有测试断言它与 `package.json` 一致），覆盖状态徽标放在头部右侧、chevron 左边。

## 输入框上方的工作台摘要

工作台继续注册到 `conversation.input.dock`，整行点击展开或收起详情；是否显示按上面的 `dock` 策略决定，未显示时不占用输入区高度、不闪烁。摘要卡片使用宿主的 `--dsh-composer-card-max-width` 与 `--dsh-composer-side-clearance` 对齐输入框；颜色使用实际存在的 `--dsw-alias-*` 主题变量并提供兜底值。

场景以独立标签显示，连接圆点仅表示工作台连接状态；参考材料数量、整理目标和当前节点按“标签 + 值”分组，空值弱化，长名称省略并通过标题保留全文。根据卡片自身宽度在窄栏切成两行，不以整个浏览器宽度判断。展开按钮保留键盘焦点、`aria-expanded` 和对应详情区域标识。

## 写入约束

新建、整篇整理和局部批量修改分别调用 `create_document`、`replace_document`、`apply_document_patch`。后两者必须带固定目标、期望版本和稳定请求 ID。文档内核按规范化路径串行写入，提交前刷新外部修改并再次核对目标和版本；一次批量修改只增加一次版本并产生一个撤销记录。

Markdown 是业务事实来源。Markdown 已保存但 sidecar 保存失败时返回 `sidecarSaved: false`，不会把已落盘正文报告成完全失败。


## 2026-10-18 统一展示与套件交付契约

依据用户已确认的 office-suite-implementation-20261018-v1。Irving · 办公讨论工作台／Irving · Office Discussion Workbench，包 dsh-discussion-workbench 统一 0.2.1-rc.2+rev.1。展示资源通过 locale 导出提供；原条目 id、服务／工具／客户端身份、配置及存储保持。组合分组为 dsh-office-bundle-members；保留本成员原始 patch 行，用户覆盖继续按原 id 命中；子开关不因总开关恢复而重置。版本按完整字符串与固定散列核对；本节不授权原先待确认的业务扩展。
