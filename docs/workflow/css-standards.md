# CSS Architecture Standards

## 1. 核心判断规则

**一个问题决定一切：这段 CSS 被几个 Vue 组件使用？**

| 使用范围 | 放置位置 |
|---------|---------|
| 仅 1 个组件使用 | 该组件的 `<style scoped>` |
| 2+ 组件共用 | 全局 CSS 文件（见第 2 节清单） |
| CSS 变量 / design token | `10-theme-base.css` |

这条规则优先于文件大小、功能分类等所有其他标准。

---

## 2. 全局 CSS 文件清单（固定结构）

以下是**唯一允许存在**的全局 CSS 文件，任何新增需要走 ADR：

| 文件 | 职责 | 行数上限 |
|-----|------|---------|
| `00-tailwind.css` | Tailwind directives，禁止修改 | 10 |
| `10-theme-base.css` | CSS 变量（`:root` 级 design tokens） | 400 |
| `20-layout-shell.css` | 顶层容器骨架（layout grid, sidebar, main, panel 容器结构） | 500 |
| `21-shared-components.css` | 被 2+ feature 引用的 UI 组件（accordion, chip, stack 等） | 600 |
| `40-responsive-transitions.css` | 响应式断点与 CSS transition | 300 |

**任何文件超出行数上限即触发强制拆分或迁移。**

---

## 3. 存量 Feature CSS 文件（冻结迁移状态）

以下文件**禁止新增代码**，仅允许迁出（删减）：

| 文件 | 迁移目标 |
|-----|---------|
| `30-feature-bug-trace.css` | 对应组件 `<style scoped>` |
| `31-feature-component-library.css` | 对应组件 `<style scoped>` |
| `32-feature-bug-inbox-feishu.css` | 对应组件 `<style scoped>` |
| `33-feature-model-settings.css` | 对应组件 `<style scoped>` |
| `34-feature-knowledge-sources.css` | 对应组件 `<style scoped>`（需先拆分组件） |
| `50-feature-bug-detail.css` | 对应组件 `<style scoped>` |

迁移策略：**机会式迁移**——修改某个功能时，顺手将涉及的选择器迁移到对应组件，迁一段删一段，不要求一次性完成。

---

## 4. Feature CSS 规范（新功能）

### 强制规则

- 所有新功能的 CSS **必须**写入 Vue 组件的 `<style scoped>`
- **禁止**新建任何 `XX-feature-*.css` 全局文件
- **禁止**向现有 `3X-feature-*.css` 文件追加任何代码

### 跨组件穿透

需要从父组件控制子组件样式时，使用 `:deep()`，**不要**为此去掉 scoped：

```css
/* ✅ 正确 */
:deep(.child-class) { color: red; }

/* ❌ 错误：不要去掉 scoped 来解决穿透问题 */
```

### 行数警戒线

- `<style scoped>` 超过 **150 行** → 考虑拆分组件
- `<style scoped>` 超过 **300 行** → 必须拆分，理由记录在 PR 描述里

### 设计 Token 使用

所有颜色、间距、阴影**必须**使用 `10-theme-base.css` 中定义的 CSS 变量，禁止在 feature CSS 中硬编码颜色值：

```css
/* ✅ */
color: var(--text-primary);
border: 1px solid var(--border-light);

/* ❌ */
color: #f3f6fb;
border: 1px solid rgba(255, 255, 255, 0.06);
```

---

## 5. 新功能开发检查流程

开发 feature 时按以下顺序判断：

```
1. 这是 CSS 变量？
   → 加入 10-theme-base.css

2. 这是顶层容器布局（app grid, sidebar, main panel 的结构）？
   → 加入 20-layout-shell.css（超出上限先拆，不可堆积）

3. 这个 UI 样式被 2+ feature 使用？
   → 加入 21-shared-components.css

4. 其他所有情况
   → 写入当前 Vue 组件的 <style scoped>
```

---

## 6. 例外处理

以下情况可申请例外，需在 PR 中说明原因并添加注释：

- 第三方库样式覆盖（无法用 scoped 解决）
- 动态注入的样式字符串（如运行时主题切换）

例外样式统一放入 `21-shared-components.css` 并在文件顶部注释标注，不单独新建文件。

---

## 7. 参考

- CSS 变量定义：[src/styles/10-theme-base.css](../../src/styles/10-theme-base.css)
- 架构守则：[ARCHITECTURE.md](../../ARCHITECTURE.md)
- ADR：[docs/adr/0001-css-architecture.md](../adr/0001-css-architecture.md)
