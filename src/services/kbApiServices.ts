import type { JsonRequest } from '@/services/httpClient'

export interface PatchDirPresetDto {
  id: string
  alias: string
  path: string
}

export interface ModelCapabilityDto {
  id: string
  title: string
  owner: 'assistant' | 'embedding' | 'dspy'
  enabled: boolean
  model: string
  description: string
  paths: string[]
}

export interface ModelSettingsDto {
  assistant: {
    apiBase: string
    apiKey: string
    apiKeyMasked?: string
    model: string
    timeoutMs: number
    temperature: number
    topP: number
    maxTokens: number
    dueDate?: string
  }
  embedding: {
    apiBase: string
    apiKey: string
    apiKeyMasked?: string
    model: string
    timeoutMs: number
    maxBatch: number
    dimensions: number
    dueDate?: string
  }
  dspy: {
    inheritFromAssistant: boolean
    provider: string
    apiBase: string
    apiKey: string
    apiKeyMasked?: string
    model: string
    timeoutMs: number
    dueDate?: string
  }
}

export interface KnowledgeItemDto {
  id: string
  sourceType: 'capture' | 'note' | 'document'
  sourceSubtype: string
  status: 'draft' | 'active' | 'archived'
  title: string
  content: string
  summary?: string
  sourceUrl?: string
  sourceFile?: string
  tags: string[]
  meta?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface KnowledgeStatsDto {
  total: number
  draft: number
  active: number
  archived: number
  byType: {
    capture: number
    note: number
    document: number
  }
}

export interface KnowledgeItemsApi {
  fetchItems(params?: {
    limit?: number
    q?: string
    sourceType?: 'all' | 'capture' | 'note' | 'document'
    status?: 'all' | 'draft' | 'active' | 'archived'
  }): Promise<{ items: KnowledgeItemDto[]; stats: KnowledgeStatsDto }>
  saveItem(payload: Partial<KnowledgeItemDto> & { tags?: string[] | string }): Promise<{ item: KnowledgeItemDto }>
  updateStatus(payload: { id: string; status: 'draft' | 'active' | 'archived' }): Promise<{ item: KnowledgeItemDto }>
  deleteItem(id: string): Promise<{ removed: boolean }>
}

export interface SessionDataApi<TSession, TIssue, TRetrieveResponse> {
  fetchSessions(params: { q?: string; provider?: string; from?: string; to?: string; conversationId?: string }): Promise<{
    updatedAt: string | null
    issues: TIssue[]
    sessions: TSession[]
  }>
  updateSessionReview(payload: {
    id: string
    segmentId?: string
    status?: 'pending' | 'kept' | 'downgraded' | 'hidden'
    keepInSearch?: boolean
    qualityScore?: number | null
    note?: string
    reviewedBy?: string
  }): Promise<{ session: TSession }>
  retrieve(payload: Record<string, unknown>): Promise<TRetrieveResponse>
  rebuildEmbeddings(payload: {
    provider?: string
    force?: boolean
    limit?: number
    embedMode?: 'local' | 'remote'
  }): Promise<{
    provider: string
    embedMode: 'local' | 'remote' | 'auto'
    limit: number
    force: boolean
      totalSessions: number
      totalChunks?: number
      alreadyEmbedded: number
      targetCount: number
      generated: number
    embedding: {
      source?: string
      model?: string
      fallback?: boolean
      error?: string | null
    }
    generatedAt: string
    stats?: {
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
    }>
  previewEmbeddings(payload: {
    provider?: string
    force?: boolean
    limit?: number
    embedMode?: 'local' | 'remote'
  }): Promise<{
    provider: string
    embedMode: 'local' | 'remote' | 'auto'
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
  }>
  startEmbeddingRebuildJob(payload: {
    provider?: string
    force?: boolean
    limit?: number
    embedMode?: 'local' | 'remote'
  }): Promise<{
    job: {
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
    }
  }>
  fetchEmbeddingRebuildJob(id: string): Promise<{
    job: {
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
      stats?: {
        provider: string
        totalSessions: number
        embeddedSessions: number
        totalChunks?: number
        embeddedChunks?: number
        lastBuildAt: string | null
        lastBuildGenerated: number
        lastBuildTargetCount: number
        lastBuildTotalSessions: number
      } | null
    }
  }>
  fetchEmbeddingBuildStats(provider?: string): Promise<{
    provider: string
    totalSessions: number
    embeddedSessions: number
    totalChunks?: number
    embeddedChunks?: number
    lastBuildAt: string | null
    lastBuildGenerated: number
    lastBuildTargetCount: number
    lastBuildTotalSessions: number
  }>
  deleteSession(id: string): Promise<{ removed: boolean; total: number; updatedAt: string | null }>
  refreshProvider(provider: string): Promise<{
    provider: string
    refreshed: number
    total: number
    updatedAt: string
    issues: TIssue[]
  }>
}

export interface PatchDirSettingsApi {
  fetchPresets(): Promise<{ presets: PatchDirPresetDto[] }>
  createPreset(alias: string, path: string, id?: string): Promise<{ preset: PatchDirPresetDto; presets: PatchDirPresetDto[] }>
  deletePreset(id: string): Promise<{ removed: boolean; presets: PatchDirPresetDto[] }>
  fetchPatchCount(patchDir: string): Promise<{ patchDir: string; total: number }>
}

export interface ModelSettingsApi {
  fetchSettings(): Promise<{ settings: ModelSettingsDto; capabilities: ModelCapabilityDto[] }>
  saveSettings(settings: ModelSettingsDto): Promise<{ settings: ModelSettingsDto; capabilities: ModelCapabilityDto[] }>
  testSettings(payload: { settings: ModelSettingsDto; owners: Array<'assistant' | 'embedding' | 'dspy'> }): Promise<{
    testedAt: string
    results: Array<{
      owner: 'assistant' | 'embedding' | 'dspy'
      ok: boolean
      model: string
      apiBase: string
      detail: string
    }>
  }>
}

export interface PromptApi<TScoreResult = unknown, TOptimizeResult = unknown, TAssessmentResult = unknown> {
  scorePrompt(payload: {
    prompt: string
    promptId: string
    contextMessages: string[]
    taskType?: 'coding' | 'writing' | 'general'
    includeEffectAssessment?: boolean
  }): Promise<TScoreResult>
  assessPromptEffect(payload: {
    prompt: string
    promptId: string
    contextMessages: string[]
    taskType?: 'coding' | 'writing' | 'general'
    cacheOnly?: boolean
    forceRegenerate?: boolean
  }): Promise<TAssessmentResult | null>
  optimizePrompt(payload: {
    prompt: string
    promptId: string
    taskType: string
    language: 'zh-CN' | 'en-US'
    forceRegenerate: boolean
    contextMessages: string[]
  }): Promise<TOptimizeResult>
}

export interface MessageTagApi {
  saveMessageTags(payload: { sessionId: string; messageIds: string[]; tags: string[] }): Promise<{ updated: boolean; matched: number }>
}

export interface ImportApi {
  previewImport(payload: { files: Array<{ path: string; content: string }>; provider: string; sourceRoot: string }): Promise<{
    count: number
    bySourceType: Record<string, number>
    sample: Array<{
      id: string
      title: string
      provider: string
      sourceType: string
      messageCount: number
    }>
  }>
  importFolder(payload: { files: Array<{ path: string; content: string }>; provider: string; sourceRoot: string }): Promise<{
    imported: number
    total: number
    issues: unknown[]
    updatedAt: string
  }>
}

export interface WikiVaultApi {
  fetchStats(provider?: string): Promise<{
    provider: string
    generatedAt: string | null
    syncMode: 'publish-only' | 'publish-with-summary'
    publishedCount: number
    conceptCount: number
    llmConceptCount: number
    fallbackConceptCount: number
    currentSessions: number
    currentConcepts: number
    llmEligibleConcepts: number
  }>
  preview(payload?: {
    provider?: string
    sessionIds?: string[]
    limit?: number
    syncMode?: 'publish-only' | 'publish-with-summary'
  }): Promise<{
    provider: string
    syncMode: 'publish-only' | 'publish-with-summary'
    totalSessions: number
    totalConcepts: number
    llmEligibleConcepts: number
    targetConcepts: number
    estimatedSteps: number
    estimatedModelCalls: number
    reusableLlmConcepts: number
    skippedConcepts: number
  }>
  startSyncJob(payload?: {
    provider?: string
    sessionIds?: string[]
    limit?: number
    syncMode?: 'publish-only' | 'publish-with-summary'
  }): Promise<{
    job: {
      id: string
      status: string
      provider: string
      syncMode: 'publish-only' | 'publish-with-summary'
      totalSessions: number
      totalConcepts: number
      llmEligibleConcepts: number
      estimatedModelCalls: number
      totalSteps: number
      processedSteps: number
      publishedCount: number
      llmConceptCount: number
      fallbackConceptCount: number
      skippedConceptCount: number
      reusedLlmConceptCount: number
      reusedFallbackConceptCount: number
      progress: number
      statusText?: string
      error?: string | null
      createdAt: string
      startedAt?: string
      finishedAt?: string
      lastRun?: {
        provider: string
        generatedAt: string | null
        syncMode: 'publish-only' | 'publish-with-summary'
        publishedCount: number
        conceptCount: number
        llmConceptCount: number
        fallbackConceptCount: number
      } | null
    }
    preview: {
      provider: string
      syncMode: 'publish-only' | 'publish-with-summary'
      totalSessions: number
      totalConcepts: number
      llmEligibleConcepts: number
      targetConcepts: number
      estimatedSteps: number
      estimatedModelCalls: number
      reusableLlmConcepts: number
      skippedConcepts: number
    }
  }>
  fetchSyncJob(id: string): Promise<{
    job: {
      id: string
      status: string
      provider: string
      syncMode: 'publish-only' | 'publish-with-summary'
      totalSessions: number
      totalConcepts: number
      llmEligibleConcepts: number
      estimatedModelCalls: number
      totalSteps: number
      processedSteps: number
      publishedCount: number
      llmConceptCount: number
      fallbackConceptCount: number
      skippedConceptCount: number
      reusedLlmConceptCount: number
      reusedFallbackConceptCount: number
      progress: number
      statusText?: string
      error?: string | null
      createdAt: string
      startedAt?: string
      finishedAt?: string
      lastRun?: {
        provider: string
        generatedAt: string | null
        syncMode: 'publish-only' | 'publish-with-summary'
        publishedCount: number
        conceptCount: number
        llmConceptCount: number
        fallbackConceptCount: number
      } | null
    }
  }>
  publish(payload?: {
    provider?: string
    sessionId?: string
    sessionIds?: string[]
    limit?: number
  }): Promise<{
    ok: boolean
    vaultDir: string
    publishedCount: number
    published: Array<{
      title: string
      provider: string
      sessionId: string
      messageCount: number
      updatedAt: string
      fileName: string
      relativePath: string
    }>
  }>
  fetchLint(writeReport?: boolean): Promise<{
    ok: boolean
    generatedAt: string
    summary: {
      totalNotes: number
      readerFirstNotes: number
      totalFindings: number
      highCount: number
      mediumCount: number
      lowCount: number
      brokenLinkCount: number
      duplicateTitleCount: number
      orphanCount: number
    }
    brokenLinks: Array<{ from: string; target: string; title: string }>
    duplicateTitleGroups: string[][]
    orphans: string[]
    findings: Array<{
      severity: 'high' | 'medium' | 'low'
      code: string
      relativePath: string
      title: string
      detail: string
      suggestion: string
    }>
    reportPath: string
  }>
  fetchPromotionQueue(writeReport?: boolean): Promise<{
    ok: boolean
    generatedAt: string
    summary: {
      totalItems: number
      issueReviewCount: number
      patternCandidateCount: number
      synthesisCandidateCount: number
      approvedIssueCount?: number
      approvedPatternCount?: number
      approvedSynthesisCount?: number
    }
    issueReviews: Array<{
      kind: string
      sourceKind?: string
      sourceLabel?: string
      segmentId?: string
      segmentLabel?: string
      title: string
      currentPath?: string
      currentLabel?: string
      project?: string
      confidence: number
      reason: string
      summary: string
      suggestedActions: string[]
      evidenceItems: string[]
    }>
    patternCandidates: Array<{
      kind: string
      sourceKind?: string
      sourceLabel?: string
      segmentId?: string
      segmentLabel?: string
      title: string
      targetPath?: string
      project?: string
      confidence: number
      reason: string
      summary: string
      suggestedActions: string[]
      evidenceItems: string[]
    }>
    synthesisCandidates: Array<{
      kind: string
      sourceKind?: string
      sourceLabel?: string
      segmentId?: string
      segmentLabel?: string
      title: string
      targetPath?: string
      project?: string
      confidence: number
      reason: string
      summary: string
      suggestedActions: string[]
      evidenceItems: string[]
      updatedAt?: string
    }>
    approvedIssues: Array<{
      kind: string
      sourceKind?: string
      sourceLabel?: string
      title: string
      currentPath?: string
      project?: string
      summary: string
      evidenceItems: string[]
      updatedAt?: string
    }>
    approvedPatterns: Array<{
      kind: string
      sourceKind?: string
      sourceLabel?: string
      title: string
      targetPath?: string
      project?: string
      summary: string
      evidenceItems: string[]
      updatedAt?: string
    }>
    approvedSyntheses: Array<{
      kind: string
      sourceKind?: string
      sourceLabel?: string
      title: string
      targetPath?: string
      project?: string
      summary: string
      evidenceItems: string[]
      updatedAt?: string
    }>
    reportPath: string
  }>
  fetchNote(path: string): Promise<{
    ok: boolean
    note: {
      path: string
      space: string
      audience: string
      title: string
      type: string
      project: string
      updatedAt: string
      summary: string
      wordCount: number
      frontmatter: Record<string, string>
      markdown: string
      body: string
    }
  }>
  search(payload: {
    query: string
    topK?: number
    spaces?: string[]
    includeMarkdown?: boolean
  }): Promise<{
    query: string
    topK: number
    spaces: string[]
    totalNotes: number
    totalMatched: number
    results: Array<{
      path: string
      space: string
      audience: string
      title: string
      type: string
      project: string
      updatedAt: string
      score: number
      matchedTerms: string[]
      summary: string
      excerpt: string
      markdown?: string
    }>
  }>
  repairLink(payload: {
    path: string
    fromTarget: string
    toTarget: string
  }): Promise<{
    ok: boolean
    path: string
    fromTarget: string
    toTarget: string
    replacedCount: number
    updatedAt: string
    note: {
      path: string
      title: string
      summary: string
      updatedAt: string
    } | null
  }>
  applyPromotion(payload: {
    kind: 'issue-review' | 'pattern-candidate' | 'synthesis-candidate'
    title: string
    currentPath?: string
    targetPath?: string
    question?: string
    project?: string
    summary?: string
    evidenceItems?: string[]
  }): Promise<{
    ok: boolean
    kind: string
    relativePath: string
    promotionStats?: {
      summary?: {
        totalItems: number
        issueReviewCount: number
        patternCandidateCount: number
        synthesisCandidateCount: number
      }
    }
    lintStats?: {
      summary?: {
        totalFindings: number
      }
    }
  }>
  decidePromotion(payload: {
    decision: 'approve' | 'dismiss' | 'revoke'
    kind: 'issue-review' | 'pattern-candidate' | 'synthesis-candidate'
    title: string
    currentPath?: string
    targetPath?: string
    question?: string
    project?: string
    summary?: string
    evidenceItems?: string[]
  }): Promise<{
    ok: boolean
    decision: string
    kind: string
    relativePath: string
  }>
  previewPromotion(payload: {
    kind: 'issue-review' | 'pattern-candidate' | 'synthesis-candidate'
    title: string
    currentPath?: string
    targetPath?: string
    question?: string
    project?: string
    summary?: string
    evidenceItems?: string[]
  }): Promise<{
    ok: boolean
    kind: string
    relativePath: string
    title: string
    question?: string
    summary?: string
    mode: 'create' | 'update'
    category: 'create' | 'lightweight-confirmation' | 'content-update'
    bodyChanged: boolean
    evidenceCount: number
    frontmatterChanges: Array<{
      field: string
      before: string
      after: string
    }>
    protectedSections: Array<{
      heading: string
      content: string
    }>
    diff: string
    generatedMarkdown: string
  }>
}

export interface BugTraceApi<TBugTraceFilePreview, TBugTraceConversationDetail, TBugTraceResponse> {
  fetchFilePreview(payload: {
    patchDir: string
    turnDir: string | null
    patchPath: string
    filePath: string
  }): Promise<TBugTraceFilePreview>
  fetchConversationDetail(payload: {
    transcriptPath: string
    cursorRoot: string
    limit: number
  }): Promise<TBugTraceConversationDetail>
  runBugTrace(payload: {
    bugCode: string
    patchDir: string
    cursorRoot: string
    topK: number
  }): Promise<TBugTraceResponse>
}

export interface FeishuBatchTransitionResponse {
  action: 'confirm' | 'rollback'
  total: number
  succeeded: number
  failed: number
  results: Array<{ id: string; ok: boolean; error?: string }>
}

export interface FeishuProjectSettingsDto {
  mode: 'default' | 'custom'
  modeResolved: 'default' | 'custom'
  defaultConfig: {
    mcpUrl: string
    projectKey: string
    tokenMasked: string
    tokenAvailable: boolean
  }
  customConfig: {
    token: string
    tokenMasked: string
    tokenAvailable: boolean
    projectKey: string
  }
  effectiveConfig: {
    mode: 'default' | 'custom'
    mcpUrl: string
    projectKey: string
    tokenMasked: string
    tokenAvailable: boolean
  }
}

export interface FeishuProjectSettingsSaveDto {
  mode: 'default' | 'custom'
  customConfig: {
    token: string
    projectKey: string
  }
}

export interface FeishuProjectSettingsApi {
  fetchSettings(): Promise<{ settings: FeishuProjectSettingsDto }>
  saveSettings(settings: FeishuProjectSettingsSaveDto): Promise<{ settings: FeishuProjectSettingsDto }>
}

export interface BugInboxFeishuApi<
  TBugInboxItem,
  TFeishuTodoItem,
  TFeishuBugCandidate,
  TBatchTransitionResponse = FeishuBatchTransitionResponse,
> {
  fetchBugInbox(limit?: number): Promise<{ items: TBugInboxItem[] }>
  fetchFeishuTodoList(force?: boolean): Promise<{ items: TFeishuTodoItem[] }>
  fetchFeishuDefectList(force?: boolean): Promise<{ candidates: TFeishuBugCandidate[] }>
  submitBatchTransition(payload: {
    action: 'confirm' | 'rollback'
    rollbackReason?: string
    items: Array<{
      id: string
      title: string
      projectKey: string
      workItemType: string
      nodeStateKey: string
    }>
  }): Promise<TBatchTransitionResponse>
  linkBugWithFeishu(payload: { bugId: string; candidate: TFeishuBugCandidate }): Promise<{ item: TBugInboxItem }>
  matchFeishuCandidates(bugId: string): Promise<{ candidates: TFeishuBugCandidate[]; attemptedTools?: string[] }>
  updateBugInbox(payload: { id: string; description: string }): Promise<{ item: TBugInboxItem }>
  deleteBugInbox(id: string): Promise<{ removed: boolean }>
  createBugInbox(payload: Record<string, unknown>): Promise<{ item: TBugInboxItem }>
}

export function createSessionDataApi<TSession, TIssue, TRetrieveResponse>(
  request: JsonRequest,
): SessionDataApi<TSession, TIssue, TRetrieveResponse> {
  return {
    async fetchSessions(params) {
      const search = new URLSearchParams()
      if (params.q) search.set('q', params.q)
      if (params.provider) search.set('provider', params.provider)
      if (params.from) search.set('from', params.from)
      if (params.to) search.set('to', params.to)
      if (params.conversationId) search.set('conversationId', params.conversationId)
      return request<{ updatedAt: string | null; issues: TIssue[]; sessions: TSession[] }>(`/api/sessions?${search.toString()}`)
    },
    async retrieve(payload) {
      return request<TRetrieveResponse>('/api/retrieve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    async updateSessionReview(payload) {
      return request<{ session: TSession }>('/api/sessions/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    async rebuildEmbeddings(payload) {
      return request<{
        provider: string
        embedMode: 'local' | 'remote' | 'auto'
        limit: number
        force: boolean
        totalSessions: number
        alreadyEmbedded: number
        targetCount: number
        generated: number
        embedding: {
          source?: string
          model?: string
          fallback?: boolean
          error?: string | null
        }
        generatedAt: string
        stats?: {
          provider: string
          totalSessions: number
          embeddedSessions: number
          lastBuildAt: string | null
          lastBuildGenerated: number
          lastBuildTargetCount: number
          lastBuildTotalSessions: number
        }
      }>('/api/embeddings/rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    async fetchEmbeddingBuildStats(provider = '') {
      const search = new URLSearchParams()
      if (provider) search.set('provider', provider)
      return request<{
        provider: string
        totalSessions: number
        embeddedSessions: number
        lastBuildAt: string | null
        lastBuildGenerated: number
        lastBuildTargetCount: number
        lastBuildTotalSessions: number
      }>(`/api/embeddings/stats?${search.toString()}`)
    },
    async previewEmbeddings(payload) {
      return request('/api/embeddings/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    async startEmbeddingRebuildJob(payload) {
      return request('/api/embeddings/rebuild-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    async fetchEmbeddingRebuildJob(id) {
      const search = new URLSearchParams()
      search.set('id', id)
      return request(`/api/embeddings/rebuild-job?${search.toString()}`)
    },
    async deleteSession(id) {
      return request<{ removed: boolean; total: number; updatedAt: string | null }>('/api/sessions/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
    },
    async refreshProvider(provider) {
      return request<{
        provider: string
        refreshed: number
        total: number
        updatedAt: string
        issues: TIssue[]
      }>('/api/scan-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
    },
  }
}

export function createModelSettingsApi(request: JsonRequest): ModelSettingsApi {
  return {
    async fetchSettings() {
      return request('/api/model-settings')
    },
    async saveSettings(settings) {
      return request('/api/model-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
    },
    async testSettings(payload) {
      return request('/api/model-settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
  }
}

export function createPatchDirSettingsApi(request: JsonRequest): PatchDirSettingsApi {
  return {
    fetchPresets() {
      return request<{ presets: PatchDirPresetDto[] }>('/api/bug-trace/settings/patch-dirs')
    },
    createPreset(alias, path, id = '') {
      return request<{ preset: PatchDirPresetDto; presets: PatchDirPresetDto[] }>('/api/bug-trace/settings/patch-dirs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, alias, path }),
      })
    },
    deletePreset(id) {
      return request<{ removed: boolean; presets: PatchDirPresetDto[] }>('/api/bug-trace/settings/patch-dirs/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
    },
    fetchPatchCount(patchDir) {
      const params = new URLSearchParams({ patchDir })
      return request<{ patchDir: string; total: number }>(`/api/bug-trace/patch-count?${params.toString()}`)
    },
  }
}

export function createPromptApi<TScoreResult, TOptimizeResult, TAssessmentResult>(request: JsonRequest): PromptApi<TScoreResult, TOptimizeResult, TAssessmentResult> {
  return {
    scorePrompt(payload) {
      return request<TScoreResult>('/api/prompt-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    assessPromptEffect(payload) {
      return request<TAssessmentResult | null>('/api/prompt-effect-assessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    optimizePrompt(payload) {
      return request<TOptimizeResult>('/api/prompt-optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
  }
}

export function createMessageTagApi(request: JsonRequest): MessageTagApi {
  return {
    saveMessageTags(payload) {
      return request<{ updated: boolean; matched: number }>('/api/messages/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
  }
}

export function createImportApi(request: JsonRequest): ImportApi {
  return {
    previewImport(payload) {
      return request<{
        count: number
        bySourceType: Record<string, number>
        sample: Array<{
          id: string
          title: string
          provider: string
          sourceType: string
          messageCount: number
        }>
      }>('/api/import-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    importFolder(payload) {
      return request<{ imported: number; total: number; issues: unknown[]; updatedAt: string }>('/api/import-folder-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
  }
}

export function createKnowledgeItemsApi(request: JsonRequest): KnowledgeItemsApi {
  return {
    fetchItems(params = {}) {
      const search = new URLSearchParams()
      if (params.limit) search.set('limit', String(Math.max(1, Number(params.limit) || 200)))
      if (params.q) search.set('q', String(params.q || '').trim())
      if (params.sourceType && params.sourceType !== 'all') search.set('sourceType', params.sourceType)
      if (params.status && params.status !== 'all') search.set('status', params.status)
      const query = search.toString()
      return request<{ items: KnowledgeItemDto[]; stats: KnowledgeStatsDto }>(
        `/api/knowledge-items${query ? `?${query}` : ''}`,
      )
    },
    saveItem(payload) {
      return request<{ item: KnowledgeItemDto }>('/api/knowledge-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    updateStatus(payload) {
      return request<{ item: KnowledgeItemDto }>('/api/knowledge-items/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    deleteItem(id) {
      return request<{ removed: boolean }>('/api/knowledge-items/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
    },
  }
}

export function createWikiVaultApi(request: JsonRequest): WikiVaultApi {
  return {
    fetchStats(provider = '') {
      const search = new URLSearchParams()
      if (provider) search.set('provider', provider)
      return request(`/api/wiki-vault/stats${search.toString() ? `?${search.toString()}` : ''}`)
    },
    preview(payload = {}) {
      return request('/api/wiki-vault/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    startSyncJob(payload = {}) {
      return request('/api/wiki-vault/sync-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    fetchSyncJob(id) {
      const search = new URLSearchParams()
      search.set('id', id)
      return request(`/api/wiki-vault/sync-job?${search.toString()}`)
    },
    publish(payload = {}) {
      return request('/api/wiki-vault/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    fetchLint(writeReport = true) {
      const search = new URLSearchParams()
      search.set('writeReport', writeReport ? '1' : '0')
      return request(`/api/wiki-vault/lint?${search.toString()}`)
    },
    fetchPromotionQueue(writeReport = true) {
      const search = new URLSearchParams()
      search.set('writeReport', writeReport ? '1' : '0')
      return request(`/api/wiki-vault/promotion-queue?${search.toString()}`)
    },
    fetchNote(path) {
      const search = new URLSearchParams()
      search.set('path', path)
      return request(`/api/wiki-vault/note?${search.toString()}`)
    },
    search(payload) {
      return request('/api/wiki-vault/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    repairLink(payload) {
      return request('/api/wiki-vault/repair-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    applyPromotion(payload) {
      return request('/api/wiki-vault/promotion-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    decidePromotion(payload) {
      return request('/api/wiki-vault/promotion-decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    previewPromotion(payload) {
      return request('/api/wiki-vault/promotion-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
  }
}

export function createBugTraceApi<TBugTraceFilePreview, TBugTraceConversationDetail, TBugTraceResponse>(
  request: JsonRequest,
): BugTraceApi<TBugTraceFilePreview, TBugTraceConversationDetail, TBugTraceResponse> {
  return {
    fetchFilePreview(payload) {
      return request<TBugTraceFilePreview>('/api/bug-trace/file-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    fetchConversationDetail(payload) {
      return request<TBugTraceConversationDetail>('/api/bug-trace/conversation-detail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    runBugTrace(payload) {
      return request<TBugTraceResponse>('/api/bug-trace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
  }
}

export function createBugInboxFeishuApi<
  TBugInboxItem,
  TFeishuTodoItem,
  TFeishuBugCandidate,
  TBatchTransitionResponse = FeishuBatchTransitionResponse,
>(request: JsonRequest): BugInboxFeishuApi<TBugInboxItem, TFeishuTodoItem, TFeishuBugCandidate, TBatchTransitionResponse> {
  return {
    fetchBugInbox(limit = 80) {
      return request<{ items: TBugInboxItem[] }>(`/api/bug-inbox?limit=${Math.max(1, Number(limit) || 80)}`)
    },
    fetchFeishuTodoList(force = false) {
      const params = new URLSearchParams()
      if (force) params.set('_ts', String(Date.now()))
      const endpoint = `/api/feishu/todolist${params.toString() ? `?${params.toString()}` : ''}`
      return request<{ items: TFeishuTodoItem[] }>(endpoint, force ? { cache: 'no-store' } : undefined)
    },
    fetchFeishuDefectList(force = false) {
      const params = new URLSearchParams()
      if (force) params.set('_ts', String(Date.now()))
      const endpoint = `/api/feishu/bug-candidates${params.toString() ? `?${params.toString()}` : ''}`
      return request<{ candidates: TFeishuBugCandidate[] }>(endpoint, force ? { cache: 'no-store' } : undefined)
    },
    submitBatchTransition(payload) {
      return request<TBatchTransitionResponse>('/api/feishu/todolist/batch-transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    linkBugWithFeishu(payload) {
      return request<{ item: TBugInboxItem }>('/api/bug-inbox/link-feishu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    matchFeishuCandidates(bugId) {
      return request<{ candidates: TFeishuBugCandidate[]; attemptedTools?: string[] }>('/api/bug-inbox/match-feishu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bugId }),
      })
    },
    updateBugInbox(payload) {
      return request<{ item: TBugInboxItem }>('/api/bug-inbox/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    deleteBugInbox(id) {
      return request<{ removed: boolean }>('/api/bug-inbox/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
    },
    createBugInbox(payload) {
      return request<{ item: TBugInboxItem }>('/api/bug-inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
  }
}

export function createFeishuProjectSettingsApi(request: JsonRequest): FeishuProjectSettingsApi {
  return {
    fetchSettings() {
      return request<{ settings: FeishuProjectSettingsDto }>('/api/feishu/settings')
    },
    saveSettings(settings) {
      return request<{ settings: FeishuProjectSettingsDto }>('/api/feishu/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
    },
  }
}
