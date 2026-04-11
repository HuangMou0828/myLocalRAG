# OpenClaw Prompt & Tool Template

本文件用于把 `myLocalRAG` 直接接成 OpenClaw 的“wiki 检索 + 历史追溯 + 复盘分析”能力。

## 1) Tool Definitions（建议）

> 约定：本项目后续新增的 `POST` 接口，都会同步登记到本文件，供 OpenClaw 直接调用。

### Tool: `search_my_history`

- method: `POST`
- url: `http://127.0.0.1:3030/api/retrieve`
- body schema:

```json
{
  "query": "string, required",
  "topK": "number, optional, default 8, max 30",
  "provider": "string, optional, chatgpt|claude|cursor|doubao|gemini|other",
  "rewriteQuery": "boolean, optional, default false, let assistant model optimize retrieval query",
  "generateAnswer": "boolean, optional, default false, let assistant model answer with citations based on retrieved evidence",
  "timeRange": {
    "from": "ISO datetime, optional",
    "to": "ISO datetime, optional"
  },
  "includeMessages": "boolean, optional, default false"
}
```

返回重点字段：

- `context_block`：将所有命中检索结果拼接好的整段文本，直接可以用作 LLM 提示词上下文。
- `retrievalQuery` / `queryRewrite`：实际用于召回的查询，以及模型是否做了查询改写。
- `answer`：当 `generateAnswer=true` 时，返回基于引用证据生成的答案、引用编号和模型元信息。
- `results[].relevance_score`：当前会话与问题的匹配得分。
- `results[].matched_at`：该记忆内容的产生时间。
- `results[].snippets`：命中的具体历史对话片段。

### Tool: `search_wiki_notes`

- method: `POST`
- url: `http://127.0.0.1:3030/api/wiki-vault/search`
- body schema:

```json
{
  "query": "string, required",
  "topK": "number, optional, default 8, max 20",
  "spaces": [
    "string, optional, e.g. projects|patterns|issues|syntheses|concepts|sources|providers|inbox|root"
  ],
  "includeMarkdown": "boolean, optional, default false",
  "syncOpenClaw": "boolean, optional, default false, run OpenClaw inbox incremental sync before searching"
}
```

返回重点字段：

- `results[].path`：note 相对路径，可直接给 `get_wiki_note` 使用。
- `results[].space`：命中的 wiki 空间，例如 `projects/patterns/issues`。
- `results[].summary/excerpt`：页面摘要和命中片段。
- `results[].audience`：该 note 更偏 `human|llm|shared`。
- `openClawSync.summary`：当 `syncOpenClaw=true` 时返回本次 OpenClaw 同步概览。

如果刚写入 `~/.openclaw/knowledge/inbox` 后需要立刻搜索未升格原料，使用：

```json
{
  "query": "批量清理前应该如何避免误删关键记忆？",
  "topK": 8,
  "spaces": ["inbox", "patterns", "issues", "syntheses", "projects"],
  "syncOpenClaw": true
}
```

命中 `inbox/knowledge__*.md` 表示这是 Raw Inbox 证据页，还不是已升格的 reader-first wiki。

### Tool: `get_wiki_note`

- method: `GET`
- url: `http://127.0.0.1:3030/api/wiki-vault/note?path={relative_path}`

示例：

```text
GET /api/wiki-vault/note?path=patterns/embedding-retrieval-workflow.md
```

返回重点字段：

- `note.frontmatter`
- `note.summary`
- `note.markdown`
- `note.body`

### Tool: `get_project_hub`

- method: `GET`
- url: `http://127.0.0.1:3030/api/wiki-vault/project?project={project_key_or_title}`

示例：

```text
GET /api/wiki-vault/project?project=myLocalRAG
```

返回重点字段：

- `note.path`
- `note.summary`
- `note.markdown`
- `note.frontmatter`

### Tool: `explain_vault`

- method: `GET`
- url: `http://127.0.0.1:3030/api/wiki-vault/explain`

返回重点字段：

- `overview`：vault 的整体分层
- `audiences`：哪些页面主要给人、主要给 LLM、哪些是共享层
- `readPriority`：推荐优先阅读顺序
- `queryPolicy`：应该先查 wiki 还是先查 history
- `writePolicy`：哪些区域会被重写，哪些区域更适合人工维护

### Tool: `review_my_history`

- method: `POST`
- url: `http://127.0.0.1:3030/api/review`
- body schema:

```json
{
  "recentDays": "number, optional, default 30",
  "provider": "string, optional",
  "minRepeatedPrompt": "number, optional, default 2"
}
```

返回重点字段：

- `summary`：使用概览（sessionCount, messageCount, avgMessagesPerSession）。
- `behaviorMetrics`：AI 行为习惯统计：
  - `longSessionsCount`：大于 8 轮往复的复杂会话数量。
  - `avgPromptLength`：用户提问平均长度。
  - `resolutionStatus`：终止状态占比（assistantLast 表示 AI 给出了最后一个回答，userOnly 表示用户自言自语，assistantFirstFoundButUserLast 表示用户做了追问或自我总结）。
- `topTerms`：高频词云。
- `repeatedPrompts`：重复出现的问题模式。
- `skillCandidates`：系统提炼的可沉淀为 SOP 的任务卡片候选。

### Tool: `delete_session`

- method: `POST`
- url: `http://127.0.0.1:3030/api/sessions/delete`
- body schema:

```json
{
  "id": "string, required, sessionId"
}
```

### Tool: `tag_messages`

- method: `POST`
- url: `http://127.0.0.1:3030/api/messages/tags`
- compatible urls:
  - `http://127.0.0.1:3030/api/messages/tags/`
  - `http://127.0.0.1:3030/api/message-tags`
- body schema:

```json
{
  "sessionId": "string, required",
  "messageIds": ["string, required, one or more message ids"],
  "tags": ["string, optional, e.g. 工作/生活/AI"]
}
```

### Tool: `scan_provider`

- method: `POST`
- url: `http://127.0.0.1:3030/api/scan-provider`
- body schema:

```json
{
  "provider": "string, required, e.g. cursor/claude/chatgpt"
}
```

### Tool: `score_prompt`（规则评分，支持上下文修正）

- method: `POST`
- url: `http://127.0.0.1:3030/api/prompt-score`
- body schema:

```json
{
  "prompt": "string, required",
  "promptId": "string, optional",
  "contextMessages": [
    "string or { content: string }, optional, recent context for adjustment"
  ]
}
```

返回重点字段：

- `weightedTotal`：最终分（已包含上下文修正）
- `baseWeightedTotal`：基准分（仅当前 prompt）
- `contextAdjustment/contextApplied`：上下文修正信息
- `antiPatterns[].resolvedByContext/resolvedReason`
- `sourceRefs.dimensions[].suggestions[]`（每维建议命中与证据）

### Tool: `score_prompt_batch`

- method: `POST`
- url: `http://127.0.0.1:3030/api/prompt-score-batch`
- body schema:

```json
{
  "prompts": [
    "string",
    { "id": "optional", "text": "string" }
  ]
}
```

### Tool: `get_prompt_rubric`

- method: `GET`
- url: `http://127.0.0.1:3030/api/prompt-rubric`

### Tool: `optimize_prompt`（DSPy 优化，支持自动降级）

- method: `POST`
- url: `http://127.0.0.1:3030/api/prompt-optimize`
- body schema:

```json
{
  "prompt": "string, required",
  "promptId": "string, optional",
  "model": "string, optional, e.g. openai/MiniMax-M2.7-highspeed",
  "taskType": "string, optional, e.g. coding/writing/general",
  "language": "string, optional, e.g. zh-CN/en-US (explicit, not auto-follow)",
  "forceRegenerate": "boolean, optional, default false",
  "contextMessages": ["string, optional"],
  "constraints": ["string, optional"]
}
```

返回重点字段：

- `mode`: `dspy | fallback`
- `cached`: `true|false`
- `optimizedPrompt`
- `changes[]/rationale[]`
- `meta.dspyAvailable/fallbackReason`

## 2) System Prompt（通用主提示词）

把下面整段作为 OpenClaw 的系统提示词：

```text
你是我的“个人知识库检索助手 + AI 使用教练”。

你必须优先使用工具获取证据，再给结论。

工具使用优先级：
1) 遇到稳定知识、项目结构、已有方案、常见问题、复用模式时，先调用 search_wiki_notes。
2) 如果已经知道具体 note 或项目，直接调用 get_wiki_note 或 get_project_hub。
3) 如果你不确定 vault 的层次和阅读策略，先调用 explain_vault。
4) 如果 wiki 证据不足，或者问题明显依赖原始会话语境，再调用 search_my_history。
5) 遇到复盘、习惯分析、技能沉淀请求时，先调用 review_my_history；必要时再补调 search_my_history。
6) 如果工具返回为空或证据不足，明确说明“证据不足”，并给出下一步可执行建议，不要编造。

输出规范：
- 先给结论，再给证据。
- 优先引用 wiki note（path/title），不够再补历史会话证据（sessionId/title/snippet）。
- 涉及建议时，按“立即可做/本周可做/后续优化”三段输出。
- 回答要简洁、可执行，不要泛泛而谈。
```

## 3) Task Prompt（Wiki 优先问答模板）

当你想让 OpenClaw 做“先查 wiki，不够再查 history”，用：

```text
请先调用 search_wiki_notes，在 `projects,patterns,issues,syntheses,concepts` 里搜索，再回答问题。
如果 wiki 证据不足，再调用 search_my_history 补充原始会话证据。

问题：{{user_question}}
wiki spaces:
- projects
- patterns
- issues
- syntheses
- concepts

输出要求：
1) 先给结论（不超过 6 行）
2) 优先给 wiki 证据（至少 1-3 条，包含 path + title + excerpt）
3) 如果还补了 history，再附历史证据（sessionId + title + snippet）
4) 如果证据冲突，指出冲突点并说明你更信哪一层，为什么
```

## 4) Task Prompt（检索问答模板）

当你想让 OpenClaw 做“先检索再回答”，用：

```text
请先调用 search_my_history 检索我的历史会话，再回答问题。

问题：{{user_question}}
检索偏好：
- provider: {{provider_or_empty}}
- topK: 8
- timeRange.from: {{optional_iso}}
- timeRange.to: {{optional_iso}}

输出要求：
1) 先给结论（不超过 6 行）
2) 给出证据列表（至少 2 条，包含 sessionId + title + snippet）
3) 如果证据冲突，指出冲突点并给出你建议采用的版本
```

## 5) Task Prompt（项目页阅读模板）

当你已经知道项目名，想让 OpenClaw 直接基于 project hub 回答，用：

```text
请先调用 get_project_hub，读取项目 `{{project_name}}` 的 project hub。
如果 project hub 证据不足，再调用 search_wiki_notes 搜索相关 patterns/issues。
必要时最后再调用 search_my_history 补充原始会话证据。

输出结构：
1) 项目当前形态
2) 关键 patterns
3) 已知 issues
4) 我现在最该关注的 3 件事
```

## 6) Task Prompt（复盘沉淀模板）

当你想让 OpenClaw 做“行为复盘 + skill 候选”，用：

```text
请先调用 review_my_history 对我最近 {{recent_days}} 天的 AI 使用做复盘。
如果需要具体上下文，请再调用 search_my_history 补充证据。

输出结构必须是：
1) 使用概览（sessionCount, messageCount, 主要 provider）
2) 高价值主题（基于 topTerms，挑 3-5 个）
3) 重复问题模式（基于 repeatedPrompts）
4) Skill 候选（基于 skillCandidates，给出名称、触发条件、输入、输出、校验清单）
5) 本周落地计划（3 条）

要求：
- 每个结论后都附证据来源字段（如 sessionId/title/term）
- 如果样本偏少，明确标注“低置信度”
```

## 7) Quick Test（手工验证）

### Wiki 搜索

```bash
curl -X POST http://127.0.0.1:3030/api/wiki-vault/search \
  -H "Content-Type: application/json" \
  -d '{"query":"embedding 检索 流程","spaces":["patterns","issues","projects"],"topK":5}'
```

### 读取单个 note

```bash
curl "http://127.0.0.1:3030/api/wiki-vault/note?path=patterns/embedding-retrieval-workflow.md"
```

### 读取 project hub

```bash
curl "http://127.0.0.1:3030/api/wiki-vault/project?project=myLocalRAG"
```

### 读取 vault 说明

```bash
curl "http://127.0.0.1:3030/api/wiki-vault/explain"
```

### 检索

```bash
curl -X POST http://127.0.0.1:3030/api/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query":"vue 弹窗","topK":5,"rewriteQuery":true,"generateAnswer":true}'
```

### 复盘

```bash
curl -X POST http://127.0.0.1:3030/api/review \
  -H "Content-Type: application/json" \
  -d '{"recentDays":30,"minRepeatedPrompt":2}'
```

### 删除会话

```bash
curl -X POST http://127.0.0.1:3030/api/sessions/delete \
  -H "Content-Type: application/json" \
  -d '{"id":"sess_xxx"}'
```

### 更新消息标签

```bash
curl -X POST http://127.0.0.1:3030/api/messages/tags \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"sess_xxx","messageIds":["msg_1"],"tags":["工作","AI"]}'
```

### 更新指定来源（从本地源重新扫描）

```bash
curl -X POST http://127.0.0.1:3030/api/scan-provider \
  -H "Content-Type: application/json" \
  -d '{"provider":"cursor"}'
```

### Prompt 评分（带上下文修正）

```bash
curl -X POST http://127.0.0.1:3030/api/prompt-score \
  -H "Content-Type: application/json" \
  -d '{
    "prompt":"请帮我优化一下",
    "contextMessages":[
      "我们正在 Cursor 里改这个 Vue 项目页面",
      "输出沿用 JSON 字段，并给出 3 条验收标准"
    ]
  }'
```

### Prompt 批量评分

```bash
curl -X POST http://127.0.0.1:3030/api/prompt-score-batch \
  -H "Content-Type: application/json" \
  -d '{"prompts":["帮我优化一下","请输出 JSON 并给出 3 条验收标准"]}'
```

### 获取 Prompt Rubric

```bash
curl http://127.0.0.1:3030/api/prompt-rubric
```

### Prompt 优化（DSPy）

```bash
curl -X POST http://127.0.0.1:3030/api/prompt-optimize \
  -H "Content-Type: application/json" \
  -d '{
    "prompt":"帮我优化这个页面",
    "model":"openai/MiniMax-M2.7-highspeed",
    "taskType":"coding",
    "language":"zh-CN",
    "forceRegenerate":false,
    "contextMessages":["我们在 Cursor 里改 Vue 项目"],
    "constraints":["输出先给方案后给代码"]
  }'
```

## 6) Recommended Defaults

- `search_my_history.topK = 8`
- `review_my_history.recentDays = 30`
- 优先 `includeMessages = false`（减少上下文长度）
- 仅在需要深入追溯时再把 `includeMessages = true`
