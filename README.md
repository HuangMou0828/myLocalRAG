# AIMemoryHub

AIMemoryHub（formerly `myLocalRAG`）是一个统一接入多个 AI 本地历史会话、知识采集、升格审核与 Vault 发布的长期记忆工作台。

当前阶段我们优先完成仓库名与主文档品牌切换；项目内部的一些历史命名（如路径、示例 project 名、旧文档引用）会分阶段逐步迁移。

## 运行

1. 安装依赖

```bash
npm install
```

2. 启动后端 API（读取本地目录、扫描索引）

```bash
npm run dev:server
```

3. 另开一个终端启动前端

```bash
npm run dev
```

前端地址：`http://localhost:5173`

## 标准接口文档（OpenAPI）

- OpenAPI 文件：`docs/api/openapi.yaml`
- 对外公开版：`docs/api/openapi.public.yaml`
- 维护说明：`docs/api/README.md`

校验“后端路由与文档是否一致”：

```bash
npm run docs:api:check
```

校验“公开版文档只包含有效路由”：

```bash
npm run docs:api:check:public
```

启动后端后可直接在浏览器查看：

- 内部版：`http://127.0.0.1:3030/api-docs`
- 公开版：`http://127.0.0.1:3030/api-docs/public`

## 工程治理（防止结构回退）

- 文档入口：`docs/README.md`
- LLM/Agent 入口：`docs/llm-entry.md`
- 架构约束：`ARCHITECTURE.md`
- 评审清单：`docs/workflow/review-checklist.md`
- ADR 机制：`docs/adr/README.md` + `docs/adr/0000-template.md`

本地提测前执行：

```bash
npm run quality:check
```

其中 `npm run arch:check` 会校验 feature 依赖边界、禁止循环依赖、禁止 feature 反向依赖入口层。

## MCP 模式（stdio）

项目已支持 MCP Server（与 HTTP API 并行，不冲突）：

```bash
npm run dev:mcp
```

可在支持 MCP 的客户端中注册该命令（stdio transport）。  
服务能力覆盖：数据源管理、扫描、会话查询、消息标签、历史检索、使用复盘、Prompt 评分与优化。

推荐做法：保留现有 `skill + HTTP`，逐步把需要的链路迁移到 MCP，形成双栈并行。

## 使用流程

1. 点击“自动发现默认路径”，系统会探测常见 AI 会话目录并给出候选。
2. 对候选点击“一键添加”，或手动填写数据源（名称、AI 类型、本地路径、格式）。
3. 点击“立即扫描”，系统会读取该路径下的会话文件。
4. 在中间搜索框检索历史会话，右侧查看完整消息时间线。

## 当前支持格式

- `chatgpt_export`：ChatGPT 导出的 `conversations.json`
- `auto`：自动识别目录中的 `*.json`、`*.md`、`*.txt`
  - `cursor` 数据源会自动解析 `*.jsonl`（agent transcripts）
  - `claude-code` 数据源会自动解析 `~/.claude/projects` 下的 `*.jsonl`（event transcripts）
  - `doubao` 数据源可实验解析 IndexedDB leveldb（`https_www.doubao.com_0.indexeddb.leveldb`）

## 默认路径探测（macOS）

- `~/Library/Application Support/com.openai.chat`
- `~/Library/Application Support/Claude`
- `~/Library/Application Support/com.anthropic.claude`
- `~/Downloads|Desktop|Documents` 下含 `conversations.json` 的子目录
- `~/.cursor/projects`（Cursor 会话 JSONL）
- `~/.claude/projects`（Claude Code 会话 JSONL）
- `~/Library/Containers/com.bot.neotix.doubao/Data/Library/Application Support/Doubao/Default/IndexedDB`

## 数据存储

- 主存储（推荐）：`<workspace>/kb.sqlite`（SQLite，含会话索引）
- 兼容快照（可选）：`<workspace>/sources.json`、`<workspace>/index.json`

### 指定 Workspace（推荐）

可以在启动后端时指定知识库存储目录，后续导入内容会写到该目录中：

```bash
KB_WORKSPACE=/absolute/path/to/my-kb npm run dev:server
```

可选关闭 JSON 快照（大规模数据建议）：

```bash
KB_WORKSPACE=/absolute/path/to/my-kb KB_JSON_SNAPSHOT=0 npm run dev:server
```

查看当前生效目录：

```bash
curl http://127.0.0.1:3030/api/workspace
```

接口会返回：

- `workspace`：当前数据目录
- `files.sources`：数据源配置文件
- `files.index`：会话索引文件

### 当前会话落盘格式

当前导入后的会话主存储在 SQLite（`kb.sqlite`）中；如未关闭快照，也会输出 `index.json`。

数据结构（逻辑上）是：

- 顶层：`updatedAt`、`sessions[]`、`issues[]`
- `sessions[]` 关键字段：
  - `id/sourceId/sourceType/provider/title/updatedAt/tags`
  - `messages[]`（`id/role/content/createdAt`）
  - `meta`（如 `sourceFile/url`）
  - `searchableText`（用于检索匹配）

### 从旧 JSON 平滑迁移

- 首次启动时，如果数据库为空，会自动读取已有 `sources.json/index.json` 并导入 SQLite。
- 导入后新的扫描与导入都优先写 SQLite。

### 全量重导入与标签保留

- 重新导入同一会话（`session.id` 一致）时，系统会按 `message.id` 合并历史标签。
- 也就是说你在消息上打过的标签（如 `工作/生活/AI`）在全量覆盖导入后会尽量保留。
- 前提：导出数据里的 `message.id` 稳定且可对应；若消息 id 变化，标签无法自动映射到新消息。

## OpenClaw 接入（打通版）

你的聚合库可以直接作为 OpenClaw 的检索工具，建议配置两个 API：

1. `POST /api/retrieve`：检索历史会话片段（RAG 检索入口）
2. `POST /api/review`：输出近期使用复盘（用于沉淀 skill 候选）

说明：`/api/retrieve` 已使用 SQLite + FTS5 做候选召回，再进行精排；不再依赖全量 JSON 扫描。

### 1) 检索接口

请求：

```bash
curl -X POST http://127.0.0.1:3030/api/retrieve \
  -H "Content-Type: application/json" \
  -d '{
    "query": "vue 弹窗",
    "topK": 5,
    "provider": "cursor",
    "timeRange": {
      "from": "2026-03-01T00:00:00.000Z",
      "to": "2026-03-31T23:59:59.000Z"
    }
  }'
```

返回关键字段：

- `results[].sessionId/title/provider/score`
- `results[].snippets`（给模型拼上下文最实用）
- `results[].sourceFile/sourceUrl`（用于追溯原始证据）

### 2) 复盘接口

请求：

```bash
curl -X POST http://127.0.0.1:3030/api/review \
  -H "Content-Type: application/json" \
  -d '{
    "recentDays": 30,
    "provider": "cursor",
    "minRepeatedPrompt": 2
  }'
```

返回关键字段：

- `summary/providerStats/roleStats`
- `topTerms`（高频主题）
- `repeatedPrompts`（重复需求）
- `skillCandidates`（可沉淀流程建议）

完整的 OpenClaw 系统提示词与任务模板见：

- `docs/openclaw/prompts.md`

## Prompt 规则评分（非 LLM）

已内置纯规则评分器（不调用大模型），用于先验证 Prompt 质量评测效果。

### CLI 用法

```bash
# 查看 rubric 配置
npm run score:prompt -- --rubric

# 评测单条 prompt
npm run score:prompt -- --text "请你帮我总结下面内容，输出 JSON，并给出3条验收标准"

# 批量评测（txt/md 或 JSON）
npm run score:prompt -- --file ./prompts.json
```

支持的 JSON 文件结构：

- 数组：`["prompt1", "prompt2"]`
- 对象：`{"prompt": "..."}` 或 `{"prompts": ["...", "..."]}`

### API 用法

```bash
# 获取评分 rubric
curl http://127.0.0.1:3030/api/prompt-rubric

# 单条评分
curl -X POST http://127.0.0.1:3030/api/prompt-score \
  -H "Content-Type: application/json" \
  -d '{
    "prompt":"请分析这段文本，输出Markdown表格，并给出2条验收标准",
    "contextMessages":[
      "我们在Cursor里改Vue页面",
      "输出先按表格字段说明再给代码片段"
    ]
  }'

# 批量评分
curl -X POST http://127.0.0.1:3030/api/prompt-score-batch \
  -H "Content-Type: application/json" \
  -d '{"prompts":["帮我优化一下","请将以下内容总结为3条要点，输出JSON"]}'
```

说明：`/api/prompt-score` 支持传入 `contextMessages[]` 做上下文修正；返回里会包含 `contextAdjustment/contextApplied`，以及反模式项的 `resolvedByContext/resolvedReason`。`sourceRefs` 字段包含评分维度对应的公开参考链接和 `dimensions[].suggestions[]`（每个维度建议项的命中状态与证据）；反模式检测规则会以 `antiPatternPolicy` 说明其为项目工程化启发式规则。

## Prompt 优化（DSPy 集成，含降级）

已新增 `POST /api/prompt-optimize`：优先走 DSPy 优化；若本机未安装 DSPy 或缺少模型配置，会自动降级为规则结构化改写，保证始终有结果。

### API 示例

```bash
curl -X POST http://127.0.0.1:3030/api/prompt-optimize \
  -H "Content-Type: application/json" \
  -d '{
    "prompt":"帮我优化这个页面",
    "model":"openai/MiniMax-M2.7-highspeed",
    "timeoutMs": 120000,
    "language":"zh-CN",
    "forceRegenerate": false,
    "taskType":"coding",
    "contextMessages":[
      "我们在 Cursor 里改 Vue 项目",
      "这个页面是 dashboard 统计页"
    ],
    "constraints":[
      "输出先给方案后给代码",
      "最后给自检清单"
    ]
  }'
```

返回字段重点：

- `mode`: `dspy` 或 `fallback`
- `optimizedPrompt`: 优化后可直接使用的 Prompt
- `cached`: 是否来自数据库缓存
- `changes/rationale`: 改写说明
- `meta`: DSPy 可用性与降级原因

### CLI 示例

```bash
# 直接优化一条
npm run optimize:prompt -- --text "帮我优化这个页面" --task-type coding --language zh-CN

# 从文件读取（json/txt/md）
npm run optimize:prompt -- --file ./prompt.json
```

### 启用 DSPy（可选）

如果希望真正走 DSPy（而不是 fallback），需要本机 Python 环境可用并设置：

```bash
export OPENAI_API_KEY=...
export DSPY_MODEL=openai/gpt-4.1-mini
```

并安装依赖（示例）：

```bash
python3 -m pip install dspy-ai
```

### Minimax 配置示例（OpenAI 兼容网关）

```bash
export DSPY_API_BASE="https://v2.aicodee.com"
export DSPY_API_KEY="你的密钥"
export DSPY_MODEL="openai/MiniMax-M2.7-highspeed"
```

说明：你也可以用 `MINIMAX_API_KEY` / `MINIMAX_API_BASE` 环境变量，效果等价。
若网关根路径返回的是网页而不是 JSON，请把 `DSPY_API_BASE` 设为 OpenAI 兼容接口路径（通常是 `.../v1`）。

若偶发 `DSPy optimizer timeout`，可调大超时：

```bash
export DSPY_TIMEOUT_MS=120000
```

也支持把这些配置写在项目根目录 `.env`，后端与 `npm run optimize:prompt` 会自动加载，无需每次手动 `export`。

## Ask 模式大模型（OpenAI 兼容接口）

已新增 `POST /api/ask`，可直接接入你提供的 `baseUrl + apiKey + model`。

### 环境变量（推荐）

- `KB_ASK_API_BASE`：例如 `https://your-gateway.example.com/v1`
- `KB_ASK_API_KEY`：调用 Key
- `KB_ASK_MODEL`：例如 `Qwen/Qwen2.5-72B-Instruct` / `openai/gpt-4.1-mini`
- `KB_ASK_TIMEOUT_MS`：默认 `60000`
- `KB_ASK_TEMPERATURE`：默认 `0.2`
- `KB_ASK_TOP_P`：默认 `1`
- `KB_ASK_MAX_TOKENS`：默认 `0`（不显式限制）

### 快速调用

```bash
curl -X POST http://127.0.0.1:3030/api/ask \
  -H "Content-Type: application/json" \
  -d '{
    "query":"用三句话总结 RAG 的核心流程",
    "systemPrompt":"你是一个简洁准确的中文助手。",
    "model":"Qwen/Qwen2.5-72B-Instruct"
  }'
```

也可直接传对话消息：

```bash
curl -X POST http://127.0.0.1:3030/api/ask \
  -H "Content-Type: application/json" \
  -d '{
    "messages":[
      {"role":"system","content":"你是资深工程助手"},
      {"role":"user","content":"给我一个 Node 服务健康检查清单"}
    ]
  }'
```

## Embedding 与效果评估

已支持会话级 embedding（存储在 SQLite 的 `session_embeddings` 表），检索链路为：

- 候选召回：SQLite FTS
- 精排：关键词分 + 向量相似度混合分

### 环境变量（可选）

- `KB_EMBEDDING_API_KEY`：Embedding API Key（兼容 OpenAI 接口）
- `KB_EMBEDDING_API_BASE`：默认 `https://api.openai.com/v1`
- `KB_EMBEDDING_MODEL`：默认 `text-embedding-3-small`
- `KB_EMBEDDING_TIMEOUT_MS`：默认 `20000`

若未配置 API Key，会自动使用本地 `local-hash-v1` 兜底 embedding（可离线运行，效果通常弱于在线模型）。

### 1) 生成 / 重建 Embedding

```bash
curl -X POST http://127.0.0.1:3030/api/embeddings/rebuild \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "",
    "limit": 1200,
    "force": false
  }'
```

说明：

- `force=false` 只补齐缺失 embedding
- `force=true` 强制重算
- `provider` 可选（如 `cursor` / `chatgpt`）

### 2) 检索时查看向量信息

`POST /api/retrieve` 返回新增字段：

- `embedding.coverage`：候选集中 embedding 覆盖率
- `embedding.regenerated`：本次懒生成数量
- `embedding.model/source/fallback`：模型来源与是否回退
- `results[].vector_similarity`：每条结果的向量相似度

### 3) 评估 Embedding 效果

```bash
curl -X POST http://127.0.0.1:3030/api/embeddings/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "",
    "sampleSize": 40,
    "topK": 8,
    "autoEmbed": true
  }'
```

返回核心指标：

- `metrics.lexicalRecallAtK` / `metrics.hybridRecallAtK`
- `metrics.lexicalMRR` / `metrics.hybridMRR`
- `metrics.recallDelta` / `metrics.mrrDelta`
- `improvedCases` / `regressedCases`：样本级对比

建议：先跑一次 `rebuild`，再跑 `evaluate`，观察 `hybrid` 是否显著优于 `lexical`。
