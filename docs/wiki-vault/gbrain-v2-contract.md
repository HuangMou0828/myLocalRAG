# GBrain V2 Data Contract（执行版）

> 日期：2026-04-25  
> 状态：Phase A 执行契约  
> 目标：为 `Raw -> Atom -> Reader-first` 提供统一字段语义、ID 规则和兼容映射

## 1. 分层职责

1. Raw 层  
- 保存原始证据与最小元数据。  
- 不承担最终知识结论。  
- 允许历史格式共存。

2. Atom 层  
- 统一证据粒度（issue/pattern/synthesis/project/decision/context）。  
- 提供稳定主键与 lineage。  
- 承担质量评分、分级、去重主键映射。

3. Reader-first 层  
- 输出可读页面（projects/patterns/issues/syntheses）。  
- 保留人工保护区（如 `My Notes`）。  
- 消费 Atom 聚合结果，不直接回写 Raw。

## 2. Atom 最小字段契约

以下字段为 V2 Atom 的最小执行集：

- `rawId`: 原始记录稳定标识（优先使用现有 `knowledge_items.id`）
- `atomId`: 原子证据标识（由 rawId + kind + evidence 特征稳定生成）
- `canonicalId`: 跨版本语义聚类标识
- `kind`: `issue | pattern | synthesis | project | decision | context`
- `title`
- `summary`
- `topics`: string[]
- `sourceRefs`: `{ type, value }[]`
- `intakeStage`
- `confidence`
- `qualityScore`: 0-100
- `qualityTier`: `clean | suspect | legacy`
- `updatedAt`
- `lineage`: `{ rawId, atomId, canonicalId, pageId }`

## 3. Reader-first 兼容映射

V2 不替换现有页面契约，而是通过映射兼容。

现有 reader-first frontmatter 关键字段：

- `title`
- `type`
- `schemaVersion`
- `status`
- `project`
- `evidenceCount`
- `updatedAt`
- `promotionState`
- `approvedAt`

### 3.1 kind -> page type 映射

- `issue` -> `issue-note`（`vault/issues/`）
- `pattern` -> `pattern-note`（`vault/patterns/`）
- `project` -> `project-hub`（`vault/projects/`）
- `synthesis | decision | context` -> `synthesis-note`（`vault/syntheses/`）

### 3.2 聚合映射规则

- `evidenceCount`: 页面聚合到的 Atom 数量
- `project`: 来自 Atom 的 `topics/project` 主标签或既有页面上下文
- `updatedAt`: 取参与聚合 Atom 的最新更新时间
- `promotionState/approvedAt`: 继续沿用人工审核链路，不下沉到 Raw

## 4. 稳定 ID 与 lineage 规则

### 4.1 身份定义

- `rawId`: 来源记录主键，保持可追溯
- `atomId`: 证据粒度主键
- `canonicalId`: 语义去重主键（检索混排与跨层去重使用）
- `pageId`: reader-first 页面标识（如 `issues/<slug>`）

### 4.2 lineage 约束

- 最小链必须满足：`rawId -> atomId -> canonicalId -> pageId`
- 历史迁移无法稳定算出 canonicalId 时，必须写 alias 映射
- 页面重命名/拆分/合并必须记录 lineage 事件

## 5. 质量分级与治理策略

### 5.1 分级

- `clean`: 可直接用于生成与检索
- `suspect`: 可用但需复核
- `legacy`: 仅追溯或降权召回，进入修复队列

### 5.2 默认策略

- 不硬删 Raw
- 以降权、软归档和人工队列收敛历史问题
- 所有自动修复动作应可回滚

## 6. gbrain 检索对齐规则

- 默认检索：`Atom + Reader-first`
- 回源检索：仅在显式追溯或证据不足时召回 Raw
- 混排去重：以 `canonicalId` 为主键，避免同证据跨层重复占位 Top-K

## 7. Phase A 交付要求

在进入 Phase B 之前，至少具备：

- 该契约文档（本文件）
- 可执行 baseline 快照
- 可执行 dry-run 报告
- 固定查询集模板与人工标注模板
