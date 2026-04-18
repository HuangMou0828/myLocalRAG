# 知识工作台四模块数据流分析报告

> 生成时间：2026-04-15

## 一、四模块概览与数据流闭环

知识工作台设计了一条 **采集 → 筛选 → 升格 → 巡检** 的完整知识精炼管线，四个 Tab 各自承担一个阶段：

| Tab key | UI label | 职责 |
|---------|----------|------|
| `raw` | Raw Inbox | 先接住原始材料，做最粗的一轮分流。 |
| `task-review` | 任务筛选 | 先按会话分流，再参考会话内任务段决定是否进入主检索。 |
| `promotion` | 升格审核 | 看哪些候选已经值得升格成 reader-first wiki。 |
| `health` | 健康巡检 | 检查 wiki 结构健康度和长期积压问题。 |

### 管线整体架构

```
┌───────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Raw Inbox │────▶│ 任务筛选      │────▶│ 升格审核      │────▶│ 健康巡检      │
│ (采集)     │     │ (Task Review)│     │ (Promotion)  │     │ (Health)     │
└─────┬─────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
      │                  │                    │                    │
      │  KnowledgeItems  │  SessionData API   │  WikiVault API     │  WikiVault API
      │  API (CRUD)      │  (updateReview)    │  (decidePromotion) │  (fetchLint)
      └──────────────────┴────────────────────┴────────────────────┘
                                    │
                          ┌────────▼─────────┐
                          │  Obsidian Wiki   │
                          │  Vault (文件系统)  │
                          └──────────────────┘
```

## 二、闭环状态判定

| 流转路径 | 是否闭环 | 健康度 | 说明 |
|---------|---------|--------|------|
| Raw Inbox → Promotion | **部分闭环** | 中等 | 只有 `wiki-candidate` / `active` 状态的条目才能被 promotion queue 扫描到，但这个衔接是**隐式**的（靠服务端扫描 knowledge items 的 `intakeStage` + 生成 evidence 页），前端没有主动 push 的动作。 |
| Task Review → Promotion | **已闭环** | 良好 | `promote-candidate` 操作后，会同时写 session review 并刷新 promotion queue（`loadPromotionQueue(true)`）。 |
| Promotion → Health | **已闭环** | 良好 | `decidePromotion` 完成后同步刷新 `loadWikiHealth(true)` 和 `loadKnowledgeItems()`，新写入的 wiki 页会立即被巡检扫描。 |
| Health → 回溯上游 | **部分闭环** | 中等 | Health action queues 定义了 `target: 'task-review'` / `'promotion'` / `'evidence'` / `'notes'` 四种回溯路由，但**只有概念设计、没有跳转实现** —— 点击后还是停留在 Health tab，只是分类展示 findings。 |
| Promotion → Raw Inbox 回写 | **已闭环** | 良好 | approve/dismiss/revoke 后都会 `loadKnowledgeItems()` 同步刷新。Mock runbook 明确验证了此路径。 |

**总体判断：管线正向流转（采集→筛选→升格→巡检）是通的，但反向回溯链路（巡检发现问题→回到筛选/采集补上下文）目前只有 UI 分类，缺少可操作的跳转闭环。**

## 三、数据流健康度分析

### 健康的部分

#### 1. 三服务分层清晰

`KnowledgeItemsApi`（Raw 条目 CRUD）、`SessionDataApi`（会话筛选）、`WikiVaultApi`（Wiki 生产 + 巡检）各司其职，domain 层组合使用，没有混乱耦合。

#### 2. 操作后联动刷新做得好

每次 promotion 决策后都同步刷新三个维度（`loadPromotionQueue` + `loadWikiHealth` + `loadKnowledgeItems`），避免了数据不一致。

#### 3. Task Review 的任务段切分算法精细

segment merge 逻辑考虑了文件引用重叠、低上下文延续、任务类型兼容性等信号，比简单的按 turn 切分高级很多。

#### 4. Promotion 候选的多通道路由

`issue-review` / `pattern-candidate` / `synthesis-candidate` 三种升格路径覆盖了 bug 排查、架构模式、知识问答三大场景。

### 不健康 / 有风险的部分

#### 1. Raw Inbox → Promotion 是隐式衔接

用户在 Raw Inbox 编辑条目、设置 `intakeStage: 'wiki-candidate'`，但"这条数据何时出现在 Promotion 队列"完全取决于服务端扫描 evidence page 的时机。前端没有「送审」按钮直接推送。用户保存后跳到 Promotion tab 可能看不到刚保存的条目。

#### 2. Health → 上游的「回查」只是分类，没有导航

`HEALTH_ACTION_QUEUE_DEFS` 定义了 `target: 'task-review'` 等路由意图，但 `selectHealthFinding` 只是设置 key，没有实际跳 tab 或预填 filter。用户看到"回源补上下文"后还是得手动切 tab、手动搜索。

#### 3. 三个数据源之间缺少关联 ID

Knowledge Item 有 `id`，Session 有 `id + segmentId`，Promotion 候选靠 `title + kind + path` 组合做 key。当用户想从一个 Health finding 追踪到原始采集条目时，缺少稳定的 cross-reference。

#### 4. 巨型单文件架构

`useKnowledgeSourcesDomain.ts` 超过 3100 行，`KnowledgeSourcesPanel.vue` 超过 4000 行。虽然领域内聚，但维护成本和 IDE 性能已经到了需要拆分的阈值。

#### 5. Tab 切换数据加载策略不一致

`setWorkbenchTab` 对 `task-review` / `promotion` / `health` 使用了 `force=false`（有缓存就不重新加载），但对 `raw` tab 没有任何加载调用。这意味着如果用户先看了 promotion、再回 raw，列表可能是旧的。

## 四、业务建议与优化方案

### 建议 1：补齐 Raw Inbox → Promotion 的显式送审动作

**现状**：条目设为 `wiki-candidate` 后只能等服务端下次扫描才进入 promotion queue。

**建议**：在 Raw Inbox 编辑器底部增加「保存并送审」按钮，在 `saveKnowledgeItem` 成功后主动调用 `wikiService.applyPromotion()` + `loadPromotionQueue(true)`，并自动跳转到 Promotion tab。Mock runbook 里其实已经提到了这个流程，但代码层还没有直接联通。

### 建议 2：Health 巡检的回溯跳转

**现状**：`HEALTH_ACTION_QUEUE_DEFS` 定义了 `target: 'task-review'` 等路由，但没有实际导航。

**建议**：在 Health action queue 的「执行」按钮里调用 `setWorkbenchTab(item.target)` 并预填对应 filter。例如 `context-recheck` 队列跳到 Task Review 并带上 `project` 或 session ID 筛选，让用户一键到达需要补上下文的会话。

### 建议 3：建立跨模块追溯 ID

**现状**：三个数据源靠 title/path 做松散关联。

**建议**：在 Knowledge Item 的 `meta` 中记录 `promotionRef`（升格后的 wiki 路径），在 Promotion 候选中记录 `sourceKnowledgeItemId`（原始采集 ID），在 wiki vault 的 frontmatter 中记录 `sourceSessionId` + `sourceSegmentId`。形成一条可双向查询的链路：`KnowledgeItem ↔ PromotionCandidate ↔ WikiNote ↔ Session`。

### 建议 4：拆分领域模块

**现状**：单个 domain 文件 3100+ 行。

**建议**：按 tab 拆成 4 个子 domain composable：

```
useKnowledgeSourcesDomain.ts       → 保留主壳 + Raw Inbox 逻辑
useTaskReviewDomain.ts             → 任务筛选（segment 切分、评分、review 操作）
usePromotionReviewDomain.ts        → 升格审核（queue 加载、preview、decide）
useWikiHealthDomain.ts             → 健康巡检（lint、repair、anchor、batch actions）
```

每个 sub-domain 只依赖自己需要的 API 切面，通过主壳进行组合和 tab 联动。

### 建议 5：引入管线状态仪表盘

**现状**：四个 tab 各自有 summary cards，但用户无法一眼看到整条管线的积压情况。

**建议**：在 workbench hero 区域增加一个 pipeline status bar，显示：

- Raw Inbox：X 条待分流
- Task Review：Y 条待筛选（其中 Z 条推荐升格）
- Promotion：N 条待审核
- Health：M 个 high severity findings

这让用户在任何 tab 下都能看到上下游积压，知道该优先处理哪个阶段。

### 建议 6：统一 Tab 切换的数据刷新策略

**现状**：Raw tab 切换时不触发 `loadKnowledgeItems`，其他 tab 用 `force=false` 缓存策略。

**建议**：给每个 tab 的数据加一个 `staleAfterMs` 过期机制（例如 60 秒），切换 tab 时如果数据已过期就静默刷新。同时在 `setWorkbenchTab` 中补上 `raw` tab 的条件加载。

### 建议 7：Task Review 增加批量操作

**现状**：每次只能对一个 segment 执行一个 action，处理积压很慢。

**建议**：支持多选 segments，增加「批量标记为 keep-search」「批量归档」「批量送审」操作。Task Review 本质是个分流漏斗，效率直接决定知识管线的吞吐量。

## 五、总结

这条知识管线的**正向流转闭环已经成形**，设计理念很成熟：从原始材料到精炼 wiki 的四阶段流水线在 AI 知识管理工具中是领先的。主要待补的是：

1. **反向回溯链路的可操作性**（Health → 上游的跳转）
2. **跨模块的稳定关联 ID**
3. **管线整体积压可视化**

代码架构上最紧迫的是大文件拆分，3000+ 行的单一 composable 已经接近维护上限。
