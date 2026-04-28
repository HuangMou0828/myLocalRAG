# GBrain V2 Rollback Drill

- generatedAt: 2026-04-25T09:00:09.471Z
- apply: true
- targetMode: v1
- restoreMode: shadow
- success: true

## Settings

- before.readMode: shadow
- after.readMode: shadow

## Steps

- query-set-loaded: ok (2 queries)
- switch-to-target: ok (readMode=v1)
- restore-read-mode: ok (readMode=shadow)

## Compare Snapshot

- shadow -> v1: top1Changed=100%, overlap@k=38.89%
