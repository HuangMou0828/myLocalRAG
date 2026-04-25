# GBrain V2 Execution Guide（Phase A-C）

> 日期：2026-04-25  
> 适用：当前仓库执行 V2 基线冻结、双写评估与读路径切换演练

## 1. 执行目标

Phase A 的目标是“先可测，再切流”：

- 固定评估口径
- 产出 baseline 快照
- 产出 dry-run 结果
- 冻结查询集模板与人工标注模板

## 2. 命令入口

```bash
npm run gbrain:v2:baseline
npm run gbrain:v2:dry-run
npm run gbrain:v2:backfill
npm run gbrain:v2:compare
npm run gbrain:v2:rollback-drill
npm run gbrain:v2:governance:report
npm run gbrain:v2:governance:queue
npm run gbrain:v2:governance:guard
npm run gbrain:v2:feed:dry-run
npm run gbrain:v2:feed:export
```

可选参数：

```bash
node scripts/gbrain-v2-eval.mjs baseline --limit 5000 --out docs/wiki-vault/eval/baseline-custom.json
node scripts/gbrain-v2-eval.mjs dry-run --limit 5000 --sample 120 --out docs/wiki-vault/eval/dry-run-custom.json
node scripts/gbrain-v2-eval.mjs backfill --status all
node scripts/gbrain-v2-eval.mjs compare --query-set docs/wiki-vault/eval/query-set.json --modes v1,v2 --top-k 8
node scripts/gbrain-v2-eval.mjs rollback-drill --to v1 --query-set docs/wiki-vault/eval/query-set.json --top-k 8 --apply
node scripts/gbrain-v2-governance.mjs report --limit 5000 --stale-days 14
node scripts/gbrain-v2-governance.mjs repair-queue --top 120
node scripts/gbrain-v2-governance.mjs guard --max-legacy-share 20 --max-duplicate-share 25 --max-lineage-missing-share 5 --max-stale-draft-share 35
node scripts/gbrain-v2-feed.mjs export --out vault/.gbrain-v2-feed --feed-mode atom-reader-first --clean
```

说明：

- `rollback-drill` 默认是 dry-run，只生成演练报告，不会改设置。
- 传 `--apply` 时会实际执行 “切到目标模式 -> 再切回原模式” 的回滚演练，并在报告里记录步骤结果。

## 3. 输出产物

默认输出目录：`docs/wiki-vault/eval/`

- `baseline-*.json`：机器可读基线报告
- `baseline-*.md`：评审摘要
- `dry-run-*.json`：Atom 试运行结果（含 sample）
- `dry-run-*.md`：试运行摘要
- `compare-*.json`：查询集多模式对比结果（默认比较 `v1/v2`）
- `compare-*.md`：查询集对比摘要（含 top1 变化率与 overlap@k）
- `rollback-drill-*.json`：读路径回滚演练结果
- `rollback-drill-*.md`：回滚演练摘要
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
5. 跑 compare，观察 `v1 -> v2` 的检索行为变化  
6. 跑 rollback-drill（先 dry-run，再 `--apply` 实际演练）  
7. 跑 feed dry-run，确认 `Atom + Reader-first` 产物规模  
8. 导出 V2 feed（默认 `vault/.gbrain-v2-feed/records.jsonl`）  
9. 跑 governance report + repair queue，生成本周治理清单  
10. 跑 governance guard，确认指标未回归  
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

- `modeReports[].summary.hitAtK`
- `modeReports[].summary.avgInvalidRecallRate`
- `modeReports[].summary.avgTraceabilityRate`
- `comparisons[].top1ChangedRate`
- `comparisons[].avgOverlapAtK`

rollback-drill 至少关注：

- `success`（演练成功）
- `steps`（切换与恢复步骤都成功）
- `before.readMode` 与 `after.readMode` 一致性
- 若带查询集：`compare.comparisons`

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
- `POST /api/gbrain-v2/retrieve`：基于 Atom 的 V2 检索原型接口  
- `GET /api/gbrain-v2/feed-status`：查看 feed 导出状态、Atom 统计、lineage 统计
- `GET /api/gbrain-v2/settings`：读取当前切流设置
- `POST /api/gbrain-v2/settings`：更新 `readMode/feedMode/includeRawFallback` 等开关
- `POST /api/gbrain-v2/feed-refresh`：按当前设置刷新 V2 feed 导出产物

## 7. 阶段门禁建议

- 若 `lineageCoverage` 明显偏低（例如低于 95%），不进入 Phase B  
- 若 `legacy` 占比异常高且原因未定位，不进入 Phase B  
- 若查询集和标注模板未冻结，不进入 Phase B
- 若 compare 显示 `v2` 的命中与可追溯指标明显劣化，不进入 Phase C
- 若 rollback-drill 未通过，不允许切读路径
- 若 governance-guard 未通过，不允许扩大 V2 放量范围

## 8. 关联文档

- [V2 评估方案](/Users/hm/myLocalRAG/docs/wiki-vault/gbrain-v2-evaluation-plan.md)
- [V2 数据契约](/Users/hm/myLocalRAG/docs/wiki-vault/gbrain-v2-contract.md)
- [Wiki Page Contract](/Users/hm/myLocalRAG/docs/wiki-vault/page-contract.md)
