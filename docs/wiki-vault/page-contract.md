# Wiki Page Contract

This document defines the page contract for the reader-first wiki layer:

- `vault/projects/`
- `vault/patterns/`
- `vault/issues/`
- `vault/syntheses/`

It exists so promotion does not merely "write markdown", but writes stable notes that can be regenerated without destroying human edits.

## 1. Shared Frontmatter Contract

All reader-first pages should expose a stable shared frontmatter subset:

- `title`
- `type`
- `schemaVersion`
- `status`
- `project`
- `evidenceCount`
- `updatedAt`

Pages promoted through manual approval should also keep:

- `promotionState`
- `approvedAt`

Type-specific identifiers stay local to each note family:

- `project-hub`: `project`
- `pattern-note`: `pattern`
- `issue-note`: `issue`
- `synthesis-note`: `question`

## 2. Shared Body Contract

Reader-first pages should keep a predictable reading shape:

1. H1 title
2. summary callout
3. generated evidence-backed sections
4. `## Evidence`
5. protected human-edit sections

Protected sections are the only places where human edits must survive regeneration.

Current protected sections:

- `## My Notes` on all reader-first pages
- `## Open Questions` on `project-hub`
- `## Open Questions` on `synthesis-note`

## 3. Page Templates

### 3.1 `issue-note`

Required sections:

- `## Symptom`
- `## Likely Causes`
- `## Fix Pattern`
- `## Validation`
- `## Evidence`
- `## My Notes`

Optional sections:

- `## Related Files`
- `## Related`

### 3.2 `pattern-note`

Required sections:

- `## When To Use`
- `## Recommended Shape`
- `## Tradeoffs`
- `## Evidence`
- `## My Notes`

Optional sections:

- `## In This Repo`
- `## Related`

### 3.3 `project-hub`

Required sections:

- `## Current Shape`
- `## Key Patterns`
- `## Known Issues`
- `## Related Concepts`
- `## Evidence`
- `## Open Questions`
- `## My Notes`

Optional sections:

- `## Important Areas`

### 3.4 `synthesis-note`

Required sections:

- `## Short Answer`
- `## Main Decisions Or Claims`
- `## Why This Conclusion Holds`
- `## Counterpoints Or Uncertainty`
- `## Evidence`
- `## Open Questions`
- `## My Notes`

## 4. Merge Rules

Promotion currently follows these merge rules:

1. Generated frontmatter is rewritten on each rebuild.
2. Generated sections are rewritten from the latest evidence set.
3. `## Evidence` is regenerated from normalized source references instead of being hand-merged.
4. `## My Notes` is preserved across rebuilds for all reader-first pages.
5. `## Open Questions` is preserved on `project-hub` and `synthesis-note`.
6. Manual approval metadata wins over purely automatic status.

This means:

- human commentary belongs in protected sections,
- evidence-backed summaries belong in generated sections,
- and promotion can be rerun safely without silently wiping the human layer.

## 5. Current Schema Version

Current reader-first page schema version:

- `schemaVersion: "1"`

When section names, frontmatter keys, or merge semantics change in a non-trivial way, bump the schema version and update the generators in `server/lib/wiki-vault.mjs`.
