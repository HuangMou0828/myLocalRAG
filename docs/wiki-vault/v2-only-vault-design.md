# V2-only 新 Vault 规则

> 日期：2026-04-26
> 状态：拟执行标准
> 目标：让新 Vault 只走 `Raw -> Atom -> Approved Reader-first` 主链路，不再让 legacy 自动候选直接写入最终知识层

## 1. 一句话原则

新 Vault 只认 V2。

默认主流程是：

`Raw / 导入 -> knowledge_items -> knowledge_atoms + lineage -> V2 候选 -> 人工 approve -> reader-first Vault`

不再把旧的 source evidence 自动聚类结果直接写成最终知识页。

## 2. 分层职责

### 2.1 Raw 层

- 存放位置：`knowledge_items`
- 来源：手动采集、快速采集、批量导入、OpenClaw 导入
- 职责：保存原始材料和最小上下文
- 规则：允许噪音存在，不直接等价于正式知识

### 2.2 Atom 层

- 存放位置：`knowledge_atoms`、`knowledge_lineage`
- 来源：Raw 保存后的 dual-write
- 职责：把原始材料整理成稳定粒度的知识原子
- 规则：V2 是唯一默认候选来源

### 2.3 Reader-first 层

- 存放位置：
  - `vault/issues/*.md`
  - `vault/patterns/*.md`
  - `vault/syntheses/*.md`
  - `vault/projects/*.md`
- 来源：只来自人工 approve 的 promotion 记录
- 规则：未 approve 的候选不得直接生成最终知识页

## 3. 哪些东西继续保留

以下内容继续存在，但不再作为默认知识生产主链：

- `vault/sources/*.md`
  用于会话追溯和证据回看

- `vault/inbox/*.md`
  用于 Raw 条目的证据追溯，命名遵循“人类可读文件名 + frontmatter 技术标识”标准

- `vault/inbox/promotion-queue.md`
  作为兼容和过渡期观察面板

- `vault/.gbrain-v2-feed/records.jsonl`
  作为检索 feed，而不是人读知识页

## 4. 新默认流程

### 4.1 日常主流程

1. 在 `知识采集` 新建或导入原始条目
2. 补项目、主题、问题、intake stage
3. 设为 `wiki-candidate`
4. 点 `保存并送升格审核`
5. 在 `升格审核` 默认查看 `V2 候选`
6. 只对真正值得长期保留的条目执行 `Approve`
7. 系统把它写入 reader-first Vault
8. 最后在 `健康巡检` 看结构问题

### 4.2 Task Review 的新定位

`任务筛选` 继续保留，但它不再是新 Vault 的必经入口。

它的职责改为：

- 处理长会话分段
- 判断是否值得继续检索
- 帮助补上下文
- 作为辅助证据分流器

而不是默认生产最终知识页。

## 5. 禁止事项

以下行为不再视为标准生产流程：

- 仅凭 `sources/*.md` 自动生成最终 `issue/pattern/project`
- 未 approve 的自动候选直接落到 reader-first
- 把 legacy promotion queue 当成默认审核面
- 让 `Health` 巡检候选噪音并把它们当正式知识维护

## 6. 生成规则

### 6.1 允许自动生成

- Raw -> Atom
- Atom -> V2 候选
- Approved record -> reader-first 页面重建
- Approved evidence -> project / concept 聚合

### 6.2 不允许自动生成

- source evidence -> issue/pattern/project 的直接最终落盘
- unapproved atom -> reader-first 页面
- unapproved knowledge evidence -> reader-first 页面

## 7. 目录语义

- `sources/`: 证据层，不等于正式知识
- `inbox/`: 过渡层和审核层
- `issues/patterns/syntheses/projects/`: 最终知识层
- `.gbrain-v2-feed/`: 检索层

## 7.1 命名原则

新 Vault 的目录结构与命名规则一起生效：

- `vault/**` 面向 Obsidian 阅读的文件一律采用人类可读命名
- 类型、来源、ID、状态等技术信息一律下沉到 frontmatter
- 目录负责分类，文件名只负责表达主题

详见：

- `docs/wiki-vault/vault-naming-standard.md`

## 8. 新 Vault 重建建议

推荐顺序：

1. 归档旧 `vault/`
2. 清空自动生成目录
3. 保留或回灌真正需要的 Raw 数据
4. 只通过 V2 候选重新 approve
5. 重建新 Vault
6. 用 `健康巡检` 做结构验收

## 9. 当前执行口径

从这版开始，默认口径应当是：

- V2 是默认审阅方式
- `reader-first` 只应来自已批准记录
- legacy 自动候选保留为兼容入口，但不再驱动新 Vault 的默认知识生产

## 10. 日常执行标准

设计规则之外，日常操作应统一遵循这份执行标准：

- [V2-only 新 Vault 日常操作规范](/Users/hm/myLocalRAG/docs/wiki-vault/v2-only-vault-operating-standard.md)
