import { ref, type Ref } from 'vue'
import type { TimeRangePreset } from '@/features/session-filter/useSessionFilterDomain'

interface SessionMessageLike {
  id: string
  role: string
  content: string
  createdAt: string | null
  tags?: string[]
}

interface SessionLike {
  id: string
  sourceId: string
  sourceType?: string
  provider: string
  title: string
  updatedAt: string
  tags: string[]
  messages: SessionMessageLike[]
  meta?: {
    review?: {
      status?: 'pending' | 'kept' | 'downgraded' | 'hidden'
      keepInSearch?: boolean
      qualityScore?: number | null
      note?: string
      reviewedAt?: string | null
      reviewedBy?: string | null
    }
    sync?: {
      syncStatus?: 'active' | 'missing' | 'orphaned'
      firstSeenAt?: string | null
      lastSeenAt?: string | null
      lastSyncedAt?: string | null
      sourceUpdatedAt?: string | null
      contentHash?: string | null
      missingCount?: number
    }
    [key: string]: unknown
  }
  relevanceScore?: number
  lexicalScore?: number
  vectorSimilarity?: number
  matchedChunkCount?: number
  matchedSnippets?: string[]
  matchedTurnIndexes?: number[]
  matchedChunks?: Array<{
    chunkId: string
    summary?: string
    chunkIndex?: number
    turnIndex?: number
    userIntent?: string
    assistantSummary?: string
    lexical_score?: number
    vector_similarity?: number
    snippet?: string
    filePaths?: string[]
    errorKeywords?: string[]
  }>
}

interface IssueLike {
  sourceId: string
  message: string
}

interface RetrieveResultItem {
  sessionId: string
  relevance_score: number
  lexical_score?: number
  vector_similarity?: number
  matched_chunk_count?: number
  snippets?: string[]
  matched_turn_indexes?: number[]
  matched_chunks?: Array<{
    chunkId: string
    summary?: string
    chunkIndex?: number
    turnIndex?: number
    userIntent?: string
    assistantSummary?: string
    lexical_score?: number
    vector_similarity?: number
    snippet?: string
    filePaths?: string[]
    errorKeywords?: string[]
  }>
}

interface RetrieveEmbeddingMeta {
  enabled?: boolean
  source?: string
  model?: string
  fallback?: boolean
  regenerated?: number
  coverage?: number
  error?: string | null
}

interface RetrieveResponse {
  retrievalQuery?: string
  embedding?: RetrieveEmbeddingMeta
  queryRewrite?: {
    enabled?: boolean
    applied?: boolean
    originalQuery?: string
    searchQuery?: string
    retrievalQuery?: string
    keywords?: string[]
    alternatives?: string[]
    reason?: string
    model?: string
    finishReason?: string
    error?: string | null
  }
  answer?: {
    requested?: boolean
    status?: string
    text?: string
    citations?: number[]
    grounded?: boolean
    insufficient?: boolean
    model?: string
    finishReason?: string
    error?: string | null
  }
  results: RetrieveResultItem[]
}

type EmbeddingBuildMode = 'local' | 'remote'

interface EmbeddingBuildStats {
  provider: string
  totalSessions: number
  embeddedSessions: number
  totalChunks?: number
  embeddedChunks?: number
  lastBuildAt: string | null
  lastBuildGenerated: number
  lastBuildTargetCount: number
  lastBuildTotalSessions: number
}

interface EmbeddingBuildPreview {
  provider: string
  embedMode: EmbeddingBuildMode | 'auto'
  force: boolean
  limit: number
  totalSessions: number
  totalChunks: number
  alreadyEmbedded: number
  targetCount: number
  reasonCounts: Record<string, number>
  embedding: {
    source?: string
    model?: string
    dims?: number
  }
}

interface EmbeddingBuildJob {
  id: string
  status: string
  provider: string
  embedMode: string
  force: boolean
  totalSessions: number
  totalChunks: number
  targetCount: number
  processed: number
  generated: number
  failed: number
  retryCount: number
  progress: number
  source?: string
  model?: string
  error?: string | null
  lastRetryError?: string | null
  lastRetryDelayMs?: number
  statusText?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  stats?: EmbeddingBuildStats | null
}

interface SessionDataService<
  TSession extends SessionLike = SessionLike,
  TIssue extends IssueLike = IssueLike,
> {
  fetchSessions(params: { q?: string; provider?: string; from?: string; to?: string; conversationId?: string }): Promise<{
    updatedAt: string | null
    issues: TIssue[]
    sessions: TSession[]
  }>
  updateSessionReview(payload: {
    id: string
    status?: 'pending' | 'kept' | 'downgraded' | 'hidden'
    keepInSearch?: boolean
    qualityScore?: number | null
    note?: string
    reviewedBy?: string
  }): Promise<{ session: TSession }>
  retrieve(payload: Record<string, unknown>): Promise<RetrieveResponse>
  rebuildEmbeddings(payload: {
    provider?: string
    force?: boolean
    limit?: number
    embedMode?: EmbeddingBuildMode
  }): Promise<{
    provider: string
    embedMode: EmbeddingBuildMode | 'auto'
    totalSessions: number
    targetCount: number
    generated: number
    embedding: {
      source?: string
      model?: string
      fallback?: boolean
      error?: string | null
    }
    stats?: EmbeddingBuildStats
  }>
  previewEmbeddings(payload: {
    provider?: string
    force?: boolean
    limit?: number
    embedMode?: EmbeddingBuildMode
  }): Promise<EmbeddingBuildPreview>
  startEmbeddingRebuildJob(payload: {
    provider?: string
    force?: boolean
    limit?: number
    embedMode?: EmbeddingBuildMode
  }): Promise<{ job: EmbeddingBuildJob }>
  fetchEmbeddingRebuildJob(id: string): Promise<{ job: EmbeddingBuildJob }>
  fetchEmbeddingBuildStats(provider?: string): Promise<EmbeddingBuildStats>
  deleteSession(id: string): Promise<{ removed: boolean; total: number; updatedAt: string | null }>
  refreshProvider(provider: string): Promise<{
    provider: string
    refreshed: number
    total: number
    updatedAt: string
    issues: TIssue[]
  }>
}

interface UseSessionDataDomainOptions<
  TSession extends SessionLike = SessionLike,
  TIssue extends IssueLike = IssueLike,
> {
  service: SessionDataService<TSession, TIssue>
  allSessions: Ref<TSession[]>
  issues: Ref<TIssue[]>
  indexUpdatedAt: Ref<string | null>
  keyword: Ref<string>
  useVectorSearch: Ref<boolean>
  providerFilter: Ref<string>
  timeRangePreset: Ref<TimeRangePreset>
  cursorConversationIdFilter: Ref<string>
  activeProvider: Ref<string>
  resolveTimeRange: (preset: TimeRangePreset) => { from: string; to: string }
  normalizeRole: (role: string) => string
  sanitizeContent: (input: string) => string
  getProviderDisplayLabel: (provider: string) => string
}

export function useSessionDataDomain<
  TSession extends SessionLike = SessionLike,
  TIssue extends IssueLike = IssueLike,
>(options: UseSessionDataDomainOptions<TSession, TIssue>) {
  const loading = ref(false)
  const initialLoading = ref(true)
  const refreshingProvider = ref(false)
  const errorText = ref('')
  const importResultText = ref('')
  const retrieving = ref(false)
  const retrieveMeta = ref<RetrieveEmbeddingMeta | null>(null)
  const embeddingBuildModalOpen = ref(false)
  const embeddingBuildMode = ref<EmbeddingBuildMode>('local')
  const embeddingBuildStats = ref<EmbeddingBuildStats | null>(null)
  const embeddingBuildStatsLoading = ref(false)
  const embeddingBuildPreview = ref<EmbeddingBuildPreview | null>(null)
  const embeddingBuildPreviewLoading = ref(false)
  const embeddingBuildJob = ref<EmbeddingBuildJob | null>(null)
  const rebuildingEmbeddings = ref(false)
  const deletingSessionId = ref('')
  const updatingSessionReviewId = ref('')
  const deleteConfirmOpen = ref(false)
  const pendingDeleteSession = ref<TSession | null>(null)
  let embeddingBuildPollTimer: ReturnType<typeof setTimeout> | null = null

  function stopEmbeddingBuildPolling() {
    if (!embeddingBuildPollTimer) return
    clearTimeout(embeddingBuildPollTimer)
    embeddingBuildPollTimer = null
  }

  async function loadSessions() {
    loading.value = true
    retrieving.value = false
    try {
      const normalizedKeyword = options.keyword.value.trim()
      const useVectorSearch = Boolean(options.useVectorSearch.value)
      const range = options.resolveTimeRange(options.timeRangePreset.value)
      const conversationId = options.cursorConversationIdFilter.value.trim()
      const retrieveProvider =
        options.activeProvider.value !== 'all' ? options.activeProvider.value : options.providerFilter.value
      const shouldUseKeywordIndex = Boolean(normalizedKeyword && !useVectorSearch)
      const shouldUseVectorSearch = Boolean(normalizedKeyword && useVectorSearch)

      const data = await options.service.fetchSessions({
        q: shouldUseKeywordIndex ? normalizedKeyword : '',
        provider: shouldUseKeywordIndex ? (retrieveProvider || '') : '',
        from: range.from || '',
        to: range.to || '',
        conversationId: ['cursor', 'codex'].includes(options.activeProvider.value) ? conversationId : '',
      })

      let nextSessions = (data.sessions || [])
        .map((session) => ({
          ...session,
          messages: (session.messages || []).map((msg) => ({
            ...msg,
            role: options.normalizeRole(msg.role),
            content: options.sanitizeContent(msg.content),
            tags: Array.isArray(msg.tags) ? msg.tags.map((tag) => String(tag || '').trim()).filter(Boolean) : [],
          })),
        }))
        .filter((session) => (session.messages || []).length > 0) as TSession[]

      retrieveMeta.value = null
      if (shouldUseVectorSearch) {
        const constrainedSessionIds = new Set(nextSessions.map((session) => String(session.id || '')).filter(Boolean))
        retrieving.value = true
        try {
          const retrievePayload: Record<string, unknown> = {
            query: normalizedKeyword,
            provider: retrieveProvider || '',
            topK: 5,
            autoEmbed: false,
            rewriteQuery: false,
          }
          if (range.from || range.to) {
            retrievePayload.timeRange = {
              from: range.from || '',
              to: range.to || '',
            }
          }

          const retrieveData = await options.service.retrieve(retrievePayload)

          retrieveMeta.value = retrieveData.embedding || null
          const scoreMap = new Map(
            (retrieveData.results || []).map((item) => [
              String(item.sessionId),
              {
                relevanceScore: Number(item.relevance_score || 0),
                lexicalScore: Number(item.lexical_score || 0),
                vectorSimilarity: Number(item.vector_similarity || 0),
                matchedChunkCount: Number(item.matched_chunk_count || 0),
                matchedSnippets: Array.isArray(item.snippets) ? item.snippets.map((text) => String(text || '').trim()).filter(Boolean) : [],
                matchedTurnIndexes: Array.isArray(item.matched_turn_indexes)
                  ? item.matched_turn_indexes.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0)
                  : [],
                matchedChunks: Array.isArray(item.matched_chunks) ? item.matched_chunks : [],
              },
            ]),
          )

          nextSessions = nextSessions
            .filter((session) => scoreMap.has(String(session.id)))
            .map((session) => ({
              ...session,
              ...(scoreMap.get(String(session.id)) || {}),
            }))
            .filter((session) => !constrainedSessionIds.size || constrainedSessionIds.has(String(session.id)))
            .sort((a, b) => {
              const scoreA = Number(a.relevanceScore ?? -1e9)
              const scoreB = Number(b.relevanceScore ?? -1e9)
              if (scoreB !== scoreA) return scoreB - scoreA
              return +new Date(b.updatedAt || 0) - +new Date(a.updatedAt || 0)
            }) as TSession[]
        } catch (error) {
          retrieveMeta.value = null
          errorText.value = `语义检索不可用，已降级普通检索：${String(error)}`
          const lowerKeyword = normalizedKeyword.toLowerCase()
          nextSessions = nextSessions.filter((session) => {
            const corpus = [
              session.title,
              session.provider,
              ...(session.tags || []),
              ...(session.messages || []).map((msg) => msg.content),
            ]
              .join(' ')
              .toLowerCase()
            return corpus.includes(lowerKeyword)
          })
        } finally {
          retrieving.value = false
        }
      }

      options.allSessions.value = nextSessions
      options.issues.value = data.issues || []
      options.indexUpdatedAt.value = data.updatedAt
    } catch (error) {
      errorText.value = String(error)
    } finally {
      retrieving.value = false
      loading.value = false
      initialLoading.value = false
    }
  }

  function openDeleteConfirm(session: TSession | null) {
    if (!session?.id) return
    pendingDeleteSession.value = session
    deleteConfirmOpen.value = true
  }

  function closeDeleteConfirm() {
    deleteConfirmOpen.value = false
    pendingDeleteSession.value = null
  }

  async function confirmDeleteSession() {
    const session = pendingDeleteSession.value
    if (!session?.id) return

    deletingSessionId.value = session.id
    errorText.value = ''

    try {
      await options.service.deleteSession(session.id)
      importResultText.value = '会话已删除'
      closeDeleteConfirm()
      await loadSessions()
    } catch (error) {
      errorText.value = String(error)
    } finally {
      deletingSessionId.value = ''
    }
  }

  async function updateSessionReview(payload: {
    id: string
    status?: 'pending' | 'kept' | 'downgraded' | 'hidden'
    keepInSearch?: boolean
    qualityScore?: number | null
    note?: string
    reviewedBy?: string
  }) {
    const sessionId = String(payload.id || '').trim()
    if (!sessionId || updatingSessionReviewId.value) return

    updatingSessionReviewId.value = sessionId
    errorText.value = ''

    try {
      await options.service.updateSessionReview(payload)
      importResultText.value = '会话审核状态已更新'
      await loadSessions()
    } catch (error) {
      errorText.value = String(error)
    } finally {
      updatingSessionReviewId.value = ''
    }
  }

  async function refreshAll() {
    loading.value = true
    errorText.value = ''

    try {
      await loadSessions()
    } catch (error) {
      errorText.value = String(error)
    } finally {
      loading.value = false
    }
  }

  async function refreshCurrentProvider() {
    if (!options.activeProvider.value || options.activeProvider.value === 'all') return
    refreshingProvider.value = true
    errorText.value = ''
    importResultText.value = ''

    try {
      const result = await options.service.refreshProvider(options.activeProvider.value)
      importResultText.value = `更新完成：${options.getProviderDisplayLabel(result.provider)} 新增/刷新 ${result.refreshed} 条`
      await loadSessions()
    } catch (error) {
      errorText.value = String(error)
    } finally {
      refreshingProvider.value = false
    }
  }

  async function rebuildSessionEmbeddings() {
    if (rebuildingEmbeddings.value) return
    errorText.value = ''
    importResultText.value = ''

    const provider = options.activeProvider.value || 'all'

    try {
      if (!embeddingBuildPreview.value) {
        await loadEmbeddingBuildPreview()
      }
      if (!embeddingBuildPreview.value) {
        throw new Error('未能获取待构建数据预估')
      }
      if (Number(embeddingBuildPreview.value.targetCount || 0) <= 0) {
        importResultText.value = '没有新增或变更的向量需要构建'
        return
      }

      rebuildingEmbeddings.value = true
      const result = await options.service.startEmbeddingRebuildJob({
        provider,
        force: false,
        limit: 1200,
        embedMode: embeddingBuildMode.value,
      })
      embeddingBuildJob.value = result.job || null
      const jobId = String(result.job?.id || '')
      if (!jobId) throw new Error('未返回有效的构建任务 ID')
      await pollEmbeddingBuildJob(jobId, provider)
    } catch (error) {
      errorText.value = `向量构建失败：${String(error)}`
    } finally {
      if (!embeddingBuildJob.value || !['queued', 'running'].includes(String(embeddingBuildJob.value.status || ''))) {
        rebuildingEmbeddings.value = false
      }
    }
  }

  function openEmbeddingBuildModal() {
    embeddingBuildModalOpen.value = true
    void loadEmbeddingBuildStats()
    void loadEmbeddingBuildPreview()
  }

  function closeEmbeddingBuildModal() {
    if (rebuildingEmbeddings.value) return
    embeddingBuildModalOpen.value = false
  }

  async function loadEmbeddingBuildStats() {
    embeddingBuildStatsLoading.value = true
    try {
      const provider = options.activeProvider.value || 'all'
      const stats = await options.service.fetchEmbeddingBuildStats(provider)
      embeddingBuildStats.value = stats
    } catch (error) {
      errorText.value = `读取向量构建统计失败：${String(error)}`
    } finally {
      embeddingBuildStatsLoading.value = false
    }
  }

  async function loadEmbeddingBuildPreview() {
    embeddingBuildPreviewLoading.value = true
    try {
      const provider = options.activeProvider.value || 'all'
      const preview = await options.service.previewEmbeddings({
        provider,
        force: false,
        limit: 1200,
        embedMode: embeddingBuildMode.value,
      })
      embeddingBuildPreview.value = preview
    } catch (error) {
      embeddingBuildPreview.value = null
      errorText.value = `读取待构建预估失败：${String(error)}`
    } finally {
      embeddingBuildPreviewLoading.value = false
    }
  }

  async function pollEmbeddingBuildJob(jobId: string, provider: string) {
    stopEmbeddingBuildPolling()
    const result = await options.service.fetchEmbeddingRebuildJob(jobId)
    embeddingBuildJob.value = result.job || null
    const job = embeddingBuildJob.value

    if (!job) {
      rebuildingEmbeddings.value = false
      return
    }

    const running = job.status === 'queued' || job.status === 'running'
    rebuildingEmbeddings.value = running

    if (running) {
      embeddingBuildPollTimer = setTimeout(() => {
        void pollEmbeddingBuildJob(jobId, provider)
      }, 1200)
      return
    }

    stopEmbeddingBuildPolling()
    rebuildingEmbeddings.value = false

    if (job.stats) {
      embeddingBuildStats.value = job.stats
    } else {
      await loadEmbeddingBuildStats()
    }
    await loadEmbeddingBuildPreview()

    const providerLabel = provider === 'all'
      ? '全部来源'
      : options.getProviderDisplayLabel(provider)
    const sourceLabel = String(job.source || '-')
    const modelLabel = String(job.model || '-')

    if (job.status === 'completed') {
      importResultText.value =
        `向量构建完成：${providerLabel}，生成 ${Number(job.generated || 0)}/${Number(job.targetCount || 0)}，来源 ${sourceLabel}，模型 ${modelLabel}`
      if (job.error) {
        errorText.value = `向量构建提示：${String(job.error)}`
      }
      if (options.keyword.value.trim()) {
        await loadSessions()
      }
      return
    }

    errorText.value = `向量构建失败：${String(job.error || job.statusText || '未知错误')}`
  }

  return {
    loading,
    initialLoading,
    refreshingProvider,
    errorText,
    importResultText,
    retrieving,
    retrieveMeta,
    embeddingBuildModalOpen,
    embeddingBuildMode,
    embeddingBuildStats,
    embeddingBuildStatsLoading,
    embeddingBuildPreview,
    embeddingBuildPreviewLoading,
    embeddingBuildJob,
    rebuildingEmbeddings,
    updatingSessionReviewId,
    deletingSessionId,
    deleteConfirmOpen,
    pendingDeleteSession,
    loadSessions,
    rebuildSessionEmbeddings,
    openEmbeddingBuildModal,
    closeEmbeddingBuildModal,
    loadEmbeddingBuildStats,
    loadEmbeddingBuildPreview,
    openDeleteConfirm,
    closeDeleteConfirm,
    confirmDeleteSession,
    updateSessionReview,
    refreshAll,
    refreshCurrentProvider,
  }
}
