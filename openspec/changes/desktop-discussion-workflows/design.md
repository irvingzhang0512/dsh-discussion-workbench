# Desktop 工作流技术设计（待确认）

## Context

原版为 discussion-desktop-workflows-20261014-v1，来自冻结的本库 docs/DESKTOP-WORKFLOWS-20261014.md、SPEC F012–F017 与架构补充。原定 DSH 0.2.0-rc.2、Better Sidebar 0.25.0；2026-10-17 完成的较新宿主兼容，以及 2026-10-18 套件交付，不能代替本整套方案确认。具体验收目标需实施前重新核定。本文件仅迁移通用软件契约，个人项目内容不复制。

## Goals / Non-Goals

支持普通讨论、富材料、会议双稿和项目协作，保持固定目标、版本、来源和失败结果可核验。不自动写会议正文、不自动生成任务、不自行调用第二个识图模型、不引入任意 shell 工具、不对外发布会议、不复制用户项目资料、不因页面断线解除宿主绑定。

## Decisions

### F012 会话、绑定与客户端

- 通过真实 session header 的 cwd 和持久 store 恢复冷会话；工具、动态上下文均能触发，不依赖 UI hello。scene 为 meeting|project|thinking，旧状态缺省 meeting；单有 scene 不算使用痕迹。
- 调用 structuredDocument.claimBinding(session, 'discussion-workbench') 持有宿主 lease；显式 bind/unbind/release，pinned=null 同步解绑。按会话串行绑定、目标持久化、会议角色登记；同一 realpath 会议目录串行并检查内容版本。失败恢复原绑定和旧状态；无法恢复须报错并阻止未知目标写入。
- 当前浏览 currentFile/fileCandidate/source 与固定目标分离。网页断开不释放 lease；插件、会话销毁释放。面板显示记忆在最后连接消失后清理，不影响持久目标。
- 使用标准 props.session.id、公开 hook、hostRouteUrl、streamBaseUrl；不从 dsh-app location 猜 HTTP/WS。仅允许明确 dsh-app://app 和当前实际可信宿主 origin；拒绝 null 与外部 origin，消息 schema 与连接会话校验，不能由 payload 切换 session。

### F012 配置、卡片与迁移

- 唯一字段 dockMode，枚举 auto|always|off，默认 auto。volatile 读取实际配置 ref.get；250 ms 有界检查并发布变化，避免重挂插件／丢失在途 lease。普通字段仍按宿主机制保存。
- plugins.bundle.config 的 key 是完整包名，必须定位实际唯一条目所有者再调用 configForms，不猜首条。仅返回可编辑字段；卡片为中文摘要／编辑面板，固定草稿 revision，显式保存或重置；覆盖→组装→默认，重置清除覆盖，不能整份复制 resolved 值。
- 移除已被替代的 settings.register/settingsScope 接缝；可选设置服务缺失仅失去卡片。非法旧 base 值须 auto 并告警，必须从真实 schema 装载路径验证：旧伪 ctx apply 兜底不足以证明不会在挂载前被拒。具体 schema 调整待实现确认，不将缺陷改成正确行为。
- GET /discussion-workbench/api/config-owner：返回唯一 entry_id 与允许编辑字段，不回传全局配置或其他条目。缺失／多重所有者为不可编辑。
- /discussion-workbench/api/config-migration：GET 预览，POST apply/restore；请求包含 action、expected_revision、preview_id、backup_id 等相应字段。受可信来源、schema、锁和 CAS 保护；400 输入无效、403 未授权、409 并发冲突、503 不可用。先预览再用户明确 apply，保存备份，只迁移 dockMode；保持 base/user 层次，非法旧值映射 auto 并告警，保留未知字段并报告。成功后仅清理已迁走的自有旧字段；失败恢复自身写入集合，遇新并发变化必须报告而不覆盖。

### F013 讨论落稿

普通聊天不每轮读取状态、不自动建立工作台；明确整理时调用文档 create_document，再把实际保存路径设为 thinking 目标。局部／成组修改交给文档事务，一次版本和一次撤销，稳定 ID 与未涉及内容保留。无唯一节点不猜“这个”。已保存而登记失败返回 saved_path，重试登记，不重复创建。

### F014 材料存储

沿用 .dsh-workbench/sessions/<session>.json。材料原有 id、label、kind、path、addedAt 保持；新增可选 format=text|docx|image，旧数据按 text；textPath、sourceHash（SHA-256）；有序 images 数组包含 id、path、mediaType、sourceOffset、analysis?。analysis 为 content、status=needs_review|reviewed、source=model|user、updatedAt，仅明确人工核对可 reviewed。

保留原始 path；派生目录 .dsh-workbench/materials/<session>，会议图片可置于 手写笔记/，按内容哈希命名。原件和用户手工转换文本不覆写。DOCX 方案为 Mammoth convertToHtml + 图片回调，parse5 在 host 侧清洁提取；不在浏览器执行未信任 HTML，不拉取外部资源，具体依赖精确锁定。客户端不能携带解析器。保留段落、表格顺序、时间戳／说话人、图片位置；缺失、外链、损坏、纯扫描正文和不支持部分明确警告。

源、派生、输出、新父目录均做真实 cwd 围栏，内部压缩包路径不直接落盘。必要文件落盘后再发布材料状态；失败保留旧状态，仅清理本次新建临时文件。恢复状态不自动转换、识图或写正文。

### F014 图像服务

附件服务为软依赖，通过 attachments.saveImage 保存可持续引用的真实图像块给当前会话；按宿主真实 imageLimits（格式、字节、像素）解码／规范化。验证透明图、重复图和原始副本。无服务返回 ATTACHMENT_UNAVAILABLE；模型无图像能力只展示占位与未识别提示。仅路径／附件不能当识别证据，不调用额外模型，不把 base64 作为系统提示。exec.signal 取消必须停止且不返回成功。分析结果单独保存为派生内容，默认 needs_review，不确定字词保留，不改原图或会议正文。

### F015 会议目录与一致性

优先读取并校验 .meeting-workbench.json；否则发现标准或日期前缀 *会议记录.md、*会议纪要.md，只接受唯一明确角色，不随机、不重命名、不把转写当记录。进入新会议清空前一会议临时引用，缺失角色显式 null。create_document 与 register 分开，保存成功登记失败保留文件并返回 saved_path。

保留 phase、info、sourceLinks、pendingSync、pdf，追加记录指纹、纪要来源记录指纹／版本、PDF 来源纪要指纹。记录变更只标纪要过期；纪要变更只标 PDF 过期；无旧依据为 unverified。共享信息按角色标 pendingSync，不自动改正文。sourceLinks 以 materialId、字符区间或 imageId 定位；删除节点标待检查，不伪造已核验引用。来源校验不改变固定目标。

finalize 只设置本地 published，更新上级 README 可识别会议索引中当前会议一行、实际相对路径、保留其他条目。索引必须在 cwd 内；不存在可识别索引返回 INDEX_UNAVAILABLE，不重写整个 README。用户可明确要求建索引后重试。meeting_saved 与 index_saved 独立；索引失败不回滚文档，不对外发布。

PDF 使用本机 Edge 隐藏进程和独立临时目录；缺失、超时、取消分别报错。捕获纪要指纹／版本，导出后重读核验；变更则拒绝登记过期结果。临时文件必须存在、非空且 %PDF 签名通过才替换；默认后缀输出，overwrite=true 失败保留旧文件；只清理本次临时资源。

### F016 工具接口

工具参数使用 snake_case，内部 camelCase 的转换在边界完成。以下是待实施的完整增量契约；现行六工具不因本文立即改变。

| 工具 | 输入 | 输出与职责 |
|---|---|---|
| open_meeting_workbench | folder、request_id? | context 和真实角色 candidates；不随机匹配，不宣称已读全部材料 |
| update_meeting_info | 原有元信息字段、request_id? | 只改元信息和 pendingSync，不改正文 |
| get_workbench_context | 现有兼容输入 | 完整 context、绑定版本、图片待核对、角色和 PDF 过期状态 |
| set_workbench_context | scene、target_file、add_material_path、pasted_material、remove_material_id 等原字段及 request_id? | 增加 thinking／DOCX／图片；只有显式 target_file 改绑定 |
| read_material | material_id、offset?、max_chars? | 正文、offset、next_offset、truncated 和片段 image IDs／状态；单图返回来源和 ID，不伪造 OCR |
| search_meeting_source | query、max_chars?、material_id?、offset? | 扫全部正文，返回 material id／label、match_offset、范围、excerpt、next／truncated；非会议场景亦可用 |
| find_workbench_files | query、directory?、kind=material|document|meeting、offset? | 名称查找；默认会议目录或 cwd；按相对路径排序，默认 20 项及下一页／警告；排除 .git、node_modules、.venv、.dsh-workbench、不可读与越界路径 |
| read_material_image | material_id、image_id | 持久附件、image_available 和实际图像块 |
| save_material_image_analysis | material_id、image_id、content、source=model|user、reviewed=false、request_id? | 派生分析及核对状态，不改原件或正文 |
| register_meeting_document | kind=record|minutes、file_path、expected_revision、finalize=false、request_id? | 校验版本并登记角色及显式绑定；minutes finalize 更新本地索引 |
| select_meeting_document | kind、request_id? | 仅切到已登记角色，缺失返回 candidates 或 DOCUMENT_UNAVAILABLE |
| export_meeting_pdf | expected_revision、overwrite=false、request_id? | 仅导出已保存登记纪要；file_path、exported_revision、pdf_saved、context |

read 默认 12000、上限 20000 字符；search 默认 4000、上限 20000 总摘录字符；offset 非负，空 query 拒绝。全文检索需覆盖超过旧 20000 限制的尾部与跨分页匹配，不仅第一页首个匹配。

新 Skill 变更调用必须提供 request_id；旧调用可省略，仅保持单次执行。按 session/tool/参数指纹在进程内合并在途或复用结果，同 ID 不同参数拒绝。超时不自动重试副作用，不承诺重启重放。工具统一 success/message、可选 error 和声明字段，output schema 与实际渲染一致；read 呈现正文而非“已读取”，mutation 摘要呈现真实路径／版本／保存标记，候选编号和路径。

### F017 项目协作

从当前工作区实际 AGENTS、项目管理／周报 Skill 和桥接接口发现规则，不把某个私人项目名称、路径、数据或脚本路径写进公共能力。固定项目主文档、JSON 参考和格式引擎各有职责；不得新增任意 shell 工具。任务拆分／分派、WBS、进展同步、周报创建／更新、日周汇总按实际项目规则。

叙述性进展保留历史事实，按日期更新与整数 progress 0–100 是不同数据，不互相猜算；状态领域分离。重复节点 ID 结合 H2／路由消歧。文件占用／冲突停止写，删除归档按项目确认规则。周报以确认周期与事实为依据、保留模板／上期计划，缺日期不判逾期、未记录不等于未开始、建议不当承诺。日周 WBS／收件箱查看只读，不恢复旧规划周期或生成第二套计划、不建自动任务。只有明确要求才把会议转为项目任务。

## Risks / Trade-offs

DOCX 提取质量和模型图像能力不等同全文已读；工具结果必须保留警告。两套角色和索引跨文件保存可能部分成功，不能伪装事务全部成功。多窗口与并发会议目录需真实锁／版本测试。历史项目样本的节点往返与桥接数量只证明可行性，不是本插件完整运行验收。

## Migration Plan

本轮仅文档，所有旧文档／源码／业务资料不变。将来实施时读取兼容旧状态，新增字段可选并清晰标记未核验；不得恢复时自动转换或改写用户文件。配置迁移按预览、确认、备份、CAS、有限写集合与恢复执行。旧工具调用兼容；新能力验证通过后才更新主规格并归档。

## Open Questions

- 确认本迁移版语义和具体固定宿主组合，不把先前兼容授权扩大为功能授权。
- 全部新增工具／字段、配置迁移 UI 和可信来源测试在真实 Desktop 的可用接口核对。
- 项目工作区实际接入按本地规则发现，公共规格不能替代用户自己的业务约定。
