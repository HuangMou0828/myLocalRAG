# AIMemoryHub Docs

这个目录是 AIMemoryHub（formerly `myLocalRAG`）的长期说明区：既给人快速理解系统，也给 LLM/Agent 在接手任务前建立上下文。

如果你不知道从哪里开始，先读本文件，再按任务进入对应文档。

## 先读这里

| 目标 | 建议入口 |
| --- | --- |
| LLM/Agent 接手任务 | [LLM Entry](./llm-entry.md) |
| 理解项目定位 | [项目介绍](./project/intro.md) |
| 理解 Git 与协作规则 | [Git Workflow](./workflow/git-workflow.md) |
| 做代码审查 | [Review Checklist](./workflow/review-checklist.md) |
| 调用或维护 API | [API 文档维护说明](./api/README.md) |
| 理解 Knowledge Workbench | [知识工作台 Mock 演练](./knowledge-workbench/mock-runbook.md) |
| 理解 Wiki / Obsidian / Vault | [Wiki Promotion Pipeline](./wiki-vault/promotion-pipeline.md) |
| 执行 GBrain V2 对齐 | [GBrain V2 Execution Guide](./wiki-vault/gbrain-v2-execution.md) |
| 接入 OpenClaw L5 记忆 | [OpenClaw L5 Memory Backend Rules](./openclaw/l5-memory-backend-rules.md) |

## 按任务找文档

### 我要理解系统

先读：

- [项目介绍](./project/intro.md)
- [会话同步与人工筛选规则](./workflow/session-sync-review-rules.md)
- [Obsidian Vault Publication Layer](./wiki-vault/obsidian-syncthing-mvp.md)

适合建立整体心智模型：数据从多 AI 会话进入系统，经过人工筛选、知识工作台、Wiki/Vault，最后沉淀成长线记忆。

### 我要开发功能

先读：

- [Git Workflow](./workflow/git-workflow.md)
- [Review Checklist](./workflow/review-checklist.md)
- [API 文档维护说明](./api/README.md)

如果改到知识工作台或 Wiki 升格，再读：

- [知识工作台 Mock 演练](./knowledge-workbench/mock-runbook.md)
- [Wiki Promotion Pipeline](./wiki-vault/promotion-pipeline.md)
- [Wiki Page Contract](./wiki-vault/page-contract.md)

### 我要调 API

先读：

- [API 文档维护说明](./api/README.md)
- [OpenAPI](./api/openapi.yaml)
- [Public OpenAPI](./api/openapi.public.yaml)

维护 API 时，同步更新 OpenAPI，并运行公开 API 文档检查。

### 我要接入 OpenClaw

先读：

- [OpenClaw L5 Memory Backend Rules](./openclaw/l5-memory-backend-rules.md)
- [OpenClaw Knowledge Ingestion Proposal](./openclaw/knowledge-ingestion.md)
- [OpenClaw Prompt & Tool Template](./openclaw/prompts.md)

当前推荐链路是：

```text
OpenClaw inbox -> AIMemoryHub Raw Inbox -> Promotion Review -> Vault / Obsidian
```

`~/.openclaw/knowledge/inbox` 是 OpenClaw 给 AIMemoryHub 的待同步原料区，不是 L5 本体。L5 本体是 AIMemoryHub 里的长期 Wiki/Vault 记忆。

### 我要维护 Wiki / Obsidian

先读：

- [Wiki Promotion Pipeline](./wiki-vault/promotion-pipeline.md)
- [Wiki Page Contract](./wiki-vault/page-contract.md)
- [Obsidian Vault Publication Layer](./wiki-vault/obsidian-syncthing-mvp.md)
- [GBrain V2 评估方案](./wiki-vault/gbrain-v2-evaluation-plan.md)
- [GBrain V2 数据契约](./wiki-vault/gbrain-v2-contract.md)
- [GBrain V2 执行手册](./wiki-vault/gbrain-v2-execution.md)
- [GBrain V2 Phase B 清单](./wiki-vault/gbrain-v2-phase-b-checklist.md)

这些文档定义了证据如何升格、页面如何写、Vault 如何发布给 Obsidian。

### 我要跑 Knowledge Workbench 演练

先读：

- [知识工作台 Mock 演练](./knowledge-workbench/mock-runbook.md)
- [Mock 数据](./knowledge-workbench/mock-data/knowledge-workbench-raw-inbox-items.json)

演练重点是 Raw Inbox 批量导入、去重合并、升格审核和回滚。

## 文档分组索引

### Core

- [项目介绍](./project/intro.md)
- [会话同步与人工筛选规则](./workflow/session-sync-review-rules.md)

### Workflow

- [Git Workflow](./workflow/git-workflow.md)
- [Review Checklist](./workflow/review-checklist.md)
- [ADR 使用说明](./adr/README.md)
- [ADR 模板](./adr/0000-template.md)

### API

- [API 文档维护说明](./api/README.md)
- [OpenAPI](./api/openapi.yaml)
- [Public OpenAPI](./api/openapi.public.yaml)

### Knowledge Workbench

- [知识工作台 Mock 演练](./knowledge-workbench/mock-runbook.md)
- [Mock 数据](./knowledge-workbench/mock-data/knowledge-workbench-raw-inbox-items.json)

### Wiki Vault / Obsidian

- [Wiki Promotion Pipeline](./wiki-vault/promotion-pipeline.md)
- [Wiki Page Contract](./wiki-vault/page-contract.md)
- [Obsidian Vault Publication Layer](./wiki-vault/obsidian-syncthing-mvp.md)
- [GBrain V2 评估方案](./wiki-vault/gbrain-v2-evaluation-plan.md)
- [GBrain V2 数据契约](./wiki-vault/gbrain-v2-contract.md)
- [GBrain V2 执行手册](./wiki-vault/gbrain-v2-execution.md)
- [GBrain V2 Phase B 清单](./wiki-vault/gbrain-v2-phase-b-checklist.md)

### OpenClaw

- [OpenClaw L5 Memory Backend Rules](./openclaw/l5-memory-backend-rules.md)
- [OpenClaw Knowledge Ingestion Proposal](./openclaw/knowledge-ingestion.md)
- [OpenClaw Prompt & Tool Template](./openclaw/prompts.md)

## 给 LLM / Agent 的读取建议

默认先读：

1. [LLM Entry](./llm-entry.md)
2. [项目介绍](./project/intro.md)
3. [Git Workflow](./workflow/git-workflow.md)
4. 和当前任务最相关的一组文档

任务相关读取规则：

- 做 OpenClaw 接入：读 OpenClaw 三件套，再看 API 文档。
- 做 Wiki/Vault：读 Wiki Promotion Pipeline、Wiki Page Contract、Obsidian Syncthing MVP。
- 做 Knowledge Workbench：读 mock runbook、mock 数据、Wiki Promotion Pipeline。
- 做 API：读 API README、OpenAPI，并在改动后运行 API 文档检查。
- 做代码审查：读 Review Checklist，并优先输出风险、缺陷和缺失验证。

不要默认全量阅读所有文档。先按任务定位，再只读取相关文档；如果发现上下文缺口，再逐步扩展。

## 后续整理方向

当前文档已按主题归档：

```text
docs/
├── README.md
├── llm-entry.md
├── project/
├── workflow/
├── api/
├── knowledge-workbench/
├── wiki-vault/
├── openclaw/
└── adr/
```

后续如果继续整理，需要同步修正文档链接、OpenClaw prompt 里的引用、以及任何脚本中的固定路径。
