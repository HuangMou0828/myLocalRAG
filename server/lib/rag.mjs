import { askModel } from './ask-model.mjs'

const MAX_QUERY_REWRITE_KEYWORDS = 6
const MAX_QUERY_REWRITE_ALTERNATIVES = 3
const MAX_CITATIONS = 8
const MAX_CONTEXT_RESULTS = 6
const MAX_SNIPPETS_PER_RESULT = 3
const MAX_SNIPPET_CHARS = 220

function normalizeText(input) {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function clipText(input, maxChars = 180) {
  const text = normalizeText(input)
  if (!text) return ''
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 3))}...`
}

function stripCodeFence(text) {
  return String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function extractJsonText(input) {
  const raw = stripCodeFence(String(input || '').trim())
  if (!raw) return ''

  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    return raw
  }

  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fencedMatch?.[1]) return stripCodeFence(fencedMatch[1])

  const firstBrace = raw.indexOf('{')
  const lastBrace = raw.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) return raw.slice(firstBrace, lastBrace + 1)

  const firstBracket = raw.indexOf('[')
  const lastBracket = raw.lastIndexOf(']')
  if (firstBracket >= 0 && lastBracket > firstBracket) return raw.slice(firstBracket, lastBracket + 1)

  return ''
}

function parseJsonLoose(input) {
  const raw = extractJsonText(input)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function normalizeStringList(input, maxItems = 6, maxChars = 80) {
  const list = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[,\n、]/g)
      : []

  const unique = []
  const seen = new Set()
  for (const item of list) {
    const value = clipText(item, maxChars)
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(value)
    if (unique.length >= maxItems) break
  }
  return unique
}

function normalizeCitationList(input, maxRef = MAX_CITATIONS) {
  const values = Array.isArray(input) ? input : []
  const unique = []
  const seen = new Set()

  for (const item of values) {
    const numeric = Number(
      typeof item === 'number'
        ? item
        : item && typeof item === 'object'
          ? item.ref ?? item.index ?? item.citation
          : item,
    )
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > maxRef) continue
    if (seen.has(numeric)) continue
    seen.add(numeric)
    unique.push(numeric)
  }

  return unique
}

function extractCitationRefs(text, maxRef = MAX_CITATIONS) {
  const matches = String(text || '').match(/\[引用\s*(\d+)\]/g) || []
  return normalizeCitationList(
    matches.map((item) => {
      const match = item.match(/(\d+)/)
      return match?.[1] ? Number(match[1]) : 0
    }),
    maxRef,
  )
}

function buildQueryRewriteMessages({ query, provider = '', timeRange = null } = {}) {
  const constraints = [
    '你是一个 RAG 检索查询优化器，只能输出 JSON。',
    '目标是把用户原问题改写成更适合向量检索和关键词检索的查询。',
    '不要回答问题本身，不要扩写成长段说明。',
    'searchQuery 保持紧凑，适合直接发给检索引擎。',
    'keywords 提炼 0-6 个高价值关键词，优先保留文件名、报错词、框架名、函数名。',
    'alternatives 最多给 3 个可选检索表达。',
    '严格输出 JSON：{"searchQuery":"", "keywords":[""], "alternatives":[""], "reason":""}',
  ]

  const contextLines = [
    `原始问题: ${query}`,
    provider ? `限定 provider: ${provider}` : '',
    timeRange?.from || timeRange?.to
      ? `时间范围: ${normalizeText(timeRange?.from)} ~ ${normalizeText(timeRange?.to)}`
      : '',
  ].filter(Boolean)

  return [
    {
      role: 'system',
      content: constraints.join('\n'),
    },
    {
      role: 'user',
      content: contextLines.join('\n'),
    },
  ]
}

function buildAnswerMessages({ query, retrievalQuery = '', results = [] } = {}) {
  const refs = results
    .slice(0, MAX_CONTEXT_RESULTS)
    .map((item, index) => {
      const snippets = (Array.isArray(item?.snippets) ? item.snippets : [])
        .map((snippet) => clipText(snippet, MAX_SNIPPET_CHARS))
        .filter(Boolean)
        .slice(0, MAX_SNIPPETS_PER_RESULT)

      return [
        `[引用 ${index + 1}]`,
        `sessionId: ${normalizeText(item?.sessionId || '')}`,
        `title: ${normalizeText(item?.title || '')}`,
        `provider: ${normalizeText(item?.provider || '')}`,
        `matchedAt: ${normalizeText(item?.matched_at || '')}`,
        snippets.length ? `snippets:\n- ${snippets.join('\n- ')}` : 'snippets: 无',
      ].join('\n')
    })
    .join('\n\n')

  const rules = [
    '你是一个严格基于检索证据作答的 RAG 助手，只能根据引用内容回答。',
    '如果证据不足，必须明确说证据不足，不能编造。',
    '回答使用简洁中文，优先给结论，再给必要说明。',
    '引用格式必须使用 [引用1] 这种形式，可在一句话后附多个引用。',
    '严格输出 JSON：{"answer":"", "citations":[1], "grounded":true, "insufficient":false}',
  ]

  const prompt = [
    `用户问题: ${query}`,
    retrievalQuery ? `检索查询: ${retrievalQuery}` : '',
    '可用证据如下：',
    refs || '无',
  ].filter(Boolean).join('\n\n')

  return [
    { role: 'system', content: rules.join('\n') },
    { role: 'user', content: prompt },
  ]
}

export async function rewriteRetrieveQuery({ query, provider = '', timeRange = null, assistantConfig = {} } = {}) {
  const originalQuery = normalizeText(query)
  if (!originalQuery) {
    return {
      applied: false,
      originalQuery: '',
      searchQuery: '',
      retrievalQuery: '',
      keywords: [],
      alternatives: [],
      reason: '',
      model: '',
      finishReason: '',
      usage: null,
    }
  }

  const result = await askModel({
    messages: buildQueryRewriteMessages({ query: originalQuery, provider, timeRange }),
    model: assistantConfig.model || '',
    apiBase: assistantConfig.apiBase || '',
    apiKey: assistantConfig.apiKey || '',
    timeoutMs: assistantConfig.timeoutMs,
    temperature: 0,
    topP: 1,
    maxTokens: 400,
  })

  const parsed = parseJsonLoose(result.answer) || {}
  const searchQuery = normalizeText(parsed.searchQuery || parsed.retrievalQuery || originalQuery)
  const keywords = normalizeStringList(parsed.keywords, MAX_QUERY_REWRITE_KEYWORDS, 60)
  const alternatives = normalizeStringList(parsed.alternatives || parsed.queries, MAX_QUERY_REWRITE_ALTERNATIVES, 80)
  const retrievalQuery = normalizeText([searchQuery, ...keywords].filter(Boolean).join(' ')) || originalQuery

  return {
    applied: retrievalQuery !== originalQuery,
    originalQuery,
    searchQuery,
    retrievalQuery,
    keywords,
    alternatives,
    reason: clipText(parsed.reason || parsed.intent || ''),
    model: String(result.model || assistantConfig.model || ''),
    finishReason: String(result.finishReason || ''),
    usage: result.usage || null,
  }
}

export async function generateGroundedAnswer({ query, retrievalQuery = '', results = [], assistantConfig = {} } = {}) {
  const normalizedQuery = normalizeText(query)
  const list = Array.isArray(results) ? results.filter(Boolean) : []

  if (!normalizedQuery) {
    return {
      status: 'skipped',
      text: '',
      citations: [],
      grounded: false,
      insufficient: true,
      model: '',
      finishReason: '',
      usage: null,
    }
  }

  if (!list.length) {
    return {
      status: 'no_results',
      text: '当前没有检索到足够相关的历史记忆，暂时无法基于证据回答。',
      citations: [],
      grounded: false,
      insufficient: true,
      model: '',
      finishReason: '',
      usage: null,
    }
  }

  const result = await askModel({
    messages: buildAnswerMessages({
      query: normalizedQuery,
      retrievalQuery,
      results: list,
    }),
    model: assistantConfig.model || '',
    apiBase: assistantConfig.apiBase || '',
    apiKey: assistantConfig.apiKey || '',
    timeoutMs: assistantConfig.timeoutMs,
    temperature: 0.1,
    topP: 1,
    maxTokens: Math.min(assistantConfig.maxTokens || 1200, 1600) || 1200,
  })

  const parsed = parseJsonLoose(result.answer) || {}
  const answerText = normalizeText(parsed.answer || parsed.response || result.answer)
  const citations = normalizeCitationList(
    Array.isArray(parsed.citations) ? parsed.citations : extractCitationRefs(answerText),
    Math.min(MAX_CITATIONS, list.length),
  )

  return {
    status: answerText ? 'generated' : 'empty',
    text: answerText,
    citations,
    grounded: parsed.grounded !== false && citations.length > 0,
    insufficient: Boolean(parsed.insufficient) || (!citations.length && /证据不足|无法根据|没有检索到/.test(answerText)),
    model: String(result.model || assistantConfig.model || ''),
    finishReason: String(result.finishReason || ''),
    usage: result.usage || null,
  }
}
