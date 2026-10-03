# dsh-discussion-workbench

当前功能与验收以 [docs/SPEC.md](docs/SPEC.md) 为入口；原始需求保留为历史来源，技术契约见规格内的文档索引。功能任务先改规格与相关技术契约，用户明确确认该版文档后再开发；已确认同一版不重复询问。Bug 按已有且不变的预期查源码修复。


DSH 文字讨论工作台。它在原生输入框上方显示会议/项目场景、参考材料、固定整理目标、当前节点和最近一次文档变更，并把同一份上下文注入每个模型步骤。

摘要卡片与输入框同宽：场景独立标记，材料数量用徽标显示，未设置的目标和节点弱化；长名称悬停可查看全文。窄栏自动分行，颜色跟随 DSH 主题，点击整行或用键盘可展开设置。

提供六个工具：`open_meeting_workbench`、`update_meeting_info`、`get_workbench_context`、`set_workbench_context`、`read_material`、`search_meeting_source`（注册见 [tools.ts](src/host/tools.ts)）。文档内容仍由 `dsh-structured-document` 负责，视图仍由 `dsh-structured-document-view` 负责，浏览状态由 `dsh-better-sidebar-controller` 提供。工作台把这三项声明为宿主依赖，确保服务完成挂载后再开始会话协调。

```powershell
npm install
npm run build
dsh plugin --profile web add .
```

实现边界见 [docs/architecture.md](docs/architecture.md)，当前验证证据见 [docs/acceptance.md](docs/acceptance.md)。

会议录音和转写的实际操作方式见 [用语音整理会议纪要](docs/voice-meeting-minutes-guide.md)。
