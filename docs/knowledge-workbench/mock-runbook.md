# 知识工作台 Mock 演练

这份演练用来验证一条知识从 Raw Inbox 进入 Promotion Review，再被发布到 reader-first wiki，并把审核结果回写到 Raw Inbox 的完整路径。

## Mock 数据

数据文件：`docs/knowledge-workbench/mock-data/knowledge-workbench-raw-inbox-items.json`

建议优先使用第一条：

- `mock_kw_embedding_empty_search_001`
- 预期进入：Issue Review 或 Synthesis Candidate，取决于当前队列里已有证据
- 关键观察点：来源应显示为「知识采集」，Raw Inbox 审核后应显示「已升格」或「已驳回」

第二条适合验证 Pattern 候选，第三条适合验证 `needs-context` 不会立刻进入升格审核。

## UI 演练步骤

1. 打开知识工作台，进入「Raw Inbox」。
2. 点击「批量导入」。
3. 把 `docs/knowledge-workbench/mock-data/knowledge-workbench-raw-inbox-items.json` 的完整内容粘进去。
4. 查看右侧预检：确认识别到 3 条，疑似重复项会标为「将合并」或「将跳过」。
5. 保持默认的「合并已有，跳过批内重复」，点击「处理」。
6. 页面会跳到「升格审核」，点击刷新。
7. 在候选卡片里确认来源是否为「知识采集」。
8. 点击「查看证据」，确认能看到 `inbox/knowledge__*.md` 证据页。
9. 点击「预览变更」，确认目标页、Frontmatter 和 Diff。
10. 点击「确认升格」。
11. 回到「Raw Inbox」，找到这条采集，确认卡片显示「已升格」。
12. 回到「升格审核」的「已确认」区域，确认能看到刚才升格的条目。
13. 如需回滚，点击「撤销人工确认」，再回到 Raw Inbox，确认状态变成「已撤销」，阶段回到「进 Wiki 编译」。

## 单条手动演练

如果只想演练一条，可以点「新建条目」，从 mock JSON 里选第一条，把 `title`、`content`、`summary`、`tags`、`project`、`topic`、`keyQuestion`、`decisionNote` 填入编辑抽屉，然后点击「保存并送升格审核」。

## API 快速导入

如果不想手动填表，可以启动服务后按条导入：

```bash
PORT=3030 npm run dev:server
```

另开一个终端，选第一条 mock 数据发送：

```bash
node -e "const fs=require('node:fs'); const data=JSON.parse(fs.readFileSync('docs/knowledge-workbench/mock-data/knowledge-workbench-raw-inbox-items.json','utf8')); const item=data.items[0]; fetch('http://127.0.0.1:3030/api/knowledge-items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item)}).then(r=>r.json()).then(console.log)"
```

然后打开前端，进入「Raw Inbox」查看条目，再按 UI 演练步骤从第 5 步开始。

## 验收点

- Raw Inbox 能保存采集条目。
- `wiki-candidate` 或 Active 条目能进入 Promotion Review。
- Promotion Review 候选来源显示「知识采集」。
- 证据页路径为 `inbox/knowledge__*.md`。
- approve 后 Raw Inbox 显示「已升格」，并写入 `promotionTargetPath`。
- dismiss 后 Raw Inbox 显示「已驳回」。
- revoke 后 Raw Inbox 显示「已撤销」，并回到可重新送审状态。

## 下一步建议

批量导入已经能跑通，下一步最值得推进的是候选改道和合并：

- 支持把候选从 Synthesis 改送 Issue 或 Pattern。
- 支持把多个相似 Raw Inbox 合并成一个升格候选。
- Promotion Review 卡片显示“同源/相似采集”，避免多个候选重复升格。
