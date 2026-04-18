# Git Workflow

This project keeps Git history useful for review, rollback, and later knowledge mining. The default unit of work is a short-lived task branch with one to three focused commits.

## Semi-Automatic Mode

The user should not need to operate Git manually. An agent should watch for Git decision points, explain the next recommended action, and wait for approval before doing it.

Use this proposal format:

```text
建议执行：<branch / commit / merge / push action>
原因：<why now>
范围：<files or feature area>
验证：<checks to run>
批准后我来执行。
```

Actions that require explicit approval:

- Create or switch task branches.
- Commit or create WIP snapshots.
- Fast-forward `main` to a task branch.
- Push branches, tags, or create/update pull requests.
- Update the remote default HEAD (`git remote set-head`).
- Include unrelated user changes in a commit.

## Baseline

The repository was first captured on branch `codex/bootstrap-git-workflow` with:

- `ea04f64 chore: capture project baseline`

Runtime data and local caches are intentionally ignored, including SQLite database files, WAL/SHM files, `server/data/*.json`, `dist/`, `node_modules/`, `.env`, and `vault/`.

## Branch Rules

- Create a task branch before meaningful edits.
- Use the `codex/` prefix for agent-driven work.
- Prefer branch names like `codex/YYYYMMDD-short-task-name`.
- Keep `main` as a stability anchor. `main` is only advanced by a fast-forward to a verified task branch at milestone or release boundaries, not by day-to-day merges.
- Day-to-day task branches chain on top of the most recent completed task branch (not on `main`), so active work stays linear and avoids premature integration.
- Do not work directly on `main` unless the change is a tiny documentation or housekeeping fix.

Recommend a new branch when:

- Work starts on a new feature, bug fix, refactor, or documentation task.
- The current branch is `main`.
- The current branch name does not match the new task.
- The current branch already has a completed task commit and the next work is unrelated.
- The expected change touches more than one file or may need review.

Do not create a new branch when:

- The user only asks a question and no files will change.
- The edit is a tiny follow-up on the current task branch.
- The current branch is already the right task branch.

If the worktree is dirty before starting a new branch, ask whether to snapshot, commit, continue on the current branch, or leave unrelated changes untouched.

Start a task:

```bash
npm run git:task:start -- "app shell config"
```

This creates or switches to a branch like:

```text
codex/20260410-app-shell-config
```

## Commit Rules

- Commit after each coherent behavioral change, not after every file edit.
- Keep commits reviewable; split unrelated UI, server, data-model, and documentation changes.
- Use the project Chinese Conventional Commit style.
- A WIP snapshot is allowed when context preservation matters more than polish.

Project commit subject format:

```text
<类型>(<范围>): <中文一句话说明>
```

The `<范围>` is optional. Keep the subject within one concise line.

Types:

- `feat`: 新能力或用户可见功能
- `fix`: 缺陷修复
- `refactor`: 不改变行为的结构调整
- `docs`: 文档、规则、ADR、README
- `test`: 测试或测试夹具
- `style`: 样式、排版、无行为格式化
- `perf`: 性能优化
- `build`: 构建、依赖、脚手架
- `ci`: CI、workflow、hook
- `chore`: 维护性杂项
- `revert`: 回滚

Examples:

```text
feat(wiki): 增加升格队列预览入口
fix(feishu): 处理空待办列表的刷新状态
refactor(app-shell): 收敛工具栏和侧栏配置
docs(git): 记录半自动审批和提交规范
chore(snapshot): 保存组件库重构前的临时状态
```

Optional body format for non-trivial commits:

```text
背景：为什么需要这次改动
变更：做了哪些关键调整
验证：跑过哪些检查
影响：兼容性、迁移、风险或后续动作
```

Recommend a normal commit when:

- A complete behavior, bug fix, refactor slice, or documentation slice is done.
- The diff has a clear single purpose and can be summarized in one sentence.
- The relevant check has passed, usually `npm run typecheck` for Vue/TypeScript changes.
- The user is about to switch tasks.
- The user asks to pause after meaningful edits.

Recommend splitting commits when:

- UI and server behavior changed independently.
- Mechanical refactors are mixed with behavior changes.
- Documentation or tests can be committed separately from implementation.
- Generated artifacts or local data appear in the staged set.

Recommend a WIP snapshot when:

- A risky refactor is about to start.
- The task needs to pause with useful but unfinished changes.
- The context is large enough that losing the work would be costly.
- The user asks for a safety checkpoint.

Commit the current task:

```bash
npm run git:task:commit -- "refactor(app-shell): collapse toolbar config"
```

Create a quick local snapshot:

```bash
npm run git:task:snapshot -- "before refactoring toolbar actions"
```

## Checks

Use the light check before normal commits:

```bash
npm run typecheck
```

Use the full check before merging or pushing:

```bash
npm run build
```

Finish a task:

```bash
npm run git:task:finish
```

## Main Sync And Advance

`main` in this project is a stability anchor rather than a constantly-integrating trunk. Task branches chain on top of each other; `main` moves forward only when a slice is ready to be marked as the new stable baseline.

Branch chaining model:

- A new task branch is cut from the HEAD of the previous completed task branch, so active work stays a linear chain.
- `main` is kept strictly behind the chain and only advances via fast-forward to a specific verified task branch.
- There is no routine "merge `main` into task branch" step, because task branches already build on the newest chain tip.

Recommend advancing `main` (fast-forward) when:

- A milestone, release, or large feature slice has been verified (`npm run typecheck` and, when relevant, `npm run build`).
- The user explicitly marks a task branch as the new stable baseline.
- The chosen task branch has been reviewed and any follow-up fixes are already folded in.

Default advance style:

- Use fast-forward only (`git merge --ff-only <task-branch>` or `git branch -f main <task-branch>`). No merge commits on `main`.
- Avoid rebasing or squashing the task branch just to keep `main` linear; the chain already is linear.
- If a fast-forward is not possible, stop and reconcile on the task branch first instead of forcing `main`.

After advancing `main`, ask before pushing `main` and before updating the remote default HEAD.

## Multi-Agent Coordination

Git state is repository-global. In a shared workspace, branch switches, staging, commits, merges, rebases, pushes, and PR operations affect every agent looking at the same checkout.

Default rule:

- Use one coordinating agent for Git operations.
- Worker agents may edit assigned files, run read-only Git commands, and run local checks.
- Worker agents must not create or switch branches, stage files, commit, merge, rebase, push, or create PRs unless explicitly assigned as the coordinator.

When multiple agents work in parallel:

- Assign disjoint file or module ownership before editing.
- Prefer one task branch for tightly coupled parallel work, with the coordinator integrating commits.
- Prefer separate branches or separate worktrees for independent tasks.
- The coordinator should run `git status --short` before and after each worker result.
- The coordinator should stage explicit path sets, not blindly include unrelated changes.
- If two agents touch the same file, stop and reconcile intentionally before committing.

Recommended multi-agent proposal:

```text
建议执行：进入多 agent 协同模式，由主 agent 负责 Git
原因：多个 worker 会并行修改不同模块，Git index/HEAD 需要统一协调。
范围：worker A 负责 src/features/app/**，worker B 负责 docs/**
验证：npm run typecheck；必要时 npm run build
批准后我来分配任务并统一提交。
```

## Hooks

Install local hooks once per clone:

```bash
npm run git:hooks:install
```

The tracked hooks do the following:

- `pre-commit`: runs `npm run typecheck`
- `commit-msg`: enforces Conventional Commit style
- `pre-push`: runs `npm run build`

Hooks are guardrails, not history authors. Branch creation, commit grouping, merge decisions, and release notes should remain explicit.

## Agent Rules

When an AI agent works in this repository:

- Check `git status --short` and current branch before edits.
- Propose a `codex/` task branch if the work is more than a tiny answer-only change, and wait for approval.
- Propose commits at coherent stopping points, and wait for approval.
- Propose main sync, final merge, push, or PR creation only after summarizing the reason and checks.
- Never commit ignored runtime data or local secrets.
- If unrelated user changes exist, leave them alone or ask before mixing them into a commit.
- Run `npm run typecheck` for Vue/TypeScript changes.
- Run `npm run build` before final merge/push or broad refactors.
- End with a clear summary of changed files, checks, and commit hashes.
