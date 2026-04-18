# Agent Operating Rules

These rules keep repository history useful while allowing fast iteration.

## Git

- Check the current branch and `git status --short` before making edits.
- Use `codex/` branches for agent-driven tasks, but ask before creating, switching, merging, pushing, or making a commit unless the user has already approved that exact task-level action.
- Prefer `npm run git:task:start -- "task name"` for new work.
- Keep `main` as a stability anchor that fast-forwards to a verified `codex/*` branch at milestone or release boundaries; avoid direct implementation work on `main`.
- Daily task work happens on `codex/<YYYYMMDD>-<task>` branches that chain on top of the previous task branch's HEAD, not on `main`.
- Before creating a new task branch, confirm the base is the latest completed task branch or `main`, whichever is newer.
- Do not commit ignored runtime data, local databases, generated builds, `.env`, or vault content.
- Do not revert or overwrite user changes unless explicitly asked.
- If unrelated changes are present, keep commits scoped or ask before including them.
- When approval is needed, state the reason, target branch or commit message, affected scope, and checks to run.

## Commits

- Use Conventional Commit messages.
- Keep commits small enough to review.
- Use `npm run git:task:commit -- "type(scope): message"` for normal commits.
- Use `npm run git:task:snapshot -- "note"` only for local WIP preservation.
- Recommend a commit when a coherent behavior, refactor, or documentation slice is complete and checks pass.
- Recommend a snapshot before risky broad refactors, long pauses, or context handoff.
- Commit messages should use the project Chinese format in `docs/workflow/git-workflow.md`.

## Semi-Automatic Approval

The user does not want to operate Git manually. Agents should propose Git actions and wait for approval when the next useful step is branch creation, commit, merge, rebase, push, or PR creation.

Use this shape:

```text
建议执行：创建分支 codex/YYYYMMDD-task-name
原因：这次会改动 app shell 和 toolbar 接口，适合独立追踪。
范围：src/features/app/**, src/App.vue
验证：npm run typecheck
批准后我来执行。
```

## Multi-Agent Coordination

Git operations affect the shared repository state. In multi-agent work, only the coordinating agent should create or switch branches, stage files, commit, merge, rebase, push, or create PRs.

Worker agents may edit assigned files, but should not run Git state-changing commands. The coordinator must review `git status --short`, inspect staged files, and keep each commit scoped before committing.

## Verification

- Run `npm run typecheck` for TypeScript or Vue changes.
- Run `npm run build` before broad refactors, merges, or pushes.
- Report any skipped check with the reason.

See `docs/workflow/git-workflow.md` for the full workflow.
