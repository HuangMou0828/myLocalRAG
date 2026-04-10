# Agent Operating Rules

These rules keep repository history useful while allowing fast iteration.

## Git

- Check the current branch and `git status --short` before making edits.
- Use `codex/` branches for agent-driven tasks.
- Prefer `npm run git:task:start -- "task name"` for new work.
- Keep `main` as an integration branch; avoid direct implementation work on `main`.
- Do not commit ignored runtime data, local databases, generated builds, `.env`, or vault content.
- Do not revert or overwrite user changes unless explicitly asked.
- If unrelated changes are present, keep commits scoped or ask before including them.

## Commits

- Use Conventional Commit messages.
- Keep commits small enough to review.
- Use `npm run git:task:commit -- "type(scope): message"` for normal commits.
- Use `npm run git:task:snapshot -- "note"` only for local WIP preservation.

## Verification

- Run `npm run typecheck` for TypeScript or Vue changes.
- Run `npm run build` before broad refactors, merges, or pushes.
- Report any skipped check with the reason.

See `docs/git-workflow.md` for the full workflow.
