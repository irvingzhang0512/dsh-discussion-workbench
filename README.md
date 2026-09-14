# dsh-discussion-workbench

DSH 文字讨论工作台。它在原生输入框上方显示会议/项目场景、参考材料、固定整理目标、当前节点和最近一次文档变更，并把同一份上下文注入每个模型步骤。

提供三个工具：`get_workbench_context`、`set_workbench_context`、`read_material`。文档内容仍由 `dsh-structured-document` 负责，视图仍由 `dsh-structured-document-view` 负责，浏览状态由 `dsh-better-sidebar-controller` 提供。工作台把这三项声明为宿主依赖，确保服务完成挂载后再开始会话协调。

```powershell
npm install
npm run build
dsh plugin --profile web add .
```

实现边界见 [docs/architecture.md](docs/architecture.md)，当前验证证据见 [docs/acceptance.md](docs/acceptance.md)。
