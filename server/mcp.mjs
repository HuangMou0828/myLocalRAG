import path from 'node:path'
import { existsSync } from 'node:fs'
import { loadLocalEnv } from './lib/load-env.mjs'
import {
  deleteSessionById,
  loadIndex,
  loadSources,
  mergeIndex,
  querySessions,
  retrieveCandidates,
  saveSources,
  scanSources,
  updateMessageTags,
} from './lib/scanner.mjs'
import { discoverSourceSuggestions } from './lib/discovery.mjs'
import { dataDir, files } from './lib/storage.mjs'
import { getPromptRubric, scorePrompt, scorePrompts } from './lib/prompt-scorer.mjs'
import { optimizePrompt } from './lib/prompt-optimizer.mjs'

loadLocalEnv()

const DEFAULT_RETRIEVE_TOP_K = 8
const MAX_RETRIEVE_TOP_K = 30

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'that',
  'with',
  'this',
  'from',
  'have',
  'you',
  'your',
  'are',
  'was',
  'were',
  'what',
  'when',
  'how',
  'why',
  'can',
  'could',
  'will',
  'would',
  'should',
  'then',
  'than',
  'into',
  'about',
  'please',
  'just',
  '我',
  '你',
  '他',
  '她',
  '它',
  '我们',
  '你们',
  '他们',
  '然后',
  '这个',
  '那个',
  '一个',
  '一些',
  '一下',
  '可以',
  '需要',
  '就是',
  '没有',
  '不是',
  '怎么',
  '什么',
  '为什么',
  '如果',
  '还是',
  '进行',
  '已经',
  '以及',
  '因为',
  '所以',
  '但是',
  '并且',
  '或者',
  '使用',
  '时候',
  '问题',
  '一下子',
])

function normalizeString(input) {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildMissingSyncSession(session) {
  const meta = session?.meta && typeof session.meta === 'object' ? session.meta : {}
  const sync = meta.sync && typeof meta.sync === 'object' ? meta.sync : {}
  return {
    ...session,
    meta: {
      ...meta,
      sync: {
        ...sync,
        syncStatus: 'missing',
      },
    },
  }
}

function mergeSyncedSessions(currentSessions = [], scannedSessions = [], { provider = '' } = {}) {
  const normalizedProvider = normalizeString(provider).toLowerCase()
  const next = new Map()
  const scannedIdSet = new Set(
    (Array.isArray(scannedSessions) ? scannedSessions : []).map((item) => String(item?.id || '')).filter(Boolean),
  )

  for (const session of Array.isArray(currentSessions) ? currentSessions : []) {
    const sessionId = String(session?.id || '').trim()
    if (!sessionId) continue
    const sameProvider = normalizedProvider
      ? String(session?.provider || '').toLowerCase() === normalizedProvider
      : true

    if (sameProvider && !scannedIdSet.has(sessionId)) next.set(sessionId, buildMissingSyncSession(session))
    else next.set(sessionId, session)
  }

  for (const session of Array.isArray(scannedSessions) ? scannedSessions : []) {
    const sessionId = String(session?.id || '').trim()
    if (!sessionId) continue
    next.set(sessionId, session)
  }

  return Array.from(next.values()).sort((a, b) => +new Date(b.updatedAt || 0) - +new Date(a.updatedAt || 0))
}

function tokenize(input) {
  return normalizeString(input)
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .slice(0, 24)
}

function toTimestamp(input) {
  const value = Date.parse(String(input || ''))
  return Number.isNaN(value) ? 0 : value
}

function inTimeRange(session, range) {
  if (!range || typeof range !== 'object') return true
  const ts = toTimestamp(session?.updatedAt)
  if (!ts) return true
  const from = toTimestamp(range.from)
  const to = toTimestamp(range.to)
  if (from && ts < from) return false
  if (to && ts > to) return false
  return true
}

function snippetByToken(text, token, radius = 80) {
  const plain = normalizeString(text)
  if (!plain) return ''
  const lower = plain.toLowerCase()
  const idx = lower.indexOf(token.toLowerCase())
  if (idx < 0) return ''
  const start = Math.max(0, idx - radius)
  const end = Math.min(plain.length, idx + token.length + radius)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < plain.length ? '...' : ''
  return `${prefix}${plain.slice(start, end)}${suffix}`.trim()
}

function pickSnippets(session, tokens, maxSnippets = 3) {
  const snippets = []
  const messages = Array.isArray(session?.messages) ? session.messages : []
  const tokenList = tokens.length ? tokens : tokenize(session?.title).slice(0, 2)

  for (const msg of messages) {
    if (!msg?.content) continue
    for (const token of tokenList) {
      const snippet = snippetByToken(msg.content, token)
      if (!snippet) continue
      if (!snippets.includes(snippet)) snippets.push(snippet)
      if (snippets.length >= maxSnippets) return snippets
    }
  }

  if (!snippets.length && messages[0]?.content) {
    const fallback = normalizeString(messages[0].content).slice(0, 180)
    if (fallback) snippets.push(fallback)
  }

  return snippets
}

function scoreSession(session, query, tokens) {
  const q = normalizeString(query).toLowerCase()
  const title = normalizeString(session?.title).toLowerCase()
  const searchable = normalizeString(session?.searchableText).toLowerCase()
  const messages = Array.isArray(session?.messages) ? session.messages : []

  let score = 0
  if (!q) {
    score += toTimestamp(session?.updatedAt) / 1e12
    return score
  }

  if (title.includes(q)) score += 8
  if (searchable.includes(q)) score += 5

  for (const token of tokens) {
    if (title.includes(token)) score += 2.4
    if (searchable.includes(token)) score += 1.2
  }

  for (const msg of messages.slice(0, 20)) {
    const body = normalizeString(msg?.content).toLowerCase()
    if (!body) continue
    for (const token of tokens) {
      if (body.includes(token)) score += 0.7
    }
  }

  score += toTimestamp(session?.updatedAt) / 1e13
  return score
}

function collectTopTerms(sessions, limit = 20) {
  const freq = new Map()

  for (const session of sessions) {
    const messages = Array.isArray(session?.messages) ? session.messages : []
    for (const msg of messages) {
      if (String(msg?.role || '').toLowerCase() !== 'user') continue
      for (const token of tokenize(msg?.content)) {
        freq.set(token, (freq.get(token) || 0) + 1)
      }
    }
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }))
}

function collectRepeatedPrompts(sessions, limit = 12) {
  const freq = new Map()

  for (const session of sessions) {
    const messages = Array.isArray(session?.messages) ? session.messages : []
    for (const msg of messages) {
      if (String(msg?.role || '').toLowerCase() !== 'user') continue
      const normalized = normalizeString(msg?.content).toLowerCase().slice(0, 140)
      if (!normalized || normalized.length < 12) continue
      freq.set(normalized, (freq.get(normalized) || 0) + 1)
    }
  }

  return Array.from(freq.entries())
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([prompt, count]) => ({ prompt, count }))
}

function id(prefix = 'src') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function validateSource(input) {
  if (!input?.name || !input?.provider || !input?.path) return 'name/provider/path 必填'
  const full = path.resolve(input.path)
  if (!existsSync(full)) return `路径不存在: ${full}`
  return null
}

async function ensureProviderSources(provider, existingSources = []) {
  const normalizedProvider = normalizeString(provider || '').toLowerCase()
  const currentSources = Array.isArray(existingSources) ? existingSources : []
  if (!normalizedProvider || normalizedProvider === 'all') return currentSources

  const hasProvider = currentSources.some(
    (source) => String(source?.provider || '').toLowerCase() === normalizedProvider,
  )
  if (hasProvider) return currentSources

  const suggestions = await discoverSourceSuggestions(currentSources)
  const matchedSuggestions = (Array.isArray(suggestions) ? suggestions : []).filter(
    (item) => String(item?.provider || '').toLowerCase() === normalizedProvider,
  )
  if (!matchedSuggestions.length) return currentSources

  const seenPaths = new Set(
    currentSources
      .map((item) => path.resolve(String(item?.path || '').trim()))
      .filter(Boolean),
  )
  const createdAt = new Date().toISOString()
  const additions = []

  for (const item of matchedSuggestions) {
    const resolvedPath = path.resolve(String(item?.path || '').trim())
    if (!resolvedPath || seenPaths.has(resolvedPath)) continue
    seenPaths.add(resolvedPath)
    additions.push({
      id: id(),
      name: String(item?.name || `${normalizedProvider} auto source`),
      provider: normalizedProvider,
      path: resolvedPath,
      format: String(item?.format || 'auto'),
      createdAt,
    })
  }

  if (!additions.length) return currentSources

  const merged = [...currentSources, ...additions]
  await saveSources(merged)
  return merged
}

function toolResult(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  }
}

function toMcpError(message, code = -32000) {
  const err = new Error(String(message || 'Unknown error'))
  err.code = code
  return err
}

const tools = [
  {
    name: 'workspace_info',
    description: '获取当前知识库工作目录和核心文件位置。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({ workspace: dataDir, files }),
  },
  {
    name: 'list_sources',
    description: '列出当前已配置的数据源。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({ sources: await loadSources() }),
  },
  {
    name: 'discover_sources',
    description: '自动发现默认目录下可接入的数据源候选。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const sources = await loadSources()
      return { suggestions: await discoverSourceSuggestions(sources) }
    },
  },
  {
    name: 'add_source',
    description: '新增一个本地数据源配置。',
    inputSchema: {
      type: 'object',
      required: ['name', 'provider', 'path'],
      properties: {
        name: { type: 'string' },
        provider: { type: 'string' },
        path: { type: 'string' },
        format: { type: 'string', default: 'auto' },
      },
    },
    handler: async (input) => {
      const err = validateSource(input || {})
      if (err) throw toMcpError(err, -32602)
      const sources = await loadSources()
      const next = {
        id: id(),
        name: input.name,
        provider: input.provider,
        path: path.resolve(input.path),
        format: input.format || 'auto',
        createdAt: new Date().toISOString(),
      }
      sources.push(next)
      await saveSources(sources)
      return { source: next }
    },
  },
  {
    name: 'scan_sources',
    description: '扫描全部已配置数据源并重建索引。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const sources = await loadSources()
      const previous = await loadIndex()
      const scanned = await scanSources(sources, { persist: false })
      const index = {
        updatedAt: new Date().toISOString(),
        sessions: mergeSyncedSessions(previous.sessions || [], scanned.sessions || []),
        issues: Array.isArray(scanned.issues) ? scanned.issues : [],
      }
      await mergeIndex(index)
      return index
    },
  },
  {
    name: 'scan_provider',
    description: '按 provider 扫描并刷新该来源的数据。',
    inputSchema: {
      type: 'object',
      required: ['provider'],
      properties: {
        provider: { type: 'string' },
      },
    },
    handler: async (input) => {
      const provider = normalizeString(input?.provider || '').toLowerCase()
      if (!provider || provider === 'all') throw toMcpError('provider 必填，且不能为 all', -32602)

      const sources = await ensureProviderSources(provider, await loadSources())
      const targetSources = (Array.isArray(sources) ? sources : []).filter(
        (source) => String(source?.provider || '').toLowerCase() === provider,
      )
      if (!targetSources.length) throw toMcpError(`未找到 provider=${provider} 的数据源配置`, -32004)

      const previous = await loadIndex()
      const scanned = await scanSources(targetSources, { persist: false })

      const oldSessions = Array.isArray(previous.sessions) ? previous.sessions : []
      const oldProviderSessions = oldSessions.filter((s) => String(s?.provider || '').toLowerCase() === provider)
      const scannedSessions = Array.isArray(scanned.sessions) ? scanned.sessions : []
      const preservedExisting = oldProviderSessions.length > 0 && scannedSessions.length === 0
      const nextSessions = preservedExisting
        ? [...oldSessions]
        : mergeSyncedSessions(oldSessions, scannedSessions, { provider })

      const targetSourceIds = new Set(targetSources.map((source) => String(source.id || '')).filter(Boolean))
      const oldIssues = Array.isArray(previous.issues) ? previous.issues : []
      const keptIssues = oldIssues.filter((issue) => !targetSourceIds.has(String(issue?.sourceId || '')))
      const scannedIssues = Array.isArray(scanned.issues) ? scanned.issues : []

      const index = {
        updatedAt: new Date().toISOString(),
        sessions: nextSessions,
        issues: [...keptIssues, ...scannedIssues],
      }
      await mergeIndex(index)

      return {
        provider,
        scannedSources: targetSources.length,
        refreshed: scannedSessions.length,
        preservedExisting,
        total: nextSessions.length,
        issues: scannedIssues,
        updatedAt: index.updatedAt,
      }
    },
  },
  {
    name: 'list_sessions',
    description: '按条件查询会话列表。',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        provider: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 200 },
      },
    },
    handler: async (input) => {
      const index = await querySessions({
        q: normalizeString(input?.q || '').toLowerCase(),
        provider: normalizeString(input?.provider || '').toLowerCase(),
        from: normalizeString(input?.from || ''),
        to: normalizeString(input?.to || ''),
      })
      const limit = Math.max(1, Math.min(200, Number(input?.limit || 60)))
      const sessions = (Array.isArray(index.sessions) ? index.sessions : [])
        .slice(0, limit)
        .map(({ searchableText, ...rest }) => rest)
      return {
        updatedAt: index.updatedAt,
        total: sessions.length,
        issues: index.issues || [],
        sessions,
      }
    },
  },
  {
    name: 'delete_session',
    description: '删除指定会话。',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    },
    handler: async (input) => {
      const sessionId = normalizeString(input?.id || '')
      if (!sessionId) throw toMcpError('id 必填', -32602)
      const { removed } = await deleteSessionById(sessionId)
      const index = await loadIndex()
      return {
        removed,
        total: Array.isArray(index.sessions) ? index.sessions.length : 0,
        updatedAt: index.updatedAt || null,
      }
    },
  },
  {
    name: 'tag_messages',
    description: '为某会话中的指定消息打标签。',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'messageIds'],
      properties: {
        sessionId: { type: 'string' },
        messageIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
    handler: async (input) => {
      const sessionId = normalizeString(input?.sessionId || '')
      const messageIds = Array.isArray(input?.messageIds)
        ? input.messageIds.map((id) => normalizeString(id)).filter(Boolean)
        : []
      const tags = Array.isArray(input?.tags) ? input.tags.map((tag) => normalizeString(tag)).filter(Boolean) : []

      if (!sessionId) throw toMcpError('sessionId 必填', -32602)
      if (!messageIds.length) throw toMcpError('messageIds 必填', -32602)

      return updateMessageTags({ sessionId, messageIds, tags })
    },
  },
  {
    name: 'retrieve_history',
    description: '检索历史会话片段（RAG 入口）。',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        topK: { type: 'number', minimum: 1, maximum: 30 },
        provider: { type: 'string' },
        includeMessages: { type: 'boolean', default: false },
        timeRange: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
          },
        },
      },
    },
    handler: async (input) => {
      const query = normalizeString(input?.query || '')
      if (!query) throw toMcpError('query 必填', -32602)

      const provider = normalizeString(input?.provider || '').toLowerCase()
      const topK = Math.min(MAX_RETRIEVE_TOP_K, Math.max(1, Number(input?.topK || DEFAULT_RETRIEVE_TOP_K)))
      const candidateLimit = Math.max(topK * 8, 80)
      const includeMessages = Boolean(input?.includeMessages)
      const timeRange = input?.timeRange && typeof input.timeRange === 'object' ? input.timeRange : null

      const index = await retrieveCandidates({
        query,
        provider,
        from: timeRange?.from || '',
        to: timeRange?.to || '',
        limit: candidateLimit,
      })
      const sessions = Array.isArray(index.sessions) ? index.sessions : []
      const tokens = tokenize(query)

      const ranked = sessions
        .filter((session) => session && typeof session === 'object')
        .filter((session) => !provider || String(session.provider || '').toLowerCase() === provider)
        .filter((session) => inTimeRange(session, timeRange))
        .map((session) => ({
          ...session,
          score: scoreSession(session, query, tokens),
        }))
        .filter((session) => session.score > 0 || !query)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map((session) => {
          const messages = Array.isArray(session.messages) ? session.messages : []
          const lastMessage = messages[messages.length - 1] || null
          return {
            sessionId: session.id,
            title: session.title,
            provider: session.provider,
            updatedAt: session.updatedAt,
            score: Number(session.score.toFixed(4)),
            sourceFile: session.meta?.sourceFile || null,
            sourceUrl: session.meta?.url || null,
            tags: Array.isArray(session.tags) ? session.tags : [],
            snippets: pickSnippets(session, tokens, 3),
            lastMessage: lastMessage
              ? {
                  role: lastMessage.role,
                  createdAt: lastMessage.createdAt || null,
                  content: normalizeString(lastMessage.content).slice(0, 260),
                }
              : null,
            messages: includeMessages
              ? messages.map((msg) => ({
                  id: msg.id,
                  role: msg.role,
                  createdAt: msg.createdAt || null,
                  content: msg.content,
                }))
              : undefined,
          }
        })

      return {
        query,
        topK,
        totalMatched: ranked.length,
        updatedAt: index.updatedAt || null,
        results: ranked,
      }
    },
  },
  {
    name: 'review_history',
    description: '输出近期 AI 使用复盘与技能沉淀候选。',
    inputSchema: {
      type: 'object',
      properties: {
        recentDays: { type: 'number', minimum: 1, default: 30 },
        provider: { type: 'string' },
        minRepeatedPrompt: { type: 'number', minimum: 2, default: 2 },
      },
    },
    handler: async (input) => {
      const provider = normalizeString(input?.provider || '').toLowerCase()
      const recentDays = Math.max(1, Number(input?.recentDays || 30))
      const minRepeatedPrompt = Math.max(2, Number(input?.minRepeatedPrompt || 2))
      const sinceTs = Date.now() - recentDays * 24 * 60 * 60 * 1000

      const index = await loadIndex()
      const allSessions = Array.isArray(index.sessions) ? index.sessions : []
      const sessions = allSessions
        .filter((s) => s && typeof s === 'object')
        .filter((s) => !provider || String(s.provider || '').toLowerCase() === provider)
        .filter((s) => {
          const ts = toTimestamp(s.updatedAt)
          return !ts || ts >= sinceTs
        })

      const providerStats = {}
      const roleStats = {}
      let totalMessages = 0

      for (const session of sessions) {
        const p = String(session.provider || 'unknown').toLowerCase()
        providerStats[p] = (providerStats[p] || 0) + 1

        const messages = Array.isArray(session.messages) ? session.messages : []
        totalMessages += messages.length
        for (const msg of messages) {
          const role = String(msg.role || 'unknown').toLowerCase()
          roleStats[role] = (roleStats[role] || 0) + 1
        }
      }

      const avgMessagesPerSession = sessions.length ? totalMessages / sessions.length : 0
      const repeatedPrompts = collectRepeatedPrompts(sessions)
        .filter((item) => item.count >= minRepeatedPrompt)
        .slice(0, 8)

      const skillCandidates = repeatedPrompts.map((item, indexNo) => ({
        id: `skill_candidate_${indexNo + 1}`,
        triggerHint: item.prompt.slice(0, 80),
        evidenceCount: item.count,
        recommendation: '将该重复任务沉淀为固定流程模板（输入约束 + 输出格式 + 校验步骤）。',
      }))

      return {
        generatedAt: new Date().toISOString(),
        range: {
          recentDays,
          provider: provider || 'all',
        },
        summary: {
          sessionCount: sessions.length,
          messageCount: totalMessages,
          avgMessagesPerSession: Number(avgMessagesPerSession.toFixed(2)),
        },
        providerStats,
        roleStats,
        topTerms: collectTopTerms(sessions, 20),
        repeatedPrompts,
        skillCandidates,
      }
    },
  },
  {
    name: 'get_prompt_rubric',
    description: '获取 Prompt 规则评分 Rubric。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({ rubric: getPromptRubric() }),
  },
  {
    name: 'score_prompt',
    description: '对单条 Prompt 做规则评分（支持上下文修正）。',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
        promptId: { type: 'string' },
        contextMessages: { type: 'array', items: { type: 'string' } },
      },
    },
    handler: async (input) => {
      const promptText = normalizeString(input?.prompt || '')
      if (!promptText) throw toMcpError('prompt 必填', -32602)
      return scorePrompt(promptText, {
        promptId: input?.promptId || '',
        contextMessages: Array.isArray(input?.contextMessages) ? input.contextMessages : [],
      })
    },
  },
  {
    name: 'score_prompt_batch',
    description: '对多条 Prompt 批量评分。',
    inputSchema: {
      type: 'object',
      required: ['prompts'],
      properties: {
        prompts: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'object' }] }, minItems: 1 },
      },
    },
    handler: async (input) => {
      const prompts = Array.isArray(input?.prompts) ? input.prompts : []
      if (!prompts.length) throw toMcpError('prompts 必填且不能为空数组', -32602)
      const results = scorePrompts(prompts)
      return {
        total: results.length,
        results,
      }
    },
  },
  {
    name: 'optimize_prompt',
    description: '优化 Prompt（优先 DSPy，不可用时自动降级）。',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
        promptId: { type: 'string' },
        taskType: { type: 'string' },
        model: { type: 'string' },
        language: { type: 'string' },
        forceRegenerate: { type: 'boolean' },
        timeoutMs: { type: 'number' },
        contextMessages: { type: 'array', items: { type: 'string' } },
        constraints: { type: 'array', items: { type: 'string' } },
      },
    },
    handler: async (input) => {
      const promptText = normalizeString(input?.prompt || '')
      if (!promptText) throw toMcpError('prompt 必填', -32602)
      return optimizePrompt({
        prompt: promptText,
        promptId: input?.promptId || '',
        taskType: input?.taskType || '',
        model: input?.model || '',
        language: input?.language || '',
        forceRegenerate: Boolean(input?.forceRegenerate),
        timeoutMs: Number(input?.timeoutMs || 0),
        contextMessages: Array.isArray(input?.contextMessages) ? input.contextMessages : [],
        constraints: Array.isArray(input?.constraints) ? input.constraints : input?.constraints || [],
      })
    },
  },
]

const toolMap = new Map(tools.map((tool) => [tool.name, tool]))

function writeMessage(message) {
  const json = JSON.stringify(message)
  const body = Buffer.from(json, 'utf8')
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii')
  process.stdout.write(Buffer.concat([header, body]))
}

function sendResponse(id, result) {
  writeMessage({ jsonrpc: '2.0', id, result })
}

function sendError(id, code, message, data) {
  writeMessage({
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data ? { data } : {}),
    },
  })
}

async function handleRequest(msg) {
  const id = Object.prototype.hasOwnProperty.call(msg, 'id') ? msg.id : null
  const method = msg?.method

  try {
    if (method === 'initialize') {
      return sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'multi-ai-session-hub',
          version: '0.1.0',
        },
      })
    }

    if (method === 'ping') {
      return sendResponse(id, {})
    }

    if (method === 'notifications/initialized') {
      return
    }

    if (method === 'tools/list') {
      return sendResponse(id, {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      })
    }

    if (method === 'tools/call') {
      const name = msg?.params?.name
      const args = msg?.params?.arguments || {}
      if (!name || typeof name !== 'string') {
        throw toMcpError('tools/call 缺少 name', -32602)
      }
      const tool = toolMap.get(name)
      if (!tool) {
        throw toMcpError(`未知工具: ${name}`, -32601)
      }
      const data = await tool.handler(args)
      return sendResponse(id, toolResult(data))
    }

    return sendError(id, -32601, `Method not found: ${method}`)
  } catch (error) {
    const code = Number(error?.code || -32000)
    const message = String(error?.message || error || 'Internal error')
    return sendError(id, code, message)
  }
}

let rawBuffer = Buffer.alloc(0)

function tryReadMessage() {
  while (true) {
    const headerEnd = rawBuffer.indexOf('\r\n\r\n')
    if (headerEnd < 0) return

    const headerText = rawBuffer.slice(0, headerEnd).toString('utf8')
    const match = headerText.match(/Content-Length:\s*(\d+)/i)
    if (!match) {
      rawBuffer = Buffer.alloc(0)
      return
    }

    const contentLength = Number(match[1])
    const bodyStart = headerEnd + 4
    const bodyEnd = bodyStart + contentLength
    if (rawBuffer.length < bodyEnd) return

    const body = rawBuffer.slice(bodyStart, bodyEnd).toString('utf8')
    rawBuffer = rawBuffer.slice(bodyEnd)

    let msg = null
    try {
      msg = JSON.parse(body)
    } catch {
      continue
    }

    Promise.resolve(handleRequest(msg)).catch((error) => {
      const id = Object.prototype.hasOwnProperty.call(msg || {}, 'id') ? msg.id : null
      sendError(id, -32000, String(error?.message || error || 'Unhandled error'))
    })
  }
}

process.stdin.on('data', (chunk) => {
  rawBuffer = Buffer.concat([rawBuffer, chunk])
  tryReadMessage()
})

process.stdin.on('error', (error) => {
  console.error('[mcp] stdin error:', error)
})

process.on('uncaughtException', (error) => {
  console.error('[mcp] uncaughtException:', error)
})

process.on('unhandledRejection', (error) => {
  console.error('[mcp] unhandledRejection:', error)
})
