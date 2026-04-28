# ADR 0001 - CSS 架构：全局 CSS + Scoped 混合方案

- 状态: Accepted
- 日期: 2026-04-27
- 负责人: @huangmou

## 背景

项目存量 CSS 共 14,712 行，分布在 10 个全局文件中。其中两个文件已超过 4,500 行：

- `20-layout-shell.css`（4,502 行）：同时承载 app 布局骨架与多个共享 UI 组件（accordion、chip、stack）
- `34-feature-knowledge-sources.css`（4,652 行）：单一功能的全量样式

44 个 Vue 组件中有 39 个没有任何 `<style>` 块，全部依赖全局 CSS。现有问题：

1. 全局选择器无法被工具检测死码，废弃样式无法发现
2. 4000+ 行单文件无法有效维护，修改回归风险高
3. 所有 CSS 首屏全量加载，无法按功能懒加载
4. BEM 命名纪律无机器强制，靠人肉约定维护
5. 过去已有因"体积超大"导致的重构技术债

## 决策

采用**全局 CSS + Scoped 混合方案**，以"CSS 与组件的使用关系"作为唯一判断标准：

- **1:1 关系（单个组件使用）** → `<style scoped>`，迁入组件
- **1:N 关系（多个组件共用）** → 保留全局 CSS，归入固定清单文件
- **Design tokens / CSS 变量** → 永远全局（`10-theme-base.css`）

全局 CSS 文件收敛为 5 个固定文件（详见 [css-standards.md](../workflow/css-standards.md)），任何新增需要新 ADR。

存量 `3X-feature-*.css` 文件进入**冻结迁移**状态：禁止追加，机会式迁出，最终删除。

## 备选方案

- **方案 A（完全 Scoped）**：将所有 CSS 迁入 `<style scoped>`。成本：一次性大规模迁移，风险高，需要同步拆分大型组件。

- **方案 B（保持现状 + 按主题拆文件）**：将 4000 行文件拆成多个按主题命名的全局文件（`.hero.css`、`.toolbar.css`）。问题：只解决可读性，不解决死码、工具支持和全局污染问题；6 个月后每个拆出的文件又会长回 800 行。

- **方案 C（本 ADR 选择）**：混合方案，清晰判断边界，增量迁移，不要求一次完成。

## 影响评估

**正向收益：**
- 新功能的 CSS 有明确归属，IDE 可追踪
- 全局文件收敛，总行数上限可控（2,000 行以内）
- 存量文件机会式清理，不阻塞业务开发

**负向成本：**
- 迁移存量 `3X-feature-*.css` 需要配合组件拆分（尤其是 `KnowledgeSourcesPanel.vue`）
- 混合模式需要开发者理解边界规则

**风险与缓解：**
- 迁移中 CSS 重复或遗漏 → 每次迁移后视觉回归测试（截图对比）
- 规则执行不一致 → review checklist 强制检查，不依赖口头约定

## 落地清单

- [x] 制定 CSS 标准文档（`docs/workflow/css-standards.md`）
- [x] 更新 PR review checklist 增加 CSS 检查项
- [x] 更新 `ARCHITECTURE.md` 增加 CSS 章节
- [ ] 拆分 `20-layout-shell.css` → 布局骨架 + `21-shared-components.css`
- [ ] 迁移 `34-feature-knowledge-sources.css`（需先拆分 `KnowledgeSourcesPanel.vue`）
- [ ] 机会式迁移其余 `3X-feature-*.css` 文件（随功能迭代完成）

## 回滚策略

本 ADR 不涉及破坏性变更，新旧方式可以共存。若迁移引发视觉回归：

1. git revert 对应迁移 commit
2. 确认问题选择器
3. 修复后重新迁移

## 关联

- 标准文档：[docs/workflow/css-standards.md](../workflow/css-standards.md)
- Review Checklist：[docs/workflow/review-checklist.md](../workflow/review-checklist.md)
