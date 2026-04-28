# OpenClaw L5 Memory Backend Rules

本文档给 OpenClaw 使用。

目标：把 `AIMemoryHub` 作为 OpenClaw 的 L5 长期记忆后端，而不是让 OpenClaw 直接维护完整 Obsidian Vault。

## 1. 总体定位

OpenClaw 不直接把所有长期记忆写入 Obsidian。

推荐架构：

```text
OpenClaw
  L1 SOUL.md
  L2 MEMORY.md
  L3 daily memory
  L4 learnings / knowledge inbox
        ↓
AIMemoryHub
  Raw Inbox
  Promotion Review
  reader-first wiki
  embeddings / retrieve API
  Obsidian Vault publication
        ↓
OpenClaw
  Search and reuse L5 memory
```

职责边界：

| 系统 | 职责 |
| --- | --- |
| OpenClaw | 产生经验、记录过程、调用 L5 检索、消费长期记忆 |
| AIMemoryHub | 接收原料、去重、审核、升格、索引、发布到 Obsidian |
| Obsidian | 人类可读的长期知识展示层 |

一句话：

```text
OpenClaw 负责产生和使用记忆；AIMemoryHub 负责让记忆变得长期可靠。
```

## 2. L5 的定义

在当前方案里，OpenClaw 的 L5 不等于一个本地 Obsidian 文件夹。

L5 是：

```text
经过浓缩、审核、结构化、可检索、可长期维护的持久记忆层。
```

AIMemoryHub 中对应：

| L5 能力 | AIMemoryHub 对应模块 |
| --- | --- |
| 原料入口 | Raw Inbox |
| 质量门禁 | Promotion Review |
| 长期知识页面 | `vault/issues`、`vault/patterns`、`vault/syntheses`、`vault/projects` |
| 可读发布层 | Obsidian Vault |
| Agent 检索入口 | wiki search / retrieve API |
| 回源证据 | evidence note、sourceFile、sourceUrl |

重要边界：

```text
~/.openclaw/knowledge/inbox 不是 L5。
它是 OpenClaw L4 -> AIMemoryHub L5 的同步入口。
```

## 3. OpenClaw 写入规则

OpenClaw 需要把待同步的知识原料写入：

```text
~/.openclaw/knowledge/inbox/
├── errors/
├── patterns/
├── memories/
├── daily/
└── reference/
```

### 3.1 目录语义

| 目录 | 用途 | 默认去向 |
| --- | --- | --- |
| `errors/` | 错误教训、故障、踩坑记录 | `wiki-candidate` |
| `patterns/` | 最佳实践、可复用流程、稳定做法 | `wiki-candidate` |
| `memories/` | 精选长期记忆 | `search-candidate` |
| `daily/` | 每日工作记录、过程日志 | `inbox` |
| `reference/` | 技能、工具、参考资料、功能设想 | `search-candidate` 或 `needs-context` |

### 3.2 文件命名

推荐：

```text
errors/ERR-YYYYMMDD-001.md
patterns/LRN-YYYYMMDD-001.md
memories/MEM-YYYYMMDD-001.md
daily/YYYY-MM-DD.md
reference/REF-YYYYMMDD-001.md
```

稳定 ID 由 AIMemoryHub 生成：

```text
openclaw_{sha1(relative_path)}
```

因此 OpenClaw 应尽量保持文件路径稳定。

如果移动文件，AIMemoryHub 会认为这是新条目。

## 4. Markdown 协议

每个文件推荐带 frontmatter。

### 4.1 error-lesson 示例

```markdown
---
source: openclaw
sourceType: note
sourceSubtype: error-lesson
status: active
project: openclaw
topic: openclaw-config
intakeStage: wiki-candidate
confidence: high
keyQuestion: "如何避免清理配置文件夹时未先记录原有内容？"
decisionNote: "错误教训，适合沉淀为 Issue Review"
tags:
  - openclaw
  - error-lesson
---

# 错误教训

## 摘要

批量清理配置目录前，需要先记录当前文件结构和关键内容，避免清理后无法复原。

## Symptom

清理配置文件夹时未先记录原有内容。

## Cause

操作前未检查 memory，也没有留下目录快照。

## Fix

以后批量清理前先写 memory 记录，并保留关键文件列表。

## Validation

下次清理前能找到对应记录，并可据此确认哪些内容可以删除。
```

### 4.2 pattern 示例

```markdown
---
source: openclaw
sourceType: note
sourceSubtype: pattern
status: active
project: openclaw
topic: openclaw-ops
intakeStage: wiki-candidate
confidence: medium
keyQuestion: "批量清理前应该如何避免误删关键记忆？"
decisionNote: "最佳实践，适合沉淀为 Pattern"
tags:
  - openclaw
  - pattern
---

# 最佳实践

## 摘要

批量清理前先检查 memory，并把清理意图、保留项和风险点写入记录。

## When To Use

准备批量清理 OpenClaw 配置、缓存、知识目录或历史文件时。

## Recommended Practice

1. 先读取 MEMORY.md 和近期 daily memory。
2. 记录当前要清理的目录和保留项。
3. 清理后写一条结果记录。

## Tradeoffs

会多花一点时间，但能避免误删长期记忆或关键配置。
```

## 5. Frontmatter 字段规则

| 字段 | 用途 | 要求 |
| --- | --- | --- |
| `source` | 来源系统 | 固定 `openclaw` |
| `sourceType` | 原料层级 | `capture` / `note` / `document` |
| `sourceSubtype` | 细分类 | `error-lesson` / `pattern` / `memory` / `daily-note` / `feature-request` |
| `status` | 初始状态 | 通常 `active` 或 `draft` |
| `project` | 项目 | 如 `openclaw`、`myLocalRAG` |
| `topic` | 主题 | 简短主题名 |
| `intakeStage` | 进入 AIMemoryHub 后的去向 | 见下方 |
| `confidence` | 可信度 | `low` / `medium` / `high` |
| `keyQuestion` | 机器检索锚点 | 一个短问题句 |
| `decisionNote` | 为什么值得保留 | 给审核和升格使用 |
| `tags` | 检索标签 | 建议包含 `openclaw` |

### 5.1 intakeStage

| 值 | 含义 |
| --- | --- |
| `inbox` | 只是先接住，暂不判断 |
| `needs-context` | 缺上下文，需要人工补充 |
| `search-candidate` | 可进入检索，但暂不升格 |
| `wiki-candidate` | 可进入 Promotion Review |
| `reference-only` | 仅参考，默认不进入主流程 |

建议：

- `errors/` 默认 `wiki-candidate`
- `patterns/` 默认 `wiki-candidate`
- `daily/` 默认 `inbox`
- `reference/` 默认 `search-candidate` 或 `needs-context`

## 6. keyQuestion 与摘要的边界

可以同时保留：

```yaml
keyQuestion: "批量清理前应该如何避免误删关键记忆？"
```

正文：

```markdown
## 摘要

批量清理前先检查 memory，并记录清理意图、保留项和风险点。
```

边界：

| 字段 | 服务对象 | 写法 |
| --- | --- | --- |
| `keyQuestion` | 机器检索和路由 | 一个短问题句 |
| `## 摘要` | 人类阅读 | 说明结论、上下文和价值 |
| `decisionNote` | 审核判断 | 为什么值得保留或升格 |

不要让三者完全重复。

## 7. OpenClaw 读取 L5 的规则

OpenClaw 不能只写入 L5，还必须会查询 L5。

当任务涉及以下内容时，应优先查询 AIMemoryHub：

- 以前踩过的坑
- 项目约定
- 最佳实践
- 长期决策
- 某个错误的历史修法
- 某个工作流的稳定流程
- 用户问“之前怎么处理的”
- 用户问“这个项目里通常怎么做”

推荐查询顺序：

```text
1. search_wiki_notes
2. get_wiki_note
3. 如果 wiki 不够，再 search_my_history
```

含义：

- 先查已审核、已升格的长期知识。
- 不够时再查原始历史对话。
- 不要一上来就查全部历史，避免噪声过大。

## 8. AIMemoryHub API

默认服务地址：

```text
http://127.0.0.1:3030
```

### 8.1 搜索长期 wiki

```text
POST /api/wiki-vault/search
```

请求：

```json
{
  "query": "批量清理前如何避免误删 memory？",
  "topK": 8,
  "spaces": ["issues", "patterns", "syntheses", "projects"],
  "includeMarkdown": false
}
```

使用场景：

- 查 issue / pattern / synthesis / project。
- 优先用于稳定知识。

如果 OpenClaw 刚写入 `~/.openclaw/knowledge/inbox`，希望立刻检索到这条未升格原料，可以传：

```json
{
  "query": "批量清理前应该如何避免误删关键记忆？",
  "topK": 8,
  "spaces": ["inbox", "patterns", "issues", "syntheses", "projects"],
  "syncOpenClaw": true,
  "includeMarkdown": false
}
```

语义：

- `syncOpenClaw: true`：搜索前先执行一次 OpenClaw inbox 增量同步，并刷新 Promotion Queue。
- `spaces: ["inbox", ...]`：允许搜索 Raw Inbox evidence note。
- 命中 `inbox/knowledge__*.md` 表示这是未升格证据，不是正式长期 wiki。

注意：

```text
刚写入 OpenClaw inbox 的内容，只有在 syncOpenClaw=true 或手动点击“OpenClaw”同步后，才会进入 AIMemoryHub。
```

如果只搜索 `patterns/issues/syntheses/projects`，则只会查已升格的 reader-first wiki，不会查未审核 Raw Inbox 原料。

### 8.2 读取具体 note

```text
GET /api/wiki-vault/note?path=patterns/example.md
```

使用场景：

- 搜索命中某个 note 后，读取完整正文。
- 需要引用证据或遵循某个 pattern。

### 8.3 查项目 hub

```text
GET /api/wiki-vault/project?project=myLocalRAG
```

使用场景：

- 进入某个项目任务前，先读取项目长期上下文。

### 8.4 查原始历史

```text
POST /api/retrieve
```

请求：

```json
{
  "query": "OpenClaw L5 Obsidian Vault 如何设计？",
  "topK": 8,
  "provider": "",
  "includeMessages": false,
  "generateAnswer": false
}
```

使用场景：

- wiki 里没有足够信息。
- 需要追溯原始对话证据。
- 需要确认某个历史上下文。

## 9. 回答时如何使用 L5

当 OpenClaw 查到 L5 结果后：

1. 优先使用 `wiki` 命中的 reader-first note。
2. 回答里简短引用 note 的 `path` 或 `title`。
3. 如果只查到了原始历史，应说明这是历史证据，不是已审核知识。
4. 如果命中的知识过旧或不确定，应提示需要重新确认。

推荐表达：

```text
我先查了 L5 记忆，命中 patterns/batch-clean-before-memory-check.md。
根据这条 pattern，批量清理前应该先读取 MEMORY.md 和近期 daily memory，再记录保留项。
```

不要：

```text
根据我的记忆，应该这样做。
```

因为这会隐藏证据来源。

## 10. 什么时候写入新经验

OpenClaw 在以下情况应写入 `~/.openclaw/knowledge/inbox`：

### 10.1 写 errors/

满足：

- 出现明确错误、失败、异常、误操作
- 有症状和原因
- 有修复或预防方法

写入：

```text
errors/ERR-YYYYMMDD-001.md
```

### 10.2 写 patterns/

满足：

- 得到可复用流程
- 以后类似任务可以照做
- 不是一次性修补

写入：

```text
patterns/LRN-YYYYMMDD-001.md
```

### 10.3 写 daily/

满足：

- 当天过程记录
- 上下文还不稳定
- 不确定是否值得长期沉淀

写入：

```text
daily/YYYY-MM-DD.md
```

### 10.4 写 reference/

满足：

- 功能设想
- 工具说明
- 外部资料摘要
- 暂时不能判断是否应升格

写入：

```text
reference/REF-YYYYMMDD-001.md
```

## 11. 同步规则

AIMemoryHub 的同步规则：

- 当前 OpenClaw inbox 有，AIMemoryHub 没有：新增。
- 当前 OpenClaw inbox 有，内容变化：更新。
- 当前 OpenClaw inbox 没有，AIMemoryHub 以前导入过：标记为 `Archived`。
- 不硬删除，避免破坏 evidence 和已升格页面。

因此 OpenClaw 如果想让某条内容从当前同步视图消失，可以删除或移动该文件。

AIMemoryHub 会在同步时把它视为 missing，并归档对应 Raw Inbox 条目。

## 12. L5 使用决策树

OpenClaw 执行任务前可以按这个顺序判断：

```text
任务是否依赖历史经验？
  否 -> 正常执行
  是 ->
    是否是项目长期约定 / 最佳实践 / 已知问题？
      是 -> search_wiki_notes
      否 ->
        是否需要追溯原始对话？
          是 -> search_my_history
          否 -> 正常执行，必要时写 daily
```

执行任务后：

```text
是否产生可复用经验？
  是 -> 写 patterns/
是否踩坑或修复故障？
  是 -> 写 errors/
是否只是过程记录？
  是 -> 写 daily/
是否是功能设想或参考资料？
  是 -> 写 reference/
```

## 13. 最小可执行要求

OpenClaw 先实现这几件事即可：

1. 按协议写入 `~/.openclaw/knowledge/inbox`。
2. 为 errors/patterns/reference/daily 设置正确 frontmatter。
3. 在长期经验类问题前调用 AIMemoryHub wiki search。
4. 搜索命中后读取具体 note。
5. 任务结束后把新经验写回 inbox。

暂时不必实现：

- 直接写 Obsidian Vault
- 直接改 AIMemoryHub vault
- 自动创建 skill
- 自动生成 ontology

这些后续可以由 AIMemoryHub 升格和回写机制继续扩展。

## 14. 一句话总结

OpenClaw 的 L5 应这样实现：

```text
OpenClaw 把经验写入 inbox；
AIMemoryHub 把经验审核、升格、索引、发布到 Obsidian；
OpenClaw 在需要长期记忆时查询 AIMemoryHub；
新的经验再回到 inbox。
```

这才是完整的 L5 记忆循环。
