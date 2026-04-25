#!/usr/bin/env node
import path from 'node:path'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import {
  getKnowledgeLineageStatsInDb,
  listKnowledgeAtomsInDb,
  listKnowledgeItemsInDb,
} from '../server/lib/db.mjs'
import { loadLocalEnv } from '../server/lib/load-env.mjs'

const DEFAULT_LIMIT = 5000
const DEFAULT_STALE_DAYS = 14
const DEFAULT_EVAL_DIR = path.resolve(process.cwd(), 'docs', 'wiki-vault', 'eval')

function usage() {
  console.log(
    [
      'Usage:',
      '  node scripts/gbrain-v2-governance.mjs report [--limit <n>] [--stale-days <n>] [--out <file>]',
      '  node scripts/gbrain-v2-governance.mjs repair-queue [--limit <n>] [--stale-days <n>] [--top <n>] [--out <file>]',
      '  node scripts/gbrain-v2-governance.mjs guard [--current <file>] [--baseline <file>] [--out <file>] [--max-legacy-share <n>] [--max-duplicate-share <n>] [--max-lineage-missing-share <n>] [--max-stale-draft-share <n>] [--max-delta <n>]',
      '',
      'Examples:',
      '  node scripts/gbrain-v2-governance.mjs report',
      '  node scripts/gbrain-v2-governance.mjs repair-queue --top 120',
      '  node scripts/gbrain-v2-governance.mjs guard --max-legacy-share 18 --max-duplicate-share 22',
    ].join('\n'),
  )
}

function argValue(args, key, fallback = '') {
  const index = args.indexOf(key)
  if (index < 0) return fallback
  return args[index + 1] || fallback
}

function toNumber(input, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(input)
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

function normalizeText(input) {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
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

function percent(part, total) {
  if (!total) return 0
  return Number(((Number(part || 0) / Number(total || 1)) * 100).toFixed(2))
}

async function writeJson(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

async function writeMarkdown(filePath, content) {
  await writeFile(filePath, `${String(content || '').trim()}\n`, 'utf8')
}

async function readJson(filePath, fallback = null) {
  try {
    const content = await readFile(filePath, 'utf8')
    return content ? JSON.parse(content) : fallback
  } catch {
    return fallback
  }
}

function toTimestamp(input) {
  const value = +new Date(input || 0)
  return Number.isFinite(value) ? value : 0
}

function buildDuplicateGroups(knowledgeItems = []) {
  const hashGroups = new Map()
  for (const item of knowledgeItems) {
    const hash = normalizeText(item?.meta?.contentHash)
    if (!hash) continue
    if (!hashGroups.has(hash)) hashGroups.set(hash, [])
    hashGroups.get(hash).push(item)
  }
  return Array.from(hashGroups.entries())
    .filter(([, list]) => list.length > 1)
    .map(([contentHash, list]) => ({
      contentHash,
      count: list.length,
      items: list.map((item) => ({
        id: String(item?.id || ''),
        title: String(item?.title || ''),
        sourceSubtype: String(item?.sourceSubtype || ''),
        status: String(item?.status || ''),
        updatedAt: String(item?.updatedAt || ''),
      })),
    }))
    .sort((a, b) => b.count - a.count)
}

function summarizeAtoms(atoms = []) {
  const byTier = { clean: 0, suspect: 0, legacy: 0 }
  const byKind = {}
  for (const atom of atoms) {
    const tier = normalizeText(atom?.qualityTier).toLowerCase()
    if (tier === 'clean' || tier === 'suspect' || tier === 'legacy') byTier[tier] += 1
    const kind = normalizeText(atom?.kind).toLowerCase() || 'unknown'
    byKind[kind] = Number(byKind[kind] || 0) + 1
  }
  return { byTier, byKind }
}

function buildGovernanceMarkdown(report) {
  const lines = []
  lines.push('# GBrain V2 Governance Weekly Report')
  lines.push('')
  lines.push(`- generatedAt: ${report.generatedAt}`)
  lines.push(`- limit: ${report.limit}`)
  lines.push(`- staleDays: ${report.staleDays}`)
  lines.push(`- atomsTotal: ${report.atomsTotal}`)
  lines.push(`- knowledgeItemsTotal: ${report.knowledgeItemsTotal}`)
  lines.push('')
  lines.push('## Core Metrics')
  lines.push('')
  lines.push(`- legacyShare: ${report.metrics.legacyShare}%`)
  lines.push(`- suspectShare: ${report.metrics.suspectShare}%`)
  lines.push(`- duplicateShare: ${report.metrics.duplicateShare}%`)
  lines.push(`- lineageMissingShare: ${report.metrics.lineageMissingShare}%`)
  lines.push(`- staleDraftShare: ${report.metrics.staleDraftShare}%`)
  lines.push('')
  lines.push('## Counts')
  lines.push('')
  lines.push(`- legacyAtoms: ${report.metrics.legacyCount}`)
  lines.push(`- suspectAtoms: ${report.metrics.suspectCount}`)
  lines.push(`- duplicateGroups: ${report.metrics.duplicateGroups}`)
  lines.push(`- duplicateItems: ${report.metrics.duplicateItems}`)
  lines.push(`- lineageMissing: ${report.metrics.lineageMissingCount}`)
  lines.push(`- staleDraftItems: ${report.metrics.staleDraftCount}`)
  lines.push('')
  lines.push('## Top Risks')
  lines.push('')
  for (const item of report.riskHighlights.slice(0, 12)) {
    lines.push(`- [${item.category}] ${item.title} | severity=${item.severity} | detail=${item.detail}`)
  }
  lines.push('')
  return lines.join('\n')
}

function buildRepairQueueMarkdown(report) {
  const lines = []
  lines.push('# GBrain V2 Repair Queue')
  lines.push('')
  lines.push(`- generatedAt: ${report.generatedAt}`)
  lines.push(`- queueSize: ${report.queue.length}`)
  lines.push(`- top: ${report.top}`)
  lines.push('')
  lines.push('## Queue')
  lines.push('')
  for (const item of report.queue.slice(0, report.top)) {
    lines.push(`- [${item.priority}] ${item.type} | ${item.title} | action=${item.recommendedAction}`)
  }
  lines.push('')
  return lines.join('\n')
}

function buildGuardMarkdown(report) {
  const lines = []
  lines.push('# GBrain V2 Regression Guard')
  lines.push('')
  lines.push(`- generatedAt: ${report.generatedAt}`)
  lines.push(`- pass: ${report.pass}`)
  lines.push(`- current: ${report.currentPath}`)
  lines.push(`- baseline: ${report.baselinePath || '-'}`)
  lines.push('')
  lines.push('## Thresholds')
  lines.push('')
  lines.push(`- maxLegacyShare: ${report.thresholds.maxLegacyShare}%`)
  lines.push(`- maxDuplicateShare: ${report.thresholds.maxDuplicateShare}%`)
  lines.push(`- maxLineageMissingShare: ${report.thresholds.maxLineageMissingShare}%`)
  lines.push(`- maxStaleDraftShare: ${report.thresholds.maxStaleDraftShare}%`)
  lines.push(`- maxDelta: ${report.thresholds.maxDelta}%`)
  lines.push('')
  lines.push('## Checks')
  lines.push('')
  for (const check of report.checks) {
    lines.push(`- ${check.name}: ${check.pass ? 'pass' : 'fail'} (${check.detail})`)
  }
  lines.push('')
  return lines.join('\n')
}

async function collectGovernanceData({ limit = DEFAULT_LIMIT, staleDays = DEFAULT_STALE_DAYS } = {}) {
  const [atoms, knowledge, lineageStats] = await Promise.all([
    listKnowledgeAtomsInDb({ limit, status: 'all', kind: 'all', qualityTier: 'all' }),
    listKnowledgeItemsInDb({ limit, status: 'all', sourceType: 'all' }),
    getKnowledgeLineageStatsInDb(),
  ])
  const atomList = Array.isArray(atoms) ? atoms : []
  const knowledgeItems = Array.isArray(knowledge?.items) ? knowledge.items : []
  const atomSummary = summarizeAtoms(atomList)
  const duplicateGroups = buildDuplicateGroups(knowledgeItems)
  const duplicateItems = duplicateGroups.reduce((sum, item) => sum + item.count, 0)
  const staleBeforeTs = Date.now() - Math.max(1, staleDays) * 24 * 60 * 60 * 1000
  const staleDraftItems = knowledgeItems
    .filter((item) => normalizeText(item?.status).toLowerCase() === 'draft')
    .filter((item) => toTimestamp(item?.updatedAt) > 0 && toTimestamp(item?.updatedAt) <= staleBeforeTs)
    .sort((left, right) => toTimestamp(left?.updatedAt) - toTimestamp(right?.updatedAt))

  const lineageMissingAtoms = atomList
    .filter((atom) => {
      const hasLineage = normalizeText(atom?.rawId) && normalizeText(atom?.atomId) && normalizeText(atom?.canonicalId) && normalizeText(atom?.pageId)
      const hasSourceRefs = Array.isArray(atom?.sourceRefs) && atom.sourceRefs.length > 0
      return !hasLineage || !hasSourceRefs
    })
    .sort((left, right) => Number(left?.qualityScore || 0) - Number(right?.qualityScore || 0))

  const legacyAtoms = atomList
    .filter((atom) => normalizeText(atom?.qualityTier).toLowerCase() === 'legacy')
    .sort((left, right) => Number(left?.qualityScore || 0) - Number(right?.qualityScore || 0))
  const suspectAtoms = atomList
    .filter((atom) => normalizeText(atom?.qualityTier).toLowerCase() === 'suspect')
    .sort((left, right) => Number(left?.qualityScore || 0) - Number(right?.qualityScore || 0))

  const riskHighlights = [
    ...legacyAtoms.slice(0, 5).map((atom) => ({
      category: 'legacy',
      title: `${atom.kind || 'unknown'}:${atom.title || atom.atomId}`,
      severity: 90,
      detail: `qualityScore=${atom.qualityScore}`,
    })),
    ...lineageMissingAtoms.slice(0, 5).map((atom) => ({
      category: 'lineage',
      title: `${atom.kind || 'unknown'}:${atom.title || atom.atomId}`,
      severity: 85,
      detail: 'missing lineage/sourceRefs',
    })),
    ...duplicateGroups.slice(0, 2).map((group) => ({
      category: 'duplicate',
      title: group.contentHash,
      severity: 70,
      detail: `count=${group.count}`,
    })),
    ...staleDraftItems.slice(0, 3).map((item) => ({
      category: 'stale-draft',
      title: item.title || item.id,
      severity: 65,
      detail: `updatedAt=${item.updatedAt}`,
    })),
  ].sort((left, right) => right.severity - left.severity)

  return {
    limit,
    staleDays,
    generatedAt: nowIso(),
    atomsTotal: atomList.length,
    knowledgeItemsTotal: knowledgeItems.length,
    lineageStats,
    metrics: {
      legacyCount: legacyAtoms.length,
      suspectCount: suspectAtoms.length,
      duplicateGroups: duplicateGroups.length,
      duplicateItems,
      lineageMissingCount: lineageMissingAtoms.length,
      staleDraftCount: staleDraftItems.length,
      legacyShare: percent(legacyAtoms.length, atomList.length),
      suspectShare: percent(suspectAtoms.length, atomList.length),
      duplicateShare: percent(duplicateItems, knowledgeItems.length),
      lineageMissingShare: percent(lineageMissingAtoms.length, atomList.length),
      staleDraftShare: percent(staleDraftItems.length, knowledgeItems.length),
      byTier: atomSummary.byTier,
      byKind: atomSummary.byKind,
    },
    topLegacyAtoms: legacyAtoms.slice(0, 30),
    topSuspectAtoms: suspectAtoms.slice(0, 30),
    topLineageMissingAtoms: lineageMissingAtoms.slice(0, 30),
    topDuplicateGroups: duplicateGroups.slice(0, 30),
    topStaleDraftItems: staleDraftItems.slice(0, 50),
    riskHighlights,
  }
}

function buildRepairQueue(report, top = 120) {
  const queue = []
  for (const atom of report.topLegacyAtoms || []) {
    queue.push({
      priority: 'P0',
      type: 'legacy-atom',
      atomId: atom.atomId,
      title: atom.title || atom.atomId,
      recommendedAction: 'downgrade-or-repair',
      reason: `legacy qualityScore=${atom.qualityScore}`,
      detail: {
        kind: atom.kind,
        qualityIssues: atom.qualityIssues || [],
        sourceRefs: atom.sourceRefs || [],
      },
    })
  }
  for (const atom of report.topLineageMissingAtoms || []) {
    queue.push({
      priority: 'P1',
      type: 'lineage-missing',
      atomId: atom.atomId,
      title: atom.title || atom.atomId,
      recommendedAction: 'repair-lineage',
      reason: 'lineage/sourceRefs missing',
      detail: {
        rawId: atom.rawId,
        canonicalId: atom.canonicalId,
        pageId: atom.pageId,
      },
    })
  }
  for (const group of report.topDuplicateGroups || []) {
    queue.push({
      priority: 'P1',
      type: 'duplicate-group',
      title: group.contentHash,
      recommendedAction: 'merge-or-hide-duplicates',
      reason: `duplicate count=${group.count}`,
      detail: {
        count: group.count,
        sampleIds: (group.items || []).slice(0, 8).map((item) => item.id),
      },
    })
  }
  for (const item of report.topStaleDraftItems || []) {
    queue.push({
      priority: 'P2',
      type: 'stale-draft',
      rawId: item.id,
      title: item.title || item.id,
      recommendedAction: 'promote-or-dismiss',
      reason: `stale draft updatedAt=${item.updatedAt}`,
      detail: {
        sourceType: item.sourceType,
        sourceSubtype: item.sourceSubtype,
      },
    })
  }
  const order = { P0: 0, P1: 1, P2: 2, P3: 3 }
  return queue
    .sort((left, right) => (order[left.priority] ?? 9) - (order[right.priority] ?? 9))
    .slice(0, Math.max(1, top))
}

async function listGovernanceReports() {
  let entries = []
  try {
    entries = await readdir(DEFAULT_EVAL_DIR, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isFile() && /^governance-report-.*\.json$/i.test(entry.name))
    .map((entry) => path.join(DEFAULT_EVAL_DIR, entry.name))
    .sort()
}

async function resolveGuardPaths(args) {
  const current = normalizeText(argValue(args, '--current', ''))
  const baseline = normalizeText(argValue(args, '--baseline', ''))
  if (current) return { currentPath: path.resolve(current), baselinePath: baseline ? path.resolve(baseline) : '' }
  const reports = await listGovernanceReports()
  if (!reports.length) throw new Error('找不到 governance-report-*.json，请先执行 report')
  const currentPath = reports[reports.length - 1]
  const baselinePath = baseline
    ? path.resolve(baseline)
    : reports.length >= 2
      ? reports[reports.length - 2]
      : ''
  return { currentPath, baselinePath }
}

function metricDiff(current = 0, baseline = 0) {
  return Number((Number(current || 0) - Number(baseline || 0)).toFixed(2))
}

async function runReport(args) {
  const limit = toNumber(argValue(args, '--limit', String(DEFAULT_LIMIT)), DEFAULT_LIMIT, { min: 1, max: 5000 })
  const staleDays = toNumber(argValue(args, '--stale-days', String(DEFAULT_STALE_DAYS)), DEFAULT_STALE_DAYS, { min: 1, max: 365 })
  const explicitOut = normalizeText(argValue(args, '--out', ''))
  const generatedAt = nowIso()
  const outPath = explicitOut
    ? path.resolve(explicitOut)
    : path.join(DEFAULT_EVAL_DIR, `governance-report-${compactTs(generatedAt)}.json`)
  const report = await collectGovernanceData({ limit, staleDays })
  const mdPath = String(outPath).replace(/\.json$/i, '.md')
  await writeJson(outPath, report)
  await writeMarkdown(mdPath, buildGovernanceMarkdown(report))
  console.log('[gbrain-v2-governance] report generated')
  console.log(`- json: ${outPath}`)
  console.log(`- md:   ${mdPath}`)
  console.log(`- legacyShare: ${report.metrics.legacyShare}%`)
  console.log(`- duplicateShare: ${report.metrics.duplicateShare}%`)
  console.log(`- lineageMissingShare: ${report.metrics.lineageMissingShare}%`)
}

async function runRepairQueue(args) {
  const limit = toNumber(argValue(args, '--limit', String(DEFAULT_LIMIT)), DEFAULT_LIMIT, { min: 1, max: 5000 })
  const staleDays = toNumber(argValue(args, '--stale-days', String(DEFAULT_STALE_DAYS)), DEFAULT_STALE_DAYS, { min: 1, max: 365 })
  const top = toNumber(argValue(args, '--top', '120'), 120, { min: 1, max: 1000 })
  const explicitOut = normalizeText(argValue(args, '--out', ''))
  const generatedAt = nowIso()
  const outPath = explicitOut
    ? path.resolve(explicitOut)
    : path.join(DEFAULT_EVAL_DIR, `governance-repair-queue-${compactTs(generatedAt)}.json`)
  const baseReport = await collectGovernanceData({ limit, staleDays })
  const queue = buildRepairQueue(baseReport, top)
  const report = {
    version: 'gbrain-v2-governance-repair-queue.v1',
    generatedAt,
    top,
    metrics: baseReport.metrics,
    queue,
  }
  const mdPath = String(outPath).replace(/\.json$/i, '.md')
  await writeJson(outPath, report)
  await writeMarkdown(mdPath, buildRepairQueueMarkdown(report))
  console.log('[gbrain-v2-governance] repair queue generated')
  console.log(`- json: ${outPath}`)
  console.log(`- md:   ${mdPath}`)
  console.log(`- queue: ${queue.length}`)
}

async function runGuard(args) {
  const generatedAt = nowIso()
  const { currentPath, baselinePath } = await resolveGuardPaths(args)
  const current = await readJson(currentPath, null)
  if (!current?.metrics) throw new Error(`current 报告无效: ${currentPath}`)
  const baseline = baselinePath ? await readJson(baselinePath, null) : null
  const thresholds = {
    maxLegacyShare: toNumber(argValue(args, '--max-legacy-share', '20'), 20, { min: 0, max: 100 }),
    maxDuplicateShare: toNumber(argValue(args, '--max-duplicate-share', '25'), 25, { min: 0, max: 100 }),
    maxLineageMissingShare: toNumber(argValue(args, '--max-lineage-missing-share', '5'), 5, { min: 0, max: 100 }),
    maxStaleDraftShare: toNumber(argValue(args, '--max-stale-draft-share', '35'), 35, { min: 0, max: 100 }),
    maxDelta: toNumber(argValue(args, '--max-delta', '3'), 3, { min: 0, max: 100 }),
  }

  const checks = []
  const absoluteChecks = [
    ['legacyShare', current.metrics.legacyShare, thresholds.maxLegacyShare],
    ['duplicateShare', current.metrics.duplicateShare, thresholds.maxDuplicateShare],
    ['lineageMissingShare', current.metrics.lineageMissingShare, thresholds.maxLineageMissingShare],
    ['staleDraftShare', current.metrics.staleDraftShare, thresholds.maxStaleDraftShare],
  ]
  for (const [name, value, maxValue] of absoluteChecks) {
    checks.push({
      name: `abs:${name}`,
      pass: Number(value) <= Number(maxValue),
      detail: `${value}% <= ${maxValue}%`,
    })
  }

  if (baseline?.metrics) {
    const deltaChecks = [
      ['legacyShare', metricDiff(current.metrics.legacyShare, baseline.metrics.legacyShare)],
      ['duplicateShare', metricDiff(current.metrics.duplicateShare, baseline.metrics.duplicateShare)],
      ['lineageMissingShare', metricDiff(current.metrics.lineageMissingShare, baseline.metrics.lineageMissingShare)],
      ['staleDraftShare', metricDiff(current.metrics.staleDraftShare, baseline.metrics.staleDraftShare)],
    ]
    for (const [name, delta] of deltaChecks) {
      checks.push({
        name: `delta:${name}`,
        pass: Number(delta) <= Number(thresholds.maxDelta),
        detail: `${delta}% <= ${thresholds.maxDelta}%`,
      })
    }
  }

  const pass = checks.every((item) => item.pass)
  const explicitOut = normalizeText(argValue(args, '--out', ''))
  const outPath = explicitOut
    ? path.resolve(explicitOut)
    : path.join(DEFAULT_EVAL_DIR, `governance-guard-${compactTs(generatedAt)}.json`)
  const report = {
    version: 'gbrain-v2-governance-guard.v1',
    generatedAt,
    pass,
    currentPath,
    baselinePath: baselinePath || null,
    thresholds,
    checks,
  }
  const mdPath = String(outPath).replace(/\.json$/i, '.md')
  await writeJson(outPath, report)
  await writeMarkdown(mdPath, buildGuardMarkdown(report))
  console.log('[gbrain-v2-governance] guard completed')
  console.log(`- json: ${outPath}`)
  console.log(`- md:   ${mdPath}`)
  console.log(`- pass: ${pass}`)
  if (!pass) process.exitCode = 2
}

async function main() {
  loadLocalEnv()
  const args = process.argv.slice(2)
  const command = normalizeText(args[0]).toLowerCase()

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage()
    return
  }

  if (command === 'report') {
    await runReport(args.slice(1))
    return
  }

  if (command === 'repair-queue') {
    await runRepairQueue(args.slice(1))
    return
  }

  if (command === 'guard') {
    await runGuard(args.slice(1))
    return
  }

  usage()
  process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

