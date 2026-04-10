const LOCAL_VECTOR_DIMS = 256
const MAX_INPUT_CHARS = 6000
const MAX_CHUNK_INPUT_CHARS = 2200
const MAX_SUMMARY_CHARS = 140
const MAX_META_ITEMS = 12

function getEmbeddingConfig(overrides = {}) {
  return {
    model: String(overrides.model || process.env.KB_EMBEDDING_MODEL || process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small').trim(),
    base: String(overrides.apiBase || overrides.base || process.env.KB_EMBEDDING_API_BASE || process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').trim(),
    apiKey: String(overrides.apiKey || process.env.KB_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || '').trim(),
    timeoutMs: Math.max(3000, Number(overrides.timeoutMs || process.env.KB_EMBEDDING_TIMEOUT_MS || 20000)),
    maxBatch: Math.max(1, Number(overrides.maxBatch || process.env.KB_EMBEDDING_MAX_BATCH || 5)),
    dimensions: Math.max(0, Number(overrides.dimensions || process.env.KB_EMBEDDING_DIMENSIONS || 0)),
  }
}

function normalizeText(input) {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncateText(input, maxChars = MAX_INPUT_CHARS) {
  const text = normalizeText(input)
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars)
}

function dotProduct(a, b) {
  let sum = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 1) sum += a[i] * b[i]
  return sum
}

function vectorNorm(a) {
  return Math.sqrt(dotProduct(a, a))
}

function normalizeVector(vector) {
  if (!Array.isArray(vector)) return []
  const nums = vector.map((v) => Number(v) || 0)
  const norm = vectorNorm(nums)
  if (!norm) return nums
  return nums.map((v) => v / norm)
}

function stableHash32(input) {
  let h = 2166136261
  const text = String(input || '')
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function trimCodeFence(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, (block) => block.length > 1200 ? `${block.slice(0, 1200)}\n...` : block)
}

function stripTaggedSections(text) {
  let next = String(text || '')
  next = next.replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, ' ')
  next = next.replace(/<turn_aborted>[\s\S]*?<\/turn_aborted>/gi, ' ')
  next = next.replace(/<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/gi, ' ')
  next = next.replace(/<instructions>[\s\S]*?<\/instructions>/gi, ' ')
  next = next.replace(/<user_query>|<\/user_query>/gi, ' ')
  return next
}

function stripAgentNoise(text) {
  return String(text || '')
    .replace(/#\s*AGENTS\.md instructions[^\n]*\n?/gi, ' ')
    .replace(/#\s*agents\.md instructions[^\n]*\n?/gi, ' ')
    .replace(/###?\s*Available skills[\s\S]*$/i, ' ')
    .replace(/the user interrupted the previous turn on purpose\.[\s\S]*$/i, ' ')
}

export function cleanConversationContent(input, options = {}) {
  const role = String(options.role || '').trim().toLowerCase()
  let text = String(input || '').replace(/\r\n?/g, '\n')
  text = stripTaggedSections(text)
  text = stripAgentNoise(text)
  text = trimCodeFence(text)
  text = text
    .replace(/::git-[^\n]+/g, ' ')
    .replace(/::automation-update\{[^\n]+\}/g, ' ')
    .replace(/::code-comment\{[^\n]+\}/g, ' ')
    .replace(/```[\s]*This block is not supported on your current device yet\.?[\s]*```/gi, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (role === 'user' && /^<environment_context>/i.test(String(input || '').trim())) return ''
  if (text.length > MAX_INPUT_CHARS * 2) text = text.slice(0, MAX_INPUT_CHARS * 2)
  return text
}

export function computeContentHash(input) {
  const text = normalizeText(input)
  const hash = stableHash32(text).toString(16).padStart(8, '0')
  return `h${hash}`
}

function collectMatches(input, pattern, maxItems = MAX_META_ITEMS) {
  const text = String(input || '')
  const matched = text.match(pattern) || []
  const unique = []
  const seen = new Set()
  for (const raw of matched) {
    const value = String(raw || '').trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(value)
    if (unique.length >= maxItems) break
  }
  return unique
}

function extractFilePaths(text) {
  return collectMatches(
    text,
    /(?:\/Users\/[^\s"'`()]+|[A-Za-z]:\\[^\s"'`()]+|(?:src|app|server|lib|components|features|pages|routes)\/[^\s"'`()]+\.[A-Za-z0-9]+|\.[/][^\s"'`()]+)/g,
  )
}

function extractErrorKeywords(text) {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const picked = []
  const seen = new Set()
  for (const line of lines) {
    if (!/(error|exception|failed|cannot|undefined|null|not found|warning|trace|stack|bug|timeout)/i.test(line)) continue
    const normalized = line.replace(/\s+/g, ' ').slice(0, 140)
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    picked.push(normalized)
    if (picked.length >= MAX_META_ITEMS) break
  }
  return picked
}

function extractCodeSymbols(text) {
  const raw = collectMatches(
    text,
    /\b(?:[A-Z][A-Za-z0-9_]{2,}|[a-z]+[A-Z][A-Za-z0-9_]+|[A-Za-z_][A-Za-z0-9_]*\(\)|[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)\b/g,
  )
  return raw.map((item) => item.replace(/\(\)$/g, ''))
}

function compactSentence(text, maxChars = MAX_SUMMARY_CHARS) {
  const normalized = normalizeText(text)
  if (!normalized) return ''
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}...`
}

function buildChunkSummary(userText, assistantText, structured) {
  const fileHint = structured.filePaths[0] ? `${structured.filePaths[0]} 相关问题` : ''
  const errorHint = structured.errorKeywords[0] || ''
  const primary = compactSentence(userText || assistantText || fileHint || errorHint, MAX_SUMMARY_CHARS)
  if (primary) return primary
  return compactSentence([fileHint, errorHint].filter(Boolean).join(' · '), MAX_SUMMARY_CHARS) || '对话片段'
}

function splitLongBlock(text, maxChars = MAX_CHUNK_INPUT_CHARS) {
  const normalized = String(text || '').trim()
  if (!normalized) return []
  if (normalized.length <= maxChars) return [normalized]

  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  if (!paragraphs.length) return [normalized.slice(0, maxChars)]

  const chunks = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph
      continue
    }
    if ((current.length + paragraph.length + 2) <= maxChars) {
      current = `${current}\n\n${paragraph}`.trim()
      continue
    }
    chunks.push(current)
    current = paragraph.length <= maxChars ? paragraph : paragraph.slice(0, maxChars)
  }
  if (current) chunks.push(current)

  return chunks.flatMap((item) => {
    if (item.length <= maxChars) return [item]
    const parts = []
    for (let i = 0; i < item.length; i += maxChars) parts.push(item.slice(i, i + maxChars).trim())
    return parts.filter(Boolean)
  })
}

function normalizeChunkRole(role) {
  const value = String(role || '').trim().toLowerCase()
  if (value === 'user' || value === 'assistant' || value === 'system') return value
  return value || 'assistant'
}

function buildConversationTurns(messages) {
  const cleaned = (Array.isArray(messages) ? messages : [])
    .map((msg, index) => ({
      id: String(msg?.id || `msg_${index}`),
      role: normalizeChunkRole(msg?.role),
      content: cleanConversationContent(msg?.content, { role: msg?.role }),
      createdAt: msg?.createdAt || null,
    }))
    .filter((msg) => msg.content)

  if (!cleaned.length) return []

  const turns = []
  let current = null
  for (const msg of cleaned) {
    if (msg.role === 'user') {
      if (!current || current.assistantMessages.length > 0) {
        if (current) turns.push(current)
        current = { userMessages: [msg], assistantMessages: [] }
      } else {
        current.userMessages.push(msg)
      }
      continue
    }

    if (!current) current = { userMessages: [], assistantMessages: [] }
    current.assistantMessages.push(msg)
  }
  if (current) turns.push(current)

  return turns.filter((turn) => turn.userMessages.length || turn.assistantMessages.length)
}

function buildStructuredChunkMeta({ userText, assistantText, contentText, turnIndex, messageCount }) {
  const structuredText = [userText, assistantText, contentText].filter(Boolean).join('\n')
  const filePaths = extractFilePaths(structuredText)
  const errorKeywords = extractErrorKeywords(structuredText)
  const codeSymbols = extractCodeSymbols(structuredText)
  return {
    turnIndex,
    messageCount,
    filePaths,
    errorKeywords,
    codeSymbols,
    userIntent: compactSentence(userText, 180),
    assistantSummary: compactSentence(assistantText, 220),
    hasCodeBlock: /```/.test(structuredText),
  }
}

export function buildSessionChunks(session) {
  const turns = buildConversationTurns(session?.messages)
  const chunks = []
  const seenHashes = new Set()

  turns.forEach((turn, turnIndex) => {
    const userText = turn.userMessages.map((msg) => msg.content).filter(Boolean).join('\n\n').trim()
    const assistantMessages = turn.assistantMessages.map((msg) => msg.content).filter(Boolean)
    const messageUnits = []
    if (userText) messageUnits.push({ role: 'user', parts: splitLongBlock(userText, 900) })
    for (const content of assistantMessages) {
      const parts = splitLongBlock(content, 1400)
      if (parts.length) messageUnits.push({ role: 'assistant', parts })
    }

    if (!messageUnits.length) return

    let current = []
    let currentLength = 0
    const emit = () => {
      const contentText = current.join('\n\n').trim()
      current = []
      currentLength = 0
      if (!contentText) return
      const contentHash = computeContentHash(contentText)
      if (seenHashes.has(contentHash)) return
      seenHashes.add(contentHash)
      const assistantText = assistantMessages.join('\n\n').trim()
      const meta = buildStructuredChunkMeta({
        userText,
        assistantText,
        contentText,
        turnIndex,
        messageCount: turn.userMessages.length + turn.assistantMessages.length,
      })
      const summary = buildChunkSummary(userText, assistantText, meta)
      chunks.push({
        id: `${String(session?.id || 'session')}::chunk:${chunks.length}`,
        sessionId: String(session?.id || ''),
        provider: normalizeText(session?.provider || ''),
        title: normalizeText(session?.title || ''),
        updatedAt: String(session?.updatedAt || ''),
        chunkIndex: chunks.length,
        summary,
        contentText,
        contentHash,
        meta,
      })
    }

    for (const unit of messageUnits) {
      for (const part of unit.parts) {
        const block = `${unit.role}: ${part}`.trim()
        if (!block) continue
        if (current.length && (currentLength + block.length + 2) > MAX_CHUNK_INPUT_CHARS) emit()
        current.push(block)
        currentLength += block.length + 2
      }
    }
    emit()
  })

  return chunks
}

export function buildChunkEmbeddingText(chunk) {
  const meta = chunk?.meta && typeof chunk.meta === 'object' ? chunk.meta : {}
  return truncateText([
    normalizeText(chunk?.title || ''),
    normalizeText(chunk?.provider || ''),
    normalizeText(chunk?.summary || ''),
    normalizeText(meta.userIntent || ''),
    normalizeText(meta.assistantSummary || ''),
    Array.isArray(meta.filePaths) ? meta.filePaths.join(' ') : '',
    Array.isArray(meta.errorKeywords) ? meta.errorKeywords.join(' ') : '',
    Array.isArray(meta.codeSymbols) ? meta.codeSymbols.join(' ') : '',
    normalizeText(chunk?.contentText || ''),
  ].filter(Boolean).join('\n'), MAX_INPUT_CHARS)
}

function localHashEmbedding(text, dims = LOCAL_VECTOR_DIMS) {
  const vector = new Array(dims).fill(0)
  const normalized = normalizeText(text).toLowerCase()
  if (!normalized) return vector

  const grams = normalized.split(/[^\p{L}\p{N}_-]+/u).filter(Boolean)
  for (const token of grams) {
    const hash = stableHash32(token)
    const idx = hash % dims
    const sign = (hash & 1) === 0 ? 1 : -1
    const weight = 1 + Math.min(5, token.length) * 0.1
    vector[idx] += sign * weight
  }

  if (!grams.length) {
    for (let i = 0; i < normalized.length; i += 1) {
      const hash = stableHash32(`${normalized[i]}:${i}`)
      vector[hash % dims] += (hash & 1) === 0 ? 0.5 : -0.5
    }
  }

  return normalizeVector(vector)
}

function remoteEnabled(cfg) {
  return Boolean(cfg.apiKey)
}

async function requestRemoteEmbeddings(texts, cfg) {
  const base = String(cfg.base || '').replace(/\/+$/, '')
  const model = String(cfg.model || '').trim()
  if (!base || !model) throw new Error('Embedding API 配置不完整')
  if (!cfg.apiKey) throw new Error('Embedding API key 缺失')

  const dimensions = Math.max(0, Number(cfg.dimensions || 0))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)

  try {
    const response = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: texts.map((text) => truncateText(text)),
        ...(dimensions ? { dimensions } : {}),
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Embedding API 请求失败(${response.status}): ${body.slice(0, 240)}`)
    }

    const data = await response.json()
    const vectors = Array.isArray(data?.data) ? data.data.map((row) => normalizeVector(row?.embedding || [])) : []
    if (vectors.length !== texts.length) {
      throw new Error(`Embedding API 返回数量异常: expect=${texts.length} got=${vectors.length}`)
    }

    return {
      vectors,
      model: String(data?.model || model),
      source: 'remote',
    }
  } finally {
    clearTimeout(timer)
  }
}

function localEmbeddingBatch(texts) {
  return {
    vectors: texts.map((text) => localHashEmbedding(text)),
    model: 'local-hash-v1',
    source: 'local',
  }
}

function normalizeEmbeddingMode(input) {
  const mode = String(input || '').trim().toLowerCase()
  if (mode === 'local' || mode === 'remote') return mode
  return ''
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0
  if (!a.length || !b.length) return 0
  const v1 = normalizeVector(a)
  const v2 = normalizeVector(b)
  if (!v1.length || !v2.length) return 0
  return dotProduct(v1, v2)
}

export function buildSessionEmbeddingText(session) {
  const title = normalizeText(session?.title || '')
  const provider = normalizeText(session?.provider || '')
  const tags = Array.isArray(session?.tags) ? session.tags.map((tag) => normalizeText(tag)).filter(Boolean) : []
  const messages = Array.isArray(session?.messages) ? session.messages : []

  const messageText = messages
    .slice(0, 24)
    .map((msg) => `${normalizeText(msg?.role || 'assistant')}: ${normalizeText(cleanConversationContent(msg?.content, { role: msg?.role }) || '')}`)
    .filter((line) => line.length > 0)
    .join('\n')

  return truncateText([title, provider, tags.join(' '), messageText].filter(Boolean).join('\n'))
}

export async function embedTexts(texts, options = {}) {
  const inputs = (Array.isArray(texts) ? texts : []).map((text) => truncateText(text))
  const cfg = getEmbeddingConfig(options.config)
  const mode = normalizeEmbeddingMode(options.mode)
  const fallbackOnError = options.fallbackOnError !== false

  if (!inputs.length) {
    if (mode === 'local') {
      return {
        vectors: [],
        model: 'local-hash-v1',
        source: 'local',
        fallback: false,
      }
    }

    return {
      vectors: [],
        model: mode === 'remote'
        ? cfg.model
        : (remoteEnabled(cfg) ? cfg.model : 'local-hash-v1'),
      source: mode === 'remote'
        ? 'remote'
        : (remoteEnabled(cfg) ? 'remote' : 'local'),
      fallback: false,
    }
  }

  if (mode === 'local') {
    const local = localEmbeddingBatch(inputs)
    return { ...local, fallback: false }
  }

  if (mode === 'remote') {
    if (!remoteEnabled(cfg)) {
      const remoteError = 'Embedding API key 缺失（remote 模式不可用）'
      if (!fallbackOnError) {
        return {
          vectors: inputs.map(() => []),
          model: cfg.model,
          source: 'remote',
          fallback: false,
          error: remoteError,
        }
      }
      const local = localEmbeddingBatch(inputs)
      return {
        ...local,
        fallback: true,
        error: remoteError,
      }
    }

    try {
      const vectors = []
      let remoteModel = ''
      for (let i = 0; i < inputs.length; i += cfg.maxBatch) {
        const chunk = inputs.slice(i, i + cfg.maxBatch)
        const remote = await requestRemoteEmbeddings(chunk, cfg)
        remoteModel = remote.model || remoteModel
        vectors.push(...(Array.isArray(remote.vectors) ? remote.vectors : []))
      }
      return {
        vectors,
        model: remoteModel || cfg.model,
        source: 'remote',
        fallback: false,
      }
    } catch (error) {
      if (!fallbackOnError) {
        return {
          vectors: inputs.map(() => []),
          model: cfg.model,
          source: 'remote',
          fallback: false,
          error: String(error),
        }
      }
      const local = localEmbeddingBatch(inputs)
      return {
        ...local,
        fallback: true,
        error: String(error),
      }
    }
  }

  if (!remoteEnabled(cfg)) {
    const local = localEmbeddingBatch(inputs)
    return { ...local, fallback: false }
  }

  try {
    const vectors = []
    let remoteModel = ''
    for (let i = 0; i < inputs.length; i += cfg.maxBatch) {
      const chunk = inputs.slice(i, i + cfg.maxBatch)
      const remote = await requestRemoteEmbeddings(chunk, cfg)
      remoteModel = remote.model || remoteModel
      vectors.push(...(Array.isArray(remote.vectors) ? remote.vectors : []))
    }
    return {
      vectors,
      model: remoteModel || cfg.model,
      source: 'remote',
      fallback: false,
    }
  } catch (error) {
    const local = localEmbeddingBatch(inputs)
    return {
      ...local,
      fallback: true,
      error: String(error),
    }
  }
}

export async function embedText(text, options = {}) {
  const result = await embedTexts([text], options)
  return {
    vector: result.vectors[0] || [],
    model: result.model,
    source: result.source,
    fallback: Boolean(result.fallback),
    error: result.error || null,
  }
}
