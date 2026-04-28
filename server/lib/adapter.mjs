import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

function toText(value) {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join('\n').trim()
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text.trim()
    if (typeof value.content === 'string') return value.content.trim()
  }
  return ''
}

function roleFrom(value) {
  const lower = String(value || '').toLowerCase()
  if (lower === 'human' || lower === 'user') return 'user'
  if (lower === 'ai' || lower === 'assistant') return 'assistant'
  return 'assistant'
}

function normalizeProvider(value, fallback = 'other') {
  const lower = String(value || '').toLowerCase().trim()
  if (['chatgpt', 'codex', 'claude', 'claude-code', 'cursor', 'doubao', 'gemini', 'other'].includes(lower)) return lower
  return fallback
}

function stableId(prefix, seed) {
  const hash = crypto.createHash('sha1').update(String(seed)).digest('hex').slice(0, 10)
  return `${prefix}_${hash}`
}

async function walk(dir) {
  const result = []
  const queue = [dir]

  while (queue.length) {
    const current = queue.shift()
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) queue.push(full)
      else result.push(full)
    }
  }

  return result
}

function cleanClaudeExportText(text) {
  return String(text || '')
    .replace(/```[\s]*This block is not supported on your current device yet\.?[\s]*```/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeForDedup(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function isContainedByLongerText(candidate, longer) {
  const a = normalizeForDedup(candidate)
  const b = normalizeForDedup(longer)
  if (!a || !b) return false
  if (a.length < 80) return false
  return b.includes(a)
}

function collapseRepeatedTail(text) {
  const normalized = String(text || '').trim()
  if (!normalized) return ''
  const compact = normalizeForDedup(normalized)
  const half = Math.floor(compact.length / 2)
  if (half < 120) return normalized
  const left = compact.slice(0, half).trim()
  const right = compact.slice(half).trim()
  if (left && right && left === right) {
    const originalHalf = Math.floor(normalized.length / 2)
    return normalized.slice(0, originalHalf).trim()
  }
  return normalized
}

function mergeClaudeMessageParts({ directText = '', blockParts = [] } = {}) {
  const blocks = (Array.isArray(blockParts) ? blockParts : []).map((item) => String(item || '').trim()).filter(Boolean)
  const direct = String(directText || '').trim()
  const parts = []

  if (direct) parts.push(direct)

  for (const block of blocks) {
    if (!parts.length) {
      parts.push(block)
      continue
    }
    const exists = parts.some((part) => normalizeForDedup(part) === normalizeForDedup(block))
    if (exists) continue

    const coveredByExisting = parts.some((part) => isContainedByLongerText(block, part))
    if (coveredByExisting) continue

    const coveringExistingIndex = parts.findIndex((part) => isContainedByLongerText(part, block))
    if (coveringExistingIndex >= 0) {
      parts[coveringExistingIndex] = block
      continue
    }

    parts.push(block)
  }

  return parts.join('\n').trim()
}

function readClaudeBlockText(block) {
  if (!block || typeof block !== 'object') return ''
  const type = String(block.type || '').toLowerCase()
  if (type === 'text') return toText(block.text)
  if (type === 'thinking') return toText(block.thinking || block.text)
  if (type === 'tool_result') return toText(block.content || block.result || block.output)
  return toText(block.text || block.content)
}

function normalizeClaudeExportMessage(raw) {
  if (!raw || typeof raw !== 'object') return null

  const parts = []
  const directText = toText(raw.text)
  if (directText) parts.push(directText)

  if (Array.isArray(raw.content)) {
    for (const block of raw.content) {
      const text = readClaudeBlockText(block)
      if (!text) continue
      if (!parts.includes(text)) parts.push(text)
    }
  }

  const merged = mergeClaudeMessageParts({
    directText,
    blockParts: parts,
  })
  const content = collapseRepeatedTail(cleanClaudeExportText(merged))
  if (!content) return null

  return {
    id: raw.uuid || stableId('msg', content),
    role: roleFrom(raw.sender),
    content,
    createdAt: raw.created_at || raw.updated_at || null,
  }
}

function parseClaudeOfficialExport(data, filePath, providerOverride = '') {
  if (!Array.isArray(data)) return []
  const provider = normalizeProvider(providerOverride, 'claude')

  return data
    .map((conv) => {
      if (!conv || typeof conv !== 'object') return null
      const messages = Array.isArray(conv.chat_messages)
        ? conv.chat_messages.map(normalizeClaudeExportMessage).filter(Boolean)
        : []
      if (!messages.length) return null
      messages.sort((a, b) => +new Date(a.createdAt || 0) - +new Date(b.createdAt || 0))

      return {
        id: stableId('sess', `${filePath}:${conv.uuid || conv.name || messages[0].id}`),
        sourceId: 'import_folder',
        sourceType: 'claude_official_export',
        provider,
        title: toText(conv.name) || toText(conv.summary).slice(0, 56) || path.basename(filePath),
        updatedAt: conv.updated_at || messages.at(-1)?.createdAt || new Date().toISOString(),
        tags: [provider, 'official-export'],
        messages,
        meta: { sourceFile: filePath, conversationId: conv.uuid || null },
      }
    })
    .filter(Boolean)
}

function parsePluginJsonExport(data, filePath, providerOverride = '') {
  if (!data || typeof data !== 'object' || !Array.isArray(data.messages)) return []
  const provider = normalizeProvider(providerOverride, String(data.author || 'unknown').toLowerCase())

  const messages = data.messages
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const content = toText(item.content)
      if (!content) return null
      return {
        id: item.id || stableId('msg', `${filePath}:${content}`),
        role: roleFrom(item.author),
        content,
        createdAt: null,
      }
    })
    .filter(Boolean)

  if (!messages.length) return []

  return [
    {
      id: stableId('sess', `${filePath}:${data.title || ''}`),
      sourceId: 'import_folder',
      sourceType: 'plugin_json_export',
      provider,
      title: toText(data.title) || path.basename(filePath, path.extname(filePath)),
      updatedAt: data.date || new Date().toISOString(),
      tags: [provider, 'plugin-export', 'json'],
      messages,
      meta: { sourceFile: filePath, url: data.url || null },
    },
  ]
}

function parseMarkdownMessages(markdown) {
  const lines = String(markdown || '').split(/\r?\n/)
  const headingRegex = /^#{1,6}\s*(user|assistant|ai|human|用户|你|我)\s*[:：]?\s*$/i

  const chunks = []
  let current = null

  for (const line of lines) {
    const match = line.match(headingRegex)
    if (match) {
      if (current) chunks.push(current)
      current = { role: roleFrom(match[1]), lines: [] }
      continue
    }
    if (!current) current = { role: 'assistant', lines: [] }
    current.lines.push(line)
  }

  if (current) chunks.push(current)

  return chunks
    .map((chunk, index) => ({
      id: stableId('msg', `${index}:${chunk.role}:${chunk.lines.join('\n')}`),
      role: chunk.role,
      content: chunk.lines.join('\n').trim(),
      createdAt: null,
    }))
    .filter((item) => item.content)
}

function parseMarkdownContent(markdown, filePath, providerOverride = '') {
  const base = path.basename(filePath).toLowerCase()
  if (base === 'readme.md') return []
  const provider = normalizeProvider(providerOverride, 'other')
  const messages = parseMarkdownMessages(markdown)
  if (!messages.length) return []

  return [
    {
      id: stableId('sess', filePath),
      sourceId: 'import_folder',
      sourceType: 'markdown_export',
      provider,
      title: path.basename(filePath, path.extname(filePath)),
      updatedAt: new Date().toISOString(),
      tags: [provider, 'markdown', 'manual-export'],
      messages,
      meta: { sourceFile: filePath },
    },
  ]
}

function parseJsonContent(raw, filePath, providerOverride = '') {
  let data = null
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }

  const base = path.basename(filePath).toLowerCase()
  if (base === 'conversations.json') {
    const claudeSessions = parseClaudeOfficialExport(data, filePath, providerOverride)
    if (claudeSessions.length) return claudeSessions
  }

  return parsePluginJsonExport(data, filePath, providerOverride)
}

async function parseJsonFile(filePath, providerOverride = '') {
  const raw = await fs.readFile(filePath, 'utf-8')
  return parseJsonContent(raw, filePath, providerOverride)
}

async function parseMarkdownFile(filePath, providerOverride = '') {
  const markdown = await fs.readFile(filePath, 'utf-8')
  return parseMarkdownContent(markdown, filePath, providerOverride)
}

export async function adaptTextFilesToStandard(fileEntries, options = {}) {
  const providerOverride = normalizeProvider(options.provider, '')
  const sessions = []
  const issues = []

  for (const entry of Array.isArray(fileEntries) ? fileEntries : []) {
    const filePath = String(entry?.path || '')
    const content = String(entry?.content || '')
    if (!filePath) continue
    const ext = path.extname(filePath).toLowerCase()

    try {
      if (ext === '.json') sessions.push(...parseJsonContent(content, filePath, providerOverride))
      else if (ext === '.md') sessions.push(...parseMarkdownContent(content, filePath, providerOverride))
    } catch (error) {
      issues.push({ filePath, message: String(error) })
    }
  }

  return {
    schema: 'ai-session-standard@1',
    generatedAt: new Date().toISOString(),
    sourceRoot: options.sourceRoot || 'upload',
    count: sessions.length,
    sessions,
    issues,
  }
}

export async function adaptFolderToStandard(inputDir, options = {}) {
  const resolvedInput = path.resolve(inputDir)
  const providerOverride = normalizeProvider(options.provider, '')
  const allFiles = await walk(resolvedInput)
  const sessions = []
  const issues = []

  for (const filePath of allFiles) {
    const ext = path.extname(filePath).toLowerCase()
    try {
      if (ext === '.json') sessions.push(...(await parseJsonFile(filePath, providerOverride)))
      else if (ext === '.md') sessions.push(...(await parseMarkdownFile(filePath, providerOverride)))
    } catch (error) {
      issues.push({ filePath, message: String(error) })
    }
  }

  return {
    schema: 'ai-session-standard@1',
    generatedAt: new Date().toISOString(),
    sourceRoot: resolvedInput,
    count: sessions.length,
    sessions,
    issues,
  }
}

export function toIndexFromStandard(standard) {
  const sessions = Array.isArray(standard?.sessions) ? standard.sessions : []
  const issues = Array.isArray(standard?.issues) ? standard.issues : []

  const normalized = sessions
    .map((item) => ({
      ...item,
      searchableText: [
        item.title,
        item.provider,
        Array.isArray(item.tags) ? item.tags.join(' ') : '',
        ...(Array.isArray(item.messages) ? item.messages.map((m) => `${m.role} ${m.content}`) : []),
      ]
        .join(' ')
        .toLowerCase(),
    }))
    .sort((a, b) => +new Date(b.updatedAt || 0) - +new Date(a.updatedAt || 0))

  return {
    updatedAt: new Date().toISOString(),
    sessions: normalized,
    issues,
  }
}
