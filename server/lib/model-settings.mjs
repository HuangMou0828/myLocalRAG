function normalizeText(input) {
  return String(input || '').trim()
}

function toNumber(input, fallback = 0) {
  const value = Number(input)
  return Number.isFinite(value) ? value : fallback
}

function clampNumber(input, min, max, fallback) {
  const value = toNumber(input, fallback)
  return Math.max(min, Math.min(max, value))
}

function sanitizeSecret(input) {
  return normalizeText(input)
}

function normalizeDateText(input) {
  const value = normalizeText(input)
  if (!value) return ''
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}

function buildEnvDefaults() {
  return {
    assistant: {
      apiBase: normalizeText(process.env.KB_ASK_API_BASE)
        || normalizeText(process.env.DSPY_API_BASE)
        || normalizeText(process.env.OPENAI_API_BASE)
        || normalizeText(process.env.OPENAI_BASE_URL)
        || 'https://api.openai.com/v1',
      apiKey: sanitizeSecret(process.env.KB_ASK_API_KEY)
        || sanitizeSecret(process.env.DSPY_API_KEY)
        || sanitizeSecret(process.env.OPENAI_API_KEY),
      model: normalizeText(process.env.KB_ASK_MODEL)
        || normalizeText(process.env.DSPY_MODEL)
        || normalizeText(process.env.OPENAI_MODEL)
        || 'gpt-4.1-mini',
      timeoutMs: clampNumber(process.env.KB_ASK_TIMEOUT_MS, 3000, 300000, 60000),
      temperature: clampNumber(process.env.KB_ASK_TEMPERATURE, 0, 2, 0.2),
      topP: clampNumber(process.env.KB_ASK_TOP_P, 0, 1, 1),
      maxTokens: Math.max(0, toNumber(process.env.KB_ASK_MAX_TOKENS, 0)),
      dueDate: '',
    },
    embedding: {
      apiBase: normalizeText(process.env.KB_EMBEDDING_API_BASE)
        || normalizeText(process.env.OPENAI_API_BASE)
        || 'https://api.openai.com/v1',
      apiKey: sanitizeSecret(process.env.KB_EMBEDDING_API_KEY)
        || sanitizeSecret(process.env.OPENAI_API_KEY),
      model: normalizeText(process.env.KB_EMBEDDING_MODEL)
        || normalizeText(process.env.OPENAI_EMBEDDING_MODEL)
        || 'text-embedding-3-small',
      timeoutMs: clampNumber(process.env.KB_EMBEDDING_TIMEOUT_MS, 3000, 300000, 20000),
      maxBatch: Math.max(1, Math.min(64, toNumber(process.env.KB_EMBEDDING_MAX_BATCH, 5))),
      dimensions: Math.max(0, toNumber(process.env.KB_EMBEDDING_DIMENSIONS, 1024)),
      dueDate: '',
    },
    dspy: {
      inheritFromAssistant: true,
      provider: normalizeText(process.env.DSPY_PROVIDER) || 'openai',
      apiBase: normalizeText(process.env.DSPY_API_BASE),
      apiKey: sanitizeSecret(process.env.DSPY_API_KEY),
      model: normalizeText(process.env.DSPY_MODEL),
      timeoutMs: clampNumber(process.env.DSPY_TIMEOUT_MS, 10000, 300000, 90000),
      dueDate: '',
    },
  }
}

function normalizeAssistantConfig(input, fallback) {
  const base = input && typeof input === 'object' ? input : {}
  return {
    apiBase: normalizeText(base.apiBase) || fallback.apiBase,
    apiKey: sanitizeSecret(base.apiKey) || fallback.apiKey,
    model: normalizeText(base.model) || fallback.model,
    timeoutMs: clampNumber(base.timeoutMs, 3000, 300000, fallback.timeoutMs),
    temperature: clampNumber(base.temperature, 0, 2, fallback.temperature),
    topP: clampNumber(base.topP, 0, 1, fallback.topP),
    maxTokens: Math.max(0, toNumber(base.maxTokens, fallback.maxTokens)),
    dueDate: normalizeDateText(base.dueDate) || fallback.dueDate,
  }
}

function normalizeEmbeddingConfig(input, fallback) {
  const base = input && typeof input === 'object' ? input : {}
  return {
    apiBase: normalizeText(base.apiBase) || fallback.apiBase,
    apiKey: sanitizeSecret(base.apiKey) || fallback.apiKey,
    model: normalizeText(base.model) || fallback.model,
    timeoutMs: clampNumber(base.timeoutMs, 3000, 300000, fallback.timeoutMs),
    maxBatch: Math.max(1, Math.min(64, toNumber(base.maxBatch, fallback.maxBatch))),
    dimensions: Math.max(0, toNumber(base.dimensions, fallback.dimensions)),
    dueDate: normalizeDateText(base.dueDate) || fallback.dueDate,
  }
}

function normalizeDspyConfig(input, fallback) {
  const base = input && typeof input === 'object' ? input : {}
  return {
    inheritFromAssistant: base.inheritFromAssistant !== false,
    provider: normalizeText(base.provider) || fallback.provider,
    apiBase: normalizeText(base.apiBase) || fallback.apiBase,
    apiKey: sanitizeSecret(base.apiKey) || fallback.apiKey,
    model: normalizeText(base.model) || fallback.model,
    timeoutMs: clampNumber(base.timeoutMs, 10000, 300000, fallback.timeoutMs),
    dueDate: normalizeDateText(base.dueDate) || fallback.dueDate,
  }
}

export function buildEffectiveModelSettings(stored = {}) {
  const envDefaults = buildEnvDefaults()
  const next = stored && typeof stored === 'object' ? stored : {}
  const assistant = normalizeAssistantConfig(next.assistant, envDefaults.assistant)
  const embedding = normalizeEmbeddingConfig(next.embedding, envDefaults.embedding)
  const dspyBase = normalizeDspyConfig(next.dspy, envDefaults.dspy)
  const dspy = dspyBase.inheritFromAssistant
    ? {
        ...dspyBase,
        apiBase: assistant.apiBase,
        apiKey: assistant.apiKey,
        model: dspyBase.model || assistant.model,
      }
    : dspyBase

  return {
    assistant,
    embedding,
    dspy,
  }
}

function maskSecret(secret) {
  const value = normalizeText(secret)
  if (!value) return ''
  if (value.length <= 8) return `${value.slice(0, 2)}***`
  return `${value.slice(0, 4)}***${value.slice(-4)}`
}

export function buildModelSettingsView(settings = {}) {
  const effective = buildEffectiveModelSettings(settings)
  return {
    assistant: {
      ...effective.assistant,
      apiKeyMasked: maskSecret(effective.assistant.apiKey),
    },
    embedding: {
      ...effective.embedding,
      apiKeyMasked: maskSecret(effective.embedding.apiKey),
    },
    dspy: {
      ...effective.dspy,
      apiKeyMasked: maskSecret(effective.dspy.apiKey),
    },
  }
}

export function buildModelCapabilityList(settings = {}) {
  const effective = buildEffectiveModelSettings(settings)
  const assistantReady = Boolean(effective.assistant.apiKey && effective.assistant.apiBase && effective.assistant.model)
  const embeddingReady = Boolean(effective.embedding.apiKey && effective.embedding.apiBase && effective.embedding.model)
  const dspyReady = Boolean(effective.dspy.apiKey && effective.dspy.apiBase && effective.dspy.model)

  return [
    {
      id: 'embedding-retrieval',
      title: '语义检索与向量召回',
      owner: 'embedding',
      enabled: embeddingReady,
      model: effective.embedding.model,
      description: '用于查询词 embedding、chunk 向量生成、检索混排和手动向量构建。',
      paths: ['/api/retrieve', '/api/embeddings/preview', '/api/embeddings/rebuild-job'],
    },
    {
      id: 'ask-model',
      title: '通用问答 / 外部模型调用',
      owner: 'assistant',
      enabled: assistantReady,
      model: effective.assistant.model,
      description: '用于 /api/ask，支持你把系统当成统一的大模型调用入口。',
      paths: ['/api/ask'],
    },
    {
      id: 'rag-assistant',
      title: 'RAG 查询改写 / 证据回答',
      owner: 'assistant',
      enabled: assistantReady,
      model: effective.assistant.model,
      description: '用于 /api/retrieve 的查询改写与基于引用证据生成答案，优化完整 RAG 流程。',
      paths: ['/api/retrieve'],
    },
    {
      id: 'prompt-optimize',
      title: 'Prompt 优化（DSPy）',
      owner: 'dspy',
      enabled: dspyReady,
      model: effective.dspy.model,
      description: '用于 DSPy Prompt 优化；如果模型不可用，会自动降级到规则改写。',
      paths: ['/api/prompt-optimize'],
    },
  ]
}
