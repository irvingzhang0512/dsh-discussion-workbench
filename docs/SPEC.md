# dsh-discussion-workbench 当前功能规格

本次升级文档版：`dsh-upgrade-20261011-v1`（2026-10-11，待用户确认）。F001–F011 的目标宿主适配与迁移验收见 [DSH 升级适配契约](DSH-UPGRADE-20261011.md)；本次变更待实现，尚未通过目标版本验证。其余功能与原有待确认设计保持原状态，下面的历史证据不自动证明 DSH 0.2.0-rc.2 兼容。

基线日期：2026-10-03；包版本：0.1.1；核对的源码提交：`913a3d9185041f07db95e6a62970a712cea10f34`。此提交是首次整理前的实现基线，后续文档提交不提高包版本。

2026-10-10 增量（F009）：新增摘要栏显示策略与上下文注入条件，并按用户确认的该版规格实现；包版本提高到 0.2.0。实现与验证证据见 F009 与 [acceptance.md](acceptance.md)。

2026-10-10 增量（F010）：把 `dock` 接入设置页「插件 → 插件配置」的卡片，配置契约扩写为「用户层 > 组装层 > schema 默认」两层；本版为待用户确认的文档增量，尚未实现，不提高包版本。

本规格可编辑，功能任务先改预期与验收及相关技术契约，交用户明确确认该版文档后再开发；确认前不得修改对应源码／测试实现或运行配置。用户已明确要求按同一版文档实现且含义未变时，不重复询问；新增语义差异须重新确认，确认范围写入规格变更或任务交付记录。Bug 按已有且不变的预期直接定位源码。流程见 [根文档驱动开发规范](../../docs/DOC-DRIVEN-DEVELOPMENT.md)。原始需求保持只读，技术文档保留现有名称。

依据与技术入口：[architecture.md](architecture.md)、[acceptance.md](acceptance.md)、[voice-meeting-minutes-guide.md](voice-meeting-minutes-guide.md)。

实现状态与验证状态分别记录。“已实现”表示有当前源码依据，不表示本次已通过运行测试。下面的测试链接是核对过的现有验证入口；2026-10-03 本次只静态核对源码、测试与文档，没有运行产品测试、构建、GUI 或外部服务验证。具体遗漏见条目与末尾待办。

## F001 会话场景与上下文

- 实现状态：已实现。
- 场景与预期：每个会话保存 meeting／project 场景、工作目录、材料及目标上下文；重读状态返回隔离快照。
- 边界与异常：会话间隔离；状态持久化失败不能发布半更新；工作台不复制文档内核或文件树。
- 验收条件：两个会话互不污染；修改返回快照不改内部状态；模拟保存失败保留旧状态。
- 实现依据：[../src/host/store.ts](../src/host/store.ts)、[../src/shared/types.ts](../src/shared/types.ts)。
- 验证记录：2026-10-03 静态核对；已有测试入口：[../tests/store.spec.ts](../tests/store.spec.ts)（覆盖范围以用例为准，本次未执行）。

## F002 固定目标与文档绑定

- 实现状态：已实现。
- 场景与预期：设置固定整理目标，通过结构化文档服务绑定、选择节点及读取 revision，目标与浏览器当前文件／候选分别保存。
- 边界与异常：浏览器切换不能悄悄改固定目标；绑定请求串行，失败恢复旧绑定或反馈 targetBindingError；未绑定时不能向未知文档写入。
- 验收条件：浏览其他文件后固定目标不变；失败反馈明确；选择节点和 revision 来自实际目标。
- 实现依据：[../src/index.ts](../src/index.ts)、[../src/host/store.ts](../src/host/store.ts)。
- 验证记录：2026-10-03 静态核对；已有测试入口：[../tests/store.spec.ts](../tests/store.spec.ts)（覆盖范围以用例为准，本次未执行）。

## F003 参考材料管理与读取

- 实现状态：已实现。
- 场景与预期：可添加文件或粘贴文本为材料，移除材料，通过 read_material 分页读取并搜索会议来源。支持 Markdown、文本与 JSON 等允许扩展。
- 边界与异常：文件需真实路径在工作区内；分页读取不改状态，offset／nextOffset／truncated 明确；JSON 可作材料但目标仅接受文档允许格式。
- 验收条件：材料分页可完整拼接；越界路径拒绝；删除材料后索引不再列出；材料和目标扩展边界区分。
- 实现依据：[../src/host/store.ts](../src/host/store.ts)、[../src/host/tools.ts](../src/host/tools.ts)。
- 验证记录：2026-10-03 静态核对；已有测试入口：[../tests/store.spec.ts](../tests/store.spec.ts)（覆盖范围以用例为准，本次未执行）。

## F004 会议目录与信息

- 实现状态：已实现。
- 场景与预期：打开会议工作区，维护时间、地点、参与者、主题和记录者等信息；发现／选择原始记录与纪要文件，在会议目录保存元信息。
- 边界与异常：会议原始记录与最终纪要分工不同；材料仅作为来源，不自动替换固定目标。
- 验收条件：更新信息后重新加载一致；切换记录／纪要时目标状态对应；空信息能编辑。
- 实现依据：[../src/host/store.ts](../src/host/store.ts)、[../src/index.ts](../src/index.ts)、[../src/client/index.tsx](../src/client/index.tsx)。
- 验证记录：2026-10-03 静态核对；无对应专项自动测试，需补宿主／页面或真实环境验证。

## F005 DOCX 导入与 PDF 导出

- 实现状态：已实现。
- 场景与预期：DOCX 导入经外部 PowerShell 转换脚本产出可读材料，已有产物可复用；纪要经 HTML 和浏览器打印导出 PDF，默认避免覆盖。
- 边界与异常：依赖外部转换脚本、pwsh 与可用浏览器可执行文件；缺失或执行失败明确报错，不宣称纯插件内置转换。
- 验收条件：外部条件齐全时 DOCX 成为材料；PDF 路径和导出 revision 记录正确；默认重名另取路径，显式允许才覆盖。
- 实现依据：[../src/host/store.ts](../src/host/store.ts)、[../src/index.ts](../src/index.ts)。
- 验证记录：2026-10-03 静态核对；无对应专项自动测试，需补宿主／页面或真实环境验证。

## F006 模型上下文与工具

- 实现状态：已实现（含 2026-10-10 的注入条件增量）。
- 场景与预期：6 个工具：open_meeting_workbench、update_meeting_info、get_workbench_context、set_workbench_context、read_material、search_meeting_source。在使用工作台的会话里，每次模型步骤注入目标、revision、节点与材料索引；未使用的会话不注入（判定见 F009）。
- 边界与异常：原始材料不自动全文注入；工作台不自行运行模型；文档改动仍通过结构化文档工具执行。未使用工作台的会话注入空字符串，不产生任何工作台文本；六个工具始终注册，即使摘要栏被配置为不显示。
- 验收条件：工具注册数量为 6；新目标／材料能进入下一步上下文；普通聊天不自动改写文档；未使用工作台的会话系统提示中不含 `[讨论工作台上下文]`，设置目标后的下一个模型步骤能看到该块。
- 实现依据：[../src/host/tools.ts](../src/host/tools.ts)、[../src/index.ts](../src/index.ts)。
- 验证记录：2026-10-03 静态核对；无对应专项自动测试，需补宿主／页面或真实环境验证。

## F007 场景摘要与操作面板

- 实现状态：已实现（含 2026-10-10 的显示策略增量）。
- 场景与预期：输入区上方显示场景、材料数量、整理目标和当前节点；摘要卡与输入区对齐，可展开材料、会议信息与目标操作。摘要栏是否出现由配置 `dock` 决定（F009）：`auto` 只在该会话已使用工作台时出现，`off` 在任何会话都不出现，`always` 与当前常驻行为一致。
- 边界与异常：无目标／无节点显示明确空状态；长路径可截断查看，展开支持键盘与 ARIA；容器宽度调整布局。未显示时不占用输入区高度、不闪烁；显示判定只在宿主侧产生一个布尔值，客户端不重复判断。
- 验收条件：窄宽度／长标题不撑破输入区；键盘可展开；数量与实际材料一致；展开后的操作仍可用；默认配置下新建的纯对话／编码会话看不到摘要栏，该会话一旦有了整理目标、材料或会议，摘要栏在下一步出现。
- 实现依据：[../src/client/index.tsx](../src/client/index.tsx)。
- 验证记录：2026-10-03 静态核对；无对应专项自动测试，需补宿主／页面或真实环境验证。

## F008 反馈与跨插件协调

- 实现状态：已实现。
- 场景与预期：展示轮次、工具步骤、响应与材料读取等反馈；协调侧边栏控制器、结构化文档和视图，不重建其业务数据。
- 边界与异常：指标由实际事件更新；项目提示中的外部 Excel 桥不是插件自身提供的独立 Excel 编辑功能。
- 验收条件：事件更新后反馈变化；文档选择／视图操作指向同一绑定目标；依赖不可用时明确失败。
- 实现依据：[../src/index.ts](../src/index.ts)、[../src/client/index.tsx](../src/client/index.tsx)、[../src/host/bridge.ts](../src/host/bridge.ts)。
- 验证记录：2026-10-03 静态核对；无对应专项自动测试，需补宿主／页面或真实环境验证。

## F009 摘要栏显示策略与上下文注入条件

- 实现状态：已实现（2026-10-10，用户确认该版规格后开发）。
- 场景与预期：宿主插件配置新增 `dock`，取值 `always` / `auto` / `off`，默认 `auto`。`always`：任何会话都显示摘要栏；`auto`：只有已使用工作台的会话显示；`off`：任何会话都不显示。会话「已使用」指该会话已有固定整理目标、参考材料或已打开会议。模型上下文注入不跟随 `dock`，只跟随会话是否已使用。
- 边界与异常：会话一旦显示过摘要栏，本次会话内保持显示（运行时记忆，不写入持久文件），避免解除目标或删空材料时面板中途收起；重开会话按当时的痕迹重新判定。`off` 下已使用的会话仍注入目标、版本与材料索引（UI 不出现，模型仍拿到事实）；`always` 下未使用的会话不注入空上下文。隐藏状态下客户端仍保持状态通道，以便接收激活变化。配置取值非法时按 `auto` 处理并记录警告，不中断插件挂载。技能目录条目与六个工具始终注册，不受 `dock` 影响。
- 验收条件：默认配置下未使用的会话不显示摘要栏，系统提示也不含工作台上下文块；为该会话设置整理目标后，摘要栏与上下文块一同出现；`dock: always` 恢复常驻，且未使用时仍不注入上下文；`dock: off` 下任何会话都不出现摘要栏，而工具与技能仍可用；`dock: off` 且会话已使用时上下文块仍注入；非法取值不导致插件挂载失败，行为等同 `auto`。
- 实现依据：[../src/host/dock.ts](../src/host/dock.ts)（取值解析、使用痕迹判定与会话内记忆）、[../src/index.ts](../src/index.ts)（配置字段、上下文注入条件、快照判定与断开时释放）、[../src/shared/types.ts](../src/shared/types.ts)（快照字段 `dock`）、[../src/client/index.tsx](../src/client/index.tsx)（按宿主下发的判定渲染）、[../cordis.patch.yml](../cordis.patch.yml)。
- 验证记录：2026-10-10 `npm run typecheck`、`npm test`（3 个文件 26 项）与 `npm run build` 通过，`lib/host/dock.js` 已生成且宿主产物可加载。新增 [../tests/dock.spec.ts](../tests/dock.spec.ts)（取值解析、使用痕迹与会话内记忆）与 [../tests/host-context.spec.ts](../tests/host-context.spec.ts)（假 ctx 宿主：空配置不告警、未使用不注入、设置目标／材料后注入、`always` 未使用不注入、`off` 已使用仍注入、非法取值告警且挂载成功、工具数仍为 6）。真实宿主协议冒烟脚本 `.test-runs/discussion-workbench/dock-smoke.mjs` 已就位，重载前跑出的负向对照确认运行中的宿主仍是旧代码（未下发 `dock`）。未执行：重载后的正向断言与浏览器页面验证；客户端渲染分支依赖宿主下发，宿主半侧重启后生效，本次未重启承载当前会话的环境。

## F010 设置页插件配置卡片

- 实现状态：已实现（2026-10-10，用户确认该版规格后开发；包版本 0.3.0）。
- 场景与预期：为 `dock` 增加设置页入口，不再只依赖组装层配置。宿主在设置服务存在时把 namespace `dsh-discussion-workbench` 注册为可编辑分节，schema 只声明 `dock`（枚举 `always` / `auto` / `off`，默认 `auto`），组装层配置作为 `base` 层，效果时机声明为 `applies: 'live'`。设置页「插件 → 插件配置」按 namespace 配对本插件注册的卡片（`settings.plugin.item`，key 为同一 namespace），卡片显示当前生效值以及该字段是否被用户覆盖；保存写入设置文档的用户层，清除该字段则回退组装层。解析顺序固定为：用户层 > 组装层 `base` > schema 默认值。
- 边界与异常：F009 的显示语义不变——`auto` 仍只在该会话已使用工作台（有固定整理目标、参考材料或已打开会议）时显示摘要栏，模型上下文注入仍只跟随使用痕迹而不跟随 `dock`，会话内显示记忆（本次连接内显示过就保持）也不因配置变化被清除；本版变化的只是配置来源与生效方式。设置层保存即时生效、不需要重载插件；组装层 `cordis.patch.yml` 的 `config` 改动仍需要重载插件后才生效，实现与卡片文案都要写清这个差异。设置服务是软依赖：缺失时不注册 namespace，`dock` 只用组装层配置（等同现状），插件照常挂载并保留六个工具与技能，卡片不出现；客户端 `settingsScope` 同为软依赖，缺失时只影响卡片，不阻塞摘要栏与工作台其他功能。非法取值按 `auto` 处理并记警告：设置层写入前由 schema 拒绝非法值，因此非法值不会落盘；组装层读取时仍要归一化并告警。namespace 未对本客户端服务时卡片渲染为空。
- 验收条件：`settings.describe()` 能看到 namespace `dsh-discussion-workbench`，`applies` 为 `live`，`base` 等于组装层配置，schema 只声明 `dock`（三值枚举、默认 `auto`）；设置页出现该卡片，把 `dock` 改成 `off` 保存后新建会话不显示摘要栏，且不需要重载插件；清除该字段后回到组装层值，组装层未配置时为 `auto`；设置服务缺失时插件仍挂载、`dock` 取组装层配置、卡片不出现，摘要栏与六个工具行为不变；设置层写入非法值被拒绝且不落盘，组装层出现非法值时按 `auto` 并记警告；F009 的判定不变（`auto` 未使用不显示、已使用显示，注入只跟随使用痕迹）。
- 实现依据：已实现。[../src/index.ts](../src/index.ts)（`ctx.inject(['settings'], …)` 把 settings 作软依赖注册 namespace：`base` 取归一化后的组装层配置、`applies: 'live'`；`readDockMode()` 每次判定都读取当前解析值，不缓存挂载时快照；设置变更后按现有快照通道对已连接会话重算并重推一次状态）、[../src/shared/settings.ts](../src/shared/settings.ts)（namespace 常量，宿主与客户端共用）、[../src/context-types.ts](../src/context-types.ts)（settings 服务面）、[../src/client/index.tsx](../src/client/index.tsx)（`ctx.inject(['settingsScope'], …)` 挂载 `settings.plugin.item` 卡片，key 为 namespace）、[../cordis.patch.yml](../cordis.patch.yml)（组装层 `config` 仍是 base 来源；该文件 `inject` 与 src/index.ts 对齐且不含 settings，否则设置服务缺失会推迟整个插件挂载）。F009 的取值解析、使用痕迹判定与会话内记忆仍集中在 [../src/host/dock.ts](../src/host/dock.ts)，语义不变。
- 实现细节（与上文措辞的一处偏差，已按真实 API 修正契约）：绑定后的 scope 上 `set(field, value)`／`unset(field)` 是 `mutate` 的单操作形式，**不接受** `expectedRevision`；需要 revision 栅栏必须直接调用 `mutate([{ op: 'set' | 'unset', path: ['dock'] }], revision)`。卡片因此走 `mutate` 完成带栅栏的保存与清除，写入语义（写用户层、清除后回退组装层）与规格一致。[architecture.md](architecture.md) 的「设置页卡片」已同步为这条真实接线。
- 验证记录：2026-10-10 `npm run typecheck` 通过；`npm test` 通过（5 个文件 39 项，F009 的 26 项保持通过，新增 13 项：`tests/host-context.spec.ts` 加 1 项、新增 `tests/settings.spec.ts` 7 项、新增 `tests/client-bundle.spec.ts` 5 项）；`npm run build` 通过并生成 `lib/client.js`（46.96 kB）。新增覆盖：namespace 注册形状（`base` 取组装层配置、`applies: 'live'`、schema 只声明 `dock` 且默认 `auto`、非法 base 被 schema 拒绝）、组装层缺省时 `base` 为空分节、组装层非法取值仍挂载并告警且不把非法值写进 `base`、settings 缺失时仍挂载并只用组装层配置；设置层写入 `off` 后已使用会话快照 `dock` 变为 `false`（真实 WebSocket 桥接收宿主重推的状态）、清除覆盖后回退组装层、F009 的使用痕迹／会话内记忆／上下文注入不因配置变化被清除；客户端 bundle 冒烟（loader id、`exports.inject` 只含 `slots`、两个 slot 与卡片 key、无会话不抛错、`unavailable` 渲染为空、settingsScope 缺失只少卡片、保存按 revision 栅栏调 `mutate`）。另用两处临时实现变异（挂载时冻结取值、去掉设置变更重推）确认上述 live 生效用例会失败，用例非空断言，变异已回滚。未执行：真实宿主与页面验收——需要重载插件后才生效，本次未重启承载当前会话的环境（3080 日常实例即该进程），因此运行中的宿主仍是旧代码，设置页卡片的实际渲染、保存后的页面即时变化与 revision 冲突拒绝仍需重载后核对。

## F011 设置卡外观对齐宿主卡片

- 实现状态：已实现（2026-10-10，用户确认该版规格后开发；外观变更并入 F010 已提高到 0.3.0 的同一版本条目，本次不再提高包版本）。
- 场景与预期：F010 的设置卡不再自绘"扁平、常展开的盒子"，改为按宿主 `PluginCard` 的布局画出**可折叠卡片**：头部（`<button>`）显示插件名 + 版本号 + 一句副标题，右侧放覆盖状态（"用户覆盖"／"继承组装层"）与 chevron（展开时旋转 180°）；主体是**带分隔线的设置行**，每行左侧为标签与说明（标签 13px/20、说明 12px/18 次级色）、**控件行内右对齐**；`dock` 改用分段控件并显示中文标签「按需／始终／不显示」；保存与恢复按钮移到卡片右下角操作行。样式一律使用 `--dsw-alias-*` 主题令牌并给兜底值，数值照 [开发 Skill 的卡片外观配方](../../.agents/skills/dsh-plugin-develop/references/config-ui.md) §8（该配方已按宿主 `PluginCard` 的真实产物校正，与宿主内置卡片同页并列时以宿主数值为准）。
- 边界与异常：本次只改外观与文案，**不改 F010 的配置语义**——仍是草稿 + 保存（`mutate` 带 revision 栅栏）、清除回退组装层、设置服务软依赖，F009 的显示与注入语义也不变。不得 import `@deepseek-ai/dsh-client-ui-settings-plugins` 的值（客户端纯度门禁会拦）。卡片收起只隐藏主体、组件保持挂载，**未保存草稿不因收起丢失**；窄宽度下标签列与控件不得重叠或溢出。
- 验收条件：与宿主自带卡片、插件市场卡片并排时视觉语法一致（可折叠头部、行间分隔线、控件右对齐、操作按钮在右下角）；头部显示插件名、版本号与副标题；覆盖状态随"字段是否出现在用户层"变化；`dock` 分段控件选中态与当前生效值一致，未设置时显示"继承组装层"且默认项为「按需」；保存与恢复行为与 F010 相同；键盘可达（头部按钮可聚焦、`aria-expanded` 与主体 `id` 正确关联）。
- 实现依据：已实现。[../src/client/index.tsx](../src/client/index.tsx) 的 `DockSettingsCard`（`<section className="dwb-card">` 外框 + `<button className="dwb-card-header">` 头部带 `aria-expanded`／`aria-controls`、`<div className="dwb-card-body" id={bodyId} hidden={!open}>` 主体、`dwb-card-field` 设置行、`dwb-segmented`／`dwb-segment` 分段控件、`dwb-card-footer` 右下角操作行；样式在同文件的 `injectStyle()` 里以 `.dwb-card*` 前缀注入）、[../src/shared/settings.ts](../src/shared/settings.ts)（新增 `PLUGIN_VERSION` 常量，卡片头部版本号的来源）、[../tests/client-bundle.spec.ts](../tests/client-bundle.spec.ts)（标记与行为断言）。`DOCK_SEGMENTS` 定义分段控件的显示顺序（按需／始终／不显示）与取值映射，默认项为 `auto`。
- 实现细节（与 §8 配方的一处按真实宿主校正，已按实测值落地）：卡片外框取**宿主自己的数值**——`border:.5px solid var(--dsw-alias-border-l4)`、`border-radius:16px`、`background:var(--dsw-alias-bg-layer-3)`，展开态 `bg-layer-2` + `border-color:label-dimmed`（与 `@deepseek-ai/dsh-client-ui-settings-plugins` 产物中的 `.card`／`.cardOpen` 逐条一致，见 `.agents/skills/dsh-plugin-develop/references/config-ui.md` §8 的数值来源说明）。插件市场 1.57.0 用的是 `1px solid border-l2` + `radius:12px`，那只是它对宿主的近似；本卡片与宿主内置卡片同页并列，故以宿主为准。头部 `border-radius:12px`、`padding:14px 16px`、`gap:12px`，主体／行／操作行的 `border-top:1px solid border-l2`，分段控件与输入框数值均照 §8 不变。宿主卡片头部的 chevron 用 `IconChevronDownOutline14`，本卡片按用户要求用 16px 的等价内联 SVG，旋转仍由 `.dwb-card.is-open .dwb-card-chevron{transform:rotate(180deg)}` 承担。这两处都不影响"视觉语法一致"的验收。
- 验证记录：2026-10-10 `npm run typecheck` 通过；`npm test` 通过（5 个文件 46 项，F009 的 26 项与 F010 的 13 项保持通过；`tests/client-bundle.spec.ts` 由 5 项增至 12 项，新增 7 项）；`npm run build` 通过并生成 `lib/client.js`（53.76 kB／53756 字节，gzip 12.90 kB／12898 字节）。新增覆盖：卡片 chrome（`section` 外框、头部 `<button>` 的 `aria-expanded` 为 `false` 且 `aria-controls` 指向主体 `id`、收起态主体 `hidden` 为 `true` 而仍挂载、头部文本含插件名与 `v<package.json version>`、chevron 为 16px SVG）、分段控件三项中文标签与选中态（`auto`／`always`／`off` 三种生效值分别断言 `aria-pressed` 与 `is-active` 类名）、覆盖徽标文案随用户层变化（`user` 层有 `dock` 为「用户覆盖」+ `is-override`，否则为「继承组装层」且恢复按钮禁用）、收起不丢草稿（用会重渲染的 React 桩：未展开时改草稿 → 展开 → 再收起，草稿仍是所选项，保存写出的值与开始草拟时的 revision 栅栏不变）、样式令牌（bundle 中用到的每个 `--dsw-alias-*` 都落在 `dsh-client-ui-theme` 实测存在的清单内，且每个都带兜底值）。另用四处临时实现变异确认用例非空：去掉头部 `aria-controls`、去掉主体的 `hidden`、把分段控件选中态写死为某一项、把徽标文案写死——前两处各让 2 项失败，第三处让 2 项失败（首轮只断言 `aria-pressed` 时该变异**未被捕获**，据此补上 `is-active` 类名断言后重新确认捕获），第四处让 1 项失败；变异均已回滚，回滚后 46 项全绿。未执行：真实浏览器目视核对——需要重载插件后才生效，本次未重启承载当前会话的环境（3080 日常实例即该进程），因此卡片的实际渲染效果、与宿主自带卡片／插件市场卡片并排的视觉一致性（含外框 `.5px` + `radius:16px` 与宿主同款）、窄宽度下的布局与键盘 Tab 走查仍需用户在重载后自行确认。


## 差异与验证待办

- README 旧列举为 3 个工具，本次改为 6 个并链接注册源码。
- 当前仅 tests/store.spec.ts 有 5 个存储用例；目标绑定、上下文注入、转换／导出、宿主工具与 GUI 无同等自动覆盖。acceptance.md 旧结果只保留为历史证据，不据此宣称本次通过。
- 本仓库没有独立冻结的原始需求文件，不补写伪造历史；会议指南继续作为使用与设计来源维护。
- 2026-10-10 增量待办：F009 已实现并通过 typecheck／26 项测试／构建；真实宿主只跑了冒烟脚本的负向对照（运行中的宿主仍是旧代码），重载后的正向断言与浏览器页面验证未执行。
- 2026-10-10 F010 待办（已实现，剩余未执行项）：设置页卡片已实现并通过 typecheck／39 项测试／构建。配置改动需核对的遗留项：现网 profile 的 `cordis.patch.yml` 未覆盖本插件（插件自身为 `config: {}`，无取值），设置的 `settings.yaml` 里也还没有 `dsh-discussion-workbench` 分节，因此既没有失效字段需要清理，也没有旧用户层取值需要迁移；新增 `dock` 未配置时按 `auto`。仍未执行：重载插件后的真实宿主正向断言、设置页卡片的实际渲染与保存后页面即时变化、并发写入的 revision 冲突拒绝、assemble 层非法取值在真实宿主下是否会被 cordis 的 `Config` 校验先行拒绝（见下方待确认项）。技能目录条目（名称／描述／whenToUse）仍随每次会话出现，它是模型发现工作台的入口，本版不提供独立开关。
- 2026-10-10 F011 待办（已实现，剩余未执行项）：设置卡外观已改为镜像宿主 `PluginCard` 的可折叠卡片，通过 typecheck／46 项测试／构建。配置语义未变，因此配置遗留项核对结论与 F010 相同（现网 profile 的 `cordis.patch.yml` 未覆盖本插件，`settings.yaml` 里也没有 `dsh-discussion-workbench` 分节，无失效字段需清理、无旧用户层取值需迁移）。仍未执行：真实浏览器目视核对——需要重载插件后才生效，本次未重启承载当前会话的环境，卡片的实际渲染、与宿主自带卡片／插件市场卡片并排的视觉一致性、窄宽度布局与键盘 Tab 走查需用户重载后自行确认。
- 待确认（规格与源码现实的一处张力，F009 起就存在，本版未改其语义）：插件导出的 `Config` 用 `z.union([z.const(...)])` 声明三值枚举，schemastery 对非法取值**直接抛错**（实测 `Config({ dock: 'sometimes' })` 抛 `$.dock expected "always" | "auto" | "off" but got "sometimes"`）。而 cordis 会在调用 `apply` 前用 `Config` 校验组装层配置，因此 profile `cordis.patch.yml` 里的非法 `dock` 取值可能在进入 `apply` 之前就让插件加载失败，使 F009／F010 声明的「非法取值按 `auto` 处理并记警告」在真实组装层不可达（该分支只在直接调用 `apply`、未经 schema 校验时可达，现有假 ctx 用例即属此路径）。本版按「F009 语义不得变」保留现状（枚举 schema 与归一化告警分支都未改），待确认是否允许把 schema 放宽为字符串加运行时归一化——那会改变 F009 已确认的 schema 声明，属新增语义差异，需先确认再改。
- 待确认（F011 引入的一处技术选择）：卡片头部的版本号由共享常量 `PLUGIN_VERSION`（[../src/shared/settings.ts](../src/shared/settings.ts)）提供，并有测试断言它与 `package.json` 的 `version` 逐字一致，因此不存在漂移，但发版时需要同时改两处（测试会在漏改时失败）。之所以不从前端读取：`settings.plugin.item` 的 slot owner props 只有 `children?: never` 标记字段，宿主插件清单服务也只暴露 `entryId`／`moduleName`，都不含版本号；客户端半边既不能 import 设置卡包的值（纯度门禁），也不能读 `package.json`（浏览器闭包无 Node 能力）。若后续宿主在 slot props 或清单服务里提供版本号，应改为读宿主值并移除该常量。

## 规格变更记录

- 2026-10-03：首次从现行文档、实现和现有测试建立功能基线；仅修改维护文档，未变更 API、存储或运行逻辑。
- 2026-10-10：新增 F009（摘要栏显示策略与上下文注入条件），修订 F006 的注入条件与 F007 的显示条件；配置契约与技术契约同步到 [architecture.md](architecture.md) 的「配置契约」。本版为待用户确认的文档增量，未改动源码、测试或运行配置。
- 2026-10-10：用户确认上一版文档后实现 F009，包版本提高到 0.2.0。实现依据、测试入口与未执行项见 F009；技术契约补充实现模块位置。
- 2026-10-10：新增 F010（设置页插件配置卡片），把 [architecture.md](architecture.md) 的「配置契约」扩写为「用户层 > 组装层 > schema 默认」两层，写明 `applies: 'live'` 与组装层改动需重载的差异；F009 的显示与注入语义不变。本版为待用户确认的文档增量，未改动源码、测试或运行配置。
- 2026-10-10：用户确认上一版文档后实现 F010，包版本提高到 0.3.0。宿主注册 namespace 并把判定改为每次读取当前解析值、设置变更后重推快照；客户端新增设置卡。实现依据、测试入口与未执行项见 F010；契约补充实现模块位置，并按真实 scope API 把「带 revision 保存」修正为经 `mutate`（`set`／`unset` 不接受 `expectedRevision`）。
- 2026-10-10：新增 F011（设置卡外观对齐宿主卡片）。用户确认三项取舍：草稿 + 右下角保存（不改 F010 的保存模型）、`dock` 用分段控件并显示中文标签「按需／始终／不显示」、头部带插件版本号。本版为待用户确认的文档增量，未改动源码、测试或运行配置。
- 2026-10-10：用户确认上一版文档后实现 F011（外观与文案变化并入 0.3.0 同一版本条目，不提高包版本）；实现中按用户纠偏把卡片外框数值改为宿主 `PluginCard` 的真实值（`.5px` + `border-l4` + `radius:16px`），并把 `references/config-ui.md` §8 的配方与数值来源同步为宿主口径。F010 的配置语义与 F009 的显示／注入语义均不变。

## F018 插件列表与详情的显示名称

- 文档版：office-suite-implementation-20261018-v1；用户在本会话完整引用该实施方案并明确 PLEASE IMPLEMENT THIS PLAN，确认同版名称、简介、版本、组合和验收。原有其他待确认功能不在授权范围。
- 实现状态：已实现；验证另记。
- 场景与预期：中文显示「Irving · 办公讨论工作台」，英文显示「Irving · Office Discussion Workbench」；保留完整包名 dsh-discussion-workbench 与全部运行标识。
- 中文简介：管理参考材料、固定目标文档，联动结构化文档、视图和侧边栏工具，支持 Agent 在讨论中整理与修改文档。
- 英文简介：Manage reference materials and pin a target document, coordinating structured documents, views, and sidebar tools so Agents can organize and edit documents during discussions.
- 技术契约：导出 locale/en.json 与 locale/zh.json 的 meta.title／meta.description；exports["./locale/*.json"] 指向对应资源，files 分发 locale，package.description 使用中文简介兜底。客户端设置／详情标题同步；功能导航不强制改名。
- 验收：目标宿主从固定 tgz 解析两语言名称／简介，原生列表、详情、成员行一致；无新增布局溢出，原工具／配置／存储保持。新套件成员在隔离验证后交付日常。

## F019 统一版本与固定交付

- 实现状态：已实现；依据同版已确认实施方案。
- 包版本统一为 0.2.1-rc.2+rev.1；宿主与官方 peers 仍为实际要求的原版本。完整字符串、源码 SHA 和产物散列同时校验，不能使用忽略 build metadata 的 SemVer 判断修订升级。
- Chatty／Automation 的原比较接口保留，规范后缀改为 +rev.N，N 为无前导零的安全正整数；跨官方基线拒绝。旧版本仅由明确迁移映射及原锁／散列接管，不能把旧后缀 .1 与 rev.1 当作无需更新。
- 本包可独立安装，也可由 dsh-office-bundle 携带；套件采用 cordis:group 保留本包原条目 id、config、inject。总开关卸载全部成员，重开恢复各自 disabled；原单独 Bundle 停用选择在接管时迁移为本条目 disabled。独立入口与套件入口不能重复组装。
- 配置／数据：没有业务字段改名或存储搬迁；套件接管仅处理组合选择与既有 disabled 字段，保留未知配置、工具引用、文档和凭据。迁移 CAS／备份／冲突／回滚由根维护入口执行。
- 验收：完整产物、版本迁移、原功能回归；成员还需唯一实例、旧配置命中、总／子开关与业务资料保留。具体记录见 VERIFICATION-OFFICE-20261018.md（完成后生成）。

- 本次自动验证：53项测试通过，类型／构建或Chatty客户端／lint通过；原生固定包与日常交付尚待本次后续验收，不能复用历史结果。
