# Obsidian CLI API（M3）

本文记录 M3 阶段新增/增强的 Vault API，以及前端最小调用示例。

## 1. 发布接口增强

`POST /api/wiki-vault/publish`

新增返回字段：`obsidianPostPublish`

用途：发布完成后，标记是否成功触发 Obsidian post-hook（`open path=index.md`）。

示例响应片段：

```json
{
  "ok": true,
  "publishedCount": 81,
  "obsidianPostPublish": {
    "engine": "obsidian-cli",
    "opened": true,
    "path": "index.md"
  }
}
```

## 2. 模板创建接口

`POST /api/wiki-vault/create-from-template`

请求体：

```json
{
  "path": "concepts/new-topic.md",
  "template": "Concept Draft"
}
```

响应体：

```json
{
  "ok": true,
  "engine": "obsidian-cli",
  "created": true,
  "path": "concepts/new-topic.md",
  "template": "Concept Draft",
  "mode": "obsidian-cli"
}
```

说明：
- `path` 为 vault 内相对路径。
- `template` 可省略；省略时后端会按目录自动映射默认模板。
- 如果 Obsidian CLI 不可用，会自动回退到文件系统模板复制（`mode=filesystem-fallback`）。

## 3. 前端最小调用示例

### 3.1 触发发布并读取 post-hook 状态

```ts
export async function publishVault(syncMode: 'publish-only' | 'publish-with-summary' = 'publish-only') {
  const resp = await fetch('/api/wiki-vault/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ syncMode }),
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data?.error || 'publish failed')
  return {
    publishedCount: Number(data?.publishedCount || 0),
    obsidianPostPublish: data?.obsidianPostPublish || null,
  }
}
```

### 3.2 从模板创建页面

```ts
export async function createVaultNoteFromTemplate(path: string, template?: string) {
  const resp = await fetch('/api/wiki-vault/create-from-template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, template }),
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data?.error || 'create-from-template failed')
  return data
}
```

## 4. 相关开关

- `KB_OBSIDIAN_TEMPLATE_AUTO_CREATE_ENABLED`
  - 默认：`1`
  - 作用：是否启用生成流程里的模板 seed（仅新文件）。

- `KB_OBSIDIAN_POST_PUBLISH_OPEN_ENABLED`
  - 默认：`1`
  - 作用：是否在发布后触发 `obsidian open path=index.md`。
