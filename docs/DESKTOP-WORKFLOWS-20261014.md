# Desktop 讨论、会议与项目工作流契约

文档版：`discussion-desktop-workflows-20261014-v1`；2026-10-14。本版具体文档待用户确认；F012–F017 为待实现，F001–F011 的本版适配待实现，目标运行未验证。本文与 [SPEC](SPEC.md)、[architecture](architecture.md) 配套；与旧升级草案冲突时本版相关预期优先，历史证据仍按原组合解释。

## 1. 分工与目标组合

- 目标为 DSH Desktop `0.2.0-rc.2`／better-sidebar `0.25.0`，复用 controller `0.3.0` 的公开 `sidebarController.getState/subscribe`。
- 当前会话负责讨论与图片理解；工作台管理材料、固定目标、会议角色和结果反馈，不调用另一个模型，不保存第二份文档树。
- `structuredDocument` 负责正文、稳定节点、事务、版本、保存与撤销；`structuredDocumentView` 负责展示；controller 负责浏览镜像与已有文件控制门禁。
- 未激活的普通讨论不写文档、不自动读取工具。工作目录及模型已准备后，所有新增业务动作都有模型工具入口；UI 是同一宿主操作的另一入口。
- 旧六工具 API 保留；本版共 12 个工作台工具。工具结果 schema、canonical value、模型文本／图片投影与捆绑 Skill 同步，不用仅含“已读取”的摘要代替材料正文。

## 2. 会话、绑定与传输

- `WorkbenchScene` 扩为 `meeting | project | thinking`，新旧会话默认仍为 meeting。scene 本身不算使用痕迹，F009 的目标／材料／已打开会议判定保留。
- 每个会话从真实会话 header 读取 cwd；无会话或未设置可用工作目录时返回明确错误，不改 cwd。恢复持久状态、工具首次读取和每步上下文准备都能触发装载，不依赖页面 hello 才恢复材料和目标。
- 使用文档服务的 `claimBinding(sessionId, 'discussion-workbench')` 取得宿主 lease，显式 bind／unbind／release。包括清除目标后的固定空态；客户端浏览消息不能越过 lease。
- 绑定、持久目标与会议角色变更按会话串行；两个会话打开同一会议目录时再按真实目录串行并核对元信息内容版本。新绑定失败恢复原绑定，恢复失败反馈 targetBinding=error，禁止向未知目标写入。
- UI 注册 `conversation.input.dock`，从目标标准 props 的 `session.id` 定位；可按公开 hook 注入取得标准状态，不依赖旧裸 sessionId。摘要仍与输入区对齐并支持键盘展开。
- HTTP URL 使用公开 hostRouteUrl，WebSocket 使用公布的 streamBaseUrl；不从 dsh-app 页面 location 拼回环地址。继续使用 `/discussion-workbench/ws`，每 path 只注册一次。
- 原生 Origin 精确校验 `dsh-app://app` 与实际信任主机，拒绝跨站及任意 null Origin。全部客户端消息按类型校验，会话身份绑定连接，payload 不得另换会话。
- 页面断开不释放宿主固定目标；释放 lease 只属于插件／会话销毁。dock 的连接内显示记忆按最后一条连接断开释放，不由另一窗口断开提前清除。

## 3. 材料与持久数据

保留 `.dsh-workbench/sessions/<session>.json`、粘贴材料目录、既有材料 id／label／kind／path／addedAt。新增字段均可缺省读取：

| 字段 | 契约 |
|---|---|
| `format` | text／docx／image；旧 file/paste 的文字材料按 text |
| `textPath` | DOCX 派生文字的路径；旧文字材料继续读 path |
| `sourceHash` | 原始来源字节 SHA-256；重复导入只在来源与内容匹配时复用，不仅检查同名 md 是否存在 |
| `images` | 有序 `{id,path,mediaType,sourceOffset,analysis?}`；来源位置对应派生文字中的图片标记 |
| `analysis` | `{content,status:'needs_review'|'reviewed',source:'model'|'user',updatedAt}`；reviewed 仅用于用户明确校对，不把模型自述升级为人工确认 |

- DOCX／图片也保留原始 path，正文派生材料存 `.dsh-workbench/materials/<session>/`；会议内嵌图片放会议目录 `手写笔记/` 的内容哈希文件名，一般材料图片放派生材料目录。已有原件与手工转换文件不覆盖。
- 采用 Mammoth `convertToHtml`＋图片转换回调，HTML 仅在宿主解析为文字／表格文本／图片标记，不将未经清理的 HTML 交给浏览器执行；外部文件访问关闭。HTML 解析使用 parse5。依赖由实现时锁文件固定，客户端不打入 DOCX 解析运行库。
- 保留段落顺序、表格阅读顺序、时间戳、说话人和图片位置；收集转换 warnings/errors。无法识别的媒体、损坏文件、外链图片和无正文扫描件不能被当作“无图片／全部读完”。
- 接受文字 `.md/.markdown/.txt/.json`、`.docx` 与宿主附件服务支持的 PNG/JPEG/WebP/GIF 等栅格格式。独立图片作为一个 image 材料；新媒体类型以宿主实际声明与完整解码结果为准，不能只相信扩展名。
- 所有源／派生／输出路径及新文件父目录做真实路径工作区围栏；DOCX 内部路径不直接作为磁盘写入路径。恢复旧状态不会自动重新转换、调用模型或改业务文档。
- 材料列表与派生物完整保存后才发布新状态。失败保留旧状态；已生成但未登记的临时产物清理只限本次创建的文件。

## 4. 12 个模型工具

snake_case 用于工具参数／返回；内部与既有客户端 wire 的 camelCase 在边界投影。下表只列本版必要字段，既有参数保留；mutation 中 request_id 为新 Skill 必填，旧调用未传时保持单次调用兼容、不声称可去重。

| 工具 | 输入与输出 |
|---|---|
| `open_meeting_workbench` | 既有 folder＋可选 request_id。读取现存目录、元信息和稿件候选；输出 context／candidates。多个候选不随机绑定，不承诺打开即完成材料阅读 |
| `update_meeting_info` | 既有信息字段＋request_id。只保存共享元信息，已有稿件需同步的信息标入 pendingSync，不自动改两份正文 |
| `get_workbench_context` | 无参数；返回完整 context，包含绑定状态、真实版本、材料／图片未处理项、会议稿与 PDF 新旧状态 |
| `set_workbench_context` | 既有 scene／target_file／add_material_path／pasted_material／remove_material_id，scene 新增 thinking，路径添加支持 DOCX／图片；新增 request_id。只有本次明确目标设置才能变更固定目标 |
| `read_material` | 既有 material_id／offset／max_chars。返回正文、offset／next_offset／truncated，附本段 images 的 id 与处理状态；单图返回来源说明与图片 id，不伪造 OCR 文本 |
| `search_meeting_source` | query／max_chars，新增 material_id?／offset?。逐材料扫描完整派生文字；结果包含 material_id、来源标签、match_offset、摘录范围、excerpt、下一页位置与 truncated。名称保留，也可搜索非会议材料 |
| `find_workbench_files` | query、directory?、kind?（material／document／meeting）、offset?。默认从会议目录或 cwd 查找；返回按相对路径稳定排序的 candidates、next_offset／truncated。只查文件名／目录名；不加入材料或改目标 |
| `read_material_image` | material_id、image_id；返回所属材料、来源位置、durable attachment 引用和 image_available。render 使用真正 image block。可用附件不等于模型已读，不输出识别文字 |
| `save_material_image_analysis` | material_id、image_id、content、source（model／user）、reviewed? 默认 false、request_id。原图不变，识别／校对文字登记为派生材料；返回材料和图片处理状态，不修改纪要正文 |
| `register_meeting_document` | kind（record／minutes）、file_path、expected_revision、finalize? 默认 false、request_id。登记已保存稿件并显式绑定；minutes＋finalize 时更新本地会议索引，phase=published 仅指本地定稿 |
| `select_meeting_document` | kind、request_id；只切换已登记稿件并绑定。没有该稿返回候选或 DOCUMENT_UNAVAILABLE，不创建空稿、不换为其他同名材料 |
| `export_meeting_pdf` | expected_revision、overwrite? 默认 false、request_id；只导出已登记且已保存的 minutes，输出 file_path、exported_revision、pdf_saved 与 context |

查找结果默认每页 20 项，offset 非负；读取沿用默认 12000 字符、最大 20000；检索默认 4000 字符、最大 20000 的总摘录预算。空检索拒绝；跨分页关键词不漏检，按真实字符偏移报告。查找排除 `.git/node_modules/.venv/.dsh-workbench` 及不可访问／越界链接，返回 warnings；“未找到”与查找被中断区分。

六个旧工具保留 `{success,message,...}`；新增同样提供该信封，失败附 error，成功附相关 context／candidates／material／file_path 等字段。所有 render 可读取 canonical 结果中的必要信息；普通 mutation 展示摘要＋真实路径／版本／保存标志，读取展示正文，候选展示编号与路径。输出 schema 拒绝不声明的字段，失败路径没有的字段可选。

## 5. 图片与当前模型

- `read_material_image` 使用 `attachments.saveImage` 的解码／归一化／限额与 durable 引用，通过工具 image block 进入原会话；不把 base64 混进系统提示，不另建模型请求。
- 图片服务为按功能软依赖；缺失时文字工具仍工作，图片返回明确 ATTACHMENT_UNAVAILABLE。取消遵守 exec.signal，不将中断登记为成功识别。
- 当前模型实际不接收图片、宿主将图片替换为 placeholder 或发生 image offload 时，Skill 报告未读取图片及下一步要求；不把图片路径、附件可用或模型文字猜测作为识别完成证据。
- `needs_review` 是模型识别结果的默认状态。只有用户明确校对才写 reviewed；读不清的字保留存疑标记。派生文字包含图片来源，不覆盖原文，不自动写进会议正文。
- 图片附件的最大字节、像素和格式使用宿主真实 imageLimits。超限或不支持时返回具体原因并保留图片记录；透明图片、同源已有副本及重复提取单列验收。

## 6. 会议双稿、索引和 PDF

- 优先加载经过路径校验的 `.meeting-workbench.json`；没有登记时分别发现标准 `会议记录.md/会议纪要.md` 及 `*会议记录.md/*会议纪要.md`。某角色唯一才可选，多候选列出。不强制改旧文件名，不把转写当会议记录。
- 新开会议先清除上一会议的临时角色关联；目标变化按绑定事务处理。没有所选稿件时保持明确未绑定，不保留上一个会议的稿件冒充当前。
- 创建业务文档仍由 create_document 执行；成功后调用 register_meeting_document。登记失败时保留已保存文件，返回 saved_path 与登记失败，不再次创建。普通 thinking 文档以 set_workbench_context 固定目标。
- 保留现有 phase、info、sourceLinks、pendingSync 与 pdf 字段；新增源记录指纹／纪要依据记录指纹与 revision／PDF 依据纪要指纹。旧依据缺失标为“尚未核验”，不推断已同步。
- 记录内容变化且已有纪要时标 minutes 待更新；仅用户明确要求重新整理时写纪要，并登记所依据记录指纹。纪要变化时 PDF 标过期。共享信息变更标明哪些稿件尚需更新，来源核对不改变目标。
- 来源联系由材料 id、字符范围／图片 id 承接，不把推断内容标为 verified；现有 sourceLinks 保留，节点删除后的链接标待核查，不借视图选中更换会议目标。
- finalize 的索引位置为当前会议目录父目录的 README.md，仍须位于 cwd 内。只增／更新该会议目录的一行，使用实际稿件相对路径；保持其他行、说明和未知内容。无可识别索引区时返回 INDEX_UNAVAILABLE，不猜测重写整篇 README；用户可自然语言要求补建索引后重试。
- 索引与元信息成功分别返回 index_saved／meeting_saved。已保存稿件但索引失败属于部分成功，返回明确 warning 和可重试动作；不会撤销原稿或外部发布。
- PDF 使用已发现的本机 Edge 打印能力和独立临时文件，进程隐藏；缺失、超时或取消明确失败。开始捕获 minutes 的真实指纹与 revision，结束前重新核对；正文改变则拒绝登记旧 PDF。
- 先生成暂存 PDF，核实存在、非空且具有 `%PDF-` 签名，再完成目标文件写入。默认重名追加序号；overwrite=true 也保留失败前原输出。清理只影响本次临时文件，不删除已存在业务文件。

## 7. 项目 Skill 路由

- project 主文档固定为编辑目标，JSON 为参考材料；工作区规则、业务编号与章节名来自 cwd 的 AGENTS／Skill，不固定磁盘路径或复制为插件配置。
- 发现 `anti-dry-pm-doc` 后由它承接任务拆分／分配、WBS、进展、状态与项目桥；发现 `anti-dry-weekly-report` 后由它承接周报；结构／样式变化转 pm-format。通过 DSH 既有受控文件／命令工具调用脚本，不新增通用任意 shell Tool。
- 主文档 `进展：` 是事实叙述，整数 progress 仍只表示 0–100；项目七值状态与收件箱、风险、周报状态分别遵循其领域规则。缺少信息不填推断值。
- 同名业务编号按所在 H2 与 KR/G/S 路径消歧。任务排期写 WBS，不在已移除计划周期的 KR OGSM 恢复空日期字段；当前进展替换前依项目规则保留旧值。
- 周报先检查两张 KR OGSM 当前事实、同步状态和确认的工作日期周期；用上一期计划帮助连续性。日周安排来自 WBS／当前收件箱，已有日期以外的推荐标为建议，不把无日期说成逾期，不把未记录说成未开展。
- 项目桥从真实工作区 Skill 获取，已知样本为 scripts/project/pm_bridge.py。修正旧硬编码提示；无对应 Skill／脚本时明确缺少集成，仍可进行普通文档讨论，不执行猜测命令。
- 会议材料不会自动变成项目任务；用户明确要求落任务时按项目 Skill 处理，并说明会议来源与当前项目目标，避免跨会话／跨工作区写错。

## 8. 配置、HTTP 与迁移

- 只保留业务配置 dock=auto／always／off，默认 auto；新增配置需求另行确认。自身可编辑字段进入 Config volatile 投影，宿主每次从实际 ref.get 读取；250ms 有界检查将变更重推已连接页面，销毁时清理。保存不重挂载工作台，不丢在途请求／lease。
- 配置卡注册 `plugins.bundle.config`，key=完整包名。Host 解析实际唯一 entry，客户端用 configForms.get(entryId)；不能将 namespace 或包名当作已证明的实际 entryId。summary 简述、page 可编辑；保留按需／始终／不显示、中文帮助、草稿与固定 revision、显式保存／重置。
- 设置服务软依赖；缺失只少卡片，按组装有效配置运行。非法旧组装值按 F009 的 auto＋告警预期处理，新设置写入只允许三值；原有 Config 校验先抛错的张力列入加载路径回归，不能只用直接 apply 桩证明通过或改规格承认加载失败正确。
- 移除旧 settings.register／settingsScope.bind 通路；dock 原名、优先级及会话使用判定保留。旧 settings.yaml 的用户覆盖与 profile base 对照迁移，不把解析默认值物化为用户值。
- HTTP 新路径 `/discussion-workbench/api/config-owner` 聚合 GET；返回唯一 owner 的 entry_id／可编辑字段，不返回配置全文或任意其他条目。缺失／多实例返回明确不可编辑，客户端不随意选择第一个。
- HTTP 新路径 `/discussion-workbench/api/config-migration` 聚合 GET 预览与 POST apply／restore；请求含 action、expected_revision、preview_id，恢复另含 backup_id。只处理本插件 dock 分节，全部写入有信任围栏、schema 校验和配置编辑器锁内冲突检查。成功返回完整本插件迁移结果；错误 HTTP 400／403／409／503 对应输入／信任／冲突／能力缺失。
- 用户明确 apply 后才备份并迁移；逐值及继承层核对，旧非法值在预览标 auto＋告警映射，用户层成功迁入后只清理本插件已失效旧分节。未知字段留原备份／旧分节并报告，不全文件覆盖；并发变化拒绝，失败恢复旧写集且报告恢复冲突。
- 同一进程 request_id 按会话＋工具＋参数指纹记录，合并在途请求；同 id 不同参数拒绝，不自动重复超时操作。已完成材料／正文／元信息／索引的保存结果分别报告，进程重启不自动重放。

## 9. 验收与文档阶段证据

验收用例见 SPEC F012–F017，并回归 F001–F011。最低覆盖：无页面的冷加载上下文、固定空目标、来源浏览、多窗口断开、长文尾部与跨分页检索、DOCX 表格及图片、当前模型图片能力失败、识别材料与人工校对、双稿旧命名／冲突、索引部分失败、PDF 无效／过期、project 四流程、旧配置／未知字段／重复迁移、取消与 request_id、两个会话。

实现完成后按 typecheck／test／build、真实精确 peers carrier、原生窗口、真实当前模型、固定本地包安装分别记证据。构建与直接工具通过不替代模型三场景；语音识别／朗读设备不属于本次验证。

本次仅静态读旧实现、官方公开类型及实际场景资料，准备可审阅契约；未修改源码、测试实现、运行配置、包版本或捆绑运行 Skill，也未执行新功能验证。
