import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { files, writeJson } from './storage.mjs'
import { cleanConversationContent } from './embedding.mjs'
import {
  updateMessageTagsInDb,
  updateSessionReviewInDb,
  deleteSessionByIdFromDb,
  loadEmbeddingBuildStatsFromDb,
  listSessionChunksForEmbeddingFromDb,
  listSessionsForEmbeddingFromDb,
  loadChunkEmbeddingsByIdsFromDb,
  loadSessionEmbeddingsByIdsFromDb,
  loadSessionsByIdsFromDb,
  upsertChunkEmbeddingsInDb,
  saveEmbeddingBuildRecordInDb,
  upsertSessionEmbeddingsInDb,
  isJsonSnapshotEnabled,
  loadIndexFromDb,
  loadSourcesFromDb,
  mergeIndexToDb,
  retrieveChunkCandidatesFromDb,
  retrieveCandidatesFromDb,
  querySessionsFromDb,
  saveIndexToDb,
  saveSourcesToDb,
} from './db.mjs'

const MAX_FILE_SIZE = 8 * 1024 * 1024
const TEXT_EXT = new Set(['.md', '.txt'])
const JSON_EXT = new Set(['.json'])
const JSONL_EXT = new Set(['.jsonl'])

function id(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function toText(content) {
  if (Array.isArray(content)) return content.map(toText).join('\n').trim()
  if (typeof content === 'string') return content.trim()
  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') return content.text.trim()
    if (typeof content.content === 'string') return content.content.trim()
  }
  return ''
}

function sanitizeScannedContent(content, role = 'assistant') {
  return cleanConversationContent(content, { role: String(role || 'assistant') })
}

function sanitizeScannedTitle(input, fallback = 'Untitled Session', maxChars = 56) {
  const cleaned = sanitizeScannedContent(input, 'user')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, maxChars) || fallback
}

function normalizeMessage(raw, fallbackRole = 'assistant') {
  if (!raw) return null

  const role =
    raw.role ||
    raw.author?.role ||
    raw.speaker ||
    (raw.type === 'human' ? 'user' : '') ||
    fallbackRole

  const content =
    raw.content?.parts ? toText(raw.content.parts) : toText(raw.content ?? raw.text ?? raw.message ?? raw.value)

  if (!content) return null
  const sanitizedContent = sanitizeScannedContent(content, role)
  if (!sanitizedContent) return null

  return {
    id: raw.id ?? id('msg'),
    role,
    content: sanitizedContent,
    createdAt: raw.createdAt ?? raw.create_time ?? raw.timestamp ?? null,
  }
}

function extractAsciiRuns(buffer, minLen = 6) {
  const lines = []
  let run = ''

  for (const byte of buffer) {
    const isPrintable = byte >= 32 && byte <= 126
    if (isPrintable) {
      run += String.fromCharCode(byte)
      continue
    }

    if (run.length >= minLen) lines.push(run)
    run = ''
  }

  if (run.length >= minLen) lines.push(run)
  return lines
}

function extractAsciiRunsSkipNull(buffer, minLen = 6) {
  const lines = []
  let run = ''

  for (const byte of buffer) {
    const isPrintable = byte >= 32 && byte <= 126
    if (isPrintable) {
      run += String.fromCharCode(byte)
      continue
    }

    // UTF-16LE text often inserts 0x00 between characters.
    if (byte === 0) continue

    if (run.length >= minLen) lines.push(run)
    run = ''
  }

  if (run.length >= minLen) lines.push(run)
  return lines
}

function cleanClaudeLine(line) {
  return String(line || '')
    .replace(/^message"?/i, '')
    .replace(/^display_contento"?/i, '')
    .replace(/^text"?/i, '')
    .replace(/^content"?/i, '')
    .replace(/^["':\-\s]+/, '')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isClaudeNoiseLine(line) {
  const l = line.toLowerCase()
  return (
    l.length < 12 ||
    l.includes('conversations_v2') ||
    l.includes('created_at') ||
    l.includes('updatedat') ||
    l.includes('uuid') ||
    l.includes('support.claude.com') ||
    l.includes('/mnt/') ||
    l.includes('/home/claude/') ||
    l.includes('indexeddb') ||
    l.includes('display_name') ||
    l.includes('organization') ||
    l.includes('workspace_ids') ||
    l.includes('cloudflare') ||
    l.includes('cache_data') ||
    /^[a-z0-9_./:-]{24,}$/i.test(l)
  )
}

function isClaudeContentLike(line) {
  const l = cleanClaudeLine(line)
  if (!l || l.length < 16 || l.length > 700) return false
  if (isClaudeNoiseLine(l)) return false
  if (!/[a-zA-Z]/.test(l)) return false
  if (!/\s/.test(l)) return false

  const weirdChars = (l.match(/[^a-zA-Z0-9\s.,:;!?'"`()\-_/[\]]/g) || []).length
  if (weirdChars > 6) return false

  const words = l.split(/\s+/).filter((w) => /[a-zA-Z]/.test(w))
  if (words.length < 3) return false

  const alphaChars = (l.match(/[a-zA-Z]/g) || []).length
  if (alphaChars / l.length < 0.35) return false

  return true
}

function compactConsecutiveMessages(messages) {
  const compacted = []

  for (const msg of messages) {
    const prev = compacted[compacted.length - 1]
    if (prev && prev.role === msg.role) {
      if (!prev.content.includes(msg.content)) {
        prev.content = `${prev.content}\n${msg.content}`.trim()
      }
      continue
    }

    compacted.push({ ...msg })
  }

  return compacted
}

function parseClaudeIndexedDbBinary(buffer, source, filePath, fileInfo) {
  const lines = extractAsciiRuns(buffer)
  if (!lines.length) return []
  if (!lines.some((line) => line.includes('conversations_v2'))) return []

  const messages = []
  let role = ''

  for (const rawLine of lines) {
    const line = rawLine.trim()
    const lower = line.toLowerCase()

    if (lower === 'human' || lower.startsWith('human"') || /^human[a-z0-9]/.test(lower)) {
      role = 'user'
      continue
    }
    if (lower === 'assistant' || lower.startsWith('assistant"') || /^assistant[a-z0-9]/.test(lower)) {
      role = 'assistant'
      continue
    }

    if (lower.startsWith('the user wants')) role = 'user'
    if (lower.startsWith("now i'll") || lower.startsWith('i need')) role = 'assistant'

    if (!role) continue
    if (!isClaudeContentLike(line)) continue

    const content = cleanClaudeLine(line)
    if (!content) continue

    const prev = messages[messages.length - 1]
    if (prev && prev.role === role && prev.content === content) continue

    messages.push({
      id: id('msg'),
      role,
      content,
      createdAt: null,
    })
  }

  const compacted = compactConsecutiveMessages(messages)
    .filter((m) => m.content.length >= 24)
    .slice(0, 220)

  if (compacted.length < 4) return []
  if (!compacted.some((m) => m.role === 'user') || !compacted.some((m) => m.role === 'assistant')) return []

  const firstUser = compacted.find((m) => m.role === 'user')?.content || path.basename(filePath)
  const title = cleanClaudeLine(firstUser).slice(0, 56)

  return [
    {
      id: `${source.id}:${path.basename(filePath)}`,
      sourceId: source.id,
      provider: source.provider,
      title,
      updatedAt: fileInfo.mtime.toISOString(),
      tags: [source.provider, 'indexeddb-experimental'],
      messages: compacted,
    },
  ]
}

function isLikelyDoubaoMetaLine(line) {
  const l = line.toLowerCase()
  return (
    l.includes('conversation_id') ||
    l.includes('local_conversation_id') ||
    l.includes('local_message_id') ||
    l.includes('message_id') ||
    l.includes('reply_id') ||
    l.includes('content_blocks_v2') ||
    l.includes('send_message_scene') ||
    l.includes('chat_ability') ||
    l.includes('inner_log_id') ||
    l.includes('bot_id') ||
    l.includes('user_type') ||
    l.includes('update_version_code') ||
    l.includes('search_engine_type') ||
    l.includes('jsonl') ||
    l.includes('https://') ||
    l.includes('verify_')
  )
}

function cleanDoubaoContentLine(line) {
  return String(line || '')
    .replace(/^[`'"|\\/\-_\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseDoubaoIndexedDbBinary(buffer, source, filePath, fileInfo) {
  const lines = extractAsciiRunsSkipNull(buffer, 10)
  if (!lines.some((line) => line.includes('conversation_id'))) return []

  let conversationId = ''
  const contents = []
  const seen = new Set()

  for (const line of lines) {
    if (!conversationId) {
      const match = line.match(/conversation_id"\s*"([^"]+)"/)
      if (match?.[1]) conversationId = match[1]
    }

    const cleaned = cleanDoubaoContentLine(line)
    if (!cleaned) continue
    if (cleaned.length < 20 || cleaned.length > 600) continue
    if (!/\s/.test(cleaned)) continue
    if (isLikelyDoubaoMetaLine(cleaned)) continue

    // Keep mostly natural-language text blocks.
    const alphaOrCjk = (cleaned.match(/[A-Za-z\u4e00-\u9fff]/g) || []).length
    if (alphaOrCjk / cleaned.length < 0.45) continue
    const weirdChars = (cleaned.match(/[^A-Za-z0-9\u4e00-\u9fff\s.,:;!?'"`()\-_/[\]{}%#]/g) || []).length
    if (weirdChars > 4) continue
    const wordLike = cleaned.split(/\s+/).filter((w) => /[A-Za-z\u4e00-\u9fff]/.test(w)).length
    if (wordLike < 3) continue

    if (seen.has(cleaned)) continue
    seen.add(cleaned)
    contents.push(cleaned)
  }

  if (contents.length < 3) return []

  const messages = contents.slice(0, 80).map((content) => ({
    id: id('msg'),
    role: 'assistant',
    content,
    createdAt: null,
  }))

  return [
    {
      id: `${source.id}:${conversationId || path.basename(filePath)}`,
      sourceId: source.id,
      provider: source.provider,
      title: contents[0].slice(0, 56),
      updatedAt: fileInfo.mtime.toISOString(),
      tags: [source.provider, 'indexeddb-experimental'],
      messages,
    },
  ]
}

function readCursorTextFromContent(content) {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object') {
          if (typeof item.text === 'string') return item.text
          if (typeof item.content === 'string') return item.content
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') return content.text.trim()
  }
  return ''
}

function normalizeCursorJsonlMessage(raw) {
  if (!raw || typeof raw !== 'object') return null

  const role = typeof raw.role === 'string' ? raw.role : 'assistant'
  const message = raw.message && typeof raw.message === 'object' ? raw.message : {}
  const content = readCursorTextFromContent(message.content ?? raw.content)
  if (!content) return null
  const sanitizedContent = sanitizeScannedContent(content, role)
  if (!sanitizedContent) return null

  return {
    id: raw.id ?? id('msg'),
    role,
    content: sanitizedContent,
    createdAt: raw.createdAt ?? raw.timestamp ?? null,
  }
}

function inferCursorTitle(messages, filePath) {
  const filename = path.basename(filePath, path.extname(filePath))
  const firstUser = messages.find((msg) => msg.role === 'user')
  if (!firstUser?.content) return filename
  return sanitizeScannedTitle(firstUser.content, filename, 48)
}

function inferCursorConversationId(filePath) {
  const fileName = path.basename(filePath, path.extname(filePath))
  if (fileName && /^[0-9a-fA-F-]{16,}$/.test(fileName)) return fileName

  const dirName = path.basename(path.dirname(filePath))
  if (dirName && /^[0-9a-fA-F-]{16,}$/.test(dirName)) return dirName
  return fileName || dirName || ''
}

function parseJsonlLines(rawText) {
  return String(rawText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function parseCursorJsonl(rawText, source, filePath, fileInfo) {
  const messages = parseJsonlLines(rawText)
    .map((line) => normalizeCursorJsonlMessage(line))
    .filter(Boolean)

  if (messages.length < 2) return []
  if (!messages.some((m) => m.role === 'user')) return []
  if (!messages.some((m) => m.role === 'assistant')) return []
  const conversationId = inferCursorConversationId(filePath)

  return [
    {
      id: `${source.id}:${path.basename(filePath)}`,
      sourceId: source.id,
      provider: source.provider,
      title: inferCursorTitle(messages, filePath),
      updatedAt: fileInfo.mtime.toISOString(),
      tags: [source.provider, 'jsonl'],
      meta: {
        cursorConversationId: conversationId,
        cursorTranscriptPath: filePath,
      },
      messages,
    },
  ]
}

function readCodexMessageText(content) {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) return content.map((item) => readCodexMessageText(item)).filter(Boolean).join('\n').trim()
  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') return content.text.trim()
    if (typeof content.input_text === 'string') return content.input_text.trim()
    if (typeof content.output_text === 'string') return content.output_text.trim()
    if (Array.isArray(content.content)) return readCodexMessageText(content.content)
    if (typeof content.content === 'string') return content.content.trim()
  }
  return ''
}

function isCodexEnvironmentContext(content) {
  const normalized = String(content || '').replace(/\s+/g, ' ').trim()
  return /^<environment_context>/i.test(normalized) && /<\/environment_context>$/i.test(normalized)
}

function normalizeCodexJsonlMessage(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null
  if (String(raw.type || '').toLowerCase() !== 'response_item') return null

  const payload = raw.payload && typeof raw.payload === 'object' ? raw.payload : {}
  if (String(payload.type || '').toLowerCase() !== 'message') return null

  const role = String(payload.role || '').toLowerCase()
  if (role !== 'user' && role !== 'assistant') return null

  const content = readCodexMessageText(payload.content || '')
  if (!content) return null
  if (role === 'user' && isCodexEnvironmentContext(content)) return null
  const sanitizedContent = sanitizeScannedContent(content, role)
  if (!sanitizedContent) return null

  return {
    id: `codex_msg_${index}_${id('msg')}`,
    role,
    content: sanitizedContent,
    createdAt: raw.timestamp || null,
  }
}

function inferCodexTitle(messages, filePath) {
  const filename = path.basename(filePath, path.extname(filePath))
  const firstUser = messages.find((msg) => msg.role === 'user' && !isCodexEnvironmentContext(msg.content))
  if (!firstUser?.content) return filename
  return sanitizeScannedTitle(firstUser.content, filename, 48)
}

function parseCodexJsonl(rawText, source, filePath, fileInfo) {
  const lines = parseJsonlLines(rawText)
  const sessionMeta = lines.find((item) => String(item?.type || '') === 'session_meta')
  const messages = lines.map((line, index) => normalizeCodexJsonlMessage(line, index)).filter(Boolean)

  if (messages.length < 2) return []
  if (!messages.some((m) => m.role === 'user')) return []
  if (!messages.some((m) => m.role === 'assistant')) return []

  const codexSessionId =
    String(sessionMeta?.payload?.id || '').trim() || path.basename(filePath, path.extname(filePath))
  const updatedAt =
    messages.at(-1)?.createdAt ||
    String(sessionMeta?.payload?.timestamp || '').trim() ||
    fileInfo.mtime.toISOString()

  return [
    {
      id: `${source.id}:${path.basename(filePath)}`,
      sourceId: source.id,
      provider: source.provider,
      title: inferCodexTitle(messages, filePath),
      updatedAt,
      tags: [source.provider, 'jsonl', 'event_stream'],
      meta: {
        codexSessionId,
        codexTranscriptPath: filePath,
        codexCwd: String(sessionMeta?.payload?.cwd || '').trim() || undefined,
      },
      messages,
    },
  ]
}

function looksLikeMessage(item) {
  if (!item || typeof item !== 'object') return false
  return Boolean(
    item.role ||
      item.author?.role ||
      item.speaker ||
      item.content ||
      item.text ||
      item.message ||
      item.value,
  )
}

function looksLikeConversationMessages(list) {
  if (!Array.isArray(list) || list.length < 2) return false
  return list.some((item) => looksLikeMessage(item))
}

function parseChatGPTExport(data, source) {
  if (!Array.isArray(data)) return []

  return data
    .map((conv) => {
      if (!conv?.id || !conv?.mapping) return null

      const nodes = Object.values(conv.mapping)
        .map((node) => node?.message)
        .filter(Boolean)
        .map((msg) => normalizeMessage(msg))
        .filter(Boolean)

      if (!nodes.length) return null

      nodes.sort((a, b) => +new Date(a.createdAt || 0) - +new Date(b.createdAt || 0))

      const updatedAt = conv.update_time || nodes.at(-1)?.createdAt || new Date().toISOString()

      return {
        id: `${source.id}:${conv.id}`,
        sourceId: source.id,
        provider: source.provider,
        title: conv.title || 'Untitled ChatGPT Conversation',
        updatedAt,
        tags: [source.provider],
        messages: nodes,
      }
    })
    .filter(Boolean)
}

function readClaudeBlockText(block) {
  if (!block || typeof block !== 'object') return ''

  const type = String(block.type || '').toLowerCase()
  if (type === 'text') return toText(block.text || '')
  if (type === 'thinking') return toText(block.thinking || block.text || '')
  if (type === 'tool_use') {
    const name = toText(block.name || 'tool')
    const input = block.input ? JSON.stringify(block.input) : ''
    return `Tool Use: ${name}${input ? ` ${input}` : ''}`.trim()
  }
  if (type === 'tool_result') return toText(block.content || block.result || block.output || '')

  return toText(block.text || block.content || '')
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

function normalizeClaudeExportMessage(raw) {
  if (!raw || typeof raw !== 'object') return null

  const sender = String(raw.sender || '').toLowerCase()
  const role = sender === 'human' ? 'user' : sender === 'assistant' ? 'assistant' : 'assistant'

  const parts = []
  const directText = toText(raw.text || '')
  if (directText) parts.push(directText)

  if (Array.isArray(raw.content)) {
    for (const block of raw.content) {
      const blockText = readClaudeBlockText(block)
      if (!blockText) continue
      if (!parts.includes(blockText)) parts.push(blockText)
    }
  }

  const merged = mergeClaudeMessageParts({
    directText,
    blockParts: parts,
  })
  const content = collapseRepeatedTail(cleanClaudeExportText(merged))
  if (!content) return null
  const sanitizedContent = sanitizeScannedContent(content, role)
  if (!sanitizedContent) return null

  return {
    id: raw.uuid || id('msg'),
    role,
    content: sanitizedContent,
    createdAt: raw.created_at || raw.updated_at || null,
  }
}

function parseClaudeExport(data, source, filePath) {
  if (!Array.isArray(data)) return []

  return data
    .map((conv) => {
      if (!conv || typeof conv !== 'object') return null
      const chatMessages = Array.isArray(conv.chat_messages) ? conv.chat_messages : []
      if (!chatMessages.length) return null

      const messages = chatMessages.map((msg) => normalizeClaudeExportMessage(msg)).filter(Boolean)
      if (messages.length < 2) return null

      messages.sort((a, b) => +new Date(a.createdAt || 0) - +new Date(b.createdAt || 0))

      const summary = toText(conv.summary || '').replace(/\s+/g, ' ').trim()
      const title =
        sanitizeScannedTitle(conv.name || '', '', 56) ||
        sanitizeScannedTitle(summary, '', 56) ||
        path.basename(filePath, path.extname(filePath))

      return {
        id: `${source.id}:${conv.uuid || id('conv')}`,
        sourceId: source.id,
        provider: source.provider,
        title,
        updatedAt: conv.updated_at || messages.at(-1)?.createdAt || new Date().toISOString(),
        tags: [source.provider, 'claude_export'],
        messages,
      }
    })
    .filter(Boolean)
}

function parseGenericJson(data, source, filePath) {
  const filename = path.basename(filePath)

  if (Array.isArray(data)) {
    if (!looksLikeConversationMessages(data)) return []

    const messages = data.map((item) => normalizeMessage(item)).filter(Boolean)
    if (messages.length < 2) return []

    return [
      {
        id: `${source.id}:${filename}`,
        sourceId: source.id,
        provider: source.provider,
        title: filename,
        updatedAt: messages.at(-1)?.createdAt || new Date().toISOString(),
        tags: [source.provider, 'json'],
        messages,
      },
    ]
  }

  if (data && typeof data === 'object') {
    const messageCandidates = data.messages || data.conversation || data.chat || []
    if (!looksLikeConversationMessages(messageCandidates)) return []

    const messages = Array.isArray(messageCandidates)
      ? messageCandidates.map((item) => normalizeMessage(item)).filter(Boolean)
      : []

    if (messages.length < 2) return []

    return [
      {
        id: `${source.id}:${data.id || filename}`,
        sourceId: source.id,
        provider: source.provider,
        title: data.title || filename,
        updatedAt: data.updatedAt || data.update_time || messages.at(-1)?.createdAt || new Date().toISOString(),
        tags: [source.provider, 'json'],
        messages,
      },
    ]
  }

  return []
}

function parseTextFile(rawText, source, filePath) {
  const lines = rawText.split('\n').map((line) => line.trim())
  const title = lines.find((line) => line.length)?.replace(/^#\s*/, '') || path.basename(filePath)
  const body = rawText.trim()

  if (!body) return []

  return [
    {
      id: `${source.id}:${path.basename(filePath)}`,
      sourceId: source.id,
      provider: source.provider,
      title,
      updatedAt: new Date().toISOString(),
      tags: [source.provider, 'text'],
      messages: [{ id: id('msg'), role: 'assistant', content: body, createdAt: null }],
    },
  ]
}

function shouldSkipDirForSource(source, dirName) {
  if (source.provider === 'claude') {
    return new Set([
      'Cache',
      'Code Cache',
      'GPUCache',
      'DawnGraphiteCache',
      'DawnWebGPUCache',
      'Crashpad',
      'WebStorage',
      'Session Storage',
      'Shared Dictionary',
    ]).has(dirName)
  }

  if (source.provider === 'doubao') {
    const lower = dirName.toLowerCase()
    return new Set([
      'cache',
      'code cache',
      'gpucache',
      'dawngraphitecache',
      'dawnwebgpucache',
      'crashpad',
      'webstorage',
      'session storage',
      'shared dictionary',
      'service worker',
      'blob_storage',
      'sdk_storage',
      'safe browsing',
    ]).has(lower)
  }

  return false
}

async function walk(dir, source) {
  const result = []
  const queue = [dir]

  while (queue.length) {
    const current = queue.shift()
    const entries = await readdir(current, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (shouldSkipDirForSource(source, entry.name)) continue
        queue.push(fullPath)
      } else {
        result.push(fullPath)
      }
    }
  }

  return result
}

async function parseFile(filePath, source) {
  const ext = path.extname(filePath).toLowerCase()

  const info = await stat(filePath)
  if (info.size > MAX_FILE_SIZE) return []

  if (source.provider === 'claude') {
    const lower = filePath.toLowerCase()
    const inIndexedDb = lower.includes('/indexeddb/')
    const inBlob = lower.includes('.indexeddb.blob')
    const inLevelDb = lower.includes('.indexeddb.leveldb')
    if (inIndexedDb && (inBlob || inLevelDb)) {
      const rawBuffer = await readFile(filePath)
      return parseClaudeIndexedDbBinary(rawBuffer, source, filePath, info)
    }
  }

  if (source.provider === 'doubao') {
    const lower = filePath.toLowerCase()
    const target =
      lower.includes('/default/indexeddb/https_www.doubao.com_0.indexeddb.leveldb/') &&
      (lower.endsWith('.log') || lower.endsWith('.ldb'))
    if (target) {
      const rawBuffer = await readFile(filePath)
      return parseDoubaoIndexedDbBinary(rawBuffer, source, filePath, info)
    }
  }

  const raw = await readFile(filePath, 'utf-8')

  if (source.format === 'chatgpt_export') {
    if (path.basename(filePath).toLowerCase() !== 'conversations.json') return []
    return parseChatGPTExport(JSON.parse(raw), source)
  }

  if (source.format === 'claude_export') {
    if (path.basename(filePath).toLowerCase() !== 'conversations.json') return []
    return parseClaudeExport(JSON.parse(raw), source, filePath)
  }

  if (path.basename(filePath).toLowerCase() === 'conversations.json') {
    try {
      const data = JSON.parse(raw)
      if (Array.isArray(data)) {
        if (data.some((item) => item?.mapping && item?.id)) {
          return parseChatGPTExport(data, source)
        }
        if (data.some((item) => Array.isArray(item?.chat_messages))) {
          return parseClaudeExport(data, source, filePath)
        }
      }
    } catch {
      // ignore and continue with regular parsers
    }
  }

  if (JSON_EXT.has(ext)) {
    try {
      return parseGenericJson(JSON.parse(raw), source, filePath)
    } catch {
      return []
    }
  }

  if (JSONL_EXT.has(ext)) {
    // Cursor/Codex transcripts are stored as jsonl conversation logs.
    if (source.provider === 'cursor') return parseCursorJsonl(raw, source, filePath, info)
    if (source.provider === 'codex') return parseCodexJsonl(raw, source, filePath, info)
    return []
  }

  if (TEXT_EXT.has(ext)) {
    // Text files are often docs/configs in app data folders (especially Claude).
    // Only allow text-as-session for explicitly generic/other sources.
    if (source.provider !== 'other') return []
    return parseTextFile(raw, source, filePath)
  }

  return []
}

export async function loadSources() {
  return loadSourcesFromDb()
}

export async function saveSources(sources) {
  const saved = await saveSourcesToDb(sources)
  if (await isJsonSnapshotEnabled()) {
    await writeJson(files.sources, saved)
  }
  return saved
}

export async function loadIndex() {
  return loadIndexFromDb()
}

export async function querySessions({ q = '', provider = '', from = '', to = '', conversationId = '' } = {}) {
  return querySessionsFromDb({ q, provider, from, to, conversationId })
}

export async function loadSessionsByIds(sessionIds = []) {
  return loadSessionsByIdsFromDb(sessionIds)
}

export async function retrieveCandidates(options = {}) {
  return retrieveCandidatesFromDb(options)
}

export async function retrieveChunkCandidates(options = {}) {
  return retrieveChunkCandidatesFromDb(options)
}

export async function listSessionsForEmbedding(options = {}) {
  return listSessionsForEmbeddingFromDb(options)
}

export async function listSessionChunksForEmbedding(options = {}) {
  return listSessionChunksForEmbeddingFromDb(options)
}

export async function loadSessionEmbeddingsByIds(sessionIds = []) {
  return loadSessionEmbeddingsByIdsFromDb(sessionIds)
}

export async function loadChunkEmbeddingsByIds(chunkIds = []) {
  return loadChunkEmbeddingsByIdsFromDb(chunkIds)
}

export async function loadEmbeddingBuildStats(options = {}) {
  return loadEmbeddingBuildStatsFromDb(options)
}

export async function saveEmbeddingBuildRecord(record = {}) {
  return saveEmbeddingBuildRecordInDb(record)
}

export async function upsertSessionEmbeddings(records = []) {
  return upsertSessionEmbeddingsInDb(records)
}

export async function upsertChunkEmbeddings(records = []) {
  return upsertChunkEmbeddingsInDb(records)
}

export async function saveIndex(index) {
  await saveIndexToDb(index)
  if (await isJsonSnapshotEnabled()) {
    await writeJson(files.index, index)
  }
}

export async function mergeIndex(index) {
  await mergeIndexToDb(index)
  if (await isJsonSnapshotEnabled()) {
    const current = await loadIndexFromDb()
    await writeJson(files.index, current)
  }
}

export async function deleteSessionById(sessionId) {
  const result = await deleteSessionByIdFromDb(sessionId)
  if (result.removed && (await isJsonSnapshotEnabled())) {
    const current = await loadIndexFromDb()
    await writeJson(files.index, current)
  }
  return result
}

export async function updateMessageTags(payload) {
  const result = await updateMessageTagsInDb(payload)
  if (result.updated && (await isJsonSnapshotEnabled())) {
    const current = await loadIndexFromDb()
    await writeJson(files.index, current)
  }
  return result
}

export async function updateSessionReview(payload) {
  const result = await updateSessionReviewInDb(payload)
  if (result.updated && (await isJsonSnapshotEnabled())) {
    const current = await loadIndexFromDb()
    await writeJson(files.index, current)
  }
  return result
}

export async function scanSources(sources, options = {}) {
  const persist = options?.persist !== false
  const sessions = []
  const issues = []

  for (const source of sources) {
    try {
      const files = await walk(source.path, source)
      for (const filePath of files) {
        const parsed = await parseFile(filePath, source)
        sessions.push(...parsed)
      }
    } catch (error) {
      issues.push({ sourceId: source.id, message: String(error) })
    }
  }

  const normalized = sessions
    .map((item) => ({
      ...item,
      searchableText: [
        item.title,
        item.provider,
        item.tags.join(' '),
        ...item.messages.map((m) => `${m.role} ${m.content}`),
      ]
        .join(' ')
        .toLowerCase(),
    }))
    .sort((a, b) => +new Date(b.updatedAt || 0) - +new Date(a.updatedAt || 0))

  const index = {
    updatedAt: new Date().toISOString(),
    sessions: normalized,
    issues,
  }

  if (persist) {
    await saveIndex(index)
  }
  return index
}
