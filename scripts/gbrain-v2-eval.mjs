#!/usr/bin/env node
import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { loadLocalEnv } from '../server/lib/load-env.mjs'
import {
  listKnowledgeAtomsInDb,
  listKnowledgeItemsInDb,
  upsertKnowledgeAtomInDb,
} from '../server/lib/db.mjs'
import { querySessions } from '../server/lib/scanner.mjs'
import { buildAtomFromKnowledgeItem } from '../server/lib/gbrain-v2.mjs'

const DEFAULT_LIMIT = 5000
const DEFAULT_SAMPLE_SIZE = 120
const DEFAULT_COMPARE_TOP_K = 8
const DEFAULT_COMPARE_MODE = 'v2'
const DEFAULT_QUERY_SET_TARGET = 50
const DEFAULT_EVAL_DIR = path.resolve(process.cwd(), 'docs', 'wiki-vault', 'eval')
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

function usage() {
  console.log(
    [
      'Usage:',
      '  node scripts/gbrain-v2-eval.mjs baseline [--limit <n>] [--out <file>]',
      '  node scripts/gbrain-v2-eval.mjs dry-run [--limit <n>] [--sample <n>] [--out <file>]',
      '  node scripts/gbrain-v2-eval.mjs backfill [--limit <n>] [--status <all|draft|active|archived>]',
      '  node scripts/gbrain-v2-eval.mjs seed-query-set [--target <n>] [--limit <n>] [--out <file>]',
      '  node scripts/gbrain-v2-eval.mjs compare [--query-set <file>] [--top-k <n>] [--limit <n>] [--out <file>]',
      '',
      'Examples:',
      '  node scripts/gbrain-v2-eval.mjs baseline',
      '  node scripts/gbrain-v2-eval.mjs dry-run --sample 80',
      '  node scripts/gbrain-v2-eval.mjs backfill --status all',
      '  node scripts/gbrain-v2-eval.mjs seed-query-set --target 50',
      '  node scripts/gbrain-v2-eval.mjs compare --top-k 8',
      '  node scripts/gbrain-v2-eval.mjs baseline --out docs/wiki-vault/eval/baseline-custom.json',
    ].join('\n'),
  )
}

function argValue(args, key, fallback = '') {
  const index = args.indexOf(key)
  if (index < 0) return fallback
  return args[index + 1] || fallback
}

function toNumber(input, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(input)
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function nowIso() {
  return new Date().toISOString()
}

function compactTs(input = nowIso()) {
  return String(input)
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '-')
}

function normalizeText(input) {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstMeaningfulLine(input) {
  const lines = String(input || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s+/, '').trim())
    .filter(Boolean)
  return lines[0] || ''
}

function sha1(input) {
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

function percent(part, total) {
  if (!total) return 0
  return Number(((Number(part || 0) / Number(total || 1)) * 100).toFixed(2))
}

function inc(map, key, delta = 1) {
  const normalized = String(key || '').trim() || 'unknown'
  map[normalized] = Number(map[normalized] || 0) + delta
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

function toMdPath(jsonPath) {
  return String(jsonPath || '').replace(/\.json$/i, '.md')
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

function buildSourceRefs(item) {
  const meta = item?.meta && typeof item.meta === 'object' ? item.meta : {}
  const refs = []
  if (normalizeText(item?.sourceFile)) refs.push({ type: 'file', value: normalizeText(item.sourceFile) })
  if (normalizeText(meta.openclawPath)) refs.push({ type: 'openclaw-path', value: normalizeText(meta.openclawPath) })
  if (normalizeText(item?.sourceUrl)) refs.push({ type: 'url', value: normalizeText(item.sourceUrl) })
  return refs
}

function buildAtomCandidate(item) {
  return buildAtomFromKnowledgeItem(item)
}

async function ensureDir(filePath) {
  const dir = path.dirname(filePath)
  await mkdir(dir, { recursive: true })
}

async function writeJson(filePath, payload) {
  await ensureDir(filePath)
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

async function writeMarkdown(filePath, content) {
  await ensureDir(filePath)
  await writeFile(filePath, `${String(content || '').trim()}\n`, 'utf8')
}

async function pathExists(filePath) {
  try {
    await readFile(filePath)
    return true
  } catch {
    return false
  }
}

async function countMarkdownFiles(rootDir) {
  const counts = {
    total: 0,
    byDir: {
      sources: 0,
      projects: 0,
      patterns: 0,
      issues: 0,
      syntheses: 0,
      inbox: 0,
    },
  }

  async function walk(dirPath) {
    let entries = []
    try {
      entries = await readdir(dirPath, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.md') continue
      counts.total += 1
      const relative = fullPath.replace(`${rootDir}${path.sep}`, '').split(path.sep)[0]
      if (relative in counts.byDir) counts.byDir[relative] += 1
    }
  }

  await walk(rootDir)
  return counts
}

function summarizeSessions(index = {}) {
  const sessions = Array.isArray(index?.sessions) ? index.sessions : []
  const byProvider = {}
  let totalMessages = 0
  let maxMessages = 0
  for (const session of sessions) {
    inc(byProvider, String(session?.provider || '').toLowerCase() || 'unknown')
    const messageCount = Array.isArray(session?.messages) ? session.messages.length : 0
    totalMessages += messageCount
    maxMessages = Math.max(maxMessages, messageCount)
  }
  return {
    total: sessions.length,
    issues: Array.isArray(index?.issues) ? index.issues.length : 0,
    byProvider,
    avgMessagesPerSession: sessions.length ? Number((totalMessages / sessions.length).toFixed(2)) : 0,
    maxMessagesPerSession: maxMessages,
  }
}

function summarizeKnowledgeItems(items = []) {
  const byStatus = {}
  const bySourceType = {}
  const byIntakeStage = {}
  const byConfidence = {}
  const byKind = {}
  const byTier = {}
  const qualityIssueCounts = {}
  const hashGroups = new Map()
  let withSummary = 0
  let withContentHash = 0
  let withIntakeStage = 0
  let withSourceRefs = 0
  let withLineage = 0

  const atomSamples = []

  for (const item of items) {
    inc(byStatus, item?.status)
    inc(bySourceType, item?.sourceType)

    const atom = buildAtomCandidate(item)
    atomSamples.push(atom)

    inc(byIntakeStage, atom.intakeStage || 'unknown')
    inc(byConfidence, atom.confidence || 'unknown')
    inc(byKind, atom.kind)
    inc(byTier, atom.qualityTier)

    if (atom.summary) withSummary += 1
    if (atom.lineage?.rawId && atom.lineage?.atomId && atom.lineage?.canonicalId && atom.lineage?.pageId) withLineage += 1
    if (normalizeText(item?.meta?.contentHash)) withContentHash += 1
    if (atom.intakeStage) withIntakeStage += 1
    if (atom.sourceRefs.length) withSourceRefs += 1

    for (const issue of atom.qualityIssues) inc(qualityIssueCounts, issue)

    const contentHash = normalizeText(item?.meta?.contentHash)
    if (contentHash) {
      if (!hashGroups.has(contentHash)) hashGroups.set(contentHash, [])
      hashGroups.get(contentHash).push({
        id: item?.id,
        title: item?.title,
        sourceSubtype: item?.sourceSubtype,
        updatedAt: item?.updatedAt,
      })
    }
  }

  const duplicateGroups = Array.from(hashGroups.entries())
    .filter(([, list]) => list.length > 1)
    .map(([contentHash, list]) => ({
      contentHash,
      count: list.length,
      items: list,
    }))
    .sort((a, b) => b.count - a.count)

  const total = items.length
  return {
    total,
    byStatus,
    bySourceType,
    byIntakeStage,
    byConfidence,
    byKind,
    byTier,
    coverage: {
      summary: percent(withSummary, total),
      contentHash: percent(withContentHash, total),
      intakeStage: percent(withIntakeStage, total),
      sourceRefs: percent(withSourceRefs, total),
      lineage: percent(withLineage, total),
    },
    duplicateGroups: {
      totalGroups: duplicateGroups.length,
      totalItems: duplicateGroups.reduce((sum, item) => sum + item.count, 0),
      topGroups: duplicateGroups.slice(0, 25),
    },
    qualityIssueCounts,
    atomSamples,
  }
}

async function readJson(filePath, fallback = null) {
  try {
    const content = await readFile(filePath, 'utf8')
    return content ? JSON.parse(content) : fallback
  } catch {
    return fallback
  }
}

function normalizeSearchQuery(input) {
  const raw = normalizeText(input)
  if (!raw) return ''
  return raw
    .replace(/([\p{Script=Latin}\p{N}])([\p{Script=Han}])/gu, '$1 $2')
    .replace(/([\p{Script=Han}])([\p{Script=Latin}\p{N}])/gu, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(input) {
  return normalizeText(input)
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .slice(0, 24)
}

function toTimestamp(input) {
  const value = +new Date(input || 0)
  return Number.isFinite(value) ? value : 0
}

function snippetByToken(content, token, radius = 72) {
  const source = normalizeText(content)
  const needle = normalizeText(token).toLowerCase()
  if (!source || !needle) return ''
  const index = source.toLowerCase().indexOf(needle)
  if (index < 0) return ''
  const start = Math.max(0, index - radius)
  const end = Math.min(source.length, index + needle.length + radius)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < source.length ? '…' : ''
  return `${prefix}${source.slice(start, end)}${suffix}`
}

function getKnowledgeAtomScoreProfile() {
  return {
    exact: { summary: 8, title: 6, topics: 1.2, kind: 0.8, pageId: 0.5, sourceRefs: 0.4 },
    token: { summary: 2.2, title: 1.6, topics: 0.4, kind: 0.3, pageId: 0.2, sourceRefs: 0.2 },
    quality: { clean: 0.2, suspect: 0, legacy: 0 },
  }
}

function scoreKnowledgeAtom(atom, query, tokens) {
  const q = normalizeText(query).toLowerCase()
  const title = normalizeText(atom?.title).toLowerCase()
  const summary = normalizeText(atom?.summary).toLowerCase()
  const kind = normalizeText(atom?.kind).toLowerCase()
  const pageId = normalizeText(atom?.pageId).toLowerCase()
  const topics = Array.isArray(atom?.topics) ? atom.topics.map((item) => normalizeText(item).toLowerCase()).join(' ') : ''
  const sourceRefs = Array.isArray(atom?.sourceRefs)
    ? atom.sourceRefs
      .map((item) => `${normalizeText(item?.type)} ${normalizeText(item?.value)}`.toLowerCase())
      .join(' ')
    : ''
  const profile = getKnowledgeAtomScoreProfile()

  let score = 0
  if (!q) {
    score += toTimestamp(atom?.updatedAt) / 1e12
    return score
  }

  if (summary.includes(q)) score += profile.exact.summary
  if (title.includes(q)) score += profile.exact.title
  if (topics.includes(q)) score += profile.exact.topics
  if (kind.includes(q)) score += profile.exact.kind
  if (pageId.includes(q)) score += profile.exact.pageId
  if (sourceRefs.includes(q)) score += profile.exact.sourceRefs

  for (const token of tokens) {
    if (summary.includes(token)) score += profile.token.summary
    if (title.includes(token)) score += profile.token.title
    if (topics.includes(token)) score += profile.token.topics
    if (kind.includes(token)) score += profile.token.kind
    if (pageId.includes(token)) score += profile.token.pageId
    if (sourceRefs.includes(token)) score += profile.token.sourceRefs
  }

  const qualityTier = normalizeText(atom?.qualityTier).toLowerCase()
  if (qualityTier === 'clean') score += profile.quality.clean
  else if (qualityTier === 'suspect') score += profile.quality.suspect
  else score += profile.quality.legacy

  if (kind === 'context') score -= 0.4
  if (kind === 'issue' || kind === 'pattern' || kind === 'decision' || kind === 'synthesis') score += 0.6

  score += toTimestamp(atom?.updatedAt) / 1e13
  return score
}

function pickKnowledgeAtomSnippet(atom, tokens) {
  const haystacks = [
    normalizeText(atom?.summary),
    Array.isArray(atom?.topics) ? atom.topics.map((item) => normalizeText(item)).filter(Boolean).join(' | ') : '',
    Array.isArray(atom?.sourceRefs)
      ? atom.sourceRefs
        .map((item) => normalizeText(item?.value || item?.type))
        .filter(Boolean)
        .join(' | ')
      : '',
  ].filter(Boolean)

  for (const haystack of haystacks) {
    for (const token of tokens) {
      const snippet = snippetByToken(haystack, token)
      if (snippet) return snippet
    }
  }

  return haystacks[0] ? haystacks[0].slice(0, 220) : ''
}

function isStructuredKind(kind) {
  const normalized = normalizeText(kind).toLowerCase()
  return normalized === 'issue' || normalized === 'pattern' || normalized === 'decision' || normalized === 'synthesis'
}

function resultKey(result = {}) {
  return String(result?.canonicalId || result?.atomId || result?.rawId || '').trim()
}

function normalizeQueryIntent(intent = '') {
  const normalized = normalizeText(intent).toLowerCase()
  if (normalized === 'issue') return 'issue'
  if (normalized === 'pattern') return 'pattern'
  if (normalized === 'project') return 'project'
  if (normalized === 'synthesis' || normalized === 'decision' || normalized === 'context') return 'synthesis'
  return 'all'
}

function mapKindToIntent(kind = '') {
  const normalized = normalizeText(kind).toLowerCase()
  if (normalized === 'issue') return 'issue'
  if (normalized === 'pattern') return 'pattern'
  if (normalized === 'project') return 'project'
  return 'synthesis'
}

function defaultSignalsForIntent(intent = 'all') {
  if (intent === 'issue') return ['symptom', 'rootCause', 'fixPattern', 'validation']
  if (intent === 'pattern') return ['recommendedShape', 'tradeoffs', 'evidenceRefs']
  if (intent === 'project') return ['module', 'ownership', 'dependencies']
  return ['conclusion', 'comparison', 'nextAction']
}

function buildQueryTextByIntent(intent, title, summary) {
  const text = normalizeText(title || summary || '').slice(0, 80)
  if (intent === 'issue') return `${text} 如何定位根因并给出修复路径`
  if (intent === 'pattern') return `${text} 的最佳实践、边界和取舍是什么`
  if (intent === 'project') return `${text} 相关模块、依赖关系和责任边界`
  return `${text} 的结论、建议和下一步动作`
}

function isIntentMatch(resultKind, queryIntent) {
  const kind = normalizeText(resultKind).toLowerCase()
  const intent = normalizeQueryIntent(queryIntent)
  if (intent === 'all') return true
  if (intent === 'synthesis') return kind === 'synthesis' || kind === 'decision' || kind === 'context'
  return kind === intent
}

function evaluateResultRelevance(result = {}, querySpec = {}) {
  const intentMatch = isIntentMatch(result.kind, querySpec.intent)
  const expectedSignals = Array.isArray(querySpec.expectedSignals)
    ? querySpec.expectedSignals.map((item) => normalizeText(item).toLowerCase()).filter(Boolean)
    : []
  const textPool = [
    result.title,
    result.summary,
    result.snippet,
    Array.isArray(result.topics) ? result.topics.join(' ') : '',
    Array.isArray(result.sourceRefs)
      ? result.sourceRefs.map((item) => `${normalizeText(item?.type)} ${normalizeText(item?.value)}`).join(' ')
      : '',
  ]
    .map((item) => normalizeText(item).toLowerCase())
    .join(' ')
  const signalHits = expectedSignals.filter((signal) => textPool.includes(signal))
  const relevanceScore = (intentMatch ? 0.6 : 0) + (expectedSignals.length ? (0.8 * signalHits.length) / expectedSignals.length : 0)
  return {
    intentMatch,
    signalHits,
    relevanceScore: Number(relevanceScore.toFixed(4)),
    relevant: intentMatch || signalHits.length > 0,
  }
}

async function runLocalAtomRetrieve({
  query = '',
  topK = DEFAULT_COMPARE_TOP_K,
  limit = 300,
  kind = 'all',
  qualityTier = 'all',
  status = 'visible',
} = {}) {
  const normalizedQuery = normalizeSearchQuery(query)
  const normalizedTopK = Math.max(1, Math.min(30, Number(topK || DEFAULT_COMPARE_TOP_K)))
  const normalizedLimit = Math.max(normalizedTopK, Math.min(5000, Number(limit || 300)))
  const normalizedKind = normalizeText(kind || 'all') || 'all'
  const normalizedTier = normalizeText(qualityTier || 'all') || 'all'
  const normalizedStatus = normalizeText(status || 'visible') || 'visible'
  const tokens = tokenize(normalizedQuery)

  let atomCandidates = await listKnowledgeAtomsInDb({
    limit: normalizedLimit,
    kind: normalizedKind,
    qualityTier: normalizedTier,
    status: normalizedStatus,
    q: normalizedQuery,
  })

  if (!atomCandidates.length && normalizedQuery) {
    atomCandidates = await listKnowledgeAtomsInDb({
      limit: Math.max(normalizedLimit, normalizedTopK * 30),
      kind: normalizedKind,
      qualityTier: normalizedTier,
      status: normalizedStatus,
      q: '',
    })
  }

  const ranked = atomCandidates
    .map((atom) => ({
      atom,
      score: scoreKnowledgeAtom(atom, normalizedQuery, tokens),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)

  const results = ranked.slice(0, normalizedTopK).map((item) => {
    const atom = item.atom
    return {
      atomId: atom.atomId,
      rawId: atom.rawId,
      canonicalId: atom.canonicalId,
      pageId: atom.pageId,
      kind: atom.kind,
      title: atom.title,
      summary: atom.summary,
      topics: atom.topics,
      sourceRefs: atom.sourceRefs,
      qualityTier: atom.qualityTier,
      qualityScore: atom.qualityScore,
      score: Number(item.score.toFixed(4)),
      snippet: pickKnowledgeAtomSnippet(atom, tokens),
    }
  })

  return {
    query: normalizedQuery,
    topK: normalizedTopK,
    tokens,
    mode: DEFAULT_COMPARE_MODE,
    totalScanned: atomCandidates.length,
    totalMatched: ranked.length,
    results,
  }
}

function summarizeModeQueries(modeQueryResults = [], topK = DEFAULT_COMPARE_TOP_K) {
  const queries = Array.isArray(modeQueryResults) ? modeQueryResults : []
  const summary = {
    queryCount: queries.length,
    hitAtK: 0,
    avgInvalidRecallRate: 0,
    avgTraceabilityRate: 0,
    avgStructuredShare: 0,
    avgContextShare: 0,
    avgCleanShare: 0,
    avgSignalCoverage: 0,
    avgTop1Score: 0,
  }
  if (!queries.length) return summary

  let invalidRecallSum = 0
  let traceabilitySum = 0
  let structuredSum = 0
  let contextSum = 0
  let cleanSum = 0
  let signalCoverageSum = 0
  let top1ScoreSum = 0
  let hitCount = 0

  for (const queryResult of queries) {
    const list = Array.isArray(queryResult?.results) ? queryResult.results.slice(0, topK) : []
    const relevantCount = list.filter((item) => item.relevance?.relevant).length
    const invalidCount = list.length - relevantCount
    const traceableCount = list.filter((item) => item.traceable).length
    const structuredCount = list.filter((item) => isStructuredKind(item.kind)).length
    const contextCount = list.filter((item) => normalizeText(item.kind).toLowerCase() === 'context').length
    const cleanCount = list.filter((item) => normalizeText(item.qualityTier).toLowerCase() === 'clean').length
    const expectedSignals = Array.isArray(queryResult?.expectedSignals) ? queryResult.expectedSignals : []
    const signalCovered = expectedSignals.filter((signal) => queryResult?.signalCoverage?.includes(signal))

    if (relevantCount > 0) hitCount += 1
    invalidRecallSum += list.length ? invalidCount / list.length : 0
    traceabilitySum += list.length ? traceableCount / list.length : 0
    structuredSum += list.length ? structuredCount / list.length : 0
    contextSum += list.length ? contextCount / list.length : 0
    cleanSum += list.length ? cleanCount / list.length : 0
    signalCoverageSum += expectedSignals.length ? signalCovered.length / expectedSignals.length : 1
    top1ScoreSum += Number(list[0]?.score || 0)
  }

  summary.hitAtK = percent(hitCount, queries.length)
  summary.avgInvalidRecallRate = Number(((invalidRecallSum / queries.length) * 100).toFixed(2))
  summary.avgTraceabilityRate = Number(((traceabilitySum / queries.length) * 100).toFixed(2))
  summary.avgStructuredShare = Number(((structuredSum / queries.length) * 100).toFixed(2))
  summary.avgContextShare = Number(((contextSum / queries.length) * 100).toFixed(2))
  summary.avgCleanShare = Number(((cleanSum / queries.length) * 100).toFixed(2))
  summary.avgSignalCoverage = Number(((signalCoverageSum / queries.length) * 100).toFixed(2))
  summary.avgTop1Score = Number((top1ScoreSum / queries.length).toFixed(4))
  return summary
}

async function loadQuerySet(args = []) {
  const explicitPath = normalizeText(argValue(args, '--query-set', ''))
  const candidatePaths = explicitPath
    ? [path.resolve(explicitPath)]
    : [
      path.join(DEFAULT_EVAL_DIR, 'query-set.json'),
      path.join(DEFAULT_EVAL_DIR, 'query-set.template.json'),
    ]

  for (const filePath of candidatePaths) {
    const data = await readJson(filePath, null)
    if (!data || !Array.isArray(data?.queries)) continue
    const queries = data.queries
      .map((item, index) => ({
        id: normalizeText(item?.id) || `query-${index + 1}`,
        intent: normalizeQueryIntent(item?.intent || 'all'),
        query: normalizeSearchQuery(item?.query || ''),
        expectedSignals: Array.isArray(item?.expectedSignals)
          ? item.expectedSignals.map((signal) => normalizeText(signal).toLowerCase()).filter(Boolean)
          : [],
      }))
      .filter((item) => item.query)
    if (!queries.length) continue
    return {
      path: filePath,
      version: normalizeText(data?.version) || 'unknown',
      queries,
    }
  }

  throw new Error('未找到可用查询集（请提供 --query-set 或先准备 docs/wiki-vault/eval/query-set.json）')
}

function seedQuerySetFromAtoms(atoms = [], target = DEFAULT_QUERY_SET_TARGET) {
  const output = []
  const usedQuery = new Set()
  const byIntent = {
    issue: [],
    pattern: [],
    project: [],
    synthesis: [],
  }
  for (const atom of atoms) {
    const intent = mapKindToIntent(atom?.kind)
    byIntent[intent].push(atom)
  }
  for (const key of Object.keys(byIntent)) {
    byIntent[key].sort((left, right) => Number(right?.qualityScore || 0) - Number(left?.qualityScore || 0))
  }

  const quotas = {
    issue: Math.max(8, Math.round(target * 0.3)),
    pattern: Math.max(8, Math.round(target * 0.3)),
    project: Math.max(6, Math.round(target * 0.2)),
    synthesis: Math.max(6, Math.round(target * 0.2)),
  }

  const addFromBucket = (intent, atom) => {
    const title = normalizeText(atom?.title || '')
    const summary = normalizeText(atom?.summary || '')
    const query = buildQueryTextByIntent(intent, title, summary)
    if (!query || usedQuery.has(query.toLowerCase())) return false
    usedQuery.add(query.toLowerCase())
    output.push({
      id: `${intent}-${String(output.length + 1).padStart(3, '0')}`,
      intent,
      query,
      expectedSignals: defaultSignalsForIntent(intent),
      seed: {
        atomId: String(atom?.atomId || ''),
        kind: String(atom?.kind || ''),
        title,
        qualityTier: String(atom?.qualityTier || ''),
        qualityScore: Number(atom?.qualityScore || 0),
      },
    })
    return true
  }

  for (const [intent, quota] of Object.entries(quotas)) {
    const list = byIntent[intent] || []
    let count = 0
    for (const atom of list) {
      if (count >= quota) break
      if (addFromBucket(intent, atom)) count += 1
    }
  }

  const merged = [
    ...byIntent.issue,
    ...byIntent.pattern,
    ...byIntent.project,
    ...byIntent.synthesis,
  ].sort((left, right) => Number(right?.qualityScore || 0) - Number(left?.qualityScore || 0))

  for (const atom of merged) {
    if (output.length >= target) break
    addFromBucket(mapKindToIntent(atom?.kind), atom)
  }

  return output.slice(0, target).map((item, index) => ({
    id: `${item.intent}-${String(index + 1).padStart(3, '0')}`,
    intent: item.intent,
    query: item.query,
    expectedSignals: item.expectedSignals,
    seed: item.seed,
  }))
}

async function evaluateModesWithQuerySet({
  querySet,
  topK = DEFAULT_COMPARE_TOP_K,
  limit = DEFAULT_LIMIT,
} = {}) {
  const modeResult = {
    mode: DEFAULT_COMPARE_MODE,
    topK,
    limit,
    queries: [],
    summary: null,
  }

  for (const querySpec of querySet.queries) {
    const retrieveResult = await runLocalAtomRetrieve({
      query: querySpec.query,
      topK,
      limit,
      kind: 'all',
      qualityTier: 'all',
      status: 'visible',
    })
    const signalCoverage = new Set()
    const mappedResults = retrieveResult.results.map((result, index) => {
      const relevance = evaluateResultRelevance(result, querySpec)
      for (const signal of relevance.signalHits) signalCoverage.add(signal)
      return {
        rank: index + 1,
        ...result,
        traceable: Boolean(result.canonicalId && result.pageId && Array.isArray(result.sourceRefs) && result.sourceRefs.length),
        relevance,
      }
    })
    modeResult.queries.push({
      id: querySpec.id,
      query: querySpec.query,
      intent: querySpec.intent,
      expectedSignals: querySpec.expectedSignals,
      signalCoverage: Array.from(signalCoverage.values()),
      totalMatched: retrieveResult.totalMatched,
      results: mappedResults,
    })
  }

  modeResult.summary = summarizeModeQueries(modeResult.queries, topK)

  return {
    querySetPath: querySet.path,
    querySetVersion: querySet.version,
    modes: [modeResult],
    comparisons: [],
  }
}

function buildCompareMarkdown(report) {
  const lines = []
  lines.push('# GBrain V2 Query Set Evaluation')
  lines.push('')
  lines.push(`- generatedAt: ${report.generatedAt}`)
  lines.push(`- querySet: ${report.querySet.path}`)
  lines.push(`- queryCount: ${report.querySet.count}`)
  lines.push(`- topK: ${report.topK}`)
  lines.push(`- limit: ${report.limit}`)
  lines.push(`- mode: ${report.mode}`)
  lines.push('')
  lines.push('## Retrieval Summary')
  lines.push('')
  for (const mode of report.modeReports) {
    lines.push(`- hit@k: ${mode.summary.hitAtK}%`)
    lines.push(`- invalidRecall(avg): ${mode.summary.avgInvalidRecallRate}%`)
    lines.push(`- traceability(avg): ${mode.summary.avgTraceabilityRate}%`)
    lines.push(`- structuredShare(avg): ${mode.summary.avgStructuredShare}%`)
    lines.push(`- contextShare(avg): ${mode.summary.avgContextShare}%`)
    lines.push(`- signalCoverage(avg): ${mode.summary.avgSignalCoverage}%`)
    lines.push(`- top1Score(avg): ${mode.summary.avgTop1Score}`)
    lines.push('')
  }
  return lines.join('\n')
}

function buildBaselineMarkdown(report) {
  const lines = []
  lines.push('# GBrain V2 Baseline Snapshot')
  lines.push('')
  lines.push(`- generatedAt: ${report.generatedAt}`)
  lines.push(`- scope: ${report.scope}`)
  lines.push(`- knowledgeItems: ${report.knowledge.total}`)
  lines.push(`- sessions: ${report.sessions.total}`)
  lines.push(`- vaultMarkdownPages: ${report.vault.total}`)
  lines.push('')
  lines.push('## Coverage')
  lines.push('')
  lines.push(`- summary: ${report.knowledge.coverage.summary}%`)
  lines.push(`- contentHash: ${report.knowledge.coverage.contentHash}%`)
  lines.push(`- intakeStage: ${report.knowledge.coverage.intakeStage}%`)
  lines.push(`- sourceRefs: ${report.knowledge.coverage.sourceRefs}%`)
  lines.push(`- lineage(estimated): ${report.knowledge.coverage.lineage}%`)
  lines.push('')
  lines.push('## Quality Tier')
  lines.push('')
  for (const [tier, count] of Object.entries(report.knowledge.byTier || {})) {
    lines.push(`- ${tier}: ${count}`)
  }
  lines.push('')
  lines.push('## Duplicate Content Hash')
  lines.push('')
  lines.push(`- groups: ${report.knowledge.duplicateGroups.totalGroups}`)
  lines.push(`- itemsInDuplicateGroups: ${report.knowledge.duplicateGroups.totalItems}`)
  lines.push('')
  return lines.join('\n')
}

function buildDryRunMarkdown(report) {
  const lines = []
  lines.push('# GBrain V2 Dry Run Report')
  lines.push('')
  lines.push(`- generatedAt: ${report.generatedAt}`)
  lines.push(`- itemsAnalyzed: ${report.summary.total}`)
  lines.push(`- sampleSize: ${report.summary.sampleSize}`)
  lines.push('')
  lines.push('## Tier Distribution')
  lines.push('')
  for (const [tier, count] of Object.entries(report.summary.byTier || {})) {
    lines.push(`- ${tier}: ${count}`)
  }
  lines.push('')
  lines.push('## Kind Distribution')
  lines.push('')
  for (const [kind, count] of Object.entries(report.summary.byKind || {})) {
    lines.push(`- ${kind}: ${count}`)
  }
  lines.push('')
  lines.push('## Top Quality Issues')
  lines.push('')
  for (const [issue, count] of Object.entries(report.summary.qualityIssueCounts || {})) {
    lines.push(`- ${issue}: ${count}`)
  }
  lines.push('')
  lines.push('## Sample (lowest score first)')
  lines.push('')
  for (const item of report.samples.slice(0, 20)) {
    lines.push(`- ${item.rawId} | ${item.qualityTier}(${item.qualityScore}) | ${item.kind} | ${item.title}`)
  }
  lines.push('')
  return lines.join('\n')
}

async function ensureEvalTemplates() {
  const querySetTemplate = path.join(DEFAULT_EVAL_DIR, 'query-set.template.json')
  const labelTemplate = path.join(DEFAULT_EVAL_DIR, 'manual-label-template.csv')

  if (!(await pathExists(querySetTemplate))) {
    await writeJson(querySetTemplate, {
      version: 'schema-1',
      generatedAt: nowIso(),
      notes: '评估前将本模板复制为 query-set.json，再按真实检索意图补齐 queries。',
      queries: [
        {
          id: 'issue-001',
          intent: 'issue',
          query: '某模块报错后如何定位根因',
          expectedSignals: ['symptom', 'rootCause', 'fixPattern', 'validation'],
        },
        {
          id: 'pattern-001',
          intent: 'pattern',
          query: 'openclaw 导入后如何稳定去重',
          expectedSignals: ['recommendedShape', 'tradeoffs', 'evidenceRefs'],
        },
      ],
    })
  }

  if (!(await pathExists(labelTemplate))) {
    await ensureDir(labelTemplate)
    await writeFile(
      labelTemplate,
      [
        'query_id,result_rank,result_id,relevant,reason',
        'issue-001,1,issues/example,true,命中 symptom+fix',
        'issue-001,2,sources/example,false,只提到背景无修复结论',
      ].join('\n') + '\n',
      'utf8',
    )
  }
}

async function runBaseline(args) {
  const limit = toNumber(argValue(args, '--limit', String(DEFAULT_LIMIT)), DEFAULT_LIMIT, { min: 1, max: 5000 })
  const explicitOut = normalizeText(argValue(args, '--out', ''))
  const generatedAt = nowIso()
  const outputBase = explicitOut
    ? path.resolve(explicitOut)
    : path.join(DEFAULT_EVAL_DIR, `baseline-${compactTs(generatedAt)}.json`)

  await ensureEvalTemplates()

  const knowledge = await listKnowledgeItemsInDb({ limit, status: 'all', sourceType: 'all' })
  const knowledgeItems = Array.isArray(knowledge?.items) ? knowledge.items : []
  const knowledgeSummary = summarizeKnowledgeItems(knowledgeItems)
  const sessionIndex = await querySessions({ provider: '' })
  const sessionsSummary = summarizeSessions(sessionIndex)
  const vault = await countMarkdownFiles(path.resolve(process.cwd(), 'vault'))

  const report = {
    version: 'gbrain-v2-baseline.schema-1',
    generatedAt,
    scope: `knowledge_items(limit=${limit}) + session_index + vault_markdown`,
    knowledge: {
      total: knowledgeSummary.total,
      byStatus: knowledgeSummary.byStatus,
      bySourceType: knowledgeSummary.bySourceType,
      byIntakeStage: knowledgeSummary.byIntakeStage,
      byConfidence: knowledgeSummary.byConfidence,
      byKind: knowledgeSummary.byKind,
      byTier: knowledgeSummary.byTier,
      coverage: knowledgeSummary.coverage,
      duplicateGroups: knowledgeSummary.duplicateGroups,
      qualityIssueCounts: knowledgeSummary.qualityIssueCounts,
    },
    sessions: sessionsSummary,
    vault,
    notes: [
      'This report is intended for Phase A baseline freeze and should be versioned alongside query set snapshots.',
      'lineage coverage here is estimated from dry-run candidate generation, not final production lineage.',
    ],
  }

  const mdPath = toMdPath(outputBase)
  await writeJson(outputBase, report)
  await writeMarkdown(mdPath, buildBaselineMarkdown(report))

  console.log(`[gbrain-v2] baseline generated`)
  console.log(`- json: ${outputBase}`)
  console.log(`- md:   ${mdPath}`)
  console.log(`- knowledge items: ${report.knowledge.total}`)
  console.log(`- sessions: ${report.sessions.total}`)
  console.log(`- duplicate groups: ${report.knowledge.duplicateGroups.totalGroups}`)
}

async function runDryRun(args) {
  const limit = toNumber(argValue(args, '--limit', String(DEFAULT_LIMIT)), DEFAULT_LIMIT, { min: 1, max: 5000 })
  const sampleSize = toNumber(argValue(args, '--sample', String(DEFAULT_SAMPLE_SIZE)), DEFAULT_SAMPLE_SIZE, { min: 10, max: 1000 })
  const explicitOut = normalizeText(argValue(args, '--out', ''))
  const generatedAt = nowIso()
  const outputBase = explicitOut
    ? path.resolve(explicitOut)
    : path.join(DEFAULT_EVAL_DIR, `dry-run-${compactTs(generatedAt)}.json`)

  await ensureEvalTemplates()

  const knowledge = await listKnowledgeItemsInDb({ limit, status: 'all', sourceType: 'all' })
  const knowledgeItems = Array.isArray(knowledge?.items) ? knowledge.items : []
  const atoms = knowledgeItems.map((item) => buildAtomCandidate(item))
  const byTier = {}
  const byKind = {}
  const qualityIssueCounts = {}
  for (const atom of atoms) {
    inc(byTier, atom.qualityTier)
    inc(byKind, atom.kind)
    for (const issue of atom.qualityIssues) inc(qualityIssueCounts, issue)
  }

  const sortedByRisk = atoms
    .slice()
    .sort((left, right) => {
      if (left.qualityScore !== right.qualityScore) return left.qualityScore - right.qualityScore
      return String(left.rawId).localeCompare(String(right.rawId))
    })

  const report = {
    version: 'gbrain-v2-dry-run.schema-1',
    generatedAt,
    summary: {
      total: atoms.length,
      sampleSize,
      byTier,
      byKind,
      qualityIssueCounts,
      lineageCoverage: percent(
        atoms.filter((item) => item.lineage?.rawId && item.lineage?.atomId && item.lineage?.canonicalId && item.lineage?.pageId).length,
        atoms.length,
      ),
    },
    samples: sortedByRisk.slice(0, sampleSize).map((item) => ({
      rawId: item.rawId,
      atomId: item.atomId,
      canonicalId: item.canonicalId,
      pageId: item.pageId,
      pageType: item.pageType,
      qualityScore: item.qualityScore,
      qualityTier: item.qualityTier,
      qualityIssues: item.qualityIssues,
      kind: item.kind,
      intakeStage: item.intakeStage || 'unknown',
      confidence: item.confidence || 'unknown',
      title: item.title,
      summary: item.summary,
      sourceRefs: item.sourceRefs,
    })),
  }

  const mdPath = toMdPath(outputBase)
  await writeJson(outputBase, report)
  await writeMarkdown(mdPath, buildDryRunMarkdown(report))

  console.log(`[gbrain-v2] dry-run generated`)
  console.log(`- json: ${outputBase}`)
  console.log(`- md:   ${mdPath}`)
  console.log(`- analyzed: ${report.summary.total}`)
  console.log(`- lineage coverage (estimated): ${report.summary.lineageCoverage}%`)
}

async function runBackfill(args) {
  const limit = toNumber(argValue(args, '--limit', String(DEFAULT_LIMIT)), DEFAULT_LIMIT, { min: 1, max: 5000 })
  const status = normalizeText(argValue(args, '--status', 'all')).toLowerCase() || 'all'
  const sourceType = normalizeText(argValue(args, '--source-type', 'all')).toLowerCase() || 'all'
  const generatedAt = nowIso()
  const knowledge = await listKnowledgeItemsInDb({ limit, status, sourceType })
  const items = Array.isArray(knowledge?.items) ? knowledge.items : []

  let success = 0
  let failed = 0
  const byTier = {}
  const byKind = {}
  const failures = []

  for (const item of items) {
    try {
      const atom = buildAtomFromKnowledgeItem(item)
      await upsertKnowledgeAtomInDb(atom)
      success += 1
      inc(byTier, atom.qualityTier)
      inc(byKind, atom.kind)
    } catch (error) {
      failed += 1
      failures.push({
        rawId: String(item?.id || ''),
        reason: String(error?.message || error || 'unknown-error'),
      })
    }
  }

  const summary = {
    version: 'gbrain-v2-backfill.schema-1',
    generatedAt,
    total: items.length,
    success,
    failed,
    status,
    sourceType,
    byTier,
    byKind,
    failures: failures.slice(0, 50),
  }

  const outPath = path.join(DEFAULT_EVAL_DIR, `backfill-${compactTs(generatedAt)}.json`)
  await writeJson(outPath, summary)
  console.log('[gbrain-v2] backfill completed')
  console.log(`- total: ${summary.total}`)
  console.log(`- success: ${summary.success}`)
  console.log(`- failed: ${summary.failed}`)
  console.log(`- summary: ${outPath}`)
}

async function runCompare(args) {
  const topK = toNumber(argValue(args, '--top-k', String(DEFAULT_COMPARE_TOP_K)), DEFAULT_COMPARE_TOP_K, { min: 1, max: 30 })
  const limit = toNumber(argValue(args, '--limit', String(DEFAULT_LIMIT)), DEFAULT_LIMIT, { min: 1, max: 5000 })
  const explicitOut = normalizeText(argValue(args, '--out', ''))
  const generatedAt = nowIso()
  const outputBase = explicitOut
    ? path.resolve(explicitOut)
    : path.join(DEFAULT_EVAL_DIR, `compare-${compactTs(generatedAt)}.json`)

  await ensureEvalTemplates()
  const querySet = await loadQuerySet(args)
  const result = await evaluateModesWithQuerySet({
    querySet,
    modes: modeList,
    topK,
    limit,
  })

  const report = {
    version: 'gbrain-v2-compare.schema-1',
    generatedAt,
    topK,
    limit,
    mode: DEFAULT_COMPARE_MODE,
    querySet: {
      path: result.querySetPath,
      version: result.querySetVersion,
      count: querySet.queries.length,
    },
    modeReports: result.modes,
    comparisons: result.comparisons,
  }

  const mdPath = toMdPath(outputBase)
  await writeJson(outputBase, report)
  await writeMarkdown(mdPath, buildCompareMarkdown(report))

  console.log('[gbrain-v2] compare generated')
  console.log(`- json: ${outputBase}`)
  console.log(`- md:   ${mdPath}`)
  console.log(`- mode: ${DEFAULT_COMPARE_MODE}`)
  console.log(`- queries: ${querySet.queries.length}`)
}

async function runSeedQuerySet(args) {
  const limit = toNumber(argValue(args, '--limit', String(DEFAULT_LIMIT)), DEFAULT_LIMIT, { min: 1, max: 5000 })
  const target = toNumber(argValue(args, '--target', String(DEFAULT_QUERY_SET_TARGET)), DEFAULT_QUERY_SET_TARGET, { min: 10, max: 500 })
  const explicitOut = normalizeText(argValue(args, '--out', ''))
  const generatedAt = nowIso()
  const outputPath = explicitOut
    ? path.resolve(explicitOut)
    : path.join(DEFAULT_EVAL_DIR, 'query-set.json')

  const atoms = await listKnowledgeAtomsInDb({
    limit,
    kind: 'all',
    qualityTier: 'all',
    status: 'visible',
  })
  const queries = seedQuerySetFromAtoms(atoms, target)
  if (!queries.length) throw new Error('无法从当前 Atom 生成查询集，请先执行 backfill 或检查数据')

  const payload = {
    version: 'schema-1',
    generatedAt,
    notes: `由 seed-query-set 自动生成，目标 ${target} 条。`,
    source: {
      atoms: Array.isArray(atoms) ? atoms.length : 0,
      limit,
    },
    queries,
  }
  await writeJson(outputPath, payload)
  console.log('[gbrain-v2] query-set seeded')
  console.log(`- out: ${outputPath}`)
  console.log(`- queries: ${queries.length}`)
}

async function main() {
  loadLocalEnv()
  const args = process.argv.slice(2)
  const command = String(args[0] || '').trim().toLowerCase()

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage()
    return
  }

  if (command === 'baseline') {
    await runBaseline(args.slice(1))
    return
  }

  if (command === 'dry-run') {
    await runDryRun(args.slice(1))
    return
  }

  if (command === 'backfill') {
    await runBackfill(args.slice(1))
    return
  }

  if (command === 'compare') {
    await runCompare(args.slice(1))
    return
  }

  if (command === 'seed-query-set') {
    await runSeedQuerySet(args.slice(1))
    return
  }

  usage()
  process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
