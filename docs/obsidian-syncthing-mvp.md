# Obsidian + Syncthing MVP

This document describes the first MVP shape for using myLocalRAG as an admin/backend layer and Obsidian as the user-facing reading layer.

## Architecture

- `myLocalRAG` stays responsible for scanning, indexing, retrieval, and future ingest orchestration.
- `vault/` is the Obsidian-facing publication layer.
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

## Current MVP Shape

- `sources/*.md` is the evidence layer and may stay somewhat machine-oriented.
- `projects/`, `patterns/`, `issues/`, and `syntheses/` are the preferred human-reading layer.
- Human edits are only preserved inside the `## My Notes` section on republish.
- Image hosting is not wired in yet. The current vault is text-first.

## Next Step Ideas

- Add LLM-assisted summary generation for session pages.
- Generate concept/entity pages from multiple sessions.
- Add a server API and admin UI action for publish jobs.
- Add asset publishing or external image-host URL rewriting.
- Add promotion from `sources/` into `projects/`, `patterns/`, `issues/`, and `syntheses/` using the rules in `docs/wiki-promotion-pipeline.md`.
