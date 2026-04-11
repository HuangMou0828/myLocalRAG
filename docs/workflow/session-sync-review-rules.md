# 会话同步与人工筛选规则 v1

本文档定义会话数据在“频繁同步 + 人工筛选”场景下的归属、覆盖边界与默认行为，避免同步过程覆盖人工决策。

## 1. 总体原则

1. 来源数据与人工数据分层管理。
2. 同步只更新来源事实，不覆盖人工审核结果。
3. 默认不做硬删除，优先使用隐藏或失联标记。
4. 自动规则只能提供建议，人工状态优先级最高。

## 2. 数据分层

### 2.1 Source Layer

由外部来源同步得到的事实字段：

- `id`
- `sourceId`
- `sourceType`
- `provider`
- `title`
- `updatedAt`
- `messages`
- 来源相关的 `meta` 字段，例如 `cursorConversationId` / `codexSessionId`

### 2.2 Review Layer

由人工维护的审核字段，存放在 `meta.review`：

- `status`: `pending | kept | downgraded | hidden`
- `keepInSearch`: 是否允许参与默认检索
- `qualityScore`: 质量分，范围 0-100，可为空
- `note`: 人工备注
- `reviewedAt`: 最后一次人工审核时间
- `reviewedBy`: 审核人，可为空

### 2.3 Sync Layer

由同步过程维护的状态字段，存放在 `meta.sync`：

- `syncStatus`: `active | missing | orphaned`
- `firstSeenAt`
- `lastSeenAt`
- `lastSyncedAt`
- `sourceUpdatedAt`
- `contentHash`
- `missingCount`

## 3. 字段归属规则

### 3.1 同步可更新的字段

- 会话标题、消息内容、来源信息
- `meta` 中的来源字段
- `meta.sync.*`
- 基于来源生成的派生数据，例如 `searchableText`、chunk、embedding

### 3.2 同步不得覆盖的字段

- `meta.review.status`
- `meta.review.keepInSearch`
- `meta.review.qualityScore`
- `meta.review.note`
- `meta.review.reviewedAt`
- `meta.review.reviewedBy`
- 人工打过的消息标签

## 4. 同步规则

### 4.1 Upsert

同步对会话执行 upsert：

- 存在则更新来源数据
- 不存在则新增

### 4.2 命中已有会话时

同步覆盖来源字段，但必须保留人工审核字段。

同时更新：

- `meta.sync.syncStatus = active`
- `meta.sync.lastSyncedAt = now`
- `meta.sync.lastSeenAt = now`
- `meta.sync.sourceUpdatedAt = source.updatedAt`
- `meta.sync.contentHash = latest content hash`
- `meta.sync.missingCount = 0`

### 4.3 来源中暂时缺失时

如果本次同步未看到某条历史会话：

- 不直接删除
- 标记 `meta.sync.syncStatus = missing`
- `meta.sync.missingCount += 1`

### 4.4 连续多次缺失时

当 `missingCount >= 3` 时：

- 标记 `meta.sync.syncStatus = orphaned`
- 会话继续保留，但视为来源已失联

## 5. 人工审核规则

### 5.1 状态定义

- `pending`: 待审核
- `kept`: 明确保留
- `downgraded`: 降权保留
- `hidden`: 明确隐藏

### 5.2 默认兼容行为

为了兼容当前全量数据，v1 阶段采用“兼容模式”：

- 新会话默认 `status = pending`
- `pending` 默认仍允许参与检索
- `kept` 默认允许参与检索
- `downgraded` 默认不参与默认检索
- `hidden` 默认不参与列表与默认检索

后续当人工筛选体系稳定后，可以再把默认检索范围收紧到 `kept`。

## 6. 列表与检索规则

### 6.1 列表默认规则

- 默认隐藏 `hidden`
- 允许显示 `pending / kept / downgraded`
- `missing / orphaned` 仍可见，便于人工处理

### 6.2 检索默认规则

- `keepInSearch = false` 的会话不参与默认检索
- `hidden` 必须不参与默认检索

## 7. 删除规则

- 默认不建议直接物理删除
- 只有明确无价值、且不需要保留审计痕迹的记录，才允许硬删除
- 产品侧优先提供 `hidden`

## 8. 冲突优先级

优先级从高到低：

1. 人工审核状态
2. 最新同步来源事实
3. 系统自动推断结果

如果同步内容变化，但会话已有人工审核状态：

- 保留人工审核结果
- 更新 `meta.sync` 和来源字段
- 不自动把人工状态改回默认值

## 9. 当前实现范围

本轮实现覆盖：

- `meta.review` / `meta.sync` 结构归一化
- 同步时保留 `meta.review`
- 列表默认隐藏 `hidden`
- 默认检索排除 `keepInSearch = false`
- 提供最小会话审核更新接口

后续可继续补充：

- 审核筛选器
- 批量审核
- 自动建议分类
- `kept only` 检索模式
