# OpenClaw API Capability Matrix

本文档给 OpenClaw 和外部调用方使用，说明 `myLocalRAG` 可以暴露哪些能力、推荐怎样分层授权、以及每类接口的读写风险。

默认服务地址：

```text
http://127.0.0.1:3030
```

机器可读接口文档：

- 公开工具集：`GET /api-docs/openapi.public.yaml`
- 内部全量接口：`GET /api-docs/openapi.yaml`
- Swagger UI：`GET /api-docs/public`、`GET /api-docs`

当前后端没有内建鉴权。只在本机使用时可以直接调用；如果要给外部网络使用，应在网关层增加 token、scope、限流和审计日志。

## 1. Scope 建议

| Scope | 用途 | 默认调用方 |
| --- | --- | --- |
| `read` | 检索、读取 wiki、读取历史、复盘、Prompt 评分 | OpenClaw 默认工具 |
| `write:knowledge` | 写入 Raw Inbox、同步 OpenClaw inbox | OpenClaw 记忆写入工具 |
| `admin` | 扫描本地源、发布 vault、重建 embedding、修改模型/飞书配置、Bug 工作流 | 管理员或手动操作工具 |

推荐默认只给 OpenClaw：

```text
read + write:knowledge
```

`admin` 只在用户明确授权时启用。

## 2. OpenClaw 默认读取工具

这些接口适合作为 OpenClaw 的常驻工具。

| 能力 | 接口 | Scope | 风险 | 说明 |
| --- | --- | --- | --- | --- |
| 健康检查 | `GET /api/health` | `read` | 低 | 检查服务可达。 |
| 查历史会话 | `GET /api/sessions` | `read` | 中 | 返回会话列表，不含 `searchableText`。 |
| 查原始历史记忆 | `POST /api/retrieve` | `read` | 中 | 可返回历史片段；`includeMessages=true` 时信息量更大。 |
| 解释 vault 规则 | `GET /api/wiki-vault/explain` | `read` | 低 | 让 OpenClaw 理解读写边界。 |
| Wiki lint | `GET /api/wiki-vault/lint` | `read` | 低 | 默认会写报告；外部只读调用建议传 `writeReport=0`。 |
| Promotion Queue | `GET /api/wiki-vault/promotion-queue` | `read` | 中 | 默认会写报告；外部只读调用建议传 `writeReport=0`。 |
| 搜索 wiki notes | `POST /api/wiki-vault/search` | `read` | 中 | 优先查长期知识；可用 `syncOpenClaw=true` 先同步 inbox。 |
| 读取 note | `GET /api/wiki-vault/note` | `read` | 中 | 读取单个 wiki note 完整正文。 |
| 读取 project hub | `GET /api/wiki-vault/project` | `read` | 中 | 项目任务开始前优先调用。 |
| Prompt rubric | `GET /api/prompt-rubric` | `read` | 低 | 获取评分规则。 |
| Prompt 评分 | `POST /api/prompt-score` | `read` | 中 | 可能调用 assistant 模型做效果评估。 |
| Prompt 批量评分 | `POST /api/prompt-score-batch` | `read` | 低 | 规则评分。 |
| Prompt 优化 | `POST /api/prompt-optimize` | `read` | 中 | 可能调用 DSPy/远端模型。 |
| 模型问答 | `POST /api/ask` | `read` | 中 | 调用配置的 assistant 模型。 |
| 使用复盘 | `POST /api/review` | `read` | 中 | 输出习惯、重复问题和 skill 候选。 |

## 3. OpenClaw 写入与同步工具

这些接口用于把 OpenClaw 的 L4 经验接入 `myLocalRAG` 的 L5 长期记忆层。

| 能力 | 接口 | Scope | 风险 | 说明 |
| --- | --- | --- | --- | --- |
| 预览 OpenClaw inbox | `POST /api/openclaw-knowledge/preview` | `write:knowledge` | 中 | 只读扫描 `~/.openclaw/knowledge/inbox` 或指定 root。 |
| 导入 OpenClaw inbox | `POST /api/openclaw-knowledge/import` | `write:knowledge` | 中 | 写入 Raw Inbox，并刷新 Promotion Queue。 |
| 列 Raw Inbox | `GET /api/knowledge-items` | `write:knowledge` | 中 | 支持 `limit/sourceType/status/q`。 |
| 写 Raw Inbox | `POST /api/knowledge-items` | `write:knowledge` | 中 | OpenClaw 直接上报结构化知识条目。 |
| 改 Raw Inbox 状态 | `POST /api/knowledge-items/status` | `write:knowledge` | 中 | 用于 draft/active/archived 等状态切换。 |
| 删除 Raw Inbox 条目 | `POST /api/knowledge-items/delete` | `write:knowledge` | 高 | 建议外部网关将其设为显式确认操作。 |

OpenClaw 写入优先级：

1. 首选写 Markdown 到 `~/.openclaw/knowledge/inbox`，再调用 `POST /api/openclaw-knowledge/import`。
2. 如果 OpenClaw 没有文件层，可以直接调用 `POST /api/knowledge-items`。
3. 不要直接写 `vault/issues`、`vault/patterns`、`vault/syntheses` 或 `vault/projects`。

## 4. 管理员受控能力

这些接口属于全系统能力，但不建议作为 OpenClaw 默认工具。需要用户授权、网关 scope 或 UI 操作。

### 4.1 Workspace 和来源管理

| 能力 | 接口 | Scope | 风险 |
| --- | --- | --- | --- |
| 工作区路径 | `GET /api/workspace` | `admin` | 高 |
| 数据源列表/新增 | `GET/POST /api/sources` | `admin` | 高 |
| 自动发现数据源 | `GET /api/discover-sources` | `admin` | 高 |
| 全量扫描 | `POST /api/scan` | `admin` | 高 |
| 扫描指定 provider | `POST /api/scan-provider` | `admin` | 高 |
| 文件夹导入 | `POST /api/import-folder` | `admin` | 高 |
| 上传文件预览 | `POST /api/import-preview` | `admin` | 中 |
| 上传文件导入 | `POST /api/import-folder-files` | `admin` | 高 |

### 4.2 Wiki 发布和维护

| 能力 | 接口 | Scope | 风险 |
| --- | --- | --- | --- |
| Wiki 构建统计 | `GET /api/wiki-vault/stats` | `admin` | 中 |
| 发布预览 | `POST /api/wiki-vault/preview` | `admin` | 中 |
| 同步任务启动/查询 | `POST/GET /api/wiki-vault/sync-job` | `admin` | 高 |
| 直接发布 vault | `POST /api/wiki-vault/publish` | `admin` | 高 |
| 应用升格候选 | `POST /api/wiki-vault/promotion-apply` | `admin` | 高 |
| 记录升格决策 | `POST /api/wiki-vault/promotion-decision` | `admin` | 高 |
| 预览升格候选 | `POST /api/wiki-vault/promotion-preview` | `admin` | 中 |
| 修复 wikilink | `POST /api/wiki-vault/repair-link` | `admin` | 高 |

### 4.3 Prompt、模型和 Embedding 运维

| 能力 | 接口 | Scope | 风险 |
| --- | --- | --- | --- |
| Prompt 效果评估 | `POST /api/prompt-effect-assessment` | `admin` | 中 |
| 模型设置读写 | `GET/POST /api/model-settings` | `admin` | 高 |
| 模型连通性测试 | `POST /api/model-settings/test` | `admin` | 高 |
| Embedding 统计 | `GET /api/embeddings/stats` | `admin` | 中 |
| Embedding 重建预览 | `POST /api/embeddings/preview` | `admin` | 中 |
| Embedding 同步重建 | `POST /api/embeddings/rebuild` | `admin` | 高 |
| Embedding 异步重建 | `POST/GET /api/embeddings/rebuild-job` | `admin` | 高 |
| 检索质量评估 | `POST /api/embeddings/evaluate` | `admin` | 中 |

### 4.4 Bug、Feishu 和会话维护

| 能力 | 接口 | Scope | 风险 |
| --- | --- | --- | --- |
| Patch 目录预设 | `GET/POST /api/bug-trace/settings/patch-dirs` | `admin` | 高 |
| 删除 Patch 目录预设 | `POST /api/bug-trace/settings/patch-dirs/delete` | `admin` | 高 |
| Patch 数量 | `GET /api/bug-trace/patch-count` | `admin` | 中 |
| Bug trace | `POST /api/bug-trace` | `admin` | 高 |
| 文件 preview | `POST /api/bug-trace/file-preview` | `admin` | 高 |
| 会话详情 | `POST /api/bug-trace/conversation-detail` | `admin` | 高 |
| 飞书设置 | `GET/POST /api/feishu/settings` | `admin` | 高 |
| 飞书待办 | `GET /api/feishu/todolist` | `admin` | 高 |
| 飞书 Bug 候选 | `GET /api/feishu/bug-candidates` | `admin` | 高 |
| 飞书批量流转 | `POST /api/feishu/todolist/batch-transition` | `admin` | 高 |
| Bug inbox 读写 | `GET/POST /api/bug-inbox` | `admin` | 高 |
| Bug 匹配飞书 | `POST /api/bug-inbox/match-feishu` | `admin` | 高 |
| Bug 绑定飞书 | `POST /api/bug-inbox/link-feishu` | `admin` | 高 |
| Bug 描述更新 | `POST /api/bug-inbox/update` | `admin` | 高 |
| Bug 删除 | `POST /api/bug-inbox/delete` | `admin` | 高 |
| 会话审核元数据 | `POST /api/sessions/review` | `admin` | 中 |
| 删除会话 | `POST /api/sessions/delete` | `admin` | 高 |
| 更新消息标签 | `POST /api/messages/tags`、`POST /api/messages/tags/`、`POST /api/message-tags` | `admin` | 中 |

## 5. OpenClaw 调用策略

执行任务前：

1. 项目长期约定、稳定方案、踩坑经验：先 `POST /api/wiki-vault/search`。
2. 已知道具体 note：再 `GET /api/wiki-vault/note`。
3. 项目任务：优先 `GET /api/wiki-vault/project`。
4. Wiki 证据不足：再 `POST /api/retrieve` 查原始历史。
5. 行为复盘、skill 候选：调用 `POST /api/review`。

执行任务后：

1. 产生可复用经验：写 OpenClaw inbox 的 `patterns/`，再同步。
2. 踩坑或修复故障：写 OpenClaw inbox 的 `errors/`，再同步。
3. 只是过程记录：写 `daily/`，默认不要直接升格。
4. 参考资料或功能设想：写 `reference/`。

## 6. 网关要求

外部暴露时建议网关实现：

- `Authorization: Bearer <token>`
- Scope 校验：`read`、`write:knowledge`、`admin`
- 请求体大小限制，尤其是 `content/messages/files`
- 本地路径白名单，禁止外部传任意绝对路径
- 审计日志：method、path、scope、调用方、请求摘要、响应状态、耗时
- 对高风险接口增加显式确认或只允许本机调用

## 7. 文档维护

接口变更后同步更新：

1. `docs/api/openapi.yaml`
2. `docs/api/openapi.public.yaml`
3. `docs/openclaw/prompts.md`
4. `docs/openclaw/api-capabilities.md`

验证命令：

```bash
npm run docs:api:check
npm run docs:api:check:public
```
