# OpenClaw Knowledge Ingestion Proposal

本文档描述 OpenClaw 如何把自身沉淀的知识接入 `AIMemoryHub`。

目标不是让 OpenClaw 直接改写 `vault/`，而是让 OpenClaw 输出更接近 `AIMemoryHub` 的知识采集协议，再由 `AIMemoryHub` 完成去重、审核、升格和发布。

## 1. 核心原则

### 1.1 OpenClaw 负责生产原料

OpenClaw 可以继续沉淀：

- 精选记忆
- 错误教训
- 最佳实践
- 每日记录
- 项目文档
- 参考资料
- 技能和工具说明

但这些内容进入 `AIMemoryHub` 时，应先作为 Raw Inbox 条目，而不是直接成为正式 wiki 页面。

### 1.2 AIMemoryHub 负责知识生命周期

`AIMemoryHub` 当前的知识流是：

```text
Raw Inbox -> Promotion Review -> reader-first wiki -> Obsidian Vault
```

对应职责：

- Raw Inbox：接收未经完全确认的知识原料。
- Promotion Review：人工或半自动判断是否值得升格。
- reader-first wiki：生成 `issues/`、`patterns/`、`syntheses/`、`projects/` 等稳定页面。
- Obsidian Vault：阅读和发布层，不是原始采集入口。

因此 OpenClaw 不建议直接写入：

- `vault/issues/`
- `vault/patterns/`
- `vault/syntheses/`
- `vault/projects/`
- `vault/concepts/`

更推荐写入一个可导入的 OpenClaw 知识目录，或直接调用 `AIMemoryHub` 的 Raw Inbox API。

## 2. 当前 OpenClaw 目录映射

如果 OpenClaw 当前输出结构如下：

```text
OpenClaw-Knowledge/
├── 01-Memories/
├── 02-Learnings/
│   ├── errors/
│   └── patterns/
├── 03-Daily/
├── 04-Projects/
├── 05-Reference/
│   ├── skills/
│   └── tools/
└── .obsidian/
```

建议映射为：

| OpenClaw 路径 | myLocalRAG sourceType | sourceSubtype | 默认 intakeStage | 说明 |
| --- | --- | --- | --- | --- |
| `01-Memories/` | `note` | `memory` | `search-candidate` | 精选记忆可进检索，特别成熟的可标为 `wiki-candidate`。 |
| `02-Learnings/errors/` | `note` | `error-lesson` | `wiki-candidate` | 错误教训通常适合进入 Issue Review。 |
| `02-Learnings/patterns/` | `note` | `pattern` | `wiki-candidate` | 最佳实践通常适合进入 Pattern Candidate。 |
| `03-Daily/` | `capture` | `daily-note` | `inbox` | 每日记录噪声较多，默认先进 inbox。 |
| `04-Projects/` | `document` | `project-doc` | `search-candidate` | 项目文档可进检索，稳定总结可进 wiki 候选。 |
| `05-Reference/skills/` | `document` | `skill-reference` | `search-candidate` | 技能说明更适合作为检索资料。 |
| `05-Reference/tools/` | `document` | `tool-reference` | `search-candidate` | 工具配置说明更适合作为检索资料。 |
| `.obsidian/` | 不导入 | 不导入 | 不导入 | Obsidian 配置应忽略。 |

## 3. 推荐输出协议

OpenClaw 最好把每个 Markdown 文件输出成“可导入知识条目”。

推荐使用 Markdown frontmatter，因为它同时适合人读和机器读。

### 3.1 推荐 frontmatter

```yaml
---
source: openclaw
sourceType: note
sourceSubtype: error-lesson
status: active
project: myLocalRAG
topic: embedding
intakeStage: wiki-candidate
confidence: high
keyQuestion: "为什么远端 embedding 会退回 local？"
decisionNote: "适合沉淀为 Issue Review。"
tags:
  - openclaw
  - embedding
  - error
---
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `source` | 推荐 | 固定为 `openclaw`，用于标识来源系统。 |
| `sourceType` | 必填 | `capture`、`note`、`document` 三选一。 |
| `sourceSubtype` | 推荐 | 更细的来源类型，例如 `error-lesson`、`pattern`、`project-doc`。 |
| `status` | 推荐 | 默认 `active`；草稿可用 `draft`。 |
| `project` | 推荐 | 关联项目，例如 `myLocalRAG`。 |
| `topic` | 推荐 | 主题，例如 `embedding`、`wiki promotion`。 |
| `intakeStage` | 必填 | 见下方分流规则。 |
| `confidence` | 推荐 | `low`、`medium`、`high` 三选一。 |
| `keyQuestion` | 推荐 | 这条知识回答的核心问题。 |
| `decisionNote` | 推荐 | 为什么值得保留或升格。 |
| `tags` | 推荐 | 用于检索和聚类。 |

### 3.2 intakeStage 分流规则

`intakeStage` 决定进入 `AIMemoryHub` 后的默认去向。

| intakeStage | 含义 | 适合内容 |
| --- | --- | --- |
| `inbox` | 先接住，暂不判断 | 每日片段、短想法、上下文不足的摘录。 |
| `needs-context` | 需要补上下文 | 缺少项目、来源、原因、验证方式的内容。 |
| `search-candidate` | 可进主检索 | 资料、技能、工具说明、项目背景。 |
| `wiki-candidate` | 可进升格审核 | 错误教训、可复用模式、稳定结论。 |
| `reference-only` | 仅参考 | 低优先级资料、临时记录、过期可能性高的信息。 |

建议：

- `02-Learnings/errors/` 默认使用 `wiki-candidate`。
- `02-Learnings/patterns/` 默认使用 `wiki-candidate`。
- `03-Daily/` 默认使用 `inbox` 或 `needs-context`。
- `05-Reference/` 默认使用 `search-candidate`。

## 4. Markdown 内容建议

OpenClaw 的 Markdown 正文建议保持稳定结构，方便 `AIMemoryHub` 后续抽取 evidence atom。

### 4.1 error-lesson 推荐结构

```markdown
# 远端 embedding 回退 local

## Symptom

远端 embedding 配置存在，但系统仍显示使用 local embedding。

## Cause

配置读取时机早于环境变量加载，导致远端配置为空。

## Fix

在调用 embedding 时读取最新配置，避免模块加载时冻结旧配置。

## Validation

重建 embedding 后返回 `embedding.source=remote`。

## Evidence

- 相关文件：`server/lib/embedding.mjs`
- 相关接口：`POST /api/embeddings/rebuild`
```

### 4.2 pattern 推荐结构

```markdown
# Raw Inbox 到 Promotion Review 的双层门禁

## When To Use

当知识来源多、质量不稳定，但又需要快速收集时使用。

## Recommended Shape

先进入 Raw Inbox，标记去向和可信度，再由 Promotion Review 决定是否升格。

## Tradeoffs

优点是避免污染正式 wiki；代价是多了一层审核成本。

## Evidence

- 相关模块：`src/features/knowledge-sources`
- 相关生成器：`server/lib/wiki-vault.mjs`
```

### 4.3 project-doc 推荐结构

```markdown
# AIMemoryHub 知识工作台

## Current Shape

系统由 Raw Inbox、Task Review、Promotion Review、Health 四层组成。

## Important Areas

- Raw Inbox：接收采集条目
- Promotion Review：审核升格候选
- Vault：发布 reader-first 页面

## Open Questions

- 是否需要 OpenClaw 直接调用 API？
- 是否需要双向回写 promotion 状态？
```

## 5. 导入 API 对齐

`AIMemoryHub` Raw Inbox 当前可通过如下 API 写入：

```text
POST http://127.0.0.1:3030/api/knowledge-items
```

推荐 payload：

```json
{
  "id": "openclaw_<stable_id>",
  "sourceType": "note",
  "sourceSubtype": "error-lesson",
  "status": "active",
  "title": "远端 embedding 回退 local",
  "content": "Markdown 正文内容",
  "summary": "远端 embedding 配置读取时机错误导致回退 local。",
  "sourceUrl": "",
  "sourceFile": "OpenClaw-Knowledge/02-Learnings/errors/embedding-local-fallback.md",
  "tags": ["openclaw", "embedding", "error"],
  "meta": {
    "sourceSystem": "openclaw",
    "project": "myLocalRAG",
    "topic": "embedding",
    "intakeStage": "wiki-candidate",
    "confidence": "high",
    "keyQuestion": "为什么远端 embedding 会退回 local？",
    "decisionNote": "适合沉淀为 Issue Review。",
    "contentHash": "sha1-of-content",
    "openclawPath": "02-Learnings/errors/embedding-local-fallback.md"
  }
}
```

关键要求：

- `id` 应稳定，不要每次导入都生成新 id。
- 推荐使用 `openclaw_` 前缀加文件路径 hash。
- `sourceFile` 保留原始文件路径，方便回源。
- `meta.contentHash` 用于判断内容是否变化。
- `meta.openclawPath` 用于后续双向同步或状态回写。

## 6. 稳定 ID 和去重建议

OpenClaw 侧建议为每个文件生成稳定 id：

```text
openclaw_<sha1(relative_path)>
```

内容变化时：

- id 不变
- `content` 更新
- `meta.contentHash` 更新
- `updatedAt` 由 `AIMemoryHub` 入库时生成

文件移动时：

- 如果只是路径整理，但标题和内容基本不变，可以在 manifest 中保留 `previousPaths`。
- 如果无法判断，按新条目导入也可以，但会增加重复审核成本。

## 7. 可选 manifest.jsonl

如果 OpenClaw 不方便给每个 Markdown 加 frontmatter，可以在根目录生成一个 `manifest.jsonl`。

每行一条记录：

```json
{"path":"02-Learnings/errors/embedding-local-fallback.md","sourceType":"note","sourceSubtype":"error-lesson","project":"myLocalRAG","topic":"embedding","intakeStage":"wiki-candidate","confidence":"high","tags":["openclaw","embedding","error"],"keyQuestion":"为什么远端 embedding 会退回 local？","decisionNote":"适合沉淀为 Issue Review。"}
```

优先级：

1. Markdown frontmatter
2. `manifest.jsonl`
3. 路径映射默认值

## 8. 不建议的接入方式

### 8.1 不建议直接写 AIMemoryHub vault

不要让 OpenClaw 直接写：

```text
vault/issues/
vault/patterns/
vault/syntheses/
vault/projects/
```

原因：

- 这些页面有固定 schema 和 merge rules。
- Promotion Review 会维护审核状态。
- 人工编辑区需要被保护。
- 直接写入容易造成断链、重复页和不可撤销的知识污染。

### 8.2 不建议把 Daily 全部标成 wiki-candidate

每日记录通常上下文噪声较多，不适合默认进入升格审核。

更稳妥的默认值：

```yaml
sourceType: capture
sourceSubtype: daily-note
intakeStage: inbox
confidence: medium
```

## 9. 推荐落地阶段

### Phase 1: 文件协议对齐

OpenClaw 调整 Markdown frontmatter，至少输出：

- `sourceType`
- `sourceSubtype`
- `intakeStage`
- `confidence`
- `project`
- `topic`
- `tags`

### Phase 2: AIMemoryHub 导入器

`AIMemoryHub` 提供 OpenClaw importer：

- 扫描 `~/.openclaw/knowledge/inbox/`
- 忽略 `.obsidian/`
- 解析 frontmatter 或 manifest
- 生成稳定 id
- 调用 `upsertKnowledgeItemInDb` 或 `/api/knowledge-items`
- 输出导入预览和变更统计

当前可用命令：

```bash
npm run openclaw:preview
npm run openclaw:import
```

也可以指定自定义路径：

```bash
node scripts/openclaw-knowledge.mjs preview --root ~/.openclaw/knowledge/inbox
node scripts/openclaw-knowledge.mjs import --root ~/.openclaw/knowledge/inbox
```

机器可读输出：

```bash
node scripts/openclaw-knowledge.mjs preview --json
node scripts/openclaw-knowledge.mjs import --json
```

导入器当前规则：

- 默认根目录：`~/.openclaw/knowledge/inbox/`
- 稳定 id：`openclaw_{sha1(relative_path)}`
- 只扫描 `.md` 文件
- 跳过点号目录，例如 `.obsidian/`
- `preview` 只读，不写数据库
- `import` 只写入新增或内容变化的条目
- 内容未变化时跳过，依赖 `meta.contentHash`
- `wiki-candidate` 默认写入 `status=active`
- 其他 `intakeStage` 默认写入 `status=draft`，避免误入 Promotion Review

### Phase 3: Promotion Review 闭环

导入后：

- `wiki-candidate` 进入 Promotion Review
- 审核通过后生成正式 reader-first wiki 页面
- 审核结果回写 Raw Inbox metadata

可选增强：

- 回写 OpenClaw manifest
- 在原 Markdown frontmatter 中记录 `promotionDecision`
- 在 OpenClaw 中展示 `promotionTargetPath`

### Phase 4: 双向状态同步

如果 OpenClaw 希望知道哪些内容已经被 `AIMemoryHub` 升格，可以维护一个状态文件：

```text
OpenClaw-Knowledge/.myLocalRAG-sync.json
```

示例：

```json
{
  "items": {
    "openclaw_abcd1234": {
      "path": "02-Learnings/errors/embedding-local-fallback.md",
      "lastImportedHash": "sha1-of-content",
      "promotionDecision": "approved",
      "promotionTargetPath": "issues/embedding-local-fallback.md",
      "lastSyncedAt": "2026-04-11T00:00:00.000Z"
    }
  }
}
```

## 10. OpenClaw 最小调整清单

如果 OpenClaw 只想做最小改动，建议先做这几项：

1. Markdown 文件增加 frontmatter。
2. 每条知识标记 `sourceType`、`sourceSubtype`、`intakeStage`、`confidence`。
3. `02-Learnings/errors/` 默认输出为 `wiki-candidate`。
4. `02-Learnings/patterns/` 默认输出为 `wiki-candidate`。
5. `03-Daily/` 默认输出为 `inbox`。
6. `.obsidian/` 不参与导入。
7. 保持文件路径稳定，方便 `AIMemoryHub` 生成稳定 id。

## 11. 总结

推荐边界：

```text
OpenClaw: 生产结构化知识原料
AIMemoryHub: 接收入 Raw Inbox，去重、审核、升格、发布
Obsidian: 阅读和同步发布层
```

OpenClaw 不需要理解 `AIMemoryHub` 的完整 wiki 生成逻辑，只要输出带元数据的 Markdown 或 manifest。

`AIMemoryHub` 也不应该把 OpenClaw 内容视为已经审核过的正式 wiki，而是把它作为高质量外部采集源接入现有知识工作台。
