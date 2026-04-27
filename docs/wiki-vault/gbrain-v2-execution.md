# GBrain V2 Execution Guide（Phase A-C）

> 日期：2026-04-26  
> 适用：当前仓库执行 V2 基线冻结、Atom 评估、候选治理与新 Vault 导出

## 1. 执行目标

当前阶段的目标是“先把 V2 跑稳，再持续产出新 Vault”：

- 固定评估口径
- 产出 baseline 快照
- 产出 dry-run 结果
- 评估当前 V2 查询集表现
- 冻结查询集模板与人工标注模板

## 2. 命令入口

```bash
npm run gbrain:v2:baseline
npm run gbrain:v2:dry-run
npm run gbrain:v2:backfill
npm run gbrain:v2:query-set
npm run gbrain:v2:compare
npm run gbrain:v2:governance:report
npm run gbrain:v2:governance:queue
npm run gbrain:v2:governance:queue:apply
npm run gbrain:v2:governance:queue:apply:plus
npm run gbrain:v2:governance:guard
npm run gbrain:v2:mvp:gate
npm run gbrain:v2:feed:dry-run
npm run gbrain:v2:feed:export
```

可选参数：

```bash
node scripts/gbrain-v2-eval.mjs baseline --limit 5000 --out docs/wiki-vault/eval/baseline-custom.json
node scripts/gbrain-v2-eval.mjs dry-run --limit 5000 --sample 120 --out docs/wiki-vault/eval/dry-run-custom.json
node scripts/gbrain-v2-eval.mjs backfill --status all
node scripts/gbrain-v2-eval.mjs seed-query-set --target 50 --out docs/wiki-vault/eval/query-set.json
node scripts/gbrain-v2-eval.mjs compare --query-set docs/wiki-vault/eval/query-set.json --top-k 8
node scripts/gbrain-v2-governance.mjs report --limit 5000 --stale-days 14
node scripts/gbrain-v2-governance.mjs repair-queue --top 120
node scripts/gbrain-v2-governance.mjs repair-queue --top 120 --apply --apply-types duplicate-group
node scripts/gbrain-v2-governance.mjs repair-queue --top 120 --apply --apply-types duplicate-group,stale-draft
node scripts/gbrain-v2-governance.mjs guard --max-legacy-share 20 --max-duplicate-share 25 --max-lineage-missing-share 5 --max-stale-draft-share 35 --min-raw-atom-coverage 95 --max-auto-promotion-constraint-violations 0
node scripts/gbrain-v2-feed.mjs export --out vault/.gbrain-v2-feed --feed-mode atom-reader-first --clean
```

## 3. 输出产物

默认输出目录：`docs/wiki-vault/eval/`

- `baseline-*.json`：机器可读基线报告
- `baseline-*.md`：评审摘要
- `dry-run-*.json`：Atom 试运行结果（含 sample）
- `dry-run-*.md`：试运行摘要
- `compare-*.json`：查询集在当前 V2 检索链路上的评估结果
- `compare-*.md`：查询集评估摘要（命中率、可追溯率、信号覆盖率）
- `governance-report-*.json`：周度治理指标快照（legacy/duplicate/lineage/stale）
- `governance-report-*.md`：治理指标摘要
- `governance-repair-queue-*.json`：按优先级生成的修复队列
- `governance-repair-queue-*.md`：修复队列摘要
- `governance-guard-*.json`：回归守卫结果
- `governance-guard-*.md`：回归守卫摘要
- `query-set.template.json`：查询集模板
- `manual-label-template.csv`：人工标注模板

## 4. 建议执行顺序

1. 跑 baseline  
2. 跑 dry-run  
3. 执行 backfill（将历史 `knowledge_items` 补齐到 Atom/lineage）  
4. 从模板生成 `query-set.json` 并补真实查询  
5. 运行 `seed-query-set` 生成 50 条 MVP 查询集（可再手工修订）  
6. 跑 compare，检查当前 V2 检索命中、可追溯和信号覆盖  
7. 跑 feed dry-run，确认 `Atom + Reader-first` 产物规模  
8. 导出 V2 feed（默认 `vault/.gbrain-v2-feed/records.jsonl`）  
9. 跑 governance report + repair queue，生成本周治理清单（必要时执行 `queue:apply` 自动处理 duplicate-group）  
10. 跑 governance guard，确认指标未回归（或直接跑 `gbrain:v2:mvp:gate`）  
11. 启动人工标注并冻结首版基线  
12. 将该轮报告路径写入评审记录

## 5. 报告最小检查项

baseline 至少关注：

- `knowledge.total`
- `coverage`（summary/contentHash/intakeStage/sourceRefs/lineage）
- `duplicateGroups.totalGroups`
- `sessions.byProvider`

dry-run 至少关注：

- `summary.byTier`
- `summary.byKind`
- `summary.qualityIssueCounts`
- `summary.lineageCoverage`
- 低分样本是否符合直觉

compare 至少关注：

- `modeReports[0].summary.hitAtK`
- `modeReports[0].summary.avgInvalidRecallRate`
- `modeReports[0].summary.avgTraceabilityRate`
- `modeReports[0].summary.avgSignalCoverage`
- `modeReports[0].summary.avgStructuredShare`

governance-report 至少关注：

- `metrics.legacyShare`
- `metrics.duplicateShare`
- `metrics.lineageMissingShare`
- `metrics.staleDraftShare`

governance-guard 至少关注：

- `pass`
- `checks[]`

## 6. 运行态 API（Phase B）

可用于工作台或脚本观测：

- `GET /api/gbrain-v2/atoms`：查看 Atom 列表与质量分布  
- `GET /api/gbrain-v2/lineage`：按 `rawId/atomId/canonicalId/pageId` 追踪链路  
- `POST /api/gbrain-v2/retrieve`：基于 Atom 的默认检索接口  
- `GET /api/gbrain-v2/feed-status`：查看 feed 导出状态、Atom 统计、lineage 统计
- `POST /api/gbrain-v2/feed-refresh`：按当前设置刷新 V2 feed 导出产物
- `POST /api/wiki-vault/promotion-auto-mvp`：按 MVP 规则自动处理低风险 issue/pattern 候选（支持 dry-run）

## 7. 阶段门禁建议

- 若 `lineageCoverage` 明显偏低（例如低于 95%），不进入 Phase B  
- 若 `legacy` 占比异常高且原因未定位，不进入 Phase B  
- 若查询集和标注模板未冻结，不进入 Phase B
- 若 `Raw -> Atom` 自动化覆盖率低于 95%，不进入 Phase C
- 若仍需人工逐条生成 Atom，不进入 Phase C
- 若 compare 显示当前 V2 的命中与可追溯指标明显劣化，不进入 Phase C
- 若 governance-guard 未通过，不允许扩大 V2 放量范围

补充约束（MVP 执行口径）：

- `Raw -> Atom + 质量评分` 必须自动执行；人工只做中风险候选确认，不做逐条 Atom 编写。
- `qualityScore 高` 的自动晋升仅限低风险类型（建议 `issue/pattern`），且必须满足 lineage/sourceRefs/去重门禁。
- 审核效率目标“20%+”的统计口径为：`总人工审核分钟 / 成功入 Vault 条数`，相对 Phase A 基线比较。

## 8. 关联文档

- [V2 评估方案](/Users/hm/myLocalRAG/docs/wiki-vault/gbrain-v2-evaluation-plan.md)
- [V2 数据契约](/Users/hm/myLocalRAG/docs/wiki-vault/gbrain-v2-contract.md)
- [Wiki Page Contract](/Users/hm/myLocalRAG/docs/wiki-vault/page-contract.md)
