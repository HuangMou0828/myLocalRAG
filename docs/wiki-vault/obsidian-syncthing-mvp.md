# Obsidian Vault Publication Layer

This document describes the optional publication layer that compiles myLocalRAG knowledge into an Obsidian-readable Markdown vault.

## Architecture

- `myLocalRAG` stays responsible for scanning, indexing, retrieval, and future ingest orchestration.
- Knowledge Workbench is the primary place for capture, task review, promotion review, and health checks.
- `vault/` is the Obsidian-facing reading/export layer, not the source of truth.
- Syncthing should sync `vault/` only.

Recommended split:

```text
myLocalRAG/
  server/
  src/
  scripts/
  vault/
    index.md
    log.md
    README.md
    AGENTS.md
    projects/
    patterns/
    issues/
    syntheses/
    sources/
    concepts/
    entities/
    assets/
    inbox/
```

## Commands

Initialize the Obsidian vault scaffold:

```bash
npm run wiki:vault:init
```

Publish the latest 10 sessions into `vault/sources/`:

```bash
npm run wiki:vault:publish
```

Publish a specific provider:

```bash
node scripts/wiki-vault.mjs publish --provider cursor --limit 20
```

Publish explicit session IDs:

```bash
node scripts/wiki-vault.mjs publish --session session_a,session_b
```

Rebuild the vault index:

```bash
npm run wiki:vault:rebuild-index
```

Refresh all already-published source pages after changing publish rules:

```bash
node scripts/wiki-vault.mjs refresh-published
```

## Syncthing Notes

- Syncthing is not a manual-only sync tool. It synchronizes automatically while the Syncthing app/process is running on both sides and the devices can reach each other.
- For the MVP, treat desktop as the main writing device and mobile as read-mostly.
- Avoid editing the same note on two devices at the same time.
- Sync `vault/` only. Do not sync `server/data/`, SQLite files, or the whole repo.

## Current Shape

- `sources/*.md` is the evidence layer and may stay somewhat machine-oriented.
- `projects/`, `patterns/`, `issues/`, and `syntheses/` are the preferred human-reading layer.
- `concepts/` groups recurring topics and modules across sources.
- `inbox/promotion-queue.md` and `inbox/wiki-lint-report.md` mirror the review and health queues for Obsidian reading.
- Human edits are only preserved inside the `## My Notes` section on republish.
- Image hosting is not wired in yet. The current vault is text-first.

## Product Role

- Use Knowledge Workbench for intake and decisions.
- Use Vault publishing when the current knowledge state is worth reading outside the app.
- Prefer full-scope publishing for routine runs. Partial provider/session publishing must not prune unrelated source pages.
- Use fast publish for daily updates.
- Use deep summary when cross-source concept pages are worth model cost.

## Next Step Ideas

- Add asset publishing or external image-host URL rewriting.
- Add explicit publish history and diff preview for Vault runs.

## Related Docs

- [Obsidian CLI API（M3）](./obsidian-cli-api.md)
