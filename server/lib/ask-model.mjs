function normalizeText(input) {
  return String(input || '').trim()
}

function toNumber(input, fallback = 0) {
  const n = Number(input)
  return Number.isFinite(n) ? n : fallback
}

function clampNumber(input, min, max, fallback) {
  const value = toNumber(input, fallback)
  return Math.max(min, Math.min(max, value))
}

function normalizeRole(input) {
  const role = normalizeText(input).toLowerCase()
  if (role === 'system' || role === 'user' || role === 'assistant' || role === 'tool') return role
  return 'user'
}

function normalizeContent(input) {
  if (typeof input === 'string') return normalizeText(input)
  if (Array.isArray(input)) {
    return input
      .map((item) => {
        if (typeof item === 'string') return normalizeText(item)
        if (item && typeof item === 'object') {
          if (typeof item.text === 'string') return normalizeText(item.text)
          if (item.type === 'text' && typeof item.content === 'string') return normalizeText(item.content)
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  if (input && typeof input === 'object' && typeof input.text === 'string') return normalizeText(input.text)
  return ''
}

function normalizeMessages(input) {
  const list = Array.isArray(input) ? input : []
  return list
    .map((item) => {
      const role = normalizeRole(item?.role)
      const content = normalizeContent(item?.content)
      if (!content) return null
      return { role, content }
    })
    .filter(Boolean)
}

function buildApiBaseCandidates(apiBase) {
  const base = normalizeText(apiBase).replace(/\/+$/, '')
  if (!base) return []
  if (base.endsWith('/v1')) return [base]
  return [base, `${base}/v1`]
}

function buildModelCandidates(model) {
  const normalized = normalizeText(model)
  if (!normalized) return []
  if (normalized.includes('/')) return [normalized]
  return [normalized, `openai/${normalized}`]
}

function parseAssistantContent(content) {
  if (typeof content === 'string') return normalizeText(content)
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return normalizeText(item)
        if (item && typeof item === 'object') {
          if (typeof item.text === 'string') return normalizeText(item.text)
          if (item.type === 'text' && typeof item.text === 'string') return normalizeText(item.text)
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  return ''
}

function getAskConfig(overrides = {}) {
  const model = normalizeText(overrides.model)
    || normalizeText(process.env.KB_ASK_MODEL)
    || normalizeText(process.env.DSPY_MODEL)
    || normalizeText(process.env.OPENAI_MODEL)
    || 'gpt-4.1-mini'

  const apiBase = normalizeText(overrides.apiBase)
    || normalizeText(process.env.KB_ASK_API_BASE)
    || normalizeText(process.env.DSPY_API_BASE)
    || normalizeText(process.env.OPENAI_API_BASE)
    || normalizeText(process.env.OPENAI_BASE_URL)
    || 'https://api.openai.com/v1'

  const apiKey = normalizeText(overrides.apiKey)
    || normalizeText(process.env.KB_ASK_API_KEY)
    || normalizeText(process.env.DSPY_API_KEY)
    || normalizeText(process.env.OPENAI_API_KEY)

  return {
    model,
    apiBase,
    apiKey,
    timeoutMs: clampNumber(overrides.timeoutMs || process.env.KB_ASK_TIMEOUT_MS, 3000, 300000, 60000),
    temperature: clampNumber(
      overrides.temperature !== undefined ? overrides.temperature : process.env.KB_ASK_TEMPERATURE,
      0,
      2,
      0.2,
    ),
    topP: clampNumber(overrides.topP !== undefined ? overrides.topP : process.env.KB_ASK_TOP_P, 0, 1, 1),
    maxTokens: Math.max(0, toNumber(overrides.maxTokens || process.env.KB_ASK_MAX_TOKENS, 0)),
  }
}

async function requestCompletion(config, messages) {
  const candidates = buildApiBaseCandidates(config.apiBase)
  const modelCandidates = buildModelCandidates(config.model)
  if (!candidates.length) throw new Error('ASK API base 未配置')
  if (!config.apiKey) throw new Error('ASK API key 缺失')
  if (!modelCandidates.length) throw new Error('ASK model 未配置')

  let lastError = 'unknown error'
  const attempts = []
  for (const base of candidates) {
    for (const modelName of modelCandidates) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      const payload = {
        model: modelName,
        messages,
        temperature: config.temperature,
        top_p: config.topP,
        stream: false,
      }
      if (config.maxTokens > 0) payload.max_tokens = config.maxTokens

      const response = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      const raw = await response.text()
      if (!response.ok) {
        attempts.push({
          base,
          model: modelName,
          status: response.status,
          detail: raw.slice(0, 260),
        })
        lastError = `base=${base} status=${response.status} body=${raw.slice(0, 260)}`
        continue
      }

      let data = {}
      try {
        data = raw ? JSON.parse(raw) : {}
      } catch {
        attempts.push({
          base,
          model: modelName,
          status: response.status,
          detail: `返回非 JSON: ${raw.slice(0, 260)}`,
        })
        lastError = `base=${base} 返回非 JSON: ${raw.slice(0, 260)}`
        continue
      }

      const choice = Array.isArray(data?.choices) ? data.choices[0] : null
      const answer = parseAssistantContent(choice?.message?.content)
      if (!answer) {
        attempts.push({
          base,
          model: modelName,
          status: response.status,
          detail: '返回结果缺少文本内容',
        })
        lastError = `base=${base} 返回结果缺少文本内容`
        continue
      }

      return {
        answer,
        id: String(data?.id || ''),
        model: String(data?.model || modelName),
        finishReason: String(choice?.finish_reason || ''),
        usage: data?.usage || null,
        source: 'remote',
        apiBase: base,
      }
    } catch (error) {
      attempts.push({
        base,
        model: modelName,
        status: 0,
        detail: String(error),
      })
      lastError = `base=${base} model=${modelName} error=${String(error)}`
    } finally {
      clearTimeout(timer)
    }
  }
  }

  const summary = attempts.length
    ? attempts.map((item) => `[${item.model}] ${item.status || 'ERR'} ${item.detail}`).join(' | ')
    : lastError
  const error = new Error(`ASK 请求失败：${summary}`)
  error.attempts = attempts
  throw error
}

export async function askModel(payload = {}) {
  const query = normalizeText(payload.query || payload.prompt || payload.input || '')
  const systemPrompt = normalizeText(payload.systemPrompt || payload.system || '')
  const inputMessages = normalizeMessages(payload.messages)

  const messages = []
  if (inputMessages.length) {
    messages.push(...inputMessages)
  } else if (query) {
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
    messages.push({ role: 'user', content: query })
  }

  if (!messages.length) throw new Error('query 或 messages 至少提供一个')

  const config = getAskConfig(payload)
  const result = await requestCompletion(config, messages)
  return {
    ...result,
    request: {
      model: config.model,
      timeoutMs: config.timeoutMs,
      temperature: config.temperature,
      topP: config.topP,
      maxTokens: config.maxTokens,
      messageCount: messages.length,
    },
  }
}
