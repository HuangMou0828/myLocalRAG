#!/usr/bin/env node
import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { loadLocalEnv } from '../server/lib/load-env.mjs'
import { listKnowledgeItemsInDb, upsertKnowledgeAtomInDb } from '../server/lib/db.mjs'
import { querySessions } from '../server/lib/scanner.mjs'
import { buildAtomFromKnowledgeItem } from '../server/lib/gbrain-v2.mjs'

const DEFAULT_LIMIT = 5000
const DEFAULT_SAMPLE_SIZE = 120
const DEFAULT_EVAL_DIR = path.resolve(process.cwd(), 'docs', 'wiki-vault', 'eval')

function usage() {
  console.log(
    [
      'Usage:',
      '  node scripts/gbrain-v2-eval.mjs baseline [--limit <n>] [--out <file>]',
      '  node scripts/gbrain-v2-eval.mjs dry-run [--limit <n>] [--sample <n>] [--out <file>]',
      '  node scripts/gbrain-v2-eval.mjs backfill [--limit <n>] [--status <all|draft|active|archived>]',
      '',
      'Examples:',
      '  node scripts/gbrain-v2-eval.mjs baseline',
      '  node scripts/gbrain-v2-eval.mjs dry-run --sample 80',
      '  node scripts/gbrain-v2-eval.mjs backfill --status all',
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
      version: 'v1',
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
    version: 'gbrain-v2-baseline.v1',
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
    version: 'gbrain-v2-dry-run.v1',
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
    version: 'gbrain-v2-backfill.v1',
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

  usage()
  process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
