# GBrain V2 Phase B Checklist（双写实施清单）

> 日期：2026-04-25  
> 目的：把 Phase A 的规则落到“并行双写”能力，不切旧读链路

## 1. 数据层任务

1. 新增 Atom 存储
- 目标：支持 `rawId/atomId/canonicalId/pageId` 落库。
- 位置：`server/lib/db.mjs`
- 交付：`upsertAtom*`、`listAtoms*`、`queryAtoms*` 基础函数。

2. 新增 lineage 存储
- 目标：记录 `raw -> atom -> canonical -> page` 关系。
- 位置：`server/lib/db.mjs`
- 交付：lineage upsert + 查询 + alias 映射。

3. 保留旧模型兼容
- 目标：不破坏现有 `knowledge_items` 与已有 API。
- 要求：所有新表默认旁路，不影响现有路径。

## 2. 生成层任务

1. Atom 生成器
- 目标：把 `knowledge_items` 转成 Atom（含质量分级）。
- 位置：建议新增 `server/lib/gbrain-v2/atomizer.mjs`
- 交付：`buildAtomFromKnowledgeItem`、`scoreAtomQuality`。

2. 双写入口
- 目标：在现有导入/同步链路中并行写 Atom + lineage。
- 位置：`scripts/openclaw-knowledge.mjs`、`server/index.mjs` 相关流程
- 要求：失败时可降级，不能阻断旧链路导入。

3. 幂等保障
- 目标：重复执行不产生脏重复。
- 要求：`atomId/canonicalId` 稳定，upsert 语义一致。

## 3. 检索层任务

1. V2 feed 导出
- 目标：为 gbrain 提供 `Atom + Reader-first` 主输入。
- 位置：建议新增 `scripts/gbrain-v2-feed.mjs`
- 交付：`--dry-run`、`--out`、`--since` 支持。

2. 混排去重主键
- 目标：按 `canonicalId` 去重，不让同证据跨层重复占位。
- 位置：检索聚合层（后端 API）
- 交付：去重策略开关（默认开，可回退）。

3. Raw 回源策略
- 目标：仅在追溯场景或上层证据不足时召回 Raw。
- 交付：查询参数或策略开关明确可控。

## 4. 运维与回滚任务

1. 切流开关
- 目标：可按环境/请求切换 V1 或 V2 读路径。
- 交付：配置项 + API 可观测标识。

2. 回滚演练
- 目标：验证“关闭 V2 读路径”可快速恢复。
- 交付：演练记录（步骤、耗时、结果）。

3. 指标看板
- 目标：观察双写一致性、lineage 完整率、召回质量。
- 交付：固定报表脚本与输出路径。

## 5. 验收门禁（Phase B -> Phase C）

- 双写一致性达到预设阈值（建议 >= 99%）
- lineage 完整率达到预设阈值（建议 >= 99.5%）
- 无 `My Notes` 覆盖事故
- 无 promotion/approval 元数据丢失
- V2 失败可一键切回 V1

