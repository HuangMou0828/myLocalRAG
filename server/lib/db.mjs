import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { files, readJson } from './storage.mjs'
import { buildSessionChunks, cleanConversationContent } from './embedding.mjs'
import { mergeFeishuProjectSettings } from './feishu-project-settings.mjs'
import { buildEffectiveModelSettings } from './model-settings.mjs'

const SNAPSHOT_ENABLED = process.env.KB_JSON_SNAPSHOT !== '0'

let db = null
let initialized = false

function nowIso() {
  return new Date().toISOString()
}

function sanitizeSessionTitle(value) {
  return cleanConversationContent(String(value || ''), { role: 'user' })
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeSessionMessages(input) {
  const list = Array.isArray(input) ? input : []
  return list
    .map((msg) => {
      const role = String(msg?.role || '').trim().toLowerCase() || 'assistant'
      const content = cleanConversationContent(msg?.content || '', { role })
      if (!content) return null
      return {
        ...msg,
        role,
        content,
      }
    })
    .filter(Boolean)
}

function toIsoOrNull(value) {
  const text = String(value || '').trim()
  if (!text) return null
  const ts = Date.parse(text)
  if (Number.isNaN(ts)) return null
  return new Date(ts).toISOString()
}

function toNullableText(value) {
  const text = String(value || '').trim()
  return text || null
}

function toClampedNullableNumber(value, min = 0, max = 100) {
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return Math.max(min, Math.min(max, num))
}

function toSafeInteger(value, fallback = 0) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.max(0, Math.floor(num))
}

function normalizeReviewStatus(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'kept' || normalized === 'downgraded' || normalized === 'hidden') return normalized
  return 'pending'
}

function normalizeSyncStatus(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'missing' || normalized === 'orphaned') return normalized
  return 'active'
}

function normalizeKnowledgeSourceType(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'note' || normalized === 'document') return normalized
  return 'capture'
}

function normalizeKnowledgeStatus(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'active' || normalized === 'archived') return normalized
  return 'draft'
}

function computeSessionContentHash(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : []
  const payload = JSON.stringify({
    sourceId: String(session?.sourceId || ''),
    sourceType: String(session?.sourceType || ''),
    provider: String(session?.provider || ''),
    title: String(session?.title || ''),
    messages: messages.map((msg) => ({
      role: String(msg?.role || ''),
      content: cleanConversationContent(msg?.content || '', { role: String(msg?.role || '') }),
      createdAt: String(msg?.createdAt || ''),
    })),
  })
  return createHash('sha1').update(payload).digest('hex')
}

function normalizeSessionReviewMeta(review, existingReview = {}) {
  const incoming = review && typeof review === 'object' ? review : {}
  const previous = existingReview && typeof existingReview === 'object' ? existingReview : {}
  const status = normalizeReviewStatus(incoming.status ?? previous.status)

  let keepInSearch
  if (typeof incoming.keepInSearch === 'boolean') keepInSearch = incoming.keepInSearch
  else if (typeof previous.keepInSearch === 'boolean') keepInSearch = previous.keepInSearch
  else keepInSearch = status !== 'hidden' && status !== 'downgraded'

  if (status === 'hidden') keepInSearch = false

  return {
    status,
    keepInSearch,
    qualityScore:
      incoming.qualityScore !== undefined
        ? toClampedNullableNumber(incoming.qualityScore)
        : toClampedNullableNumber(previous.qualityScore),
    note:
      incoming.note !== undefined
        ? String(incoming.note || '').trim()
        : String(previous.note || '').trim(),
    reviewedAt:
      incoming.reviewedAt !== undefined
        ? toIsoOrNull(incoming.reviewedAt)
        : toIsoOrNull(previous.reviewedAt),
    reviewedBy:
      incoming.reviewedBy !== undefined
        ? toNullableText(incoming.reviewedBy)
        : toNullableText(previous.reviewedBy),
  }
}

function normalizeStoredSessionSyncMeta(sync, session) {
  const current = sync && typeof sync === 'object' ? sync : {}
  const contentHash = toNullableText(current.contentHash) || (session ? computeSessionContentHash(session) : null)
  const status = normalizeSyncStatus(current.syncStatus ?? current.status)
  const missingCount = current.missingCount !== undefined
    ? toSafeInteger(current.missingCount)
    : status === 'active'
      ? 0
      : status === 'orphaned'
        ? 3
        : 1

  return {
    syncStatus: status,
    firstSeenAt: toIsoOrNull(current.firstSeenAt),
    lastSeenAt: toIsoOrNull(current.lastSeenAt),
    lastSyncedAt: toIsoOrNull(current.lastSyncedAt),
    sourceUpdatedAt: toIsoOrNull(current.sourceUpdatedAt) || toIsoOrNull(session?.updatedAt),
    contentHash,
    missingCount,
  }
}

function buildSessionSyncMetaForSourceUpsert(incomingSync, session, existingSync = {}) {
  const now = nowIso()
  const previous = normalizeStoredSessionSyncMeta(existingSync, session)
  const incoming = incomingSync && typeof incomingSync === 'object' ? incomingSync : {}
  const requestedStatus = normalizeSyncStatus(incoming.syncStatus ?? incoming.status)
  const sourceUpdatedAt = toIsoOrNull(session?.updatedAt) || previous.sourceUpdatedAt
  const contentHash = computeSessionContentHash(session)

  if (requestedStatus === 'active') {
    return {
      syncStatus: 'active',
      firstSeenAt: previous.firstSeenAt || now,
      lastSeenAt: now,
      lastSyncedAt: now,
      sourceUpdatedAt,
      contentHash,
      missingCount: 0,
    }
  }

  const incomingMissingCount = incoming.missingCount !== undefined ? toSafeInteger(incoming.missingCount) : 0
  const nextMissingCount = Math.max(previous.missingCount + 1, incomingMissingCount, 1)
  const nextStatus = requestedStatus === 'orphaned' || nextMissingCount >= 3 ? 'orphaned' : 'missing'

  return {
    syncStatus: nextStatus,
    firstSeenAt: previous.firstSeenAt || now,
    lastSeenAt: previous.lastSeenAt,
    lastSyncedAt: now,
    sourceUpdatedAt,
    contentHash: previous.contentHash || contentHash,
    missingCount: nextStatus === 'orphaned' ? Math.max(3, nextMissingCount) : nextMissingCount,
  }
}

function buildSessionBaseMeta(existingMeta, incomingMeta) {
  const previous = existingMeta && typeof existingMeta === 'object' ? existingMeta : {}
  const incoming = incomingMeta && typeof incomingMeta === 'object' ? incomingMeta : {}
  const merged = { ...previous, ...incoming }
  delete merged.review
  delete merged.taskReviewSegments
  delete merged.sync
  return merged
}

function normalizeTaskReviewSegmentMap(nextSegments, previousSegments = {}) {
  const incoming = nextSegments && typeof nextSegments === 'object' ? nextSegments : {}
  const previous = previousSegments && typeof previousSegments === 'object' ? previousSegments : {}
  const normalized = {}

  for (const [key, value] of Object.entries(incoming)) {
    const segmentId = String(key || '').trim()
    if (!segmentId || !value || typeof value !== 'object') continue
    normalized[segmentId] = normalizeSessionReviewMeta(value, previous[segmentId])
  }

  return normalized
}

function buildSessionMetaForSourceUpsert(incomingMeta, session, existingMeta = {}) {
  const previous = existingMeta && typeof existingMeta === 'object' ? existingMeta : {}
  const incoming = incomingMeta && typeof incomingMeta === 'object' ? incomingMeta : {}
  const preservedReview =
    previous.review && typeof previous.review === 'object'
      ? previous.review
      : incoming.review
  return {
    ...buildSessionBaseMeta(previous, incoming),
    review: normalizeSessionReviewMeta(preservedReview, preservedReview),
    taskReviewSegments: normalizeTaskReviewSegmentMap(
      previous.taskReviewSegments && typeof previous.taskReviewSegments === 'object'
        ? previous.taskReviewSegments
        : incoming.taskReviewSegments,
      previous.taskReviewSegments,
    ),
    sync: buildSessionSyncMetaForSourceUpsert(incoming.sync, session, previous.sync),
  }
}

function buildSessionMetaForReviewPatch(existingMeta = {}, reviewPatch = {}, segmentId = '') {
  const previous = existingMeta && typeof existingMeta === 'object' ? existingMeta : {}
  const patch = reviewPatch && typeof reviewPatch === 'object' ? reviewPatch : {}
  const normalizedSegmentId = String(segmentId || '').trim()
  const taskReviewSegments = normalizeTaskReviewSegmentMap(previous.taskReviewSegments, previous.taskReviewSegments)

  if (normalizedSegmentId) {
    taskReviewSegments[normalizedSegmentId] = normalizeSessionReviewMeta(
      patch,
      previous?.taskReviewSegments?.[normalizedSegmentId],
    )
  }

  return {
    ...buildSessionBaseMeta(previous, {}),
    review: normalizedSegmentId
      ? normalizeSessionReviewMeta(previous.review, previous.review)
      : normalizeSessionReviewMeta(patch, previous.review),
    taskReviewSegments,
    sync: normalizeStoredSessionSyncMeta(previous.sync),
  }
}

function getDb() {
  if (db) return db
  mkdirSync(path.dirname(files.db), { recursive: true })
  db = new DatabaseSync(files.db)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA synchronous = NORMAL;')
  return db
}

function initSchema() {
  const database = getDb()
  database.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      source_id TEXT,
      source_type TEXT,
      provider TEXT,
      title TEXT,
      updated_at TEXT,
      tags_json TEXT,
      messages_json TEXT,
      meta_json TEXT,
      searchable_text TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_provider ON sessions(provider);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
      id UNINDEXED,
      title,
      provider,
      tags,
      searchable_text
    );

    CREATE TABLE IF NOT EXISTS session_embeddings (
      session_id TEXT PRIMARY KEY,
      model TEXT,
      dims INTEGER,
      vector_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_session_embeddings_updated_at
    ON session_embeddings(updated_at DESC);

    CREATE TABLE IF NOT EXISTS session_chunks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      provider TEXT,
      title TEXT,
      session_updated_at TEXT,
      chunk_index INTEGER NOT NULL,
      summary TEXT,
      content_text TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      searchable_text TEXT NOT NULL,
      meta_json TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_session_chunks_session_id
    ON session_chunks(session_id);

    CREATE INDEX IF NOT EXISTS idx_session_chunks_provider
    ON session_chunks(provider);

    CREATE INDEX IF NOT EXISTS idx_session_chunks_updated_at
    ON session_chunks(session_updated_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS session_chunks_fts USING fts5(
      id UNINDEXED,
      session_id UNINDEXED,
      title,
      provider,
      summary,
      searchable_text
    );

    CREATE TABLE IF NOT EXISTS chunk_embeddings (
      chunk_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      model TEXT,
      dims INTEGER,
      content_hash TEXT,
      vector_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_session_id
    ON chunk_embeddings(session_id);

    CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_updated_at
    ON chunk_embeddings(updated_at DESC);

    CREATE TABLE IF NOT EXISTS prompt_optimizations (
      cache_key TEXT PRIMARY KEY,
      prompt_id TEXT,
      language TEXT,
      task_type TEXT,
      model TEXT,
      mode TEXT,
      optimized_prompt TEXT,
      changes_json TEXT,
      rationale_json TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_prompt_optimizations_updated_at
    ON prompt_optimizations(updated_at DESC);

    CREATE TABLE IF NOT EXISTS prompt_effect_assessments (
      cache_key TEXT PRIMARY KEY,
      prompt_id TEXT,
      task_type TEXT,
      model TEXT,
      available INTEGER NOT NULL DEFAULT 0,
      mode TEXT,
      verdict TEXT,
      confidence REAL,
      summary TEXT,
      strengths_json TEXT,
      risks_json TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_prompt_effect_assessments_updated_at
    ON prompt_effect_assessments(updated_at DESC);

    CREATE TABLE IF NOT EXISTS patch_dir_presets (
      id TEXT PRIMARY KEY,
      alias TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_patch_dir_presets_updated_at
    ON patch_dir_presets(updated_at DESC);

    CREATE TABLE IF NOT EXISTS knowledge_items (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_subtype TEXT,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      summary TEXT,
      source_url TEXT,
      source_file TEXT,
      tags_json TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_items_updated_at
    ON knowledge_items(updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_knowledge_items_type_status
    ON knowledge_items(source_type, status);

    CREATE TABLE IF NOT EXISTS bug_inbox (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      bug_code TEXT NOT NULL,
      patch_file TEXT,
      patch_path TEXT,
      patch_dir TEXT,
      cursor_root TEXT,
      conversation_id TEXT,
      score REAL,
      snippet_json TEXT,
      matched_snippets_json TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bug_inbox_created_at
    ON bug_inbox(created_at DESC);
  `)
}

function setKv(key, value) {
  const database = getDb()
  database
    .prepare(
      `INSERT INTO kv(key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), nowIso())
}

function getKv(key, fallback) {
  const database = getDb()
  const row = database.prepare('SELECT value FROM kv WHERE key = ?').get(key)
  if (!row?.value) return fallback
  try {
    return JSON.parse(row.value)
  } catch {
    return fallback
  }
}

function clearSessions() {
  const database = getDb()
  database.exec('DELETE FROM sessions;')
  database.exec('DELETE FROM sessions_fts;')
  database.exec('DELETE FROM session_chunks;')
  database.exec('DELETE FROM session_chunks_fts;')
}

function pruneOrphanSessionEmbeddings() {
  const database = getDb()
  database.exec(`
    DELETE FROM session_embeddings
    WHERE session_id NOT IN (SELECT id FROM sessions)
  `)
}

function pruneOrphanChunkEmbeddings() {
  const database = getDb()
  database.exec(`
    DELETE FROM chunk_embeddings
    WHERE chunk_id NOT IN (SELECT id FROM session_chunks)
  `)
}

function runTransaction(fn) {
  const database = getDb()
  database.exec('BEGIN;')
  try {
    fn()
    database.exec('COMMIT;')
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }
}

function sessionRowFromItem(item) {
  const sanitizedTitle = sanitizeSessionTitle(item?.title || '')
  const sanitizedMessages = sanitizeSessionMessages(item?.messages)
  return {
    id: String(item?.id || ''),
    sourceId: item?.sourceId ? String(item.sourceId) : null,
    sourceType: item?.sourceType ? String(item.sourceType) : null,
    provider: item?.provider ? String(item.provider) : '',
    title: sanitizedTitle,
    updatedAt: item?.updatedAt ? String(item.updatedAt) : nowIso(),
    tagsJson: JSON.stringify(Array.isArray(item?.tags) ? item.tags : []),
    messagesJson: JSON.stringify(sanitizedMessages),
    metaJson: JSON.stringify(item?.meta && typeof item.meta === 'object' ? item.meta : {}),
    searchableText: String(item?.searchableText || '').toLowerCase(),
  }
}

function normalizeTags(input) {
  const list = Array.isArray(input) ? input : []
  const unique = new Set()
  for (const raw of list) {
    const value = String(raw || '').trim()
    if (!value) continue
    unique.add(value)
  }
  return Array.from(unique).slice(0, 12)
}

function parseMessagesJson(raw) {
  try {
    const parsed = JSON.parse(String(raw || '[]'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function mergeMessageTags(incomingMessages, existingMessages) {
  const current = Array.isArray(incomingMessages) ? incomingMessages : []
  const existing = Array.isArray(existingMessages) ? existingMessages : []
  if (!existing.length) {
    return current.map((msg) => ({
      ...msg,
      tags: normalizeTags(msg?.tags),
    }))
  }

  const normalizeContent = (value) =>
    cleanConversationContent(String(value || ''), { role: 'assistant' })
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()

  const signatureOf = (msg) => {
    const role = String(msg?.role || '').trim().toLowerCase()
    const content = normalizeContent(msg?.content || '')
    if (!role && !content) return ''
    return `${role}::${content}`
  }

  const existingTagMap = new Map()
  const existingTagBySignature = new Map()
  for (const msg of existing) {
    const id = String(msg?.id || '').trim()
    const tags = normalizeTags(msg?.tags)
    if (id) existingTagMap.set(id, tags)

    const signature = signatureOf(msg)
    if (signature) {
      const prev = existingTagBySignature.get(signature) || []
      existingTagBySignature.set(signature, normalizeTags([...prev, ...tags]))
    }
  }

  return current.map((msg) => {
    const id = String(msg?.id || '').trim()
    const incomingTags = normalizeTags(msg?.tags)
    if (id && existingTagMap.has(id)) {
      const merged = normalizeTags([...(existingTagMap.get(id) || []), ...incomingTags])
      return {
        ...msg,
        tags: merged,
      }
    }

    const signature = signatureOf(msg)
    if (!signature || !existingTagBySignature.has(signature)) {
      return { ...msg, tags: incomingTags }
    }

    const merged = normalizeTags([...(existingTagBySignature.get(signature) || []), ...incomingTags])
    return {
      ...msg,
      tags: merged,
    }
  })
}

function computeSearchableText(session) {
  const title = String(session?.title || '')
  const provider = String(session?.provider || '')
  const sessionTags = Array.isArray(session?.tags) ? session.tags : []
  const messages = Array.isArray(session?.messages) ? session.messages : []
  const parts = [title, provider, sessionTags.join(' ')]

  for (const msg of messages) {
    const role = String(msg?.role || '')
    const content = cleanConversationContent(msg?.content || '', { role })
    const tags = Array.isArray(msg?.tags) ? msg.tags : []
    parts.push(`${role} ${content} ${tags.join(' ')}`)
  }

  return parts.join(' ').toLowerCase().trim()
}

function computeChunkSearchableText(chunk) {
  const meta = chunk?.meta && typeof chunk.meta === 'object' ? chunk.meta : {}
  return [
    String(chunk?.title || ''),
    String(chunk?.provider || ''),
    String(chunk?.summary || ''),
    String(chunk?.contentText || ''),
    String(meta.userIntent || ''),
    String(meta.assistantSummary || ''),
    Array.isArray(meta.filePaths) ? meta.filePaths.join(' ') : '',
    Array.isArray(meta.errorKeywords) ? meta.errorKeywords.join(' ') : '',
    Array.isArray(meta.codeSymbols) ? meta.codeSymbols.join(' ') : '',
  ]
    .join(' ')
    .toLowerCase()
    .trim()
}

function insertSessions(list) {
  const safeList = Array.isArray(list) ? list : []
  const database = getDb()
  const selectExistingSession = database.prepare(
    `SELECT id, source_id, source_type, provider, title, updated_at, tags_json, messages_json, meta_json, searchable_text
     FROM sessions
     WHERE id = ?`,
  )
  const insertSession = database.prepare(
    `INSERT INTO sessions (
      id, source_id, source_type, provider, title, updated_at, tags_json, messages_json, meta_json, searchable_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_id=excluded.source_id,
      source_type=excluded.source_type,
      provider=excluded.provider,
      title=excluded.title,
      updated_at=excluded.updated_at,
      tags_json=excluded.tags_json,
      messages_json=excluded.messages_json,
      meta_json=excluded.meta_json,
      searchable_text=excluded.searchable_text`,
  )
  const insertFts = database.prepare(
    'INSERT INTO sessions_fts(id, title, provider, tags, searchable_text) VALUES (?, ?, ?, ?, ?)',
  )
  const deleteFts = database.prepare('DELETE FROM sessions_fts WHERE id = ?')
  const deleteChunks = database.prepare('DELETE FROM session_chunks WHERE session_id = ?')
  const deleteChunkFts = database.prepare('DELETE FROM session_chunks_fts WHERE session_id = ?')
  const deleteChunkEmbeddings = database.prepare('DELETE FROM chunk_embeddings WHERE session_id = ?')
  const insertChunk = database.prepare(
    `INSERT INTO session_chunks(
      id, session_id, provider, title, session_updated_at, chunk_index, summary, content_text, content_hash, searchable_text, meta_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      session_id=excluded.session_id,
      provider=excluded.provider,
      title=excluded.title,
      session_updated_at=excluded.session_updated_at,
      chunk_index=excluded.chunk_index,
      summary=excluded.summary,
      content_text=excluded.content_text,
      content_hash=excluded.content_hash,
      searchable_text=excluded.searchable_text,
      meta_json=excluded.meta_json,
      updated_at=excluded.updated_at`,
  )
  const insertChunkFts = database.prepare(
    'INSERT INTO session_chunks_fts(id, session_id, title, provider, summary, searchable_text) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const selectExistingChunkEmbeddings = database.prepare(
    `SELECT c.id, c.content_hash, e.model, e.dims, e.vector_json, e.updated_at
     FROM session_chunks c
     LEFT JOIN chunk_embeddings e ON e.chunk_id = c.id
     WHERE c.session_id = ?`,
  )
  const insertChunkEmbedding = database.prepare(
    `INSERT INTO chunk_embeddings(chunk_id, session_id, model, dims, content_hash, vector_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chunk_id) DO UPDATE SET
       session_id=excluded.session_id,
       model=excluded.model,
       dims=excluded.dims,
       content_hash=excluded.content_hash,
       vector_json=excluded.vector_json,
       updated_at=excluded.updated_at`,
  )

  for (const item of safeList) {
    const row = sessionRowFromItem(item)
    if (!row.id) continue
    const existing = selectExistingSession.get(row.id)
    const existingSession = existing ? parseSessionRow(existing) : null
    const existingChunkEmbeddings = selectExistingChunkEmbeddings.all(row.id)
    const existingMessages = parseMessagesJson(existing?.messages_json)
    const mergedMessages = mergeMessageTags(item?.messages, existingMessages)
    const normalizedMeta = buildSessionMetaForSourceUpsert(
      item?.meta,
      {
        ...item,
        id: row.id,
        sourceId: row.sourceId,
        sourceType: row.sourceType,
        provider: row.provider,
        title: row.title,
        updatedAt: row.updatedAt,
        messages: mergedMessages,
      },
      existingSession?.meta,
    )
    const searchableText = computeSearchableText({
      ...item,
      messages: mergedMessages,
    })
    const reusableEmbeddingByHash = new Map()

    for (const chunkRow of existingChunkEmbeddings) {
      const contentHash = String(chunkRow?.content_hash || '').trim()
      const vectorJson = String(chunkRow?.vector_json || '').trim()
      if (!contentHash || !vectorJson) continue
      if (reusableEmbeddingByHash.has(contentHash)) continue
      reusableEmbeddingByHash.set(contentHash, {
        model: String(chunkRow?.model || ''),
        dims: Number(chunkRow?.dims || 0),
        vectorJson,
        updatedAt: String(chunkRow?.updated_at || nowIso()),
      })
    }

    insertSession.run(
      row.id,
      row.sourceId,
      row.sourceType,
      row.provider,
      row.title,
      row.updatedAt,
      row.tagsJson,
      JSON.stringify(mergedMessages),
      JSON.stringify(normalizedMeta),
      searchableText || row.searchableText,
    )
    deleteFts.run(row.id)
    insertFts.run(row.id, row.title, row.provider, row.tagsJson, searchableText || row.searchableText)

    deleteChunks.run(row.id)
    deleteChunkFts.run(row.id)
    deleteChunkEmbeddings.run(row.id)
    const chunks = buildSessionChunks({
      ...item,
      id: row.id,
      title: row.title,
      provider: row.provider,
      updatedAt: row.updatedAt,
      messages: mergedMessages,
    })
    const now = nowIso()
    for (const chunk of chunks) {
      const searchableChunk = computeChunkSearchableText(chunk)
      insertChunk.run(
        String(chunk.id || ''),
        row.id,
        String(chunk.provider || row.provider || ''),
        String(chunk.title || row.title || ''),
        String(chunk.updatedAt || row.updatedAt || now),
        Number(chunk.chunkIndex || 0),
        String(chunk.summary || ''),
        String(chunk.contentText || ''),
        String(chunk.contentHash || ''),
        searchableChunk,
        JSON.stringify(chunk.meta && typeof chunk.meta === 'object' ? chunk.meta : {}),
        now,
      )
      insertChunkFts.run(
        String(chunk.id || ''),
        row.id,
        String(chunk.title || row.title || ''),
        String(chunk.provider || row.provider || ''),
        String(chunk.summary || ''),
        searchableChunk,
      )

      const reusableEmbedding = reusableEmbeddingByHash.get(String(chunk.contentHash || ''))
      if (reusableEmbedding?.vectorJson) {
        insertChunkEmbedding.run(
          String(chunk.id || ''),
          row.id,
          reusableEmbedding.model,
          reusableEmbedding.dims,
          String(chunk.contentHash || ''),
          reusableEmbedding.vectorJson,
          reusableEmbedding.updatedAt,
        )
      }
    }
  }
}

function parseSessionRow(row) {
  let tags = []
  let messages = []
  let meta = {}
  try {
    tags = JSON.parse(row.tags_json || '[]')
  } catch {}
  try {
    messages = JSON.parse(row.messages_json || '[]')
  } catch {}
  try {
    meta = JSON.parse(row.meta_json || '{}')
  } catch {}

  return {
    id: row.id,
    sourceId: row.source_id,
    sourceType: row.source_type || undefined,
    provider: row.provider || '',
    title: sanitizeSessionTitle(row.title || ''),
    updatedAt: row.updated_at || null,
    tags: Array.isArray(tags) ? tags : [],
    messages: sanitizeSessionMessages(messages),
    meta: meta && typeof meta === 'object' ? meta : {},
    searchableText: row.searchable_text || '',
  }
}

function parseSessionChunkRow(row) {
  let meta = {}
  try {
    meta = JSON.parse(row.meta_json || '{}')
  } catch {}

  return {
    id: String(row.id || ''),
    sessionId: String(row.session_id || ''),
    provider: String(row.provider || ''),
    title: String(row.title || ''),
    updatedAt: String(row.session_updated_at || ''),
    chunkIndex: Number(row.chunk_index || 0),
    summary: String(row.summary || ''),
    contentText: String(row.content_text || ''),
    contentHash: String(row.content_hash || ''),
    searchableText: String(row.searchable_text || ''),
    meta: meta && typeof meta === 'object' ? meta : {},
  }
}

function escapeLike(input) {
  return String(input || '').replace(/[%_\\]/g, '\\$&')
}

function normalizeFtsQuery(input) {
  const raw = String(input || '').trim().toLowerCase()
  if (!raw) return ''
  const tokens = raw
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    .slice(0, 10)
  if (!tokens.length) return ''
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' OR ')
}

async function seedFromJsonSnapshotIfNeeded() {
  const database = getDb()
  const row = database.prepare('SELECT COUNT(*) AS c FROM sessions').get()
  if ((row?.c || 0) > 0) return

  const [sources, index] = await Promise.all([
    readJson(files.sources, []),
    readJson(files.index, { updatedAt: null, sessions: [], issues: [] }),
  ])

  if (Array.isArray(sources) && sources.length) setKv('sources', sources)

  if (index && typeof index === 'object') {
    const sessions = Array.isArray(index.sessions) ? index.sessions : []
    if (sessions.length) insertSessions(sessions)
    setKv('index_meta', {
      updatedAt: index.updatedAt || nowIso(),
      issues: Array.isArray(index.issues) ? index.issues : [],
    })
  }
}

function backfillChunksFromSessionsIfNeeded() {
  const database = getDb()
  const sessionCount = Number(database.prepare('SELECT COUNT(*) AS c FROM sessions').get()?.c || 0)
  if (!sessionCount) return

  const chunkCount = Number(database.prepare('SELECT COUNT(*) AS c FROM session_chunks').get()?.c || 0)
  const chunkedSessionCount = Number(
    database.prepare('SELECT COUNT(*) AS c FROM (SELECT DISTINCT session_id FROM session_chunks) scoped').get()?.c || 0,
  )
  if (chunkCount > 0 && chunkedSessionCount >= sessionCount) return

  const rows = database
    .prepare(
      `SELECT id, source_id, source_type, provider, title, updated_at, tags_json, messages_json, meta_json, searchable_text
       FROM sessions
       ORDER BY datetime(updated_at) DESC`,
    )
    .all()
  if (!rows.length) return

  runTransaction(() => {
    insertSessions(rows.map(parseSessionRow))
  })
}

async function ensureReady() {
  if (initialized) return
  initSchema()
  await seedFromJsonSnapshotIfNeeded()
  backfillChunksFromSessionsIfNeeded()
  initialized = true
}

export async function loadSourcesFromDb() {
  await ensureReady()
  return getKv('sources', [])
}

export async function saveSourcesToDb(sources) {
  await ensureReady()
  const list = Array.isArray(sources) ? sources : []
  setKv('sources', list)
  return list
}

export async function saveIndexToDb(index) {
  await ensureReady()
  const sessions = Array.isArray(index?.sessions) ? index.sessions : []
  const issues = Array.isArray(index?.issues) ? index.issues : []
  const updatedAt = index?.updatedAt || nowIso()

  runTransaction(() => {
    clearSessions()
    insertSessions(sessions)
    pruneOrphanSessionEmbeddings()
    pruneOrphanChunkEmbeddings()
    setKv('index_meta', { updatedAt, issues })
  })
}

export async function mergeIndexToDb(index) {
  await ensureReady()
  const sessions = Array.isArray(index?.sessions) ? index.sessions : []
  const issues = Array.isArray(index?.issues) ? index.issues : []
  const updatedAt = index?.updatedAt || nowIso()

  insertSessions(sessions)
  setKv('index_meta', { updatedAt, issues })
}

export async function loadIndexFromDb() {
  await ensureReady()
  const meta = getKv('index_meta', { updatedAt: null, issues: [] })
  const database = getDb()
  const rows = database
    .prepare(
      `SELECT id, source_id, source_type, provider, title, updated_at, tags_json, messages_json, meta_json, searchable_text
       FROM sessions
       ORDER BY datetime(updated_at) DESC`,
    )
    .all()
  return {
    updatedAt: meta?.updatedAt || null,
    issues: Array.isArray(meta?.issues) ? meta.issues : [],
    sessions: rows.map(parseSessionRow),
  }
}

export async function querySessionsFromDb({ q = '', provider = '', from = '', to = '', conversationId = '' } = {}) {
  await ensureReady()
  const query = String(q || '').trim().toLowerCase()
  const p = String(provider || '').trim().toLowerCase()
  const fromIso = String(from || '').trim()
  const toIso = String(to || '').trim()
  const convoId = String(conversationId || '').trim().toLowerCase()
  const database = getDb()

  const whereParts = []
  const whereParams = []
  if (p) {
    whereParts.push('lower(provider) = ?')
    whereParams.push(p)
  }
  if (fromIso) {
    whereParts.push('datetime(updated_at) >= datetime(?)')
    whereParams.push(fromIso)
  }
  if (toIso) {
    whereParts.push('datetime(updated_at) <= datetime(?)')
    whereParams.push(toIso)
  }
  if (convoId) {
    whereParts.push(
      `(lower(COALESCE(json_extract(meta_json, '$.cursorConversationId'), '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(json_extract(meta_json, '$.codexSessionId'), '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(json_extract(meta_json, '$.claudeCodeSessionId'), '')) LIKE ? ESCAPE '\\' OR lower(id) LIKE ? ESCAPE '\\')`,
    )
    whereParams.push(`%${escapeLike(convoId)}%`)
    whereParams.push(`%${escapeLike(convoId)}%`)
    whereParams.push(`%${escapeLike(convoId)}%`)
    whereParams.push(`%${escapeLike(convoId)}%`)
  }
  whereParts.push(`lower(COALESCE(json_extract(meta_json, '$.review.status'), 'pending')) != 'hidden'`)
  const whereClause = whereParts.length ? ` AND ${whereParts.join(' AND ')}` : ''

  let rows = []
  if (query) {
    rows = database
      .prepare(
        `SELECT id, source_id, source_type, provider, title, updated_at, tags_json, messages_json, meta_json, searchable_text
         FROM sessions
         WHERE searchable_text LIKE ? ${whereClause}
         ORDER BY datetime(updated_at) DESC`,
      )
      .all(`%${query}%`, ...whereParams)
  } else if (whereParts.length) {
    rows = database
      .prepare(
        `SELECT id, source_id, source_type, provider, title, updated_at, tags_json, messages_json, meta_json, searchable_text
         FROM sessions
         WHERE 1=1 ${whereClause}
         ORDER BY datetime(updated_at) DESC`,
      )
      .all(...whereParams)
  } else {
    rows = database
      .prepare(
        `SELECT id, source_id, source_type, provider, title, updated_at, tags_json, messages_json, meta_json, searchable_text
         FROM sessions
         ORDER BY datetime(updated_at) DESC`,
      )
      .all()
  }

  const meta = getKv('index_meta', { updatedAt: null, issues: [] })
  return {
    updatedAt: meta?.updatedAt || null,
    issues: Array.isArray(meta?.issues) ? meta.issues : [],
    sessions: rows.map(parseSessionRow),
  }
}

export async function loadSessionsByIdsFromDb(sessionIds = []) {
  await ensureReady()
  const ids = Array.isArray(sessionIds) ? sessionIds.map((id) => String(id || '').trim()).filter(Boolean) : []
  if (!ids.length) return []

  const database = getDb()
  const placeholders = ids.map(() => '?').join(',')
  const rows = database
    .prepare(
      `SELECT id, source_id, source_type, provider, title, updated_at, tags_json, messages_json, meta_json, searchable_text
       FROM sessions
       WHERE id IN (${placeholders})
       ORDER BY datetime(updated_at) DESC`,
    )
    .all(...ids)

  return rows.map(parseSessionRow)
}

export async function deleteSessionByIdFromDb(sessionId) {
  await ensureReady()
  const id = String(sessionId || '').trim()
  if (!id) return { removed: false }

  const database = getDb()
  const deleteSessionStmt = database.prepare('DELETE FROM sessions WHERE id = ?')
  const deleteFtsStmt = database.prepare('DELETE FROM sessions_fts WHERE id = ?')
  const deleteEmbeddingStmt = database.prepare('DELETE FROM session_embeddings WHERE session_id = ?')
  const deleteChunksStmt = database.prepare('DELETE FROM session_chunks WHERE session_id = ?')
  const deleteChunkFtsStmt = database.prepare('DELETE FROM session_chunks_fts WHERE session_id = ?')
  const deleteChunkEmbeddingStmt = database.prepare('DELETE FROM chunk_embeddings WHERE session_id = ?')

  let removed = false
  runTransaction(() => {
    const result = deleteSessionStmt.run(id)
    deleteFtsStmt.run(id)
    deleteEmbeddingStmt.run(id)
    deleteChunksStmt.run(id)
    deleteChunkFtsStmt.run(id)
    deleteChunkEmbeddingStmt.run(id)
    removed = Number(result?.changes || 0) > 0
  })

  if (removed) {
    const meta = getKv('index_meta', { updatedAt: null, issues: [] })
    setKv('index_meta', {
      updatedAt: nowIso(),
      issues: Array.isArray(meta?.issues) ? meta.issues : [],
    })
  }

  return { removed }
}

export async function loadSessionEmbeddingsByIdsFromDb(sessionIds = []) {
  await ensureReady()
  const ids = Array.isArray(sessionIds) ? sessionIds.map((id) => String(id || '').trim()).filter(Boolean) : []
  if (!ids.length) return []

  const database = getDb()
  const placeholders = ids.map(() => '?').join(',')
  const rows = database
    .prepare(
      `SELECT session_id, model, dims, vector_json, updated_at
       FROM session_embeddings
       WHERE session_id IN (${placeholders})`,
    )
    .all(...ids)

  return rows
    .map((row) => {
      let vector = []
      try {
        vector = JSON.parse(String(row?.vector_json || '[]'))
      } catch {
        vector = []
      }
      return {
        sessionId: String(row?.session_id || ''),
        model: String(row?.model || ''),
        dims: Number(row?.dims || 0),
        vector: Array.isArray(vector) ? vector.map((v) => Number(v) || 0) : [],
        updatedAt: String(row?.updated_at || ''),
      }
    })
    .filter((row) => row.sessionId)
}

export async function loadChunkEmbeddingsByIdsFromDb(chunkIds = []) {
  await ensureReady()
  const ids = Array.isArray(chunkIds) ? chunkIds.map((id) => String(id || '').trim()).filter(Boolean) : []
  if (!ids.length) return []

  const database = getDb()
  const placeholders = ids.map(() => '?').join(',')
  const rows = database
    .prepare(
      `SELECT chunk_id, session_id, model, dims, content_hash, vector_json, updated_at
       FROM chunk_embeddings
       WHERE chunk_id IN (${placeholders})`,
    )
    .all(...ids)

  return rows
    .map((row) => {
      let vector = []
      try {
        vector = JSON.parse(String(row?.vector_json || '[]'))
      } catch {
        vector = []
      }
      return {
        chunkId: String(row?.chunk_id || ''),
        sessionId: String(row?.session_id || ''),
        model: String(row?.model || ''),
        dims: Number(row?.dims || 0),
        contentHash: String(row?.content_hash || ''),
        vector: Array.isArray(vector) ? vector.map((v) => Number(v) || 0) : [],
        updatedAt: String(row?.updated_at || ''),
      }
    })
    .filter((row) => row.chunkId)
}

export async function saveEmbeddingBuildRecordInDb(record = {}) {
  await ensureReady()
  const provider = String(record?.provider || 'all').trim().toLowerCase() || 'all'
  const generatedAt = String(record?.generatedAt || nowIso())
  const generated = Math.max(0, Number(record?.generated || 0))
  const targetCount = Math.max(0, Number(record?.targetCount || 0))
  const totalSessions = Math.max(0, Number(record?.totalSessions || 0))

  const next = {
    provider,
    generatedAt,
    generated,
    targetCount,
    totalSessions,
  }

  const key = 'embedding_build_history'
  const history = getKv(key, [])
  const list = Array.isArray(history) ? history : []
  const filtered = list.filter((item) => {
    const p = String(item?.provider || '').trim().toLowerCase()
    const at = String(item?.generatedAt || '')
    return !(p === provider && at === generatedAt)
  })
  const merged = [next, ...filtered].slice(0, 120)
  setKv(key, merged)
  return next
}

export async function loadEmbeddingBuildStatsFromDb({ provider = '' } = {}) {
  await ensureReady()
  const normalizedProvider = String(provider || '').trim().toLowerCase()
  const scopeProvider = normalizedProvider && normalizedProvider !== 'all' ? normalizedProvider : ''
  const providerLabel = scopeProvider || 'all'
  const database = getDb()

  const totalSessions = scopeProvider
    ? Number(
      database
        .prepare('SELECT COUNT(*) AS c FROM sessions WHERE lower(provider) = ?')
        .get(scopeProvider)?.c || 0,
    )
    : Number(database.prepare('SELECT COUNT(*) AS c FROM sessions').get()?.c || 0)

  const embeddedSessions = scopeProvider
    ? Number(
      database
        .prepare(
          `SELECT COUNT(*) AS c
           FROM (
             SELECT DISTINCT c.session_id
             FROM chunk_embeddings e
             JOIN session_chunks c ON c.id = e.chunk_id
             JOIN sessions s ON s.id = c.session_id
             WHERE lower(s.provider) = ?
           ) scoped`,
        )
        .get(scopeProvider)?.c || 0,
    )
    : Number(
      database
        .prepare('SELECT COUNT(*) AS c FROM (SELECT DISTINCT session_id FROM chunk_embeddings) scoped')
        .get()?.c || 0,
    )
  const totalChunks = scopeProvider
    ? Number(
      database
        .prepare(
          `SELECT COUNT(*) AS c
           FROM session_chunks c
           JOIN sessions s ON s.id = c.session_id
           WHERE lower(s.provider) = ?`,
        )
        .get(scopeProvider)?.c || 0,
    )
    : Number(database.prepare('SELECT COUNT(*) AS c FROM session_chunks').get()?.c || 0)
  const embeddedChunks = scopeProvider
    ? Number(
      database
        .prepare(
          `SELECT COUNT(*) AS c
           FROM chunk_embeddings e
           JOIN session_chunks c ON c.id = e.chunk_id
           JOIN sessions s ON s.id = c.session_id
           WHERE lower(s.provider) = ?`,
        )
        .get(scopeProvider)?.c || 0,
    )
    : Number(database.prepare('SELECT COUNT(*) AS c FROM chunk_embeddings').get()?.c || 0)

  const history = getKv('embedding_build_history', [])
  const list = Array.isArray(history) ? history : []
  const lastRecord = list.find((item) => {
    const p = String(item?.provider || '').trim().toLowerCase() || 'all'
    return p === providerLabel
  }) || null

  return {
    provider: providerLabel,
    totalSessions,
    embeddedSessions,
    totalChunks,
    embeddedChunks,
    lastBuildAt: String(lastRecord?.generatedAt || '') || null,
    lastBuildGenerated: Number(lastRecord?.generated || 0),
    lastBuildTargetCount: Number(lastRecord?.targetCount || 0),
    lastBuildTotalSessions: Number(lastRecord?.totalSessions || 0),
  }
}

export async function upsertSessionEmbeddingsInDb(records = []) {
  await ensureReady()
  const list = Array.isArray(records) ? records : []
  if (!list.length) return { upserted: 0 }

  const database = getDb()
  const stmt = database.prepare(
    `INSERT INTO session_embeddings(session_id, model, dims, vector_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       model=excluded.model,
       dims=excluded.dims,
       vector_json=excluded.vector_json,
       updated_at=excluded.updated_at`,
  )

  let upserted = 0
  runTransaction(() => {
    for (const record of list) {
      const sessionId = String(record?.sessionId || '').trim()
      const vector = Array.isArray(record?.vector) ? record.vector.map((v) => Number(v) || 0) : []
      if (!sessionId || !vector.length) continue
      const model = String(record?.model || '')
      const dims = Number(record?.dims || vector.length || 0)
      const updatedAt = String(record?.updatedAt || nowIso())
      stmt.run(sessionId, model, dims, JSON.stringify(vector), updatedAt)
      upserted += 1
    }
  })

  return { upserted }
}

export async function upsertChunkEmbeddingsInDb(records = []) {
  await ensureReady()
  const list = Array.isArray(records) ? records : []
  if (!list.length) return { upserted: 0 }

  const database = getDb()
  const stmt = database.prepare(
    `INSERT INTO chunk_embeddings(chunk_id, session_id, model, dims, content_hash, vector_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chunk_id) DO UPDATE SET
       session_id=excluded.session_id,
       model=excluded.model,
       dims=excluded.dims,
       content_hash=excluded.content_hash,
       vector_json=excluded.vector_json,
       updated_at=excluded.updated_at`,
  )

  let upserted = 0
  runTransaction(() => {
    for (const record of list) {
      const chunkId = String(record?.chunkId || '').trim()
      const sessionId = String(record?.sessionId || '').trim()
      const vector = Array.isArray(record?.vector) ? record.vector.map((v) => Number(v) || 0) : []
      if (!chunkId || !sessionId || !vector.length) continue
      const model = String(record?.model || '')
      const dims = Number(record?.dims || vector.length || 0)
      const contentHash = String(record?.contentHash || '')
      const updatedAt = String(record?.updatedAt || nowIso())
      stmt.run(chunkId, sessionId, model, dims, contentHash, JSON.stringify(vector), updatedAt)
      upserted += 1
    }
  })

  return { upserted }
}

export async function listSessionsForEmbeddingFromDb({ provider = '', limit = 300 } = {}) {
  await ensureReady()
  const p = String(provider || '')
    .trim()
    .toLowerCase()
  const maxLimit = Math.max(1, Math.min(5000, Number(limit || 300)))
  const database = getDb()

  const rows = p
    ? database
        .prepare(
          `SELECT id, source_id, source_type, provider, title, updated_at, tags_json, messages_json, meta_json, searchable_text
           FROM sessions
           WHERE lower(provider) = ?
           ORDER BY datetime(updated_at) DESC
           LIMIT ?`,
        )
        .all(p, maxLimit)
    : database
        .prepare(
          `SELECT id, source_id, source_type, provider, title, updated_at, tags_json, messages_json, meta_json, searchable_text
           FROM sessions
           ORDER BY datetime(updated_at) DESC
           LIMIT ?`,
        )
        .all(maxLimit)

  return rows.map(parseSessionRow)
}

export async function listSessionChunksForEmbeddingFromDb({ sessionIds = [], provider = '', limit = 5000 } = {}) {
  await ensureReady()
  const ids = Array.isArray(sessionIds) ? sessionIds.map((id) => String(id || '').trim()).filter(Boolean) : []
  const p = String(provider || '').trim().toLowerCase()
  const maxLimit = Math.max(1, Math.min(20000, Number(limit || 5000)))
  const database = getDb()

  let rows = []
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',')
    rows = database
      .prepare(
        `SELECT id, session_id, provider, title, session_updated_at, chunk_index, summary, content_text, content_hash, searchable_text, meta_json
         FROM session_chunks
         WHERE session_id IN (${placeholders})
         ORDER BY datetime(session_updated_at) DESC, chunk_index ASC
         LIMIT ?`,
      )
      .all(...ids, maxLimit)
  } else if (p) {
    rows = database
      .prepare(
        `SELECT id, session_id, provider, title, session_updated_at, chunk_index, summary, content_text, content_hash, searchable_text, meta_json
         FROM session_chunks
         WHERE lower(provider) = ?
         ORDER BY datetime(session_updated_at) DESC, chunk_index ASC
         LIMIT ?`,
      )
      .all(p, maxLimit)
  } else {
    rows = database
      .prepare(
        `SELECT id, session_id, provider, title, session_updated_at, chunk_index, summary, content_text, content_hash, searchable_text, meta_json
         FROM session_chunks
         ORDER BY datetime(session_updated_at) DESC, chunk_index ASC
         LIMIT ?`,
      )
      .all(maxLimit)
  }

  return rows.map(parseSessionChunkRow)
}

export async function updateMessageTagsInDb({ sessionId = '', messageIds = [], tags = [] } = {}) {
  await ensureReady()
  const sid = String(sessionId || '').trim()
  const msgIds = Array.isArray(messageIds)
    ? messageIds.map((id) => String(id || '').trim()).filter(Boolean)
    : []
  if (!sid || !msgIds.length) return { updated: false, matched: 0 }

  const normalizedTags = normalizeTags(tags)
  const database = getDb()
  const row = database
    .prepare(
      `SELECT id, source_id, source_type, provider, title, updated_at, tags_json, messages_json, meta_json, searchable_text
       FROM sessions WHERE id = ?`,
    )
    .get(sid)
  if (!row) return { updated: false, matched: 0 }

  const session = parseSessionRow(row)
  const idSet = new Set(msgIds)
  let matched = 0
  const updatedMessages = (Array.isArray(session.messages) ? session.messages : []).map((msg) => {
    const mid = String(msg?.id || '').trim()
    if (!idSet.has(mid)) return msg
    matched += 1
    return {
      ...msg,
      tags: normalizedTags,
    }
  })
  if (!matched) return { updated: false, matched: 0 }

  const updatedSession = {
    ...session,
    messages: updatedMessages,
  }
  const searchableText = computeSearchableText(updatedSession)

  runTransaction(() => {
    database
      .prepare(
        `UPDATE sessions
         SET messages_json = ?, searchable_text = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify(updatedMessages), searchableText, nowIso(), sid)

    database.prepare('DELETE FROM sessions_fts WHERE id = ?').run(sid)
    database
      .prepare('INSERT INTO sessions_fts(id, title, provider, tags, searchable_text) VALUES (?, ?, ?, ?, ?)')
      .run(
        sid,
        String(session.title || ''),
        String(session.provider || ''),
        JSON.stringify(Array.isArray(session.tags) ? session.tags : []),
        searchableText,
      )
  })

  const meta = getKv('index_meta', { updatedAt: null, issues: [] })
  setKv('index_meta', {
    updatedAt: nowIso(),
    issues: Array.isArray(meta?.issues) ? meta.issues : [],
  })

  return { updated: true, matched }
}

export async function updateSessionReviewInDb({
  id = '',
  segmentId = '',
  status,
  keepInSearch,
  qualityScore,
  note,
  reviewedBy,
} = {}) {
  await ensureReady()
  const sessionId = String(id || '').trim()
  if (!sessionId) return { updated: false, session: null }

  const database = getDb()
  const row = database
    .prepare(
      `SELECT id, source_id, source_type, provider, title, updated_at, tags_json, messages_json, meta_json, searchable_text
       FROM sessions
       WHERE id = ?`,
    )
    .get(sessionId)
  if (!row) return { updated: false, session: null }

  const session = parseSessionRow(row)
  const nextMeta = buildSessionMetaForReviewPatch(session.meta, {
    status,
    keepInSearch,
    qualityScore,
    note,
    reviewedBy,
    reviewedAt: nowIso(),
  }, segmentId)

  database
    .prepare(
      `UPDATE sessions
       SET meta_json = ?
       WHERE id = ?`,
    )
    .run(JSON.stringify(nextMeta), sessionId)

  const updatedRow = database
    .prepare(
      `SELECT id, source_id, source_type, provider, title, updated_at, tags_json, messages_json, meta_json, searchable_text
       FROM sessions
       WHERE id = ?`,
    )
    .get(sessionId)

  const meta = getKv('index_meta', { updatedAt: null, issues: [] })
  setKv('index_meta', {
    updatedAt: nowIso(),
    issues: Array.isArray(meta?.issues) ? meta.issues : [],
  })

  return {
    updated: true,
    session: updatedRow ? parseSessionRow(updatedRow) : null,
  }
}

export async function retrieveCandidatesFromDb({
  query = '',
  provider = '',
  from = '',
  to = '',
  limit = 120,
} = {}) {
  await ensureReady()
  const q = String(query || '').trim().toLowerCase()
  const p = String(provider || '').trim().toLowerCase()
  const fromIso = String(from || '').trim()
  const toIso = String(to || '').trim()
  const maxLimit = Math.max(1, Math.min(500, Number(limit || 120)))
  const database = getDb()
  const meta = getKv('index_meta', { updatedAt: null, issues: [] })

  const where = []
  const params = []
  if (p) {
    where.push('lower(s.provider) = ?')
    params.push(p)
  }
  if (fromIso) {
    where.push('datetime(s.updated_at) >= datetime(?)')
    params.push(fromIso)
  }
  if (toIso) {
    where.push('datetime(s.updated_at) <= datetime(?)')
    params.push(toIso)
  }
  const whereClause = where.length ? ` AND ${where.join(' AND ')}` : ''

  const dedup = new Map()
  const pushRows = (rows) => {
    for (const row of rows) {
      if (!row?.id) continue
      if (!dedup.has(row.id)) dedup.set(row.id, row)
      if (dedup.size >= maxLimit) break
    }
  }

  if (q) {
    const ftsQuery = normalizeFtsQuery(q)
    if (ftsQuery) {
      const ftsRows = database
        .prepare(
          `SELECT s.id, s.source_id, s.source_type, s.provider, s.title, s.updated_at, s.tags_json, s.messages_json, s.meta_json, s.searchable_text
           FROM sessions s
           JOIN sessions_fts f ON f.id = s.id
           WHERE sessions_fts MATCH ? ${whereClause}
           ORDER BY bm25(sessions_fts), datetime(s.updated_at) DESC
           LIMIT ?`,
        )
        .all(ftsQuery, ...params, maxLimit)
      pushRows(ftsRows)
    }

    if (dedup.size < maxLimit) {
      const likeNeed = maxLimit - dedup.size
      const likeRows = database
        .prepare(
          `SELECT s.id, s.source_id, s.source_type, s.provider, s.title, s.updated_at, s.tags_json, s.messages_json, s.meta_json, s.searchable_text
           FROM sessions s
           WHERE lower(s.searchable_text) LIKE ? ESCAPE '\\' ${whereClause}
           ORDER BY datetime(s.updated_at) DESC
           LIMIT ?`,
        )
        .all(`%${escapeLike(q)}%`, ...params, likeNeed)
      pushRows(likeRows)
    }
  } else {
    const rows = database
      .prepare(
        `SELECT s.id, s.source_id, s.source_type, s.provider, s.title, s.updated_at, s.tags_json, s.messages_json, s.meta_json, s.searchable_text
         FROM sessions s
         WHERE 1=1 ${whereClause}
         ORDER BY datetime(s.updated_at) DESC
         LIMIT ?`,
      )
      .all(...params, maxLimit)
    pushRows(rows)
  }

  return {
    updatedAt: meta?.updatedAt || null,
    issues: Array.isArray(meta?.issues) ? meta.issues : [],
    sessions: Array.from(dedup.values()).map(parseSessionRow),
  }
}

export async function retrieveChunkCandidatesFromDb({
  query = '',
  provider = '',
  from = '',
  to = '',
  limit = 240,
} = {}) {
  await ensureReady()
  const q = String(query || '').trim().toLowerCase()
  const p = String(provider || '').trim().toLowerCase()
  const fromIso = String(from || '').trim()
  const toIso = String(to || '').trim()
  const maxLimit = Math.max(1, Math.min(800, Number(limit || 240)))
  const database = getDb()

  const where = []
  const params = []
  if (p) {
    where.push('lower(c.provider) = ?')
    params.push(p)
  }
  if (fromIso) {
    where.push('datetime(c.session_updated_at) >= datetime(?)')
    params.push(fromIso)
  }
  if (toIso) {
    where.push('datetime(c.session_updated_at) <= datetime(?)')
    params.push(toIso)
  }
  const whereClause = where.length ? ` AND ${where.join(' AND ')}` : ''

  const rows = []
  const seen = new Set()
  const pushRows = (list) => {
    for (const row of list) {
      const id = String(row?.id || '').trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      rows.push(row)
      if (rows.length >= maxLimit) break
    }
  }

  if (q) {
    const ftsQuery = normalizeFtsQuery(q)
    if (ftsQuery) {
      const ftsRows = database
        .prepare(
          `SELECT c.id, c.session_id, c.provider, c.title, c.session_updated_at, c.chunk_index, c.summary, c.content_text, c.content_hash, c.searchable_text, c.meta_json
           FROM session_chunks c
           JOIN session_chunks_fts f ON f.id = c.id
           WHERE session_chunks_fts MATCH ? ${whereClause}
           ORDER BY bm25(session_chunks_fts), datetime(c.session_updated_at) DESC
           LIMIT ?`,
        )
        .all(ftsQuery, ...params, maxLimit)
      pushRows(ftsRows)
    }

    if (rows.length < maxLimit) {
      const likeNeed = maxLimit - rows.length
      const likeRows = database
        .prepare(
          `SELECT c.id, c.session_id, c.provider, c.title, c.session_updated_at, c.chunk_index, c.summary, c.content_text, c.content_hash, c.searchable_text, c.meta_json
           FROM session_chunks c
           WHERE lower(c.searchable_text) LIKE ? ESCAPE '\\' ${whereClause}
           ORDER BY datetime(c.session_updated_at) DESC, c.chunk_index ASC
           LIMIT ?`,
        )
        .all(`%${escapeLike(q)}%`, ...params, likeNeed)
      pushRows(likeRows)
    }
  } else {
    const plainRows = database
      .prepare(
        `SELECT c.id, c.session_id, c.provider, c.title, c.session_updated_at, c.chunk_index, c.summary, c.content_text, c.content_hash, c.searchable_text, c.meta_json
         FROM session_chunks c
         WHERE 1=1 ${whereClause}
         ORDER BY datetime(c.session_updated_at) DESC, c.chunk_index ASC
         LIMIT ?`,
      )
      .all(...params, maxLimit)
    pushRows(plainRows)
  }

  return rows.map(parseSessionChunkRow)
}

export async function isJsonSnapshotEnabled() {
  await ensureReady()
  return SNAPSHOT_ENABLED
}

export async function loadPromptOptimizationByKey(cacheKey) {
  await ensureReady()
  const key = String(cacheKey || '').trim()
  if (!key) return null

  const database = getDb()
  const row = database
    .prepare(
      `SELECT cache_key, prompt_id, language, task_type, model, mode, optimized_prompt, changes_json, rationale_json, meta_json, created_at, updated_at
       FROM prompt_optimizations
       WHERE cache_key = ?`,
    )
    .get(key)
  if (!row) return null

  let changes = []
  let rationale = []
  let meta = {}
  try {
    changes = JSON.parse(row.changes_json || '[]')
  } catch {}
  try {
    rationale = JSON.parse(row.rationale_json || '[]')
  } catch {}
  try {
    meta = JSON.parse(row.meta_json || '{}')
  } catch {}

  return {
    cacheKey: row.cache_key,
    promptId: row.prompt_id || '',
    language: row.language || '',
    taskType: row.task_type || '',
    model: row.model || '',
    mode: row.mode || 'fallback',
    optimizedPrompt: row.optimized_prompt || '',
    changes: Array.isArray(changes) ? changes : [],
    rationale: Array.isArray(rationale) ? rationale : [],
    meta: meta && typeof meta === 'object' ? meta : {},
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

export async function savePromptOptimizationByKey(record) {
  await ensureReady()
  const now = nowIso()
  const cacheKey = String(record?.cacheKey || '').trim()
  if (!cacheKey) throw new Error('cacheKey 必填')

  const database = getDb()
  database
    .prepare(
      `INSERT INTO prompt_optimizations(
         cache_key, prompt_id, language, task_type, model, mode, optimized_prompt, changes_json, rationale_json, meta_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         prompt_id=excluded.prompt_id,
         language=excluded.language,
         task_type=excluded.task_type,
         model=excluded.model,
         mode=excluded.mode,
         optimized_prompt=excluded.optimized_prompt,
         changes_json=excluded.changes_json,
         rationale_json=excluded.rationale_json,
         meta_json=excluded.meta_json,
         updated_at=excluded.updated_at`,
    )
    .run(
      cacheKey,
      String(record?.promptId || ''),
      String(record?.language || ''),
      String(record?.taskType || ''),
      String(record?.model || ''),
      String(record?.mode || 'fallback'),
      String(record?.optimizedPrompt || ''),
      JSON.stringify(Array.isArray(record?.changes) ? record.changes : []),
      JSON.stringify(Array.isArray(record?.rationale) ? record.rationale : []),
      JSON.stringify(record?.meta && typeof record.meta === 'object' ? record.meta : {}),
      now,
      now,
    )

  return loadPromptOptimizationByKey(cacheKey)
}

export async function loadPromptEffectAssessmentByKey(cacheKey) {
  await ensureReady()
  const key = String(cacheKey || '').trim()
  if (!key) return null

  const database = getDb()
  const row = database
    .prepare(
      `SELECT cache_key, prompt_id, task_type, model, available, mode, verdict, confidence, summary, strengths_json, risks_json, meta_json, created_at, updated_at
       FROM prompt_effect_assessments
       WHERE cache_key = ?`,
    )
    .get(key)
  if (!row) return null

  let strengths = []
  let risks = []
  let meta = {}
  try {
    strengths = JSON.parse(row.strengths_json || '[]')
  } catch {}
  try {
    risks = JSON.parse(row.risks_json || '[]')
  } catch {}
  try {
    meta = JSON.parse(row.meta_json || '{}')
  } catch {}

  return {
    cacheKey: row.cache_key,
    promptId: row.prompt_id || '',
    taskType: row.task_type || '',
    effectAssessment: {
      available: Boolean(row.available),
      mode: row.mode || 'unavailable',
      verdict: row.verdict || 'unknown',
      confidence: Number(row.confidence || 0),
      summary: row.summary || '',
      strengths: Array.isArray(strengths) ? strengths : [],
      risks: Array.isArray(risks) ? risks : [],
      model: row.model || '',
    },
    meta: meta && typeof meta === 'object' ? meta : {},
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

export async function savePromptEffectAssessmentByKey(record) {
  await ensureReady()
  const now = nowIso()
  const cacheKey = String(record?.cacheKey || '').trim()
  if (!cacheKey) throw new Error('cacheKey 必填')

  const effectAssessment = record?.effectAssessment && typeof record.effectAssessment === 'object'
    ? record.effectAssessment
    : {}

  const database = getDb()
  database
    .prepare(
      `INSERT INTO prompt_effect_assessments(
         cache_key, prompt_id, task_type, model, available, mode, verdict, confidence, summary, strengths_json, risks_json, meta_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         prompt_id=excluded.prompt_id,
         task_type=excluded.task_type,
         model=excluded.model,
         available=excluded.available,
         mode=excluded.mode,
         verdict=excluded.verdict,
         confidence=excluded.confidence,
         summary=excluded.summary,
         strengths_json=excluded.strengths_json,
         risks_json=excluded.risks_json,
         meta_json=excluded.meta_json,
         updated_at=excluded.updated_at`,
    )
    .run(
      cacheKey,
      String(record?.promptId || ''),
      String(record?.taskType || ''),
      String(effectAssessment?.model || ''),
      effectAssessment?.available ? 1 : 0,
      String(effectAssessment?.mode || 'unavailable'),
      String(effectAssessment?.verdict || 'unknown'),
      Number(effectAssessment?.confidence || 0),
      String(effectAssessment?.summary || ''),
      JSON.stringify(Array.isArray(effectAssessment?.strengths) ? effectAssessment.strengths : []),
      JSON.stringify(Array.isArray(effectAssessment?.risks) ? effectAssessment.risks : []),
      JSON.stringify(record?.meta && typeof record.meta === 'object' ? record.meta : {}),
      now,
      now,
    )

  return loadPromptEffectAssessmentByKey(cacheKey)
}

export async function loadModelSettingsInDb() {
  await ensureReady()
  const stored = getKv('model_settings', {})
  return buildEffectiveModelSettings(stored)
}

export async function saveModelSettingsInDb(record = {}) {
  await ensureReady()
  const next = buildEffectiveModelSettings(record)
  setKv('model_settings', next)
  return next
}

export async function loadFeishuProjectSettingsInDb() {
  await ensureReady()
  return getKv('feishu_project_settings', {})
}

export async function saveFeishuProjectSettingsInDb(record = {}) {
  await ensureReady()
  const prev = getKv('feishu_project_settings', {})
  const next = mergeFeishuProjectSettings(prev, record)
  setKv('feishu_project_settings', next)
  return next
}

export async function loadWikiVaultBuildStatsInDb({ provider = 'all' } = {}) {
  await ensureReady()
  const normalizedProvider = String(provider || 'all').trim().toLowerCase() || 'all'
  return getKv(`wiki_vault_build_stats:${normalizedProvider}`, {
    provider: normalizedProvider,
    generatedAt: null,
    syncMode: 'publish-only',
    publishedCount: 0,
    conceptCount: 0,
    llmConceptCount: 0,
    fallbackConceptCount: 0,
  })
}

export async function saveWikiVaultBuildStatsInDb(record = {}) {
  await ensureReady()
  const normalizedProvider = String(record?.provider || 'all').trim().toLowerCase() || 'all'
  const payload = {
    provider: normalizedProvider,
    generatedAt: String(record?.generatedAt || nowIso()),
    syncMode: String(record?.syncMode || 'publish-only'),
    publishedCount: Math.max(0, Number(record?.publishedCount || 0)),
    conceptCount: Math.max(0, Number(record?.conceptCount || 0)),
    llmConceptCount: Math.max(0, Number(record?.llmConceptCount || 0)),
    fallbackConceptCount: Math.max(0, Number(record?.fallbackConceptCount || 0)),
  }
  setKv(`wiki_vault_build_stats:${normalizedProvider}`, payload)
  return payload
}

export async function listPatchDirPresetsInDb() {
  await ensureReady()
  const database = getDb()
  const rows = database
    .prepare(
      `SELECT id, alias, path, created_at, updated_at
       FROM patch_dir_presets
       ORDER BY datetime(updated_at) DESC`,
    )
    .all()

  return rows.map((row) => ({
    id: String(row.id || ''),
    alias: String(row.alias || ''),
    path: String(row.path || ''),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }))
}

export async function upsertPatchDirPresetInDb({ id = '', alias = '', path: patchPath = '' } = {}) {
  await ensureReady()
  const normalizedAlias = String(alias || '').trim()
  const rawPath = String(patchPath || '').trim()
  const resolvedPath = rawPath ? path.resolve(rawPath) : ''
  const normalizedPath = resolvedPath && resolvedPath !== path.parse(resolvedPath).root
    ? resolvedPath.replace(/[\\/]+$/, '')
    : resolvedPath
  if (!normalizedAlias || !normalizedPath) {
    throw new Error('alias/path 必填')
  }

  const presetId = String(id || '').trim() || `preset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const now = nowIso()
  const database = getDb()

  database
    .prepare(
      `INSERT INTO patch_dir_presets(id, alias, path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         alias=excluded.alias,
         path=excluded.path,
         updated_at=excluded.updated_at`,
    )
    .run(presetId, normalizedAlias, normalizedPath, now, now)

  return {
    id: presetId,
    alias: normalizedAlias,
    path: normalizedPath,
    updatedAt: now,
  }
}

export async function deletePatchDirPresetInDb(id) {
  await ensureReady()
  const presetId = String(id || '').trim()
  if (!presetId) return { removed: false }

  const database = getDb()
  const result = database.prepare('DELETE FROM patch_dir_presets WHERE id = ?').run(presetId)
  return { removed: Number(result?.changes || 0) > 0 }
}

function parseKnowledgeItemRow(row) {
  let tags = []
  let meta = {}
  try {
    tags = JSON.parse(String(row?.tags_json || '[]'))
  } catch {
    tags = []
  }
  try {
    meta = JSON.parse(String(row?.meta_json || '{}'))
  } catch {
    meta = {}
  }

  return {
    id: String(row?.id || ''),
    sourceType: normalizeKnowledgeSourceType(row?.source_type),
    sourceSubtype: String(row?.source_subtype || ''),
    status: normalizeKnowledgeStatus(row?.status),
    title: String(row?.title || ''),
    content: String(row?.content || ''),
    summary: String(row?.summary || ''),
    sourceUrl: String(row?.source_url || ''),
    sourceFile: String(row?.source_file || ''),
    tags: Array.isArray(tags) ? tags.map((item) => String(item || '').trim()).filter(Boolean) : [],
    meta: meta && typeof meta === 'object' ? meta : {},
    createdAt: String(row?.created_at || ''),
    updatedAt: String(row?.updated_at || ''),
  }
}

function buildKnowledgeStats(database) {
  const totals = database
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft_total,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_total,
         SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived_total
       FROM knowledge_items`,
    )
    .get()

  const byTypeRows = database
    .prepare(
      `SELECT source_type, COUNT(*) AS total
       FROM knowledge_items
       GROUP BY source_type`,
    )
    .all()

  const byType = {
    capture: 0,
    note: 0,
    document: 0,
  }
  for (const row of byTypeRows) {
    const type = normalizeKnowledgeSourceType(row?.source_type)
    byType[type] = Number(row?.total || 0)
  }

  return {
    total: Number(totals?.total || 0),
    draft: Number(totals?.draft_total || 0),
    active: Number(totals?.active_total || 0),
    archived: Number(totals?.archived_total || 0),
    byType,
  }
}

function buildKnowledgeTitle({ title = '', content = '', sourceType = 'capture' } = {}) {
  const explicit = String(title || '').trim()
  if (explicit) return explicit

  const contentLines = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (contentLines.length > 0) {
    return contentLines[0].slice(0, 60) || '未命名条目'
  }

  if (sourceType === 'note') return '未命名笔记'
  if (sourceType === 'document') return '未命名文档'
  return '未命名片段'
}

export async function listKnowledgeItemsInDb({ limit = 200, sourceType = 'all', status = 'all', q = '' } = {}) {
  await ensureReady()
  const database = getDb()
  const max = Math.max(1, Math.min(500, Number(limit || 200)))
  const normalizedType = String(sourceType || '').trim().toLowerCase()
  const normalizedStatus = String(status || '').trim().toLowerCase()
  const keyword = String(q || '').trim().toLowerCase()

  const where = []
  const params = []

  if (normalizedType && normalizedType !== 'all') {
    where.push('source_type = ?')
    params.push(normalizeKnowledgeSourceType(normalizedType))
  }

  if (normalizedStatus && normalizedStatus !== 'all') {
    if (normalizedStatus === 'visible' || normalizedStatus === 'non-archived') {
      where.push("status != 'archived'")
    } else {
      where.push('status = ?')
      params.push(normalizeKnowledgeStatus(normalizedStatus))
    }
  }

  if (keyword) {
    where.push('(LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(source_subtype) LIKE ? OR LOWER(tags_json) LIKE ? OR LOWER(meta_json) LIKE ?)')
    const likeKeyword = `%${keyword}%`
    params.push(likeKeyword, likeKeyword, likeKeyword, likeKeyword, likeKeyword)
  }

  const rows = database
    .prepare(
      `SELECT id, source_type, source_subtype, status, title, content, summary, source_url, source_file, tags_json, meta_json, created_at, updated_at
       FROM knowledge_items
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY datetime(updated_at) DESC
       LIMIT ?`,
    )
    .all(...params, max)

  return {
    items: rows.map(parseKnowledgeItemRow),
    stats: buildKnowledgeStats(database),
  }
}

export async function getKnowledgeItemByIdInDb(id) {
  await ensureReady()
  const knowledgeId = String(id || '').trim()
  if (!knowledgeId) return null
  const database = getDb()
  const row = database
    .prepare(
      `SELECT id, source_type, source_subtype, status, title, content, summary, source_url, source_file, tags_json, meta_json, created_at, updated_at
       FROM knowledge_items
       WHERE id = ?`,
    )
    .get(knowledgeId)
  return row ? parseKnowledgeItemRow(row) : null
}

export async function upsertKnowledgeItemInDb(record = {}) {
  await ensureReady()
  const now = nowIso()
  const database = getDb()
  const existingId = String(record?.id || '').trim()
  const existing = existingId ? await getKnowledgeItemByIdInDb(existingId) : null
  const id = existing?.id || existingId || `knowledge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const sourceType = normalizeKnowledgeSourceType(record?.sourceType)
  const status = normalizeKnowledgeStatus(record?.status)
  const content = String(record?.content || '').trim()
  const title = buildKnowledgeTitle({
    title: record?.title,
    content,
    sourceType,
  })
  const sourceSubtype = String(record?.sourceSubtype || '').trim().toLowerCase()
  const sourceUrl = String(record?.sourceUrl || '').trim()
  const sourceFile = String(record?.sourceFile || '').trim()
  const summary = String(record?.summary || '').trim()
  const tags = Array.isArray(record?.tags)
    ? [...new Set(record.tags.map((item) => String(item || '').trim()).filter(Boolean))]
    : []
  const meta = record?.meta && typeof record.meta === 'object' ? record.meta : existing?.meta || {}
  const createdAt = existing?.createdAt || now

  database
    .prepare(
      `INSERT INTO knowledge_items(
         id, source_type, source_subtype, status, title, content, summary, source_url, source_file, tags_json, meta_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         source_type=excluded.source_type,
         source_subtype=excluded.source_subtype,
         status=excluded.status,
         title=excluded.title,
         content=excluded.content,
         summary=excluded.summary,
         source_url=excluded.source_url,
         source_file=excluded.source_file,
         tags_json=excluded.tags_json,
         meta_json=excluded.meta_json,
         updated_at=excluded.updated_at`,
    )
    .run(
      id,
      sourceType,
      sourceSubtype,
      status,
      title,
      content,
      summary,
      sourceUrl,
      sourceFile,
      JSON.stringify(tags),
      JSON.stringify(meta),
      createdAt,
      now,
    )

  return getKnowledgeItemByIdInDb(id)
}

export async function updateKnowledgeItemStatusInDb({ id = '', status = 'draft' } = {}) {
  await ensureReady()
  const knowledgeId = String(id || '').trim()
  if (!knowledgeId) throw new Error('id 必填')
  const current = await getKnowledgeItemByIdInDb(knowledgeId)
  if (!current) throw new Error('条目不存在')
  const nextStatus = normalizeKnowledgeStatus(status)
  const database = getDb()
  database
    .prepare(
      `UPDATE knowledge_items
       SET status = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(nextStatus, nowIso(), knowledgeId)
  return getKnowledgeItemByIdInDb(knowledgeId)
}

export async function patchKnowledgeItemMetaInDb({ id = '', status, metaPatch = {} } = {}) {
  await ensureReady()
  const knowledgeId = String(id || '').trim()
  if (!knowledgeId) throw new Error('id 必填')
  const current = await getKnowledgeItemByIdInDb(knowledgeId)
  if (!current) throw new Error('条目不存在')
  const patch = metaPatch && typeof metaPatch === 'object' && !Array.isArray(metaPatch) ? metaPatch : {}
  const nextMeta = {
    ...(current.meta && typeof current.meta === 'object' ? current.meta : {}),
    ...patch,
  }
  const nextStatus = typeof status === 'string' && status.trim()
    ? normalizeKnowledgeStatus(status)
    : current.status
  const database = getDb()
  database
    .prepare(
      `UPDATE knowledge_items
       SET status = ?, meta_json = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(nextStatus, JSON.stringify(nextMeta), nowIso(), knowledgeId)
  return getKnowledgeItemByIdInDb(knowledgeId)
}

export async function deleteKnowledgeItemInDb(id) {
  await ensureReady()
  const knowledgeId = String(id || '').trim()
  if (!knowledgeId) return { removed: false }
  const database = getDb()
  const result = database.prepare('DELETE FROM knowledge_items WHERE id = ?').run(knowledgeId)
  return { removed: Number(result?.changes || 0) > 0 }
}

function parseBugInboxRow(row) {
  let snippet = null
  let matchedSnippets = []
  let meta = {}
  try {
    snippet = row?.snippet_json ? JSON.parse(String(row.snippet_json || 'null')) : null
  } catch {
    snippet = null
  }
  try {
    matchedSnippets = JSON.parse(String(row?.matched_snippets_json || '[]'))
  } catch {
    matchedSnippets = []
  }
  try {
    meta = JSON.parse(String(row?.meta_json || '{}'))
  } catch {
    meta = {}
  }

  return {
    id: String(row?.id || ''),
    title: String(row?.title || ''),
    description: String(row?.description || ''),
    severity: String(row?.severity || 'medium'),
    status: String(row?.status || 'open'),
    bugCode: String(row?.bug_code || ''),
    patchFile: String(row?.patch_file || ''),
    patchPath: String(row?.patch_path || ''),
    patchDir: String(row?.patch_dir || ''),
    cursorRoot: String(row?.cursor_root || ''),
    conversationId: String(row?.conversation_id || ''),
    score: Number(row?.score || 0),
    snippet,
    matchedSnippets: Array.isArray(matchedSnippets) ? matchedSnippets : [],
    meta: meta && typeof meta === 'object' ? meta : {},
    createdAt: String(row?.created_at || ''),
    updatedAt: String(row?.updated_at || ''),
  }
}

export async function listBugInboxInDb({ limit = 100 } = {}) {
  await ensureReady()
  const max = Math.max(1, Math.min(500, Number(limit || 100)))
  const database = getDb()
  const rows = database
    .prepare(
      `SELECT id, title, description, severity, status, bug_code, patch_file, patch_path, patch_dir, cursor_root, conversation_id,
              score, snippet_json, matched_snippets_json, meta_json, created_at, updated_at
       FROM bug_inbox
       ORDER BY datetime(created_at) DESC
       LIMIT ?`,
    )
    .all(max)
  return rows.map(parseBugInboxRow)
}

export async function createBugInboxInDb(record = {}) {
  await ensureReady()
  const now = nowIso()
  const id = `bug_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const title = String(record?.title || '').trim() || '未命名 Bug'
  const description = String(record?.description || '').trim()
  const severityRaw = String(record?.severity || '').trim().toLowerCase()
  const severity = ['low', 'medium', 'high', 'critical'].includes(severityRaw) ? severityRaw : 'medium'
  const statusRaw = String(record?.status || '').trim().toLowerCase()
  const status = ['open', 'investigating', 'resolved', 'ignored'].includes(statusRaw) ? statusRaw : 'open'
  const bugCode = String(record?.bugCode || '').trim()
  if (!bugCode) throw new Error('bugCode 必填')

  const database = getDb()
  database
    .prepare(
      `INSERT INTO bug_inbox(
         id, title, description, severity, status, bug_code, patch_file, patch_path, patch_dir, cursor_root, conversation_id,
         score, snippet_json, matched_snippets_json, meta_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      title,
      description,
      severity,
      status,
      bugCode,
      String(record?.patchFile || '').trim(),
      String(record?.patchPath || '').trim(),
      String(record?.patchDir || '').trim(),
      String(record?.cursorRoot || '').trim(),
      String(record?.conversationId || '').trim(),
      Number(record?.score || 0),
      JSON.stringify(record?.snippet && typeof record.snippet === 'object' ? record.snippet : null),
      JSON.stringify(Array.isArray(record?.matchedSnippets) ? record.matchedSnippets : []),
      JSON.stringify(record?.meta && typeof record.meta === 'object' ? record.meta : {}),
      now,
      now,
    )

  const row = database
    .prepare(
      `SELECT id, title, description, severity, status, bug_code, patch_file, patch_path, patch_dir, cursor_root, conversation_id,
              score, snippet_json, matched_snippets_json, meta_json, created_at, updated_at
       FROM bug_inbox
       WHERE id = ?`,
    )
    .get(id)
  return parseBugInboxRow(row)
}

export async function getBugInboxByIdInDb(id) {
  await ensureReady()
  const bugId = String(id || '').trim()
  if (!bugId) return null
  const database = getDb()
  const row = database
    .prepare(
      `SELECT id, title, description, severity, status, bug_code, patch_file, patch_path, patch_dir, cursor_root, conversation_id,
              score, snippet_json, matched_snippets_json, meta_json, created_at, updated_at
       FROM bug_inbox
       WHERE id = ?`,
    )
    .get(bugId)
  return row ? parseBugInboxRow(row) : null
}

export async function updateBugInboxMetaInDb({ id = '', metaPatch = {} } = {}) {
  await ensureReady()
  const bugId = String(id || '').trim()
  if (!bugId) throw new Error('id 必填')
  const patch = metaPatch && typeof metaPatch === 'object' ? metaPatch : {}
  const current = await getBugInboxByIdInDb(bugId)
  if (!current) throw new Error('bug 不存在')
  const nextMeta = {
    ...(current.meta && typeof current.meta === 'object' ? current.meta : {}),
    ...patch,
  }
  const now = nowIso()
  const database = getDb()
  database
    .prepare(
      `UPDATE bug_inbox
       SET meta_json = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(JSON.stringify(nextMeta), now, bugId)
  return getBugInboxByIdInDb(bugId)
}

export async function updateBugInboxDescriptionInDb({ id = '', description = '' } = {}) {
  await ensureReady()
  const bugId = String(id || '').trim()
  if (!bugId) throw new Error('id 必填')
  const current = await getBugInboxByIdInDb(bugId)
  if (!current) throw new Error('bug 不存在')
  const now = nowIso()
  const database = getDb()
  database
    .prepare(
      `UPDATE bug_inbox
       SET description = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(String(description || '').trim(), now, bugId)
  return getBugInboxByIdInDb(bugId)
}

export async function deleteBugInboxInDb(id) {
  await ensureReady()
  const bugId = String(id || '').trim()
  if (!bugId) return { removed: false }
  const database = getDb()
  const result = database.prepare('DELETE FROM bug_inbox WHERE id = ?').run(bugId)
  return { removed: Number(result?.changes || 0) > 0 }
}
