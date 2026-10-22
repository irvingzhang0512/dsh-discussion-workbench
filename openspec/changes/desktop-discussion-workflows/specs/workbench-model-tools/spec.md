# 工作台模型工具增量

## Purpose

F016 在兼容现行六个工具调用的前提下规定十二工具的职责、真实结果、全材料搜索、分页和幂等边界。所有新工具和参数仍待确认实施；当前搜索仅覆盖材料前部的限制在迁移索引保留，不能以本计划声称已完成全文检索。

## ADDED Requirements

### Requirement: F016 十二工具与旧调用兼容

工作台 SHALL 保留 open_meeting_workbench、update_meeting_info、get_workbench_context、set_workbench_context、read_material、search_meeting_source，并新增 find_workbench_files、read_material_image、save_material_image_analysis、register_meeting_document、select_meeting_document、export_meeting_pdf。旧有效调用保持兼容。

#### Scenario: 旧工具和新职责

- **WHEN** 使用旧参数调用已有工具，或查询新工具能力
- **THEN** 旧调用仍有效；新工具各自只执行文件发现、图片读取／分析、会议登记／切换／导出的明确职责，不暗含额外写入。

### Requirement: F016 完整文本搜索与分页

文本读取 SHALL 默认最多 12000 字符、单次上限 20000；搜索默认摘录总量 4000、上限 20000，并搜索全部材料正文含尾部和跨页匹配。offset 必须非负，空查询拒绝；返回实际范围、下一位置和截断状态。

#### Scenario: 命中在材料尾部

- **WHEN** 关键词位于超过 20000 字符的尾部或分页边界
- **THEN** 能够返回真实命中位置、来源和摘录；未命中与只读了部分不得混淆。

#### Scenario: 继续读取

- **WHEN** 模型使用返回的 next_offset 请求后续段
- **THEN** 返回连续实际正文与范围，不以“读取完成”替代内容。

### Requirement: F016 文件发现只读与候选

文件发现 SHALL 默认在当前会议目录或 cwd 按名称查找，排序返回相对路径候选，每页默认 20 项；排除版本库、依赖、虚拟环境、派生材料目录及越界路径。查找不登记材料或绑定目标，不可读和中断不得伪装无结果。

#### Scenario: 同名文件与部分不可读目录

- **WHEN** 只读查找返回多个相似文件并遇无权限目录
- **THEN** 返回排序候选、分页和警告，不猜选、不自动读取全文、不改变当前目标。

### Requirement: F016 变更请求幂等边界

新 Skill 发起变更 SHALL 使用 request_id；宿主按会话、工具与参数指纹合并同进程在途或已完成请求，同 ID 不同参数拒绝。旧调用省略 ID 时仅承诺单次执行；超时不自动重试副作用，不承诺重启后重放幂等。

#### Scenario: 重复提交和不同参数复用

- **WHEN** 同会话重复相同请求，随后用同 ID 改参数
- **THEN** 前者复用在途或已有结果，后者拒绝冲突；不重复导出、创建或登记。

### Requirement: F016 结构化真实结果

工具 SHALL 使用 success、message、可选 error 及声明字段返回实际结果；材料工具呈现正文，变更结果呈现实际路径、版本及保存标记，候选显示编号和路径。登记、保存、索引、PDF 与图像可用性分别表述。

#### Scenario: 部分完成

- **WHEN** 文件已保存而索引、登记或附件尚未成功
- **THEN** 返回各阶段真实字段与可恢复错误，不把路径存在当作分析完成或把部分成功掩盖为全成功。

### Requirement: F016 会议工具不隐式写正文

更新元信息 SHALL 仅更新元信息及待同步标记；选择角色只允许已登记文档，缺失返回候选或 DOCUMENT_UNAVAILABLE。PDF 工具只导出已保存纪要；登记工具显式验证路径和 expected_revision。

#### Scenario: 未登记纪要时选择或导出

- **WHEN** 模型请求选择不存在的纪要或导出临时草稿
- **THEN** 返回明确不可用信息，不自动新建空稿、使用错误文件或改写正文。
