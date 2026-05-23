# 资产决策剪辑轨道设计基准

## 核心定位

资产决策剪辑轨道是资产定版之后的下一层核心工作区。

它要解决的不是单条资产记录管理，而是让团队在全剧时间轴上看清：

- 资产从第几集出现，到第几集持续。
- 哪些集发生资产状态变化。
- 剧本修改后，资产覆盖范围、状态和来源段落是否变化。
- 编剧、创作者、统筹围绕资产变化做确认、沟通和定口径。
- 创作者能快速知道自己负责集数内哪些资产要处理。

设计方向：用类似剪辑软件的横向轨道展示资产生命周期，用决策层解决多资产沟通和确认。

## 主界面结构

### 中间主区：横向资产剪辑轨道

主轴是第一视觉中心。

- 横向轴线是剧集时间轴，例如第 1 集到第 60 集。
- 支持左右拖动。
- 支持视图切换：
  - 全剧视图。
  - 10-15 集工作视图。
  - 单集细看视图。
- 按资产类型分轨：
  - 角色轨。
  - 场景轨。
  - 道具轨。
  - 特效轨。
  - 状态轨。
- 每个资产显示为 clip：
  - 缩略图或稳定图标占位。
  - 资产名。
  - 状态名。
  - 持续集数。
  - 状态标记。
- 一个资产跨多集出现时，不重复铺图片，而是一张代表图加一条横向持续区间。
- 一个资产发生状态变化时，拆成多个状态段。

示例：

- 角色A · 状态A：第 1-8 集。
- 角色A · 状态B：第 9-16 集。

## 版本对比

默认对比：当前版 vs 上一版。

表现方式：

- 当前版资产 clip 是主视觉。
- 上一版用更细、更淡的 ghost clip 放在当前 clip 下方。
- 变化标记：
  - 新增资产：绿色标记。
  - 删除资产：红色虚线或红色 ghost。
  - 起止集变化：箭头。
  - 状态变化：amber 标记。
  - 来源段落变化：段落标记或提示点。

目标：用户在主轴上就能看出哪里发生变化，而不是必须打开详情。

## 多资产拥挤处理

资产很多时必须聚合，不能变成图片墙。

聚合要按决策意义，而不是只按数量：

- 需编剧定口径 3。
- 需创作者确认 5。
- 资产冲突 2。
- 可直接执行 12。
- 道具组 12。
- 新增道具 5。
- 状态变化 3。
- 沿用确认 4。

点击聚合块后，不跳转页面。应在轨道上方、中间浮层或右侧详情里打开决策面板。

决策面板包含：

- 相关资产缩略图。
- 资产名称。
- 涉及集数。
- 需要处理的问题。
- 来源剧本段落。
- 当前版 vs 上一版摘要。
- 操作按钮：
  - 我已了解。
  - 确认可执行。
  - 需要编剧确认。
  - 标记冲突。
  - 退回补充。

## 左侧决策队列

左侧不是普通导航，而是“我该处理什么”的入口。

建议队列：

- 今日必须确认。
- 影响我的集。
- 等待他人。
- 剧本变更。
- 资产冲突。

创作者进入页面时，默认看到与自己负责集数相关的决策项。编剧和统筹可以切换查看全剧。

## 右侧详情面板

右侧详情是辅助，不抢主轴。

点击资产 clip 或决策聚合块后打开。

建议 tabs：

- 决策说明。
- 资产详情。
- 剧本对比。
- 沟通记录。

资产详情：

- 资产图。
- 资产名称。
- 资产类型。
- 当前状态。
- 涉及集数。
- 状态说明。
- 来源剧本段落。
- 关联交稿版本。
- 编剧确认状态。
- 创作者确认状态。
- 统筹最终口径。

剧本对比：

- 上一版段落，较小、灰色。
- 当前版段落，较大、清晰。
- 影响资产 chips。
- 差异摘要。

沟通记录：

- 编剧说明。
- 创作者反馈。
- 统筹最终口径。
- 未解决问题。

## 角色视角

### 创作者视角

默认：

- 只看我的集。
- 只看影响我负责范围的资产。
- 优先展示需要处理的决策项。
- 主轴聚焦到自己负责的集数窗口。

主要操作：

- 我已了解。
- 确认可执行。
- 需要补充说明。
- 标记资产冲突。
- 查看剧本段落对比。

### 编剧视角

默认：

- 可看全剧。
- 可维护资产状态段。
- 可绑定资产与剧本段落。
- 可解释资产状态变化。
- 可处理“需编剧定口径”的决策项。

主要操作：

- 创建/编辑资产状态段。
- 设置起止集。
- 绑定来源段落。
- 修改状态说明。
- 回复创作者问题。
- 给出最终文字口径。

### 统筹视角

默认：

- 看全剧资产状态和冲突。
- 看哪些决策阻塞创作。
- 最终确认关键口径。

主要操作：

- 查看全局风险。
- 处理冲突。
- 最终确认。
- 推动待处理项。

## 首版范围

首版不做自动资产解析。

先做：

1. 横向资产剪辑轨道。
2. 资产状态段的起止集展示。
3. 当前版 vs 上一版 ghost 对比。
4. 多资产按决策意义聚合。
5. 点击资产或聚合块打开右侧详情。
6. 剧本段落对比。
7. 创作者默认只看“影响我的集”。
8. 编剧可手动维护资产状态段和来源段落。
9. 本地原型数据即可，不接真实数据库。

暂不做：

- AI 自动识别资产。
- 全自动解析剧本资产。
- 真实图片资产库。
- 复杂权限系统。
- 任意两个版本自由对比。
- 真实生产任务派发系统。

## 首版 View Model

首版类型先放 UI mock 层：

- `apps/web/app/ui/asset-decision-timeline-data.ts`

不要马上进入 domain，也不要新增 API。原因是首版字段主要服务界面表达、筛选、聚合和选中状态，很多字段不应长期持久化。

建议最小类型范围：

- `AssetTimelineViewMode`: `series` / `work_window` / `episode`。
- `AssetTimelineTrackKind`: existing asset type plus `status`。
- `AssetDecisionStatus`: `todo` / `acknowledged` / `executable` / `needs_writer_decision` / `conflict` / `returned` / `resolved`。
- `AssetDecisionKind`: `new_asset` / `removed_asset` / `range_changed` / `state_changed` / `source_changed` / `needs_creator_confirm` / `needs_writer_decision` / `conflict` / `ready_to_execute`。
- `CreatorAssignedEpisodeWindow`: creator user, assigned episode range, assigned episode numbers, source assignment ids。
- `ScriptSourceExcerpt`: project, delivery package, episode, excerpt text, optional line range, related asset names。
- `AssetStateSegment`: asset record reference, asset name/type, state label, episode range, change type, risk, source excerpts。
- `PreviousVersionGhostComparison`: previous range/state/source and change markers。
- `AssetTimelineClip`: current segment, optional ghost, decision references, role-scoping flags。
- `AssetTimelineTrack`: track kind, label, order, clips。
- `AssetDecisionItem`: kind, status, title, description, episodes, assignee role/user, source excerpts, current/previous summary, risk。
- `RoleScopedAssetTimelineViewModel`: project/viewer/window/tracks/queue/excerpts/selection/permissions。

与现有模型关系：

- `AssetLockRecord` 是 timeline clip 和 segment 的主要来源。
- `DeliveryPackage` 用于当前版和上一版来源。
- `EpisodeAssignment` 用于生成创作者默认工作窗口。
- `AssetAttachment` 首版不进 timeline 模型，只作为未来详情或真实资产来源。

首版纯函数建议：

- 按资产类型分轨。
- clip episode range 映射到 10-15 集窗口列。
- 按队列标签/决策类型筛选。
- 聚合决策计数。
- ghost comparison 与当前 clip 对齐。
- 根据角色生成 scoped view model。

## 设计原则

- 主轴第一：横向时间轴必须清晰、明确、美观。
- 图片辅助：图片帮助识别资产，但不能堆满页面。
- 决策优先：资产多时展示“该处理什么”，而不是展示全部细节。
- 对比可见：剧本变化对资产的影响要在主轴上能看出来。
- 详情后置：详情、沟通、剧本段落对比放在右侧或抽屉，不压主轴。
- 创作者减负：创作者默认只看自己相关内容。
- 编剧可维护：编剧能清楚地标注资产状态和持续集数。
- 可逐步扩展：先人工标注，后续再考虑自动解析和 AI 辅助。

## 下一步拆解建议

### 并行A

做数据模型草案，只读或小范围新增类型建议。重点：

- timeline track。
- clip / segment。
- ghost comparison。
- decision item。
- script source excerpt。
- role-scoped view model。

### 并行B

做首版范围审查。重点判断：

- 首版是否过大。
- 哪些必须砍。
- 哪些测试和验收最关键。
- 是否应先做静态 UI 原型而非 domain/API。

### 并行C

做静态 UI 原型。重点：

- 横向轨道可读性。
- 10-15 集视窗。
- 聚合块。
- 左侧决策队列。
- 右侧详情面板。

### 并行D

做 UI/交互审查。重点：

- 主轴是否第一视觉中心。
- 拥挤处理是否有效。
- ghost 对比是否清楚。
- 创作者视角是否减负。
