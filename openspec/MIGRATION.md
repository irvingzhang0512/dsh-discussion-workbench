# dsh-discussion-workbench 需求迁移索引

迁移日期：2026-10-22。本轮仅把既有开发需求整理为 OpenSpec，未授权待定功能实施。当前功能契约在 `openspec/specs/`；待定增量在 `openspec/changes/`，批准和完成前不合入主规格。原始需求、旧 `docs/SPEC.md` 和历史证据全文保留并冻结，不再双写活动需求。

本轮其他技术／使用文档、运行 Skill、源码、测试、配置、构建产物和个人资料全部保持原字节；它们并非永久冻结，未来已确认实现后仍应同步实际技术和使用说明。个人项目、会议、周报和业务样本不因软件规格转换而移动、重写或复制到新公共规格。

OpenSpec 校验只证明文档结构，不等于用户批准、产品实现或运行验证。新功能先维护 proposal／specs／design／tasks 和具体版 review，获确认后才改实现；已有预期不变的 Bug 可直接修复，不强制新提案，也不得改预期掩盖 Bug。纯文档不改包版本、依赖、运行锁或实装快照，不提交／推送。

## 当前能力与待定范围

主规格：[会话与材料](specs/workbench-context-and-materials/spec.md)、[摘要与工具](specs/workbench-dock-and-tools/spec.md)、[办公成员交付](specs/office-member-delivery/spec.md)。当前接口及过时接缝边界见 [CONTRACTS](CONTRACTS.md)。

待定：[Desktop 讨论工作流](changes/desktop-discussion-workflows/proposal.md)（F012–F017）、[语音后续设想](changes/meeting-voice-followups/proposal.md)、[通用与会议工具指引](changes/workbench-tool-guidance/proposal.md)。均待确认，文档迁移没有改运行 Skill、注册名或场景。

## 状态和旧文档冲突的处理

- F001–F008 已有基础实现；F009/F010/F011 在 2026-10-10 后续确认并实现。旧 SPEC 顶部仍留“F010 未实现”的阶段文字，以后文实现依据、同日变更记录与验收记录解释，不删除历史。
- F012–F017 为 20261014 具体草案，待确认／待实现；既有 F001–F011 的基础实现不等于该新组合所有适配已完成。F018/F019 是后续已确认名称、版本和套件交付，不扩大前述业务范围。
- 20261017 已落地 Connection、公开 WS 和冷会话只读 inspect/cwd；它优先于早期旧宿主接缝。历史 settings.register/settingsScope 仅可选旧服务存在时工作，不是当前 Desktop 统一入口；新 configForms／plugins.bundle.config 与 dockMode／专用迁移路由仍属 F012 待定。当前 dock 及继承／草稿预期保留。
- 非法旧组装值应 auto+告警是既有预期；schema 在 apply 前拒绝的缺口不能通过改规格合法化。真实装载路径验证放 F012；历史假 ctx 和已有测试不是充分证明。
- 当前 search_meeting_source 只检查每份材料前 20000 字符的首个匹配，不能声称全文搜索。F016 保存完整长文尾部／跨页检索要求。
- 当前 DOCX 依赖外部 PowerShell；F014 的内置提取／图片材料尚未完成。F015 的指纹、过期链、明确角色和索引／PDF 事务也不由既有基础导出自动满足。
- 卡片版本常量已有一致性检查；“若宿主提供实际版本则改用宿主”仅技术选项，没有已存在 API 或实施承诺。
- 新公开规格仅写通用项目接口和事实保护；原指南与草案中的个人项目路径、真实会议与业务资料原位保留，不复制。历史项目节点往返／桥接样本仅可行性证据，非插件验收。

## 未进入旧 SPEC 的来源去向

| 来源标识 | 去向和原状态 |
|---|---|
| docs/voice-meeting-minutes-guide.md 的音频导入、连续听写、确定性命令、语音选候选和可打断 TTS | meeting-voice-followups；跨插件归属、接口、参数和验收未决定，不照搬示例值 |
| 同指南的明确落稿、原文／确认结论分开、分段读材料、版本目标和成组撤销规则 | 现行 F002/F003/F006/F008 的指引；私人例子保持原文件 |
| workbench-tool-groups-20261018-v1（根维护讨论来源标识） | workbench-tool-guidance；建议单份 Skill 分为是否需要工作台→通用流程→会议扩展；当次只确认名称／套件，工具分组与改名未实施 |
| 同讨论中的通用检索命名、别名／旧名过渡、general 场景与条件暴露工具 | 保留为 open questions，不默认新增名称、场景或动态注册；全文检索由 F016 负责 |

## 原实现和验证依据

现状源码依据在 src/index.ts、src/host/store.ts、src/host/tools.ts、src/host/bridge.ts、src/host/dock.ts、src/client/index.tsx 及原 SPEC 的对应测试链接。本轮仅静态核对、未执行产品验证。

历史分层：2026-10-03 的 store／UI 静态及 5 项测试、旧 Web 基础桥接不代表新 Desktop；2026-10-10 F009 为 26 项、F010 为 39 项、F011 为 46 项，记录里明确存在未重载真实页面范围。2026-10-17 53 项及真实 carrier／冷会话绑定，不含真实模型、录音、云 TTS 或 IM；2026-10-18 53 项、原生名称／唯一组合与基础创建修改保存撤销／三视图目标保持。F004/F005 等早期无专项自动测试事实保留；完整 F012–F017 仍待验收。

## 全部原文档分类

| 原文件 | 职责、迁移去向与状态 |
|---|---|
| [docs/DESKTOP-WORKFLOWS-20261014.md](../docs/DESKTOP-WORKFLOWS-20261014.md) | F012–F017 完整草案 → changes/desktop-discussion-workflows，仍待确认／待实现。 |
| [AGENTS.md](../AGENTS.md) | 维护规则；仅改需求入口与状态边界。 |
| [README.md](../README.md) | 产品使用入口；当前规格改链本索引，产品描述保持。 |
| [docs/CHANGELOG.md](../docs/CHANGELOG.md) | 历史版本和已有工作区改动；冻结证据，不伪造本轮运行。 |
| [docs/DSH-UPGRADE-20261011.md](../docs/DSH-UPGRADE-20261011.md) | 未确认旧宿主适配草案；原业务预期留主规格，新配置与输入接缝合入待定 F012，已交付兼容以 20261017 为证。 |
| [docs/DSH-UPGRADE-20261017.md](../docs/DSH-UPGRADE-20261017.md) | 已确认兼容、53 项测试及冷会话／三桥局部证据；未实施完整 Desktop 工作流。 |
| [docs/SPEC.md](../docs/SPEC.md) | 旧 F001–F019 与多时期状态；全文冻结，冲突按下方时间与范围解释。 |
| [docs/VERIFICATION-OFFICE-20261018.md](../docs/VERIFICATION-OFFICE-20261018.md) | 53 项、名称／固定组合、原生基础文档目标与视图链路证据；不代表图片／双稿生命周期／项目流程完成。 |
| [docs/acceptance.md](../docs/acceptance.md) | 原分阶段验收：2026-10-03、10-10 等，保留未执行和环境限制。 |
| [docs/architecture.md](../docs/architecture.md) | 现状与历史／待定技术契约；本轮字节保持，新方案技术完整放 desktop-discussion-workflows/design.md。 |
| [docs/voice-meeting-minutes-guide.md](../docs/voice-meeting-minutes-guide.md) | 使用指南与原业务样例保持不变；通用明确落稿／材料核验规则归主规格，后续语音愿望归 meeting-voice-followups，不复制真实会议内容。 |
| [skills/discussion-workbench/SKILL.md](../skills/discussion-workbench/SKILL.md) | 现有随包运行 Skill，字节保持；其行为指引与六工具现状不因新建议改变。 |

## 原 F 编号到 Requirement 与验收场景

下面使用精确 Requirement 标题和场景名；主规格为已落地行为契约，changes 仍待定。条目存在不等于本轮运行通过。

| 原编号／来源 | 规格与 Requirement | 验收场景 | 实现／验证归属 |
|---|---|---|---|
| F012 | [F012 冷会话和场景默认](changes/desktop-discussion-workflows/specs/desktop-workbench-session/spec.md) | 未打开界面的冷会话；旧状态缺少新场景字段 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F012 | [F012 固定目标的宿主租约](changes/desktop-discussion-workflows/specs/desktop-workbench-session/spec.md) | 绑定中途失败；页面断开 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F012 | [F012 Desktop 通信信任边界](changes/desktop-discussion-workflows/specs/desktop-workbench-session/spec.md) | 伪造来源或会话 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F012 | [F012 配置继承与所有者唯一](changes/desktop-discussion-workflows/specs/desktop-workbench-session/spec.md) | 编辑唯一所有者；所有者不唯一 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F012 | [F012 非法旧值与可选设置服务](changes/desktop-discussion-workflows/specs/desktop-workbench-session/spec.md) | 旧配置非法 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F012 | [F012 显式配置迁移和恢复](changes/desktop-discussion-workflows/specs/desktop-workbench-session/spec.md) | 迁移后并发修改；应用或恢复失败 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F015 | [F015 角色发现与清空旧会议关系](changes/desktop-discussion-workflows/specs/meeting-document-lifecycle/spec.md) | 缺失或多份角色候选 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F015 | [F015 显式登记与并发保护](changes/desktop-discussion-workflows/specs/meeting-document-lifecycle/spec.md) | 两会话修改同会议 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F015 | [F015 来源指纹和过期状态](changes/desktop-discussion-workflows/specs/meeting-document-lifecycle/spec.md) | 源记录修改 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F015 | [F015 元信息与来源引用](changes/desktop-discussion-workflows/specs/meeting-document-lifecycle/spec.md) | 元信息或关联变化 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F015 | [F015 本地定稿索引与部分成功](changes/desktop-discussion-workflows/specs/meeting-document-lifecycle/spec.md) | 正文已存但索引不可写 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F015 | [F015 PDF 只来自当前已保存纪要](changes/desktop-discussion-workflows/specs/meeting-document-lifecycle/spec.md) | 导出期间编辑纪要；损坏输出或取消 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F017 | [F017 工作区规则与目标分离](changes/desktop-discussion-workflows/specs/project-skill-coordination/spec.md) | 进入不同项目 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F017 | [F017 任务与进度事实保护](changes/desktop-discussion-workflows/specs/project-skill-coordination/spec.md) | 更新部分进展 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F017 | [F017 重复标识与冲突处理](changes/desktop-discussion-workflows/specs/project-skill-coordination/spec.md) | 重复任务编号 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F017 | [F017 周报与只读计划汇总](changes/desktop-discussion-workflows/specs/project-skill-coordination/spec.md) | 生成周报或查看日周事项 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F014 | [F014 文件类型与实际内容](changes/desktop-discussion-workflows/specs/rich-source-materials/spec.md) | 伪装后缀或破损文件 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F014 | [F014 派生内容与原件保护](changes/desktop-discussion-workflows/specs/rich-source-materials/spec.md) | 含图片表格的 DOCX | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F014 | [F014 材料发布原子性与路径围栏](changes/desktop-discussion-workflows/specs/rich-source-materials/spec.md) | 越界或保存中断 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F014 | [F014 真正图像附件与能力降级](changes/desktop-discussion-workflows/specs/rich-source-materials/spec.md) | 图片可用与不可用；取消图片处理 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F014 | [F014 图像分析需显式核对](changes/desktop-discussion-workflows/specs/rich-source-materials/spec.md) | 模型识别手写图 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F013 | [F013 普通讨论不建立文档任务](changes/desktop-discussion-workflows/specs/thinking-discussion/spec.md) | 从聊天转为落稿 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F013 | [F013 批量修改与指代保护](changes/desktop-discussion-workflows/specs/thinking-discussion/spec.md) | 局部改写或重排 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F013 | [F013 已保存但未登记的恢复](changes/desktop-discussion-workflows/specs/thinking-discussion/spec.md) | 登记故障 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F016 | [F016 十二工具与旧调用兼容](changes/desktop-discussion-workflows/specs/workbench-model-tools/spec.md) | 旧工具和新职责 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F016 | [F016 完整文本搜索与分页](changes/desktop-discussion-workflows/specs/workbench-model-tools/spec.md) | 命中在材料尾部；继续读取 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F016 | [F016 文件发现只读与候选](changes/desktop-discussion-workflows/specs/workbench-model-tools/spec.md) | 同名文件与部分不可读目录 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F016 | [F016 变更请求幂等边界](changes/desktop-discussion-workflows/specs/workbench-model-tools/spec.md) | 重复提交和不同参数复用 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F016 | [F016 结构化真实结果](changes/desktop-discussion-workflows/specs/workbench-model-tools/spec.md) | 部分完成 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F016 | [F016 会议工具不隐式写正文](changes/desktop-discussion-workflows/specs/workbench-model-tools/spec.md) | 未登记纪要时选择或导出 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| 旧草案未来／建议 | [音频导入及材料链](changes/meeting-voice-followups/specs/meeting-voice-followups/spec.md) | 音频转写不完整 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| 旧草案未来／建议 | [连续听写与恢复监听](changes/meeting-voice-followups/specs/meeting-voice-followups/spec.md) | 讨论连续模式 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| 旧草案未来／建议 | [确定性命令与候选消歧](changes/meeting-voice-followups/specs/meeting-voice-followups/spec.md) | 候选已变化 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| 旧草案未来／建议 | [可打断语音播报](changes/meeting-voice-followups/specs/meeting-voice-followups/spec.md) | 用户中断播报 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| 旧草案未来／建议 | [通用与会议职责分组](changes/workbench-tool-guidance/specs/workbench-tool-guidance/spec.md) | 仅把会议文档当材料 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| 旧草案未来／建议 | [按明确任务使用工具](changes/workbench-tool-guidance/specs/workbench-tool-guidance/spec.md) | 继续已有任务 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| 旧草案未来／建议 | [单份技能分段与名称过渡](changes/workbench-tool-guidance/specs/workbench-tool-guidance/spec.md) | 评估通用检索名称 | 待确认／待实现，见该 change 的 review；无本轮产品验证 |
| F018 | [F018 双语展示及身份保持](specs/office-member-delivery/spec.md) | 固定包展示 | 已有行为；原范围与证据见上方状态说明及原 SPEC，不新增验证声明 |
| F019 | [F019 完整修订与唯一组合](specs/office-member-delivery/spec.md) | 套件与独立来源 | 已有行为；原范围与证据见上方状态说明及原 SPEC，不新增验证声明 |
| F019 | [F019 启停与资料保留](specs/office-member-delivery/spec.md) | 总开关重开 | 已有行为；原范围与证据见上方状态说明及原 SPEC，不新增验证声明 |
| F001 | [F001 会话场景与隔离快照](specs/workbench-context-and-materials/spec.md) | 会话隔离与保存失败 | 已有行为；原范围与证据见上方状态说明及原 SPEC，不新增验证声明 |
| F002 | [F002 固定目标独立于浏览候选](specs/workbench-context-and-materials/spec.md) | 浏览材料不替换目标；绑定失败 | 已有行为；原范围与证据见上方状态说明及原 SPEC，不新增验证声明 |
| F003 | [F003 材料添加移除及分页读取](specs/workbench-context-and-materials/spec.md) | 完整分页及移除；路径及格式边界 | 已有行为；原范围与证据见上方状态说明及原 SPEC，不新增验证声明 |
| F004 | [F004 会议信息与角色文件](specs/workbench-context-and-materials/spec.md) | 保存重载会议信息 | 已有行为；原范围与证据见上方状态说明及原 SPEC，不新增验证声明 |
| F005 | [F005 外部 DOCX 转换与 PDF 输出](specs/workbench-context-and-materials/spec.md) | 外部条件齐全；外部转换能力缺失 | 已有行为；原范围与证据见上方状态说明及原 SPEC，不新增验证声明 |
| F008 | [F008 反馈与跨插件协作](specs/workbench-context-and-materials/spec.md) | 事件与目标一致；进程结束 | 已有行为；原范围与证据见上方状态说明及原 SPEC，不新增验证声明 |
| F006 | [F006 六工具与上下文注入](specs/workbench-dock-and-tools/spec.md) | 普通聊天与激活 | 已有行为；原范围与证据见上方状态说明及原 SPEC，不新增验证声明 |
| F009 | [F009 显示策略与使用痕迹](specs/workbench-dock-and-tools/spec.md) | 三模式交叉验证 | 已有行为；原范围与证据见上方状态说明及原 SPEC，不新增验证声明 |
| F009 | [F009 会话内显示记忆与异常预期](specs/workbench-dock-and-tools/spec.md) | 使用痕迹清空及重连 | 已有行为；原范围与证据见上方状态说明及原 SPEC，不新增验证声明 |
| F007 | [F007 摘要栏布局与可访问操作](specs/workbench-dock-and-tools/spec.md) | 窄窗口和长名称 | 已有行为；原范围与证据见上方状态说明及原 SPEC，不新增验证声明 |
| F010 | [F010 设置继承与即时用户覆盖](specs/workbench-dock-and-tools/spec.md) | 保存和清除覆盖；软依赖缺失 | 已有行为；原范围与证据见上方状态说明及原 SPEC，不新增验证声明 |
| F010 | [F010 草稿及配置版本保护](specs/workbench-dock-and-tools/spec.md) | 配置并发冲突 | 已有行为；原范围与证据见上方状态说明及原 SPEC，不新增验证声明 |
| F011 | [F011 可折叠配置卡](specs/workbench-dock-and-tools/spec.md) | 卡片交互及继承显示；版本和样式 | 已有行为；原范围与证据见上方状态说明及原 SPEC，不新增验证声明 |

## 本轮检查

新增内容仅在 openspec 内，允许的既有修改仅 AGENTS／README 文档路由。严格 CLI 校验与逐文件前置哈希核对另在迁移交付记录汇总；源码、运行 Skill、技术说明、原始需求、旧 SPEC、历史证据及个人资料不得变化。本轮不运行 typecheck／产品测试／构建，不执行安装、迁移、提交或推送。


## 2026-11-04 rc5升级增量

[adapt-dsh-021-rc5 v1](changes/adapt-dsh-021-rc5/proposal.md) 承接本次固定组合适配；具体文档待确认、实现待实施、验证另记。既有编号及历史证据保持，未确认前不合入主规格。


## 2026-11-04 DSH 0.2.2-rc.1 升级增量

[adapt-dsh-022-rc1 v1](changes/adapt-dsh-022-rc1/proposal.md) 记录新目标的适配、迁移与验收；具体文件待确认、实现待实施，验证另记。旧编号及历史来源保持，未提前同步主规格。
