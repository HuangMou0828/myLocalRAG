# ADR（Architecture Decision Record）使用说明

当你需要做以下事情时，请新增一条 ADR：

- 新增跨 feature 依赖
- 调整分层职责或依赖方向
- 引入影响长期维护成本的关键技术选型

## 命名约定

- 文件名格式：`NNNN-短标题.md`
- 示例：`0001-allow-session-data-depend-on-session-filter.md`

## 流程

1. 复制 `0000-template.md` 新建 ADR。
2. 在 PR 中关联该 ADR。
3. 决策生效后把状态改为 `Accepted`。
4. 若被替代，新增后续 ADR 并将旧 ADR 状态改为 `Superseded`。
