# Architecture Guardrails

## 1. 目标

本文件用于防止代码结构回退。规则以“可执行检查 + 评审清单 + ADR 记录”三件套落地，默认要求所有 PR 遵守。

## 2. 分层与职责

### Entry Layer

- `src/main.ts`
- `src/App.vue`

职责：应用入口与页面装配，不承载业务规则。

### Orchestration Layer

- `src/features/app/**`

职责：跨 feature 编排、状态聚合、调用顺序控制。

### Feature Layer

- `src/features/<feature-name>/**`（不含 `app`）

职责：单一业务域能力，默认独立演进。

### Shared Layer

- `src/components/**`
- `src/composables/**`
- `src/services/**`
- `src/lib/**`
- `src/types.ts`

职责：跨 feature 复用的通用能力。

## 3. 依赖方向（强约束）

1. `Entry -> app + shared`，禁止 `Entry` 直连具体 feature 细节（通过 `app` 编排）。
2. `app` 可以依赖任意 feature（它是编排层）。
3. 非 `app` feature 只能依赖：
- 自身目录
- shared layer
- 明确白名单的跨 feature 依赖（见下节）
4. 任意 feature 禁止依赖 `src/main.ts` 或 `src/App.vue`。
5. 禁止 feature 间循环依赖。

以上规则由 `npm run arch:check` 在 CI 中强制执行。

## 4. 当前允许的跨 Feature 白名单

以下依赖为现状兼容白名单，若要新增，请先走 ADR：

- `bug-inbox -> bug-trace`
- `message-tags -> session-flow`
- `prompt-score -> session-flow`
- `session-data -> session-filter`

## 5. 变更流程（新增跨模块依赖时）

1. 在 `docs/adr/` 新增一条 ADR（可用 `0000-template.md`）。
2. 同一个 PR 内更新 `scripts/check-architecture.mjs` 的白名单。
3. 在 PR 模板中说明收益、替代方案、回滚方式。

## 6. 日常执行机制

1. 开发前：先确认是否会引入新的跨 feature 依赖。
2. 提交前：本地执行 `npm run quality:check`。
3. 评审时：按 `docs/workflow/review-checklist.md` 逐项过。
4. 每两周：做一次代码健康巡检（复杂度、耦合、测试缺口、技术债处理率）。
