# GBrain 使用指南

## 概述

GBrain 是一个知识图谱系统，通过 MCP 集成到 OpenClaw 中。它提供语义搜索、关键词检索和图谱查询能力，帮助你从大量笔记和文档中快速找到相关信息。

**当前配置**
- 数据库: `/Users/hm/.gbrain/brain.pglite` (PGLite 本地数据库)
- 数据源: `/Users/hm/myLocalRAG` (93 个页面，144 个 chunks)
- Embedding: text-embedding-3-large (1536 维)
- API: https://api.agicto.cn/v1

## 日常使用场景

### 1. 语义搜索：找相关概念

**场景**: 你记得讨论过某个技术方案，但忘了具体在哪个文档里。

```bash
cd ~/gbrain && bun run src/cli.ts query "会话同步的实现方案" --limit 5
```

**返回**: 按相似度排序的相关片段，即使用词不完全匹配也能找到。

**OpenClaw 中使用**: 通过 MCP 工具调用
```
"帮我搜索 gbrain 里关于会话同步的内容"
```

### 2. 关键词搜索：精确匹配

**场景**: 你知道文档里有 "KnowledgeSourcesPanel" 这个组件名，想找所有提到它的地方。

```bash
cd ~/gbrain && bun run src/cli.ts query "KnowledgeSourcesPanel" --keyword-only --limit 10
```

**适用于**: 代码符号、专有名词、精确术语。

### 3. 图谱查询：找关联页面

**场景**: 你想知道 OpenClaw 项目都关联了哪些概念和文档。

```bash
cd ~/gbrain && bun run src/cli.ts graph-query "vault/projects/openclaw" --depth 2
```

**返回**: 从该页面出发，2 层深度内的所有链接关系。

**用途**: 
- 发现知识盲区（某个重要概念没有链接到相关文档）
- 梳理项目依赖关系
- 构建知识地图

### 4. 查看页面详情

**场景**: 搜索结果显示某个页面相关度很高，想看完整内容。

```bash
cd ~/gbrain && bun run src/cli.ts get "vault/projects/openclaw"
```

**返回**: 页面的完整 markdown 内容、元数据、链接关系。

## 最佳实践

### 数据同步策略

**手动同步** (推荐用于开发阶段)
```bash
cd ~/gbrain && bun run src/cli.ts sync --repo ~/myLocalRAG
```

每次修改 AIMemoryHub 的文档后手动执行，确保 gbrain 数据是最新的。

**自动同步** (推荐用于生产环境)
```bash
cd ~/gbrain && bun run src/cli.ts sync --install-cron --repo ~/myLocalRAG
```

安装 cron 任务，每小时自动同步一次。适合长期运行的场景。

**监听模式** (开发时实时同步)
```bash
cd ~/gbrain && bun run src/cli.ts sync --watch --repo ~/myLocalRAG
```

持续监听 git 变更，有新 commit 立即同步。适合频繁修改文档的场景。

### Embedding 生成策略

**增量生成** (日常使用)
```bash
cd ~/gbrain && GBRAIN_EMBED_CONCURRENCY=5 bun run src/cli.ts embed --stale
```

只为新增或修改的页面生成 embedding，节省 API 调用。

**全量重建** (切换 embedding 模型后)
```bash
cd ~/gbrain && GBRAIN_EMBED_CONCURRENCY=5 bun run src/cli.ts embed --all
```

为所有页面重新生成 embedding。注意 API 限流，建议设置 `GBRAIN_EMBED_CONCURRENCY=5`。

### 搜索技巧

**混合搜索** (默认，推荐)
```bash
bun run src/cli.ts query "OpenClaw 架构" --limit 5
```

同时使用语义搜索和关键词搜索，结果更全面。

**纯语义搜索** (找相关概念)
```bash
bun run src/cli.ts query "如何优化前端性能" --semantic-only --limit 5
```

适合探索性搜索，即使用词不同也能找到相关内容。

**纯关键词搜索** (精确匹配)
```bash
bun run src/cli.ts query "KnowledgeSourcesPanel" --keyword-only --limit 10
```

适合查找代码符号、API 名称、专有术语。

## 后期维护

### 定期健康检查

**检查数据库状态**
```bash
cd ~/gbrain && bun run src/cli.ts stats
```

查看页面数、chunk 数、embedding 覆盖率、数据库大小等指标。

**检查断链**
```bash
cd ~/gbrain && bun run src/cli.ts graph-query --validate
```

找出指向不存在页面的链接，及时修复。

### 数据库备份

**备份数据库**
```bash
cp -r ~/.gbrain/brain.pglite ~/.gbrain/brain.pglite.backup-$(date +%Y%m%d)
```

建议每周备份一次，或在大规模修改前备份。

**恢复数据库**
```bash
rm -rf ~/.gbrain/brain.pglite
cp -r ~/.gbrain/brain.pglite.backup-20260424 ~/.gbrain/brain.pglite
```

### 清理过期数据

**删除已不存在的页面**
```bash
cd ~/gbrain && bun run src/cli.ts sync --repo ~/myLocalRAG --prune
```

同步时自动删除 git 仓库中已删除的文件对应的页面。

### 性能优化

**数据库大小监控**
```bash
du -sh ~/.gbrain/brain.pglite
```

当数据库超过 500MB 时，考虑：
- 清理不再需要的历史页面
- 减少 chunk 大小（修改 chunking 策略）
- 迁移到 Postgres（支持更大规模数据）

**Embedding API 限流应对**

如果遇到 429 错误，降低并发：
```bash
GBRAIN_EMBED_CONCURRENCY=3 bun run src/cli.ts embed --stale
```

或者分批处理：
```bash
bun run src/cli.ts embed --slugs vault/projects/openclaw vault/concepts/memory
```

## 注意事项

### API Key 安全

**不要提交 .env 文件到 git**
```bash
echo ".env" >> ~/gbrain/.gitignore
```

**定期轮换 API Key**

Embedding API key 暴露风险较低（只能生成 embedding，不能生成文本），但仍建议每季度更换一次。

### Embedding 模型兼容性

**切换模型时必须重建 embeddings**

如果更换 embedding 模型（比如从 text-embedding-3-large 换到其他模型），必须：
1. 确认新模型输出维度是 1536（或修改数据库 schema）
2. 运行 `embed --all` 重新生成所有 embeddings
3. 旧的 embeddings 和新的不兼容，混用会导致搜索结果不准确

**维度不匹配的处理**

如果新模型输出维度不是 1536（比如 4096），需要：
1. 修改 `src/core/db.ts` 中的 `vector(1536)` 为 `vector(4096)`
2. 删除旧数据库 `rm -rf ~/.gbrain/brain.pglite`
3. 重新同步和生成 embeddings

### 数据一致性

**同步和 embedding 的顺序**

正确流程：
```bash
# 1. 先同步内容
bun run src/cli.ts sync --repo ~/myLocalRAG

# 2. 再生成 embeddings
bun run src/cli.ts embed --stale
```

错误流程：先生成 embeddings 再同步，会导致新同步的页面没有 embeddings。

**避免并发写入**

不要同时运行多个 `sync` 或 `embed` 命令，PGLite 不支持并发写入。

### MCP 集成注意事项

**重启 OpenClaw 生效**

修改 `~/.openclaw/openclaw.json` 中的 gbrain 配置后，需要重启 OpenClaw 才能生效。

**环境变量传递**

MCP 服务器会继承 OpenClaw 的环境变量，但不会读取 `~/gbrain/.env`。如果需要在 MCP 中使用自定义配置，在 `openclaw.json` 中添加：

```json
{
  "mcp": {
    "servers": {
      "gbrain": {
        "command": "bun",
        "args": ["run", "/Users/hm/gbrain/src/cli.ts", "serve"],
        "env": {
          "EMBEDDING_BASE_URL": "https://api.agicto.cn/v1",
          "EMBEDDING_API_KEY": "sk-...",
          "EMBEDDING_MODEL": "text-embedding-3-large"
        }
      }
    }
  }
}
```

**MCP 工具调用示例**

在 OpenClaw 对话中：
- "搜索 gbrain 里关于 OpenClaw 架构的内容"
- "查询 vault/projects/openclaw 的关联页面"
- "从 AIMemoryHub 同步最新内容到 gbrain"

## 常见问题

### Q: 搜索结果为空怎么办？

1. 检查是否生成了 embeddings: `bun run src/cli.ts stats`
2. 尝试更简单的关键词: `query "openclaw"` 而不是 `query "OpenClaw 的架构设计"`
3. 使用关键词搜索: `query "openclaw" --keyword-only`

### Q: Embedding 生成很慢怎么办？

1. 降低并发: `GBRAIN_EMBED_CONCURRENCY=3`
2. 分批处理: `embed --slugs <slug1> <slug2>`
3. 检查 API 限流: 查看错误日志中的 429 错误

### Q: 数据库损坏怎么办？

1. 删除数据库: `rm -rf ~/.gbrain/brain.pglite`
2. 重新同步: `bun run src/cli.ts sync --repo ~/myLocalRAG`
3. 重新生成 embeddings: `bun run src/cli.ts embed --all`

### Q: 如何迁移到 Postgres？

1. 安装 Postgres 并创建数据库
2. 修改 `~/.gbrain/config.json`:
   ```json
   {
     "engine": "postgres",
     "database_url": "postgresql://user:pass@localhost:5432/gbrain"
   }
   ```
3. 重新同步和生成 embeddings

## 进阶用法

### 自定义 Chunking 策略

编辑 `src/core/chunkers/recursive.ts`，调整 chunk 大小和重叠：

```typescript
const MAX_CHUNK_SIZE = 1000;  // 默认 1000 字符
const OVERLAP = 200;          // 默认 200 字符重叠
```

修改后需要重新同步和生成 embeddings。

### 批量导入外部数据

```bash
# 从 Obsidian vault 导入
bun run src/cli.ts sync --repo ~/Documents/ObsidianVault

# 从多个源导入
bun run src/cli.ts sync --repo ~/myLocalRAG
bun run src/cli.ts sync --repo ~/Documents/Notes
```

### 导出为 Markdown

```bash
bun run src/cli.ts export --dir ./exported-brain
```

将 gbrain 中的所有页面导出为 markdown 文件，用于备份或迁移。

## 总结

GBrain 的核心价值在于：
1. **语义搜索**: 理解意图，不只是匹配关键词
2. **知识图谱**: 发现页面之间的隐藏关联
3. **增量同步**: 自动跟踪 git 变更，保持数据最新

日常使用建议：
- 每天开始工作前运行 `sync --repo ~/myLocalRAG`
- 每周运行一次 `stats` 检查健康状态
- 每月备份一次数据库

遇到问题时：
- 先查看 `stats` 了解数据状态
- 使用 `--dry-run` 测试命令效果
- 查看日志文件排查错误
