# OpenClaw Cron Automation Recipes

本文档给 OpenClaw 使用，用来把 `myLocalRAG` 的对外 API 编排成可执行的 cron 自动化。

目标：

- 自动同步 OpenClaw 写入的知识原料。
- 每天巡检 L5 记忆层健康状态。
- 每天生成 AI 使用日报和 skill 候选。
- 每周生成 AI 使用复盘和 Promotion Queue 周报。
- 每次自动化运行都必须显式提示，不允许静默执行。

默认服务地址：

```text
http://127.0.0.1:3030
```

推荐时区：

```text
Asia/Shanghai
```

## 1. 全局执行规则

OpenClaw 创建 cron 时必须遵守这些规则。

### 1.1 每次运行都要提示

每个自动化任务开始和结束时，都要生成一条可见提示。

开始提示模板：

```markdown
## 自动化操作开始

- 名称：{{automation_name}}
- 计划时间：{{scheduled_time}}
- 实际开始：{{started_at}}
- 本次会调用：
  - {{method}} {{path}}
- 写入级别：{{read_only|write_knowledge|admin_suggestion}}
- 安全策略：只执行本文档允许的动作；高风险动作只给建议，不自动执行。
```

结束提示模板：

```markdown
## 自动化操作完成

- 名称：{{automation_name}}
- 开始时间：{{started_at}}
- 结束时间：{{finished_at}}
- 状态：{{success|partial|failed}}
- 调用接口：
  - {{method}} {{path}} -> {{status}}
- 本次写入：{{none|raw_inbox|report_only}}
- 需要用户确认：{{yes|no}}

### 摘要

{{summary}}

### 下一步

{{next_actions}}
```

### 1.2 默认禁止动作

cron 不允许自动执行以下接口。只能生成建议，等待用户确认：

- `POST /api/sessions/delete`
- `POST /api/knowledge-items/delete`
- `POST /api/wiki-vault/publish`
- `POST /api/wiki-vault/promotion-apply`
- `POST /api/wiki-vault/promotion-decision`
- `POST /api/wiki-vault/repair-link`
- `POST /api/embeddings/rebuild`
- `POST /api/embeddings/rebuild-job`
- `POST /api/model-settings`
- `POST /api/feishu/todolist/batch-transition`
- `POST /api/bug-trace/*`
- `POST /api/bug-inbox/delete`

### 1.3 失败处理

如果任一接口失败：

1. 不重试高风险写入。
2. 最多重试低风险读取 1 次。
3. 输出失败接口、错误内容和建议动作。
4. 不要编造缺失数据。

### 1.4 输出位置

OpenClaw 应把每次 cron 的结果作为可见消息、通知或 inbox item 输出。

建议标题格式：

```text
[myLocalRAG 自动化] {{automation_name}} - {{YYYY-MM-DD HH:mm}}
```

## 2. 第一阶段自动化清单

| 名称 | 建议频率 | 风险 | 是否自动写入 | 目标 |
| --- | --- | --- | --- | --- |
| L5 Health Check | 每天 09:00 | 低 | 否 | 检查服务、vault lint、promotion queue。 |
| OpenClaw Inbox Import | 每天 12:00、18:00 | 中 | 是，Raw Inbox | 同步 `~/.openclaw/knowledge/inbox`。 |
| Daily AI Usage Report | 每天 20:30 | 中 | 否 | 输出当天 AI 使用复盘和 skill 候选。 |
| Weekly AI Review | 每周一 09:30 | 中 | 否 | 输出最近 7 天 AI 使用复盘和 skill 候选。 |
| Weekly Promotion Queue Report | 每周五 17:30 | 中 | 否 | 汇总最值得处理的升格候选。 |

## 3. Cron Recipe: L5 Health Check

### Schedule

```yaml
name: mylocalrag-l5-health-check
timezone: Asia/Shanghai
schedule: "0 9 * * *"
```

### Allowed API Calls

```text
GET /api/health
GET /api/wiki-vault/lint?writeReport=0
GET /api/wiki-vault/promotion-queue?writeReport=0
```

### Prompt

```text
你是 myLocalRAG 的 L5 健康巡检助手。

请按顺序调用：
1. GET /api/health
2. GET /api/wiki-vault/lint?writeReport=0
3. GET /api/wiki-vault/promotion-queue?writeReport=0

要求：
- 每次运行开始和结束都输出“自动化操作提示”。
- 这是只读巡检，不要调用任何写入、删除、发布、重建接口。
- 如果 health 失败，停止后续调用并输出失败原因。
- 如果 lint 有错误，列出最重要的 5 个问题。
- 如果 promotion queue 有候选，输出数量和优先处理建议。
- 如果全部正常，输出简短 OK 报告。
```

### Output Template

```markdown
# L5 健康巡检日报

## 自动化操作提示

- 名称：L5 Health Check
- 写入级别：read_only
- 调用接口：
  - GET /api/health
  - GET /api/wiki-vault/lint?writeReport=0
  - GET /api/wiki-vault/promotion-queue?writeReport=0

## 结论

{{ok_or_problem_summary}}

## Vault 健康

- lint 状态：{{lint_status}}
- 主要问题：
  - {{top_lint_issue_1}}
  - {{top_lint_issue_2}}

## Promotion Queue

- 候选数量：{{candidate_count}}
- 建议优先处理：
  - {{candidate_1}}
  - {{candidate_2}}

## 需要用户确认

{{confirmation_needed}}
```

## 4. Cron Recipe: OpenClaw Inbox Import

### Schedule

```yaml
name: mylocalrag-openclaw-inbox-import
timezone: Asia/Shanghai
schedule: "0 12,18 * * *"
```

### Allowed API Calls

```text
POST /api/openclaw-knowledge/import
GET /api/wiki-vault/promotion-queue?writeReport=0
```

### Request Body

```json
{}
```

如需指定 OpenClaw inbox 根目录：

```json
{
  "root": "~/.openclaw/knowledge/inbox"
}
```

### Prompt

```text
你是 myLocalRAG 的 OpenClaw inbox 同步助手。

请调用：
1. POST /api/openclaw-knowledge/import
2. GET /api/wiki-vault/promotion-queue?writeReport=0

要求：
- 每次运行开始和结束都输出“自动化操作提示”。
- 本任务允许写入 Raw Inbox，但不允许应用 promotion、不允许发布 vault、不允许删除知识条目。
- 汇总新增、更新、跳过、归档数量。
- 如果同步后出现 wiki-candidate，列出最多 5 条值得人工处理的候选。
- 如果没有变化，明确输出“本次无新增或更新”。
```

### Output Template

```markdown
# OpenClaw Inbox 同步报告

## 自动化操作提示

- 名称：OpenClaw Inbox Import
- 写入级别：write_knowledge
- 调用接口：
  - POST /api/openclaw-knowledge/import
  - GET /api/wiki-vault/promotion-queue?writeReport=0
- 禁止动作：不自动 promotion apply，不自动 publish，不自动 delete。

## 同步结果

- 新增：{{created_count}}
- 更新：{{updated_count}}
- 跳过：{{skipped_count}}
- 归档：{{archived_count}}
- inbox 根目录：{{root}}

## 候选升格

- 当前候选数：{{promotion_candidate_count}}
- 建议优先看：
  - {{candidate_title_1}}：{{reason_1}}
  - {{candidate_title_2}}：{{reason_2}}

## 需要用户确认

{{manual_actions}}
```

## 5. Cron Recipe: Daily AI Usage Report

### Schedule

```yaml
name: mylocalrag-daily-ai-usage-report
timezone: Asia/Shanghai
schedule: "30 20 * * *"
```

### Allowed API Calls

```text
POST /api/review
POST /api/retrieve
POST /api/wiki-vault/search
```

### Request Body

`POST /api/review`：

```json
{
  "recentDays": 1,
  "minRepeatedPrompt": 2
}
```

`POST /api/retrieve` 只在日报需要补证据时调用：

```json
{
  "query": "今天重复出现的问题、未完成任务、可沉淀经验",
  "topK": 8,
  "includeMessages": false,
  "generateAnswer": false
}
```

### Prompt

```text
你是 myLocalRAG 的每日 AI 使用复盘助手。

请先调用 POST /api/review，参数 recentDays=1, minRepeatedPrompt=2。
如果 summary.sessionCount 为 0，输出低活动日报，不要调用额外接口。
如果 repeatedPrompts、skillCandidates 或 topTerms 信息不足，可以调用 POST /api/retrieve 补充当天相关证据。

要求：
- 每次运行开始和结束都输出“自动化操作提示”。
- 只生成日报，不自动创建 skill，不自动写入 vault，不自动删除会话。
- 每个判断都尽量附证据来源，例如 term、prompt、sessionId、title。
- 如果样本少于 3 个 session，标记“低置信度”。
- 输出必须包含 skill 候选，但允许为空。
```

### Output Template

````markdown
# AI 使用日报

日期：{{YYYY-MM-DD}}
置信度：{{high|medium|low}}

## 自动化操作提示

- 名称：Daily AI Usage Report
- 写入级别：report_only
- 调用接口：
  - POST /api/review
  - {{optional_extra_calls}}
- 禁止动作：不自动创建 skill，不自动写 vault，不自动删除历史。

## 今日概览

- 会话数：{{sessionCount}}
- 消息数：{{messageCount}}
- 平均消息数：{{avgMessagesPerSession}}
- 主要 provider：{{top_providers}}

## 高频主题

1. {{term_1}}：{{count_1}} 次，说明 {{interpretation_1}}
2. {{term_2}}：{{count_2}} 次，说明 {{interpretation_2}}
3. {{term_3}}：{{count_3}} 次，说明 {{interpretation_3}}

## 重复问题模式

{{repeated_prompt_summary}}

示例：

- 模式：{{prompt_pattern}}
- 出现次数：{{count}}
- 建议：{{how_to_reduce_repetition}}

## Skill 候选

{{skill_candidates}}

每个候选按下面格式输出：

```text
名称：{{skill_name}}
触发条件：{{trigger}}
输入：{{inputs}}
输出：{{outputs}}
校验清单：{{checks}}
证据：{{evidence}}
建议优先级：{{high|medium|low}}
```

## 今日可沉淀经验

- errors 候选：{{error_lessons}}
- patterns 候选：{{patterns}}
- reference 候选：{{references}}

## 明日建议

1. {{action_1}}
2. {{action_2}}
3. {{action_3}}

## 需要用户确认

{{confirmation_needed}}
````

## 6. Cron Recipe: Weekly AI Review

### Schedule

```yaml
name: mylocalrag-weekly-ai-review
timezone: Asia/Shanghai
schedule: "30 9 * * 1"
```

### Allowed API Calls

```text
POST /api/review
POST /api/retrieve
POST /api/prompt-score
POST /api/prompt-optimize
```

### Request Body

`POST /api/review`：

```json
{
  "recentDays": 7,
  "minRepeatedPrompt": 2
}
```

### Prompt

```text
你是 myLocalRAG 的每周 AI 使用复盘和 skill 候选助手。

请先调用 POST /api/review，参数 recentDays=7, minRepeatedPrompt=2。
如果 repeatedPrompts 中有高频低质量 prompt，可以最多挑 3 条调用 POST /api/prompt-score。
如果用户明显需要可复用模板，可以最多挑 1 条调用 POST /api/prompt-optimize，但只输出建议，不自动写入 skill。

要求：
- 每次运行开始和结束都输出“自动化操作提示”。
- 不自动创建 skill，不自动修改任何配置，不自动删除历史。
- 输出 3-5 个高价值主题。
- 输出 1-5 个 skill 候选，并按优先级排序。
- 每个候选必须包含触发条件、输入、输出、校验清单和证据。
```

### Output Template

```markdown
# AI 使用周报与 Skill 候选

周期：{{start_date}} 至 {{end_date}}

## 自动化操作提示

- 名称：Weekly AI Review
- 写入级别：report_only
- 调用接口：
  - POST /api/review
  - {{optional_prompt_score_or_optimize_calls}}
- 禁止动作：不自动创建 skill，不自动写入 vault。

## 使用概览

- 会话数：{{sessionCount}}
- 消息数：{{messageCount}}
- 主要 provider：{{providerStats}}
- 长会话数：{{longSessionsCount}}

## 高价值主题

{{top_topics}}

## 重复问题模式

{{repeated_prompts}}

## Skill 候选

{{skill_candidates_ranked}}

## 本周落地计划

1. {{plan_1}}
2. {{plan_2}}
3. {{plan_3}}

## 需要用户确认

{{confirmation_needed}}
```

## 7. Cron Recipe: Weekly Promotion Queue Report

### Schedule

```yaml
name: mylocalrag-weekly-promotion-queue-report
timezone: Asia/Shanghai
schedule: "30 17 * * 5"
```

### Allowed API Calls

```text
GET /api/wiki-vault/promotion-queue?writeReport=0
POST /api/wiki-vault/search
```

### Prompt

```text
你是 myLocalRAG 的 Promotion Queue 周报助手。

请调用 GET /api/wiki-vault/promotion-queue?writeReport=0。
如果需要判断候选是否已有相似 wiki，可调用 POST /api/wiki-vault/search 做去重辅助。

要求：
- 每次运行开始和结束都输出“自动化操作提示”。
- 只做报告，不自动 promotion apply，不自动 decision，不自动 publish。
- 选出最多 5 条最值得人工处理的候选。
- 对每条候选说明推荐动作：approve / reject / needs-context / merge。
- 如果候选为空，输出“本周无待处理升格候选”。
```

### Output Template

```markdown
# Promotion Queue 周报

周期：{{week_start}} 至 {{week_end}}

## 自动化操作提示

- 名称：Weekly Promotion Queue Report
- 写入级别：report_only
- 调用接口：
  - GET /api/wiki-vault/promotion-queue?writeReport=0
  - {{optional_search_calls}}
- 禁止动作：不自动应用升格，不自动发布 vault。

## 队列概览

- 候选总数：{{candidate_count}}
- 高优先级：{{high_count}}
- 需要补上下文：{{needs_context_count}}
- 疑似重复：{{duplicate_count}}

## 推荐处理 Top 5

1. {{candidate_title_1}}
   - 推荐动作：{{approve|reject|needs-context|merge}}
   - 理由：{{reason}}
   - 证据：{{evidence}}

## 本周建议

{{weekly_actions}}

## 需要用户确认

{{confirmation_needed}}
```

## 8. 推荐创建顺序

先创建：

1. `mylocalrag-l5-health-check`
2. `mylocalrag-openclaw-inbox-import`
3. `mylocalrag-daily-ai-usage-report`

稳定运行 3 天后，再创建：

4. `mylocalrag-weekly-ai-review`
5. `mylocalrag-weekly-promotion-queue-report`

## 9. 最小可用 Cron Prompt

如果 OpenClaw 只支持一段 prompt 创建任务，可以使用下面模板，并把具体 recipe 的 schedule、allowed API calls 和 output template 填进去。

```text
请创建一个 OpenClaw cron 自动化。

名称：{{name}}
时区：Asia/Shanghai
计划：{{schedule}}

任务：
{{task_description}}

允许调用接口：
{{allowed_api_calls}}

禁止调用接口：
- 删除、发布、promotion apply、embedding rebuild、模型配置、飞书流转、bug trace 文件读取等高风险接口。

执行规则：
1. 每次运行开始和结束都必须输出“自动化操作提示”。
2. 只调用允许列表里的接口。
3. 高风险动作只输出建议，不自动执行。
4. 如果接口失败，输出失败接口、错误内容和下一步建议。
5. 输出必须使用下面模板：

{{output_template}}
```
