# 现状技术契约与版本边界

本轮原 docs/architecture.md 和使用指南字节不改；后续已确认功能实现仍应同步实际技术与使用说明。冻结的是旧 SPEC、原始需求和历史证据，不能因迁移永久冻结技术维护。

## 已落地现状

- 当前场景 meeting|project；状态按会话保存在 .dsh-workbench/sessions/<session>.json，返回隔离快照，写入失败保持旧状态。材料与固定目标分离，材料路径遵守真实 cwd，JSON 可为材料不自动成为允许格式目标。
- 工具共六个：open_meeting_workbench(folder)、update_meeting_info（时间／地点／参与者／主题／记录人）、get_workbench_context、set_workbench_context（scene/target_file/add_material_path/pasted_material/remove_material_id）、read_material(material_id/offset/max_chars)、search_meeting_source(query/max_chars)。实际参数可选性与输出实现仍由现行工具 schema 定义；不把待定十二工具当现行。
- read_material 默认 12000、单次最多 20000 字符，可用 offset 继续。当前 search_meeting_source 对每份材料只读前 20000 字符做首个匹配；会搜索已登记材料而不要求 meeting 场景，但没有完整长文检索保证。完善需求在 F016。
- 文档绑定串行、真实 revision／node；失败恢复旧绑定或报告 targetBindingError，浏览候选不改变固定目标。真正修改、保存、撤销由文档插件承担；撤销日志不是跨宿主重启持久能力。
- DOCX 当前经外部 PowerShell 转换脚本；PDF 当前依赖 pwsh、HTML 与可用浏览器，不是新增内置 Mammoth 材料链。外部条件缺失必须报错。
- 2026-10-17 已落地 Connection 原生鉴权、公开 WS 地址、冷会话只读 inspect 获取真实 cwd；不依赖 UI hello 才拿到目录，但不代表 F012 整套新租约和配置迁移已经完成。

## 摘要与配置的当前边界

dock=auto|always|off，默认 auto。显示和模型上下文注入分离；auto 使用痕迹含目标、材料、已开会议，连接内显示记忆不落盘。隐藏仍连接状态通道、六工具与 Skill 保持。

历史独立即时卡片的 settings/register 与 settingsScope 只在旧服务确实存在时可用，不是新 Desktop 统一接缝。当前 README 明确可查看 Desktop 组件 dock 组装配置，组装修改需重载；不得声称新版 configForms／plugins.bundle.config、dockMode 或专用迁移路由已完成。新 Desktop 接缝归待定 F012。既有产品预期仍为用户层优先、显式草稿保存、固定 revision 拒绝并发覆盖、重置回继承；非法组装值 auto+告警预期不变，但真实 schema 先拒绝可能让 apply 兜底达不到，保留缺口而不改预期。

既有卡片设计：可折叠 button 头部、真实版本、覆盖标记与 180° chevron；主体保持挂载、收起保草稿；标签 13px/20、说明 12px/18，分隔线、右对齐控件、右下操作；真实宿主主题变量与兜底，外框 .5px、border-l4、16px 圆角。版本常量与 package 校验，未来仅在宿主确有版本来源时才考虑替换，不假装已有 API。

## 新旧字段不可混用

当前配置名 dock；草案 F012 拟 dockMode，旧值映射／清理须按该 change 的预览、确认、备份、CAS 和未知字段保留完成后才切换。当前没有 thinking 场景、全部十二工具、图片待核对链、完整来源指纹、会议索引事务或项目自动流程的验收证据。

较新包 0.2.1-rc.2+rev.1 的套件显示和组合事实见 office-member-delivery；其名称／版本变更未扩展业务。完整行为以主规格和待定增量分开维护。既有实际接口详细说明仍见 [架构](../docs/architecture.md)，历史与新提案的关系见 [迁移表](MIGRATION.md)。
