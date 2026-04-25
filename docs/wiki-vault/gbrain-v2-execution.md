# GBrain V2 Execution Guide（Phase A）

> 日期：2026-04-25  
> 适用：当前仓库执行 V2 基线冻结与 dry-run 评估

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
npm run gbrain:v2:feed:dry-run
npm run gbrain:v2:feed:export
```

可选参数：

```bash
node scripts/gbrain-v2-eval.mjs baseline --limit 5000 --out docs/wiki-vault/eval/baseline-custom.json
node scripts/gbrain-v2-eval.mjs dry-run --limit 5000 --sample 120 --out docs/wiki-vault/eval/dry-run-custom.json
node scripts/gbrain-v2-eval.mjs backfill --status all
node scripts/gbrain-v2-feed.mjs export --out vault/.gbrain-v2-feed --clean
```

## 3. 输出产物

默认输出目录：`docs/wiki-vault/eval/`

- `baseline-*.json`：机器可读基线报告
- `baseline-*.md`：评审摘要
- `dry-run-*.json`：Atom 试运行结果（含 sample）
- `dry-run-*.md`：试运行摘要
- `query-set.template.json`：查询集模板
- `manual-label-template.csv`：人工标注模板

## 4. 建议执行顺序

1. 跑 baseline  
2. 跑 dry-run  
3. 执行 backfill（将历史 `knowledge_items` 补齐到 Atom/lineage）  
4. 跑 feed dry-run，确认 `Atom + Reader-first` 产物规模  
5. 导出 V2 feed（默认 `vault/.gbrain-v2-feed/records.jsonl`）  
6. 从模板生成 `query-set.json` 并补真实查询  
7. 启动人工标注并冻结首版基线  
8. 将该轮报告路径写入评审记录

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

## 6. 运行态 API（Phase B）

可用于工作台或脚本观测：

- `GET /api/gbrain-v2/atoms`：查看 Atom 列表与质量分布  
- `GET /api/gbrain-v2/lineage`：按 `rawId/atomId/canonicalId/pageId` 追踪链路  
- `POST /api/gbrain-v2/retrieve`：基于 Atom 的 V2 检索原型接口  
- `GET /api/gbrain-v2/feed-status`：查看 feed 导出状态、Atom 统计、lineage 统计
- `GET /api/gbrain-v2/settings`：读取当前切流设置
- `POST /api/gbrain-v2/settings`：更新 `readMode/feedMode/includeRawFallback` 等开关

## 7. 阶段门禁建议

- 若 `lineageCoverage` 明显偏低（例如低于 95%），不进入 Phase B  
- 若 `legacy` 占比异常高且原因未定位，不进入 Phase B  
- 若查询集和标注模板未冻结，不进入 Phase B

## 8. 关联文档

- [V2 评估方案](/Users/hm/myLocalRAG/docs/wiki-vault/gbrain-v2-evaluation-plan.md)
- [V2 数据契约](/Users/hm/myLocalRAG/docs/wiki-vault/gbrain-v2-contract.md)
- [Wiki Page Contract](/Users/hm/myLocalRAG/docs/wiki-vault/page-contract.md)
