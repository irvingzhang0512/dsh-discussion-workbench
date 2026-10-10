# dsh-discussion-workbench

当前功能与验收以 [docs/SPEC.md](docs/SPEC.md) 为入口；原始需求保留为历史来源，技术契约见规格内的文档索引。功能任务先改规格与相关技术契约，用户明确确认该版文档后再开发；已确认同一版不重复询问。Bug 按已有且不变的预期查源码修复。


DSH 文字讨论工作台。它在原生输入框上方显示会议/项目场景、参考材料、固定整理目标、当前节点和最近一次文档变更，并在使用工作台的会话里把同一份上下文注入每个模型步骤。

摘要卡片与输入框同宽：场景独立标记，材料数量用徽标显示，未设置的目标和节点弱化；长名称悬停可查看全文。窄栏自动分行，颜色跟随 DSH 主题，点击整行或用键盘可展开设置。

## 摘要栏显示策略

默认只在已使用工作台的会话里出现摘要栏并注入工作台上下文；没有整理目标、参考材料或已打开会议的普通会话不显示、也不注入。

```yaml
# profiles/<profile>/cordis.patch.yml
- id: dsh-discussion-workbench
  config:
    dock: auto   # always 所有会话都显示；auto（默认）只在已使用工作台的会话显示；off 任何会话都不显示
```

六个工具与技能始终注册，不受该配置影响。上面这段组装层配置在插件重载后生效；未识别的取值按 `auto` 处理并记录警告。摘要栏完全由宿主下发的判定决定：宿主尚未重载、还没下发该判定时，页面不显示摘要栏。

同一个 `dock` 也可以在设置页「插件 → 插件配置」里改：解析顺序是**用户层（设置页）> 组装层（`cordis.patch.yml` 的 `config`）> schema 默认值**。**设置页保存即时生效、不需要重载插件**，并会同步到已打开的页面；**组装层 `cordis.patch.yml` 的改动仍需重载插件**。卡片会标明该字段是否被用户覆盖，清除后回退组装层；没有 `settings` 服务时用组装层配置，卡片不出现。两层契约见 [docs/architecture.md](docs/architecture.md#配置契约)，功能编号见 [docs/SPEC.md](docs/SPEC.md) 的 F009／F010。

提供六个工具：`open_meeting_workbench`、`update_meeting_info`、`get_workbench_context`、`set_workbench_context`、`read_material`、`search_meeting_source`（注册见 [tools.ts](src/host/tools.ts)）。文档内容仍由 `dsh-structured-document` 负责，视图仍由 `dsh-structured-document-view` 负责，浏览状态由 `dsh-better-sidebar-controller` 提供。工作台把这三项声明为宿主依赖，确保服务完成挂载后再开始会话协调。

```powershell
npm install
npm run build
dsh plugin --profile web add .
```

实现边界见 [docs/architecture.md](docs/architecture.md)，当前验证证据见 [docs/acceptance.md](docs/acceptance.md)。

会议录音和转写的实际操作方式见 [用语音整理会议纪要](docs/voice-meeting-minutes-guide.md)。
