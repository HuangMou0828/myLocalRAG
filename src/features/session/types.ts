export interface SessionMessage {
  id: string
  role: string
  content: string
  createdAt: string | null
  tags?: string[]
}

export type SessionReviewStatus = 'pending' | 'kept' | 'downgraded' | 'hidden'
export type SessionSyncStatus = 'active' | 'missing' | 'orphaned'

export interface SessionReviewMeta {
  status: SessionReviewStatus
  keepInSearch: boolean
  qualityScore: number | null
  note: string
  reviewedAt: string | null
  reviewedBy: string | null
}

export interface SessionSyncMeta {
  syncStatus: SessionSyncStatus
  firstSeenAt: string | null
  lastSeenAt: string | null
  lastSyncedAt: string | null
  sourceUpdatedAt: string | null
  contentHash: string | null
  missingCount: number
}

export interface SessionMeta {
  review?: Partial<SessionReviewMeta>
  taskReviewSegments?: Record<string, Partial<SessionReviewMeta>>
  sync?: Partial<SessionSyncMeta>
  cursorConversationId?: string
  codexSessionId?: string
  [key: string]: unknown
}

export interface SessionItem {
  id: string
  sourceId: string
  sourceType?: string
  provider: string
  title: string
  updatedAt: string
  tags: string[]
  messages: SessionMessage[]
  meta?: SessionMeta
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

export interface Issue {
  sourceId: string
  message: string
}

export interface SessionRetrieveResponse {
  retrievalQuery?: string
  embedding?: {
    enabled?: boolean
    source?: string
    model?: string
    fallback?: boolean
    regenerated?: number
    coverage?: number
    error?: string | null
  }
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
  results: Array<{
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
  }>
}
