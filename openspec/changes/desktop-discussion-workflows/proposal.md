# Desktop 讨论、材料和会议工作流

## Why

F012–F017 及 2026-10-14 草案要求普通讨论可逐步落稿、材料可追溯、会议记录与纪要各有生命周期，项目流程复用所在项目规则。2026-10-17 的宿主兼容与 2026-10-18 的套件基础交付只证明部分现有能力，不能证明本完整方案已实现。

## What Changes

- 适配 Desktop 冷会话、固定文档绑定、设置所有者与配置迁移。
- 新增 thinking 讨论场景，明确落稿意图与局部修改保护。
- 支持 DOCX 和图片材料、派生文本、真实附件与待核对分析。
- 建立会议角色文件、来源指纹、过期状态、本地定稿索引和安全 PDF 导出。
- 保留旧六工具并拟扩展至十二工具，补齐全文搜索、分页、结果和幂等契约。
- 将项目主文档、结构数据、任务和周报流程与工作区已有 Skill 协调；不复制个人业务资料。

## Capabilities

### New Capabilities

- `desktop-workbench-session`: F012 的宿主会话、绑定及配置迁移增量。
- `thinking-discussion`: F013 的讨论到落稿流程。
- `rich-source-materials`: F014 的 DOCX、图片和派生材料。
- `meeting-document-lifecycle`: F015 的会议双稿、索引和 PDF 生命周期。
- `workbench-model-tools`: F016 的工具扩展、结果及重试边界。
- `project-skill-coordination`: F017 的项目与周报协作规则。

### Modified Capabilities

无直接同步主规格；确认并完成后按领域整合既有能力与增量。

## Impact

涉及工作台服务、会话状态、文件材料、图片附件、配置桥接和捆绑 Skill；依赖文档、视图、侧边栏公开接口与宿主会话／附件服务。原草案目标 DSH 0.2.0-rc.2／Better Sidebar 0.25.0；后续已兼容的 DSH 0.2.1-rc.2／Better Sidebar 0.28.0 不自动批准本变更。所有任务待确认、待实施。
