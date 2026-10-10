# 第一阶段验收记录

更新时间：2026-10-10（Asia/Shanghai）。

## 2026-10-10：0.3.0 设置页插件配置卡片（F010）

- `npm run typecheck` 通过；`npm test` 通过（5 个文件 39 项，F009 的 26 项保持通过，新增 13 项）；`npm run build` 通过并生成 `lib/client.js`（46.96 kB）。`npm test` 现在先重建客户端 bundle（`build:client`）再跑 vitest。
- 新增 `tests/settings.spec.ts`（7 项）。用假 ctx 加**真实 WebSocket 桥**（进程内 http server + `ws` 客户端连 `/discussion-workbench/ws`）观察宿主实际下发的状态快照：namespace 注册为 `dsh-discussion-workbench`、`applies` 为 `live`、`base` 等于组装层配置（`{ dock: 'always' }`；组装层为 `{}` 时为空分节）、schema 只声明 `dock`（默认 `auto`，非法取值被拒绝）；组装层非法取值 `sometimes` 时插件仍挂载、告警一次且不把非法值写进 `base`；settings 服务缺失时仍把 settings 作为软依赖请求、六工具照常注册、`dock=always` 让未使用会话显示摘要栏且不注入空上下文块；设置层写入 `off` 后已使用会话的快照 `dock` 由 `true` 变 `false`（不需要重载插件，痕迹不变）；清除覆盖后回退组装层；F009 的使用痕迹／会话内记忆／上下文注入都不因配置变化被清除。
- 新增 `tests/client-bundle.spec.ts`（5 项）：`node:vm` + React 桩 + 假 `window.__ModuleLoader__` 执行 `lib/client.js`，核对 loader id 为 `dsh-discussion-workbench`、`exports.inject` 只含 `slots`（settingsScope 未写进入口）、注册 `conversation.input.dock` 与 `settings.plugin.item` 两个 slot 且卡片 `key` 等于 namespace、绑定 namespace 正确；无会话时摘要栏返回 null 且副作用不抛错；`unavailable` 时卡片渲染为空；settingsScope 缺失时只少一张卡；保存／清除按 revision 栅栏调用 `mutate`（`[{ op: 'set', path: ['dock'], value: 'off' }], 3` 与 `[{ op: 'unset', path: ['dock'] }], 3`），未改动时保存按钮禁用。
- `tests/host-context.spec.ts` 补 1 项：settings 缺失时仍挂载、把 settings 作为软依赖请求、不写进入口 `inject`。
- 用例有效性反证：临时把实现变异为「挂载时冻结取值」时，2 项 live 生效用例失败；变异为「不重推设置变更」时 3 项失败；两次变异均已回滚，最终 39 项全绿。这确认新增用例不是空断言。
- 未执行：重载插件后的真实宿主正向断言与浏览器页面验收。宿主半侧改动需重启进程才生效，本次未重启承载当前会话的环境（3080 日常实例即该进程），因此运行中的宿主仍是旧代码；设置页卡片的实际渲染、保存后的页面即时变化、并发写入的 revision 冲突拒绝仍待重载后核对。

## 2026-10-10：0.2.0 摘要栏显示策略与上下文注入条件

- `npm run typecheck`、`npm test`（3 个文件 26 项）和 `npm run build` 通过；`lib/host/dock.js` 已生成，`node -e "import('./lib/index.js')"` 可加载导出 `apply`／`Config`。
- 新增 `tests/dock.spec.ts`：取值解析（含未提供、`null`、空字符串与非法取值）、使用痕迹判定（目标／材料／会议任一存在即已使用）、会话内记忆（`auto` 显示后保持、`release` 后重新判定、会话间隔离、`always`／`off` 行为）。
- 新增 `tests/host-context.spec.ts`：用假 ctx 跑真实 `apply()`。核对空配置对象、缺省配置均不告警且注册 6 个工具；未使用工作台的会话（含已建立状态后）不注入 `[讨论工作台上下文]`；设置固定整理目标或仅添加参考材料后注入，且会话之间隔离；`dock=always` 时未使用仍不注入；`dock=off` 时工具仍注册、已使用的会话仍注入；非法取值 `sometimes` 记录警告、按 `auto` 处理且不中断挂载。
- 真实宿主协议冒烟脚本：`.test-runs/discussion-workbench/dock-smoke.mjs`（一次性会话 id 连接工作台桥，核对 `dock` 判定、激活与会话内保持，不打开浏览器、不调用模型）。重载前作为负向对照跑过一次，输出为 `FAIL 宿主已下发 dock 判定 — 缺少 dock 字段：插件宿主半侧尚未重载`，确认脚本连通正常且运行中的宿主仍是旧代码。
- 未执行：重载后的正向断言（正例需宿主加载新代码）、浏览器页面验收。客户端渲染分支（宿主未判定为真时不渲染）没有自动化覆盖；本次未重启承载当前会话的环境（3080 日常实例即该进程），交接记录见根仓库 `.local/handoff.md`。

## 2026-10-03：0.1.1 摘要 UI 验证

- `npm run typecheck`、`npm test`（5 项）和 `npm run build` 通过。
- 生产客户端 bundle 的 VM 冒烟通过：无会话、空上下文、项目场景与长名称、展开/收起、详情区域的 ARIA 关联。新样式引用的 11 个宿主变量均在本地 DSH `0.1.5-rc.2` 中存在。
- 浏览器控制桥连接失败，内置浏览器不可用，尚未完成真实页面的宽窄栏、浅深色主题和键盘截图验收。这些自动化结果不作为完整 GUI 兼容验证。

## 自动化验证

- `dsh-better-sidebar-controller`: 132 项测试通过。
- `dsh-structured-document`: 101 项测试通过。
- `dsh-structured-document-view`: 129 项测试通过。
- `dsh-discussion-workbench`: 3 项测试通过。
- 四个插件均通过 TypeScript 检查和生产构建。

文档事务测试覆盖整篇替换后整次撤销、多个节点批量修改只提交一次、陈旧版本拒绝、同名新建自动追加序号、保存失败回滚和外部修改检测。原有场景测试继续覆盖同名节点消歧、属性缺失与非法属性、会话隔离和单节点操作。

## 真实 DSH 宿主检查

在 `web` profile 安装四个插件并启动真实 DSH Web 宿主后完成以下检查：

- 根页面与工作台客户端包返回 HTTP 200；启动载荷包含 `dsh-discussion-workbench`。
- 客户端包包含 `conversation.input.dock` 状态栏、固定目标 API 和直接视图切换命令。
- 客户端包包含首段模型文本、材料读取、模型工具轮次、文档提交和视图刷新的真实耗时栏。
- 同一真实宿主中连接工作台、Sidebar Controller 和 Structured Document View 三条 WebSocket。
- Sidebar 浏览 `参考材料.txt` 时，工作台目标仍为 `固定目标.md`，结构化文档标题保持“固定目标”。
- 工作台直接把视图从 Markdown 切换为思维导图，视图状态回传成功。
- 解除固定目标后文档区进入真实空态，不会回退跟随仍在浏览的参考文件。

宿主烟测脚本及固定输入保存在仓库根目录 `.test-runs/discussion-workbench/`。它不调用模型，因此不会产生模型费用。

## 尚需人工页面验收的部分

当前自动化环境没有可用的 DSH 内置浏览器控制工具，无法保留点击后的页面截图，也没有代表用户发送真实模型对话。上线前仍应在实际页面各跑一次会议与项目完整对话，检查文案、布局、工具轨迹和模型等待耗时。文档提交到宿主状态更新的内核路径已由测试覆盖；P95 页面刷新指标需要在固定浏览器环境采样。
