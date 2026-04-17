# Obsidian CLI 集成优化方案

> 记录日期：2026-04-16  
> 状态：待实施  
> 前提：`/usr/local/bin/obsidian` 已安装，`vault=vault` 对应 `/Users/hm/myLocalRAG/vault`，全部命令均实测验证过。

---

## 基准数据（实测）

| 操作 | 当前方式 | CLI 方式 | 差距 |
|------|---------|---------|------|
| 全文搜索（65 文件） | `grep` 文件扫描 154ms | `obsidian search` 4ms | **40x** |
| 搜索召回数 | 14 个文件 | 26 个文件 | **+86%**（多出 frontmatter/aliases/wikilink 显示文本命中） |
| 断链检测 | 读全量文件 + 正则 loop | `obsidian unresolved` | 代码量减少 + 更准确 |
| 孤儿页检测 | 自制 inbound 图遍历 | `obsidian orphans` | 直接替换 |
| log.md 追加 | 读整文件 → 修改 → 全量写回 | `obsidian append` | 单次原子操作 |

---

## 一、Lint / 健康巡检（替换现有逻辑）

### 1.1 `unresolved` → 替换断链检查

**现状：** `lintWikiVault()`（`wiki-vault.mjs:1105`）用正则 `\[\[([^\]]+)\]\]` 提取链接后手动判断文件是否存在，Obsidian 的模糊路径解析、别名、大小写规则与正则不一致，导致误报/漏报。

**CLI：**
```bash
obsidian vault=vault unresolved format=json
# 返回 [{link: "concepts/missing-page"}]
```

**收益：** 用 Obsidian 自身的链接引擎判断，删除 `createBrokenWikiLinkFinding` 相关的 loop 代码。

---

### 1.2 `orphans` → 替换孤儿页检测

**现状：** `lintWikiVault()` 自建 `inboundCounts` Map，遍历所有文件统计入链数量，判断 count === 0 的为孤儿页（`wiki-vault.mjs:6156`）。

**CLI：**
```bash
obsidian vault=vault orphans format=json
# 直接返回无任何入链的文件列表
```

**收益：** 删除自制图遍历逻辑，且 Obsidian 的 orphan 定义包含 aliases 解析，比手工统计更准。

---

### 1.3 `deadends` → 新增 stub 页检测

**现状：** 没有检测"有入链但无出链"的 stub 页，这类页面往往是未完成的占位页。

**CLI：**
```bash
obsidian vault=vault deadends format=json
# 返回没有任何出链的文件列表
```

**收益：** 新增一个 lint 维度，无需写任何解析代码。实测当前 vault 存在多个 deadend 页（README 类除外需过滤）。

---

### 1.4 `wordcount` → 补充 weak-summary 检测

**现状：** `weak-summary` 检查用 `note.summary.length < 24` 判断（`wiki-vault.mjs:6169`），只检查 summary 字段长度。

**CLI：**
```bash
obsidian vault=vault wordcount path=concepts/obsidian.md
# 返回 words: 1091 / characters: 3302
```

**收益：** 可以对 reader-first 页面做正文字数下限检查，比 summary 长度更能反映页面内容丰富度。

---

## 二、Vault 搜索（新能力）

### 2.1 结构化搜索层

**现状：** 系统没有针对 vault 的独立搜索入口。RAG 检索走 `kb.sqlite`（原始 session），vault 文件只写不读。

**CLI：**
```bash
# 按 frontmatter property 筛选
obsidian vault=vault search query="[type:source-session]" format=json

# 按 tag 筛选
obsidian vault=vault search query="tag:#concept" format=json

# 限定目录 + 关键词
obsidian vault=vault search query="knowledge" path=concepts format=json

# 布尔组合
obsidian vault=vault search query="vault AND publish" format=json

# 带上下文的命中行
obsidian vault=vault search:context query="健康巡检" format=json
```

**为什么比 grep 找到更多：** Obsidian 的索引覆盖 frontmatter 所有字段、`aliases`、wikilink 显示文本（`[[path|显示文本]]`），grep 只扫正文。

**收益：** 新增"查已发布知识"的专属检索入口，与 RAG（查原始 session）形成互补。无需维护额外索引，Obsidian 常驻时始终热启动，4ms 响应。

**可在 Knowledge Workbench 里暴露为：** "在 Vault 中查找" 的独立搜索框或 RAG 回答的补充来源。

---

## 三、发布流水线（改进现有）

### 3.1 `append` → 替换 log.md 全量读写

**现状：** `appendVaultLog()`（`wiki-vault.mjs:6328`）每次追加日志都要 `readFile` 读整个文件，拼接后 `writeFile` 全量写回。

**CLI：**
```bash
obsidian vault=vault append path=log.md content="## [2026-04-16] publish\n- ..."
```

**收益：** 单次原子追加，不存在并发读写竞争，删除 read → join → write 三步。

---

### 3.2 `property:set` → 发布后立即同步 Obsidian 属性索引

**现状：** 写完 frontmatter YAML 字符串到文件后，Obsidian 属性索引不会立即更新，要等 Obsidian 打开该文件才重建。导致 Dataview / Bases 查询结果滞后。

**CLI（发布 post-hook）：**
```bash
obsidian vault=vault property:set name=status value=published path=sources/xxx.md
```

**收益：** 发布完成后 Obsidian 属性索引立即可查，是 Bases 集成的前置条件。

---

### 3.3 `create template=<name>` → 模板驱动页面创建

**现状：** 所有页面类型（concept-hub、pattern-note、synthesis 等）都是在 JS 里硬编码 Markdown 模板字符串拼接（`wiki-vault.mjs:550` 附近大量 `lines.push`）。

**CLI：**
```bash
obsidian vault=vault create path=concepts/new-topic.md template="Concept Draft"
```

**收益：** 模板由 Obsidian 管理，模板变量（`{{date}}`、`{{title}}` 等）由 Obsidian 原生解析，服务端代码只需传路径和模板名，不再维护 Markdown 拼接逻辑。

---

### 3.4 发布后触发索引刷新

**现状：** 批量写入文件后 Obsidian 图谱/索引不一定立即重建。

**CLI：**
```bash
obsidian vault=vault open path=index.md
```

**收益：** 触发 Obsidian 重建图谱，用户打开 vault 时看到的是最新状态。

---

## 四、Inbox / 升格流程（双向打通）

### 4.1 `tasks` → 结构化读取 promotion-queue

**现状：** `inbox/promotion-queue.md` 里的 `- [ ]` 待审条目，服务端需要自己读文件、解析 Markdown 任务格式。

**CLI：**
```bash
obsidian vault=vault tasks todo path=inbox format=json
# 返回结构化任务列表，含文件路径和行号
```

**收益：** 用户在 Obsidian 里手动勾选后，服务端下次健康巡检能直接感知，无需重新解析文件。

---

### 4.2 `task done` → 服务端回写任务状态

**现状：** 单向，服务端只写 promotion-queue，不能标记完成。

**CLI：**
```bash
obsidian vault=vault task done ref="inbox/promotion-queue.md:12"
```

**收益：** 升格操作完成后，服务端可直接在 Obsidian 里把对应条目标记为已完成，不需要用户手动操作。

---

## 五、导航 / 结构查询（新能力）

### 5.1 `outline` → 页面结构感知

**CLI：**
```bash
obsidian vault=vault outline path=concepts/obsidian.md format=json
# 返回 [{level:1, heading:"Obsidian", line:14}, {level:2, heading:"Summary", line:25}, ...]
```

**用途：** 验证发布的页面结构是否符合规范（如是否包含 `## Evidence`、`## My Notes` 等必要 section），比正则匹配标题更可靠。

---

### 5.2 `backlinks` → 页面入链查询

**CLI：**
```bash
obsidian vault=vault backlinks path=concepts/obsidian.md format=json
# 返回引用了该页面的所有文件列表
```

**用途：** 发布 concept 页后验证它是否被足够多的 source/pattern 页引用，作为 concept 质量的量化指标。目前 lintWikiVault 里的 inboundCounts 正是为了这个，可以用 CLI 替换。

---

### 5.3 `recents` → 最近修改监控

**CLI：**
```bash
obsidian vault=vault recents
```

**用途：** 健康巡检时检测用户在 Obsidian 里手动编辑了哪些页面（`## My Notes` 修改等），判断 vault 活跃度，或在下次发布前检查是否有冲突。

---

## 六、Bases 结构化视图（进阶）

### 6.1 `base:query` → 取代静态 index.md

**现状：** `index.md` 每次发布后程序重写，是静态快照。

**方案：** 在 vault 根目录建 `sources-index.base` 文件，配置按 provider / type / date 过滤的视图：

```bash
obsidian vault=vault base:query file=sources-index view="By Provider" format=json
```

**收益：** index 变为动态视图，始终反映最新 vault 状态，不需要每次发布重写文件。

**前置条件：** 需先在 Obsidian GUI 里手动创建 `.base` 文件和视图，之后 CLI 可查询。

---

## 实施优先级

| 优先级 | 方案 | 类型 | 收益 | 改动量 |
|--------|------|------|------|--------|
| P0 | `unresolved` + `orphans` 替换 lint | 替换 | 删代码 + 更准确 | 小 |
| P0 | `search` / `search:context` vault 搜索 | 新能力 | 全新检索入口 | 中 |
| P1 | `append` 替换 log.md 读写 | 替换 | 原子操作 | 极小 |
| P1 | `property:set` 发布 post-hook | 增强 | 属性索引实时同步 | 小 |
| P1 | `tasks` + `task done` 打通 inbox | 增强 | 升格流程双向 | 小 |
| P2 | `deadends` + `wordcount` 新 lint 维度 | 新能力 | 更全面的健康检查 | 小 |
| P2 | `outline` 验证页面结构 | 新能力 | 发布质量保障 | 小 |
| P2 | `backlinks` 替换 inboundCounts | 替换 | 简化 lintWikiVault | 小 |
| P3 | `create template=` 替换 Markdown 拼接 | 替换 | 模板解耦 | 大 |
| P3 | `base:query` 动态 index | 新能力 | 需先建 Bases 视图 | 中 |

---

## 运行时约束与 Fallback 策略

### 约束说明

CLI 是向 Obsidian app 发 IPC，不是独立进程。但 **Obsidian 未运行时可以强制拉起**，实测流程：

```bash
open -a Obsidian          # 后台启动，不阻塞
# 轮询直到 CLI 可响应，通常 1-2s 内就绪
obsidian vault=vault vault  # 就绪后正常使用
```

### 三级 Fallback 策略

```
CLI 调用
  ├─ 成功 → 直接用结果
  ├─ 失败（Obsidian 未运行）
  │    ├─ open -a Obsidian 拉起
  │    ├─ 轮询等待就绪（每 500ms 重试，最多 5s）
  │    ├─ 就绪后重试原命令
  │    └─ 仍失败 → 降级到现有实现（文件 I/O）
  └─ 失败（其他原因）→ 直接降级到现有实现
```

### 参考实现

```js
// 确保 Obsidian 运行，必要时自动拉起
async function ensureObsidian(timeoutMs = 5000) {
  try {
    await exec('obsidian vault=vault vault')
    return true
  } catch {
    await exec('open -a Obsidian')
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500))
      try { await exec('obsidian vault=vault vault'); return true } catch {}
    }
    return false
  }
}

// 所有 CLI 调用的统一入口
async function obsidianCli(args, fallback = null) {
  const ready = await ensureObsidian()
  if (!ready) return fallback?.()  // 降级到传入的现有实现

  try {
    const { stdout } = await exec(`obsidian vault=vault ${args}`)
    return JSON.parse(stdout)
  } catch {
    return fallback?.()
  }
}

// 使用示例：CLI 优先，降级到原有正则扫描
const unresolved = await obsidianCli(
  'unresolved format=json',
  () => legacyParseWikiLinks()  // 现有实现作为 fallback
)
```

### 适用场景区分

| 场景 | 策略 |
|------|------|
| lint / 健康巡检（用户主动触发）| 拉起 Obsidian + 等待就绪，体验可接受 |
| 发布流水线 post-hook | 后台拉起，不阻塞主流程 |
| search 实时查询 | 若 Obsidian 未运行直接降级，不等待 |
| `append` log.md | 降级方案（全量读写）本身成本低，可直接降级 |

P0/P1 级别的方案（lint、search、append）最值得先做，改动最小且收益最直接。
