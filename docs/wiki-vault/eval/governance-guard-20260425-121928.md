# GBrain V2 Regression Guard

- generatedAt: 2026-04-25T12:19:28.436Z
- pass: true
- current: /Users/hm/myLocalRAG/docs/wiki-vault/eval/governance-report-20260425-121913.json
- baseline: /Users/hm/myLocalRAG/docs/wiki-vault/eval/governance-report-20260425-121427.json

## Thresholds

- maxLegacyShare: 20%
- maxDuplicateShare: 25%
- maxLineageMissingShare: 5%
- maxStaleDraftShare: 35%
- minRawAtomCoverage: 95%
- maxAutoPromotionConstraintViolations: 0
- maxDelta: 3%

## Checks

- abs:legacyShare: pass (0% <= 20%)
- abs:duplicateShare: pass (22.55% <= 25%)
- abs:lineageMissingShare: pass (0% <= 5%)
- abs:staleDraftShare: pass (0.98% <= 35%)
- abs:rawToAtomAutomationCoverage: pass (100% >= 95%)
- abs:autoPromotionConstraintViolationCount: pass (0 <= 0)
- delta:legacyShare: pass (0% <= 3%)
- delta:duplicateShare: pass (0% <= 3%)
- delta:lineageMissingShare: pass (0% <= 3%)
- delta:staleDraftShare: pass (0% <= 3%)
