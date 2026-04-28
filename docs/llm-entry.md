# LLM Entry

这份文件是给 LLM/Agent 的最短读取入口。目标是在不全量阅读 `docs/` 的情况下，快速定位当前任务需要的协议、约束和验证方式。

## 默认读取顺序

1. 读 [Docs Index](./README.md)，确认文档分组。
2. 读 [项目介绍](./project/intro.md)，建立系统定位。
3. 读 [Git Workflow](./workflow/git-workflow.md)，确认分支、提交和验证规则。
4. 根据任务类型，只读下面对应的一组文档。

## 任务路由

### OpenClaw / L5 记忆

必读：

- [OpenClaw L5 Memory Backend Rules](./openclaw/l5-memory-backend-rules.md)
- [OpenClaw Knowledge Ingestion Proposal](./openclaw/knowledge-ingestion.md)
- [OpenClaw Prompt & Tool Template](./openclaw/prompts.md)

要点：

- OpenClaw 写入 `~/.openclaw/knowledge/inbox`。
- AIMemoryHub 负责 Raw Inbox、升格审核、Vault/Obsidian 和检索。
- `syncOpenClaw: true` 用于搜索前增量同步 OpenClaw inbox。
- 新增可由 OpenClaw 调用的 `POST` 接口时，同步更新 `docs/openclaw/prompts.md`。

### Knowledge Workbench

必读：

- [知识工作台 Mock 演练](./knowledge-workbench/mock-runbook.md)
- [Mock 数据](./knowledge-workbench/mock-data/knowledge-workbench-raw-inbox-items.json)
- [Wiki Promotion Pipeline](./wiki-vault/promotion-pipeline.md)

要点：

- Raw Inbox 是采集层，不是最终知识层。
- Promotion Review 决定是否升格为 reader-first wiki。
- 证据页通常落在 `vault/inbox/knowledge__*.md`。

### Wiki / Obsidian / Vault

必读：

- [Wiki Promotion Pipeline](./wiki-vault/promotion-pipeline.md)
- [Wiki Page Contract](./wiki-vault/page-contract.md)
- [Obsidian Vault Publication Layer](./wiki-vault/obsidian-syncthing-mvp.md)

要点：

- `vault/` 是发布/阅读层，避免直接写入低质量原料。
- 先保留 evidence，再由审核结果写入 `issues/`、`patterns/`、`syntheses/`、`projects/`。

### API

必读：

- [API 文档维护说明](./api/README.md)
- [OpenAPI](./api/openapi.yaml)
- [Public OpenAPI](./api/openapi.public.yaml)

要点：

- 新增或变更 HTTP 接口时，同步更新 OpenAPI。
- 公开接口变更后运行公开 API 文档检查。
- `docs/api/` 被脚本直接引用，除非同步改脚本，否则不要搬目录。

### 新增依赖 / Build 配置变更

触发条件：

- 新增或替换 `dependencies`（production 依赖）。
- 修改 `vite.config.*`、`build` 或 `quality:check` 相关脚本。

必读：

- [Review Checklist](./workflow/review-checklist.md)
- [Git Workflow](./workflow/git-workflow.md)
- [Agent Operating Rules](../AGENTS.md)

必跑检查：

- `npm run build`
- 体积变化不确定或依赖较重时，额外运行 `npm run build:analyze`

要点：

- 先复用现有依赖，再引入新依赖。
- 重型库默认使用动态加载（`import()` / `defineAsyncComponent`）。
- 评审时显式确认主包体积变化是否符合预期。

### 架构 / Review / Git

必读：

- [Git Workflow](./workflow/git-workflow.md)
- [Review Checklist](./workflow/review-checklist.md)
- [会话同步与人工筛选规则](./workflow/session-sync-review-rules.md)

要点：

- 改 TypeScript/Vue 后运行 `npm run typecheck`。
- 广泛重构、合并、发布前运行 `npm run build`。
- Review 先报风险、缺陷和缺失验证，再给摘要。

## 不要做的事

- 不要默认全量读取 `docs/`。
- 不要移动 `docs/api/`，除非同步更新脚本和 README。
- 不要修改 `server/data/*`、本地数据库、`vault/` 运行产物来“修历史路径”。
- 不要把 OpenClaw inbox 当作 L5 本体；它只是 L4 到 L5 的同步入口。

## 输出建议

回答或改动完成时，优先说明：

- 读了哪些文档。
- 改了哪些路径或接口。
- 跑了哪些验证。
- 是否有未处理的旧路径、运行数据或链接风险。
