# Git Workflow

This project keeps Git history useful for review, rollback, and later knowledge mining. The default unit of work is a short-lived task branch with one to three focused commits.

## Baseline

The repository was first captured on branch `codex/bootstrap-git-workflow` with:

- `ea04f64 chore: capture project baseline`

Runtime data and local caches are intentionally ignored, including SQLite database files, WAL/SHM files, `server/data/*.json`, `dist/`, `node_modules/`, `.env`, and `vault/`.

## Branch Rules

- Create a task branch before meaningful edits.
- Use the `codex/` prefix for agent-driven work.
- Prefer branch names like `codex/YYYYMMDD-short-task-name`.
- Keep `main` as the integration branch.
- Do not work directly on `main` unless the change is a tiny documentation or housekeeping fix.

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
- Use Conventional Commit style:
  - `feat: add wiki promotion queue`
  - `fix(feishu): guard empty todo payload`
  - `refactor(app-shell): collapse toolbar config`
  - `docs: record git workflow`
  - `chore(snapshot): work in progress`
- A WIP snapshot is allowed when context preservation matters more than polish.

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
- Create a `codex/` task branch if the work is more than a tiny answer-only change.
- Never commit ignored runtime data or local secrets.
- If unrelated user changes exist, leave them alone or ask before mixing them into a commit.
- Run `npm run typecheck` for Vue/TypeScript changes.
- Run `npm run build` before final merge/push or broad refactors.
- End with a clear summary of changed files, checks, and commit hashes.
