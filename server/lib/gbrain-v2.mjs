import { createHash } from 'node:crypto'

function nowIso() {
  return new Date().toISOString()
}

function normalizeText(input) {
  return String(input || '').replace(/\s+/g, ' ').trim()
}

function firstMeaningfulLine(input) {
  const lines = String(input || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s+/, '').trim())
    .filter(Boolean)
  return lines[0] || ''
}

function stableSha1(input) {
  return createHash('sha1').update(String(input || '')).digest('hex')
}

function toSlug(input) {
  const normalized = String(input || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim()
  return normalized || 'untitled'
}

function pickTopics(item) {
  const meta = item?.meta && typeof item.meta === 'object' ? item.meta : {}
  const raw = []
  raw.push(meta.topic)
  raw.push(meta.project)
  if (Array.isArray(meta.topics)) raw.push(...meta.topics)
  if (Array.isArray(item?.tags)) raw.push(...item.tags)
  raw.push(item?.sourceSubtype)

  const deduped = []
  const seen = new Set()
  for (const candidate of raw) {
    const value = normalizeText(candidate).toLowerCase()
    if (!value || seen.has(value)) continue
    seen.add(value)
    deduped.push(value)
    if (deduped.length >= 12) break
  }
  return deduped
}

function inferKind(item) {
  const sourceSubtype = normalizeText(item?.sourceSubtype).toLowerCase()
  const title = normalizeText(item?.title).toLowerCase()
  const summary = normalizeText(item?.summary).toLowerCase()
  const merged = `${sourceSubtype} ${title} ${summary}`

  if (/(issue|bug|error|故障|报错|异常|失败|symptom)/.test(merged)) return 'issue'
  if (/(pattern|practice|最佳实践|recommended|tradeoff|方案)/.test(merged)) return 'pattern'
  if (/(synthesis|总结|结论|对比|roadmap|planning|规划|question)/.test(merged)) return 'synthesis'
  if (/(project|项目|repo|module|架构)/.test(merged)) return 'project'
  if (/(decision|决策|取舍)/.test(merged)) return 'decision'
  return 'context'
}

function mapKindToPage(kind) {
  if (kind === 'issue') return { type: 'issue-note', bucket: 'issues' }
  if (kind === 'pattern') return { type: 'pattern-note', bucket: 'patterns' }
  if (kind === 'project') return { type: 'project-hub', bucket: 'projects' }
  if (kind === 'synthesis' || kind === 'decision') return { type: 'synthesis-note', bucket: 'syntheses' }
  return { type: 'synthesis-note', bucket: 'syntheses' }
}

function buildSourceRefs(item) {
  const meta = item?.meta && typeof item.meta === 'object' ? item.meta : {}
  const refs = []
  if (normalizeText(item?.sourceFile)) refs.push({ type: 'file', value: normalizeText(item.sourceFile) })
  if (normalizeText(meta.openclawPath)) refs.push({ type: 'openclaw-path', value: normalizeText(meta.openclawPath) })
  if (normalizeText(item?.sourceUrl)) refs.push({ type: 'url', value: normalizeText(item.sourceUrl) })
  const deduped = []
  const seen = new Set()
  for (const ref of refs) {
    const type = normalizeText(ref?.type)
    const value = normalizeText(ref?.value)
    if (!type || !value) continue
    const key = `${type}:${value}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push({ type, value })
  }
  return deduped
}

function evaluateQuality(item, atomDraft) {
  const issues = []
  let score = 100

  const title = normalizeText(item?.title)
  const summary = normalizeText(item?.summary)
  const content = normalizeText(item?.content)
  const meta = item?.meta && typeof item.meta === 'object' ? item.meta : {}

  if (!title || /未命名/.test(title)) {
    score -= 12
    issues.push('missing_title')
  }
  if (!summary) {
    score -= 12
    issues.push('missing_summary')
  }
  if (content.length < 120) {
    score -= 18
    issues.push('short_content')
  }
  if (!normalizeText(meta.contentHash)) {
    score -= 10
    issues.push('missing_content_hash')
  }
  if (!normalizeText(meta.intakeStage)) {
    score -= 8
    issues.push('missing_intake_stage')
  }
  if (!atomDraft.sourceRefs.length) {
    score -= 10
    issues.push('missing_source_refs')
  }
  if (!atomDraft.topics.length) {
    score -= 8
    issues.push('missing_topics')
  }
  if (String(item?.status || '').toLowerCase() === 'archived') {
    score -= 4
    issues.push('archived_item')
  }

  score = Math.max(0, Math.min(100, score))
  const tier = score >= 80 ? 'clean' : score >= 60 ? 'suspect' : 'legacy'
  return { score, tier, issues }
}

function buildCanonicalId({ meta, kind, title, summary, contentHash }) {
  const explicit = normalizeText(meta?.canonicalId || meta?.canonical_id)
  if (explicit) return explicit
  const seed = contentHash || `${kind}|${normalizeText(title).toLowerCase()}|${normalizeText(summary).toLowerCase()}`
  return `canon_${stableSha1(seed).slice(0, 24)}`
}

function buildAtomId({ meta, rawId, kind, contentHash, summary }) {
  const explicit = normalizeText(meta?.atomId || meta?.atom_id)
  if (explicit) return explicit
  return `atom_${stableSha1(`${rawId}|${kind}|${contentHash || summary}`).slice(0, 24)}`
}

function buildPageId({ meta, pageBucket, title, canonicalId }) {
  const explicit = normalizeText(meta?.pageId || meta?.page_id)
  if (explicit) return explicit
  return `${pageBucket}/${toSlug(title || canonicalId)}`
}

export function buildAtomFromKnowledgeItem(item, options = {}) {
  const normalized = item && typeof item === 'object' ? item : {}
  const meta = normalized?.meta && typeof normalized.meta === 'object' ? normalized.meta : {}
  const rawId = normalizeText(normalized.id)
  const title = normalizeText(normalized.title) || firstMeaningfulLine(normalized.content) || 'untitled'
  const summary = normalizeText(normalized.summary) || firstMeaningfulLine(normalized.content)
  const kind = inferKind(normalized)
  const page = mapKindToPage(kind)
  const topics = pickTopics(normalized)
  const sourceRefs = buildSourceRefs(normalized)
  const contentHash = normalizeText(meta.contentHash)
  const canonicalId = buildCanonicalId({ meta, kind, title, summary, contentHash })
  const atomId = buildAtomId({ meta, rawId, kind, contentHash, summary })
  const pageId = buildPageId({ meta, pageBucket: page.bucket, title, canonicalId })
  const updatedAt = normalizeText(options?.updatedAt) || normalizeText(normalized.updatedAt) || nowIso()
  const createdAt = normalizeText(options?.createdAt) || normalizeText(normalized.createdAt) || updatedAt

  const atomDraft = {
    rawId,
    atomId,
    canonicalId,
    kind,
    pageType: page.type,
    pageBucket: page.bucket,
    pageId,
    title,
    summary,
    topics,
    sourceRefs,
    intakeStage: normalizeText(meta.intakeStage),
    confidence: normalizeText(meta.confidence),
    status: normalizeText(normalized.status) || 'draft',
    updatedAt,
    createdAt,
    lineage: {
      rawId,
      atomId,
      canonicalId,
      pageId,
    },
  }

  const quality = evaluateQuality(normalized, atomDraft)
  return {
    ...atomDraft,
    qualityScore: quality.score,
    qualityTier: quality.tier,
    qualityIssues: quality.issues,
  }
}

