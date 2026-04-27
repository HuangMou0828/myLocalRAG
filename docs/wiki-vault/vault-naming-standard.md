# Vault 文件命名标准

> 日期：2026-04-26
> 状态：正式标准草案
> 适用范围：`vault/**`
> 目标：让 Vault 在 Obsidian 中首先是“人可读的笔记集合”，而不是“把数据库主键直接暴露成文件名的产物”

## 1. 一句话原则

Vault 文件名优先服务于人。

规则收敛成一句话就是：

**标题像笔记，属性像数据库。**

这意味着：

- 文件名负责让人一眼看懂“这是什么”
- frontmatter 负责保存系统追踪所需的身份信息
- 目录负责表达分类，不允许文件名重复承担目录语义

## 2. 命名总规则

### 2.1 必须遵守

- 文件名只保留主题语义，不保留技术身份
- 文件名默认不带类型前缀
- 文件名默认不带来源前缀
- 文件名默认不带 provider 前缀
- 文件名默认不带长 ID
- 文件名默认不带 workflow 状态
- 文件名默认不带时间戳，除非时间本身就是主题的一部分
- 文件名应该能被人单独阅读，不依赖目录上下文也尽量可理解

### 2.2 明确禁止

以下形式不再是标准命名：

- `knowledge__主题__长id.md`
- `provider__title__hash.md`
- `issue__主题.md`
- `pattern__主题.md`
- `topic__source__id.md`
- 任何把数据库 ID、trace ID、atom ID、session ID 直接塞进文件名的形式

## 3. 技术标识放哪里

所有技术身份都下沉到 frontmatter，而不是暴露在文件名里。

优先放入以下属性：

- `title`
- `type`
- `canonicalId`
- `knowledgeItemId`
- `atomIds`
- `lineageIds`
- `sourceSessionId`
- `sourceType`
- `provider`
- `promotionState`
- `promotionSource`
- `updatedAt`

如果后续还需要新的追踪键，也继续加属性，不回退到污染文件名。

## 4. 文件名格式

标准格式：

`<human-readable-slug>.md`

示例：

- `gateway-sigterm-rootcause.md`
- `openclaw-multipath-diagnosis.md`
- `feishu-sprint-lookup.md`
- `embedding-rebuild-warning.md`

### 4.1 冲突处理

默认不追加任何技术后缀。

只有在同目录下发生重名冲突时，才允许追加一个短后缀：

`<human-readable-slug>--<short-suffix>.md`

示例：

- `gateway-sigterm-rootcause.md`
- `gateway-sigterm-rootcause--a1b2.md`

约束：

- 后缀必须短
- 后缀只用于消歧
- 后缀不能重新演化成长 ID 直出

## 5. 目录职责与命名规则

### 5.1 `inbox/`

定位：候选层、证据层、待审核层。

命名规则：

- 用主题名命名
- 不带 `knowledge__`
- 不带 `raw__`
- 不带 `candidate__`
- 不带 `knowledgeItemId`

示例：

- `gateway-sigterm-rootcause.md`
- `openclaw-multipath-diagnosis.md`

frontmatter 至少应有：

- `type: knowledge-evidence`
- `knowledgeItemId`
- `canonicalId`
- `sourceType`
- `intakeStage`

### 5.2 `sources/`

定位：会话或来源证据页，仍然是人会直接浏览的目录。

命名规则：

- 优先使用会话主题或压缩后的人工可读摘要
- 不带 `provider__`
- 不带 session hash
- 不带长 ID

示例：

- `gateway-sigterm-investigation.md`
- `task-review-and-promotion-flow.md`

如果原始会话标题不可读：

- 允许基于首个用户意图生成短标题
- 允许在冲突时追加短后缀
- 不允许退回 `provider__title__hash.md`

frontmatter 至少应有：

- `type: source-evidence`
- `sourceSessionId`
- `provider`
- `sessionStartedAt`
- `sessionUpdatedAt`

### 5.3 `issues/`

定位：reader-first 的问题页。

命名规则：

- 以问题主题命名
- 不带 `issue__`
- 不带审批状态
- 不带来源 ID

示例：

- `gateway-sigterm-rootcause.md`
- `embedding-preview-timeout.md`

### 5.4 `patterns/`

定位：reader-first 的模式页。

命名规则：

- 以模式主题命名
- 不带 `pattern__`
- 不带分类前缀编号，除非编号本身是业务语义

示例：

- `raw-to-atom-promotion-pipeline.md`
- `reader-first-approval-only.md`

### 5.5 `projects/`

定位：reader-first 的项目页。

命名规则：

- 直接使用项目名称或稳定缩写
- 不带 `project__`

示例：

- `my-local-rag.md`
- `openclaw.md`

### 5.6 `syntheses/`

定位：主题归纳或综合页。

命名规则：

- 直接使用综合主题
- 不带 `synthesis__`

示例：

- `knowledge-workbench-redesign.md`
- `v2-only-vault-governance.md`

### 5.7 `concepts/`、`entities/`、`providers/`

定位：辅助知识页。

命名规则与上面一致：

- 文件名只保留主题语义
- 类型和来源一律走 frontmatter

## 6. 标题与文件名关系

Vault 文件名和文档标题应尽量一致，但允许标题比文件名更自然。

推荐：

- 文件名：`gateway-sigterm-rootcause.md`
- 文档标题：`# Gateway SIGTERM Root Cause`

不推荐：

- 文件名可读，但标题仍是技术串
- 文件名和标题表达完全不同，导致人无法建立记忆映射

## 7. 生成策略要求

命名标准会反向约束生成逻辑。

后续实现必须满足：

- 不能再依赖文件名前缀识别类型
- 不能再依赖文件名中的 ID 做反查
- 清理逻辑应基于 frontmatter 或显式索引，而不是 `knowledge__`
- lint 扫描应按 frontmatter `type` 或目录规则识别目标文件
- promotion 引用应保存 `relativePath + canonicalId`，而不是把技术身份嵌在路径里

## 8. 兼容与迁移原则

从旧规则迁移到新规则时，按以下原则执行：

1. 先定义新命名标准
2. 再修改生成器
3. 再迁移现有文件
4. 最后移除对旧前缀的技术依赖

迁移过程中允许兼容读取旧命名，但不允许继续按旧标准新写文件。

## 9. 评判标准

一个 Vault 文件名是否合格，可以用下面三个问题快速判断：

1. 人在 Obsidian 目录里看到它，能否大致知道内容是什么？
2. 去掉目录上下文后，这个文件名是否仍然像“一个笔记主题”？
3. 这个名字里是否混入了本该放进属性的技术信息？

只要第 3 个问题答案是“是”，就说明这个命名仍然不合格。

## 10. 当前执行口径

从这版标准开始，Vault 文件命名默认执行以下口径：

- 所有 `vault/**` 人读文件都采用人类可读命名
- 所有技术标识默认下沉到 frontmatter
- 所有目录默认禁止类型前缀和长 ID 直出
- 只有重名冲突时才允许最小化短后缀
