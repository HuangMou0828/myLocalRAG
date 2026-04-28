#!/usr/bin/env node
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { loadLocalEnv } from '../server/lib/load-env.mjs'

export const DEFAULT_OPENCLAW_KNOWLEDGE_ROOT = path.join(os.homedir(), '.openclaw', 'knowledge', 'inbox')
const VALID_SOURCE_TYPES = new Set(['capture', 'note', 'document'])
const VALID_STATUSES = new Set(['draft', 'active', 'archived'])
const VALID_INTAKE_STAGES = new Set(['inbox', 'needs-context', 'search-candidate', 'wiki-candidate', 'reference-only'])
const VALID_CONFIDENCE = new Set(['low', 'medium', 'high'])
const GENERIC_TITLES = new Set(['错误教训', '最佳实践', '功能需求', '学习记录', '记忆', '每日记录', '参考资料'])
let dbApi = null

async function loadDbApi() {
  if (!dbApi) {
    dbApi = await import('../server/lib/db.mjs')
  }
  return dbApi
}

function usage() {
  console.log(
    [
      'Usage:',
      '  node scripts/openclaw-knowledge.mjs preview [--root <path>] [--json]',
      '  node scripts/openclaw-knowledge.mjs import [--root <path>] [--json]',
      '',
      'Default root:',
      `  ${DEFAULT_OPENCLAW_KNOWLEDGE_ROOT}`,
      '',
      'Examples:',
      '  node scripts/openclaw-knowledge.mjs preview',
      '  node scripts/openclaw-knowledge.mjs import',
      '  node scripts/openclaw-knowledge.mjs preview --root ~/.openclaw/knowledge/inbox --json',
    ].join('\n'),
  )
}

function argValue(args, key) {
  const index = args.indexOf(key)
  if (index < 0) return ''
  return args[index + 1] || ''
}

function hasFlag(args, key) {
  return args.includes(key)
}

function expandHome(input) {
  const value = String(input || '').trim()
  if (!value) return ''
  if (value === '~') return os.homedir()
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2))
  return value
}

function toPosixPath(input) {
  return String(input || '').split(path.sep).join('/')
}

function stableSha1(input) {
  return createHash('sha1').update(String(input || '')).digest('hex')
}

function stableOpenClawId(relativePath) {
  return `openclaw_${stableSha1(toPosixPath(relativePath))}`
}

function trimQuotes(input) {
  return String(input || '').trim().replace(/^['"]|['"]$/g, '')
}

function parseScalarValue(rawValue) {
  const value = trimQuotes(rawValue)
  if (!value) return ''
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((item) => trimQuotes(item))
      .filter(Boolean)
  }
  return value
}

function parseFrontmatter(markdown) {
  const raw = String(markdown || '')
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { frontmatter: {}, body: raw }

  const frontmatter = {}
  let currentListKey = ''
  for (const line of String(match[1] || '').split(/\r?\n/)) {
    const listMatch = line.match(/^\s*-\s*(.*?)\s*$/)
    if (listMatch && currentListKey) {
      const entry = trimQuotes(listMatch[1])
      if (entry) frontmatter[currentListKey].push(entry)
      continue
    }

    const keyValue = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/)
    if (!keyValue) {
      currentListKey = ''
      continue
    }

    const key = keyValue[1].trim()
    const value = keyValue[2].trim()
    if (!value) {
      frontmatter[key] = []
      currentListKey = key
      continue
    }

    frontmatter[key] = parseScalarValue(value)
    currentListKey = ''
  }

  return {
    frontmatter,
    body: raw.slice(match[0].length),
  }
}

function normalizeEnum(value, validValues, fallback) {
  const normalized = String(value || '').trim().toLowerCase()
  return validValues.has(normalized) ? normalized : fallback
}

function dedupeList(items, maxItems = 24) {
  const seen = new Set()
  const result = []
  for (const item of Array.isArray(items) ? items : []) {
    const value = String(item || '').trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
    if (result.length >= maxItems) break
  }
  return result
}

function firstScalar(value) {
  if (Array.isArray(value)) return String(value[0] || '').trim()
  return String(value || '').trim()
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean)
  return String(value || '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function pathDefaults(relativePath) {
  const normalized = toPosixPath(relativePath).toLowerCase()
  if (normalized.startsWith('errors/')) {
    return {
      sourceType: 'note',
      sourceSubtype: 'error-lesson',
      intakeStage: 'wiki-candidate',
      confidence: 'high',
      pathTag: 'errors',
    }
  }
  if (normalized.startsWith('patterns/')) {
    return {
      sourceType: 'note',
      sourceSubtype: 'pattern',
      intakeStage: 'wiki-candidate',
      confidence: 'high',
      pathTag: 'patterns',
    }
  }
  if (normalized.startsWith('memories/')) {
    return {
      sourceType: 'note',
      sourceSubtype: 'memory',
      intakeStage: 'search-candidate',
      confidence: 'high',
      pathTag: 'memories',
    }
  }
  if (normalized.startsWith('daily/')) {
    return {
      sourceType: 'capture',
      sourceSubtype: 'daily-note',
      intakeStage: 'inbox',
      confidence: 'medium',
      pathTag: 'daily',
    }
  }
  if (normalized.startsWith('reference/skills/')) {
    return {
      sourceType: 'document',
      sourceSubtype: 'skill-reference',
      intakeStage: 'search-candidate',
      confidence: 'medium',
      pathTag: 'reference',
    }
  }
  if (normalized.startsWith('reference/tools/')) {
    return {
      sourceType: 'document',
      sourceSubtype: 'tool-reference',
      intakeStage: 'search-candidate',
      confidence: 'medium',
      pathTag: 'reference',
    }
  }
  if (normalized.startsWith('reference/')) {
    return {
      sourceType: 'document',
      sourceSubtype: 'reference',
      intakeStage: 'search-candidate',
      confidence: 'medium',
      pathTag: 'reference',
    }
  }
  return {
    sourceType: 'capture',
    sourceSubtype: 'openclaw',
    intakeStage: 'inbox',
    confidence: 'medium',
    pathTag: 'openclaw',
  }
}

function titleFromBody(body) {
  const h1 = String(body || '').match(/^#\s+(.+?)\s*$/m)
  return h1 ? h1[1].trim() : ''
}

function isGenericTitle(title) {
  return GENERIC_TITLES.has(String(title || '').trim())
}

function firstMeaningfulBodyLine(body) {
  for (const rawLine of String(body || '').split(/\r?\n/)) {
    const line = rawLine
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*]\s+/, '')
      .trim()
    if (!line) continue
    if (isGenericTitle(line)) continue
    if (/^(symptom|cause|fix|validation|when to use|recommended practice|tradeoffs)$/iu.test(line)) continue
    return line
  }
  return ''
}

function titleFromPath(relativePath) {
  const base = path.basename(relativePath, path.extname(relativePath))
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractSection(markdown, headingPatterns) {
  const lines = String(markdown || '').split(/\r?\n/)
  const start = lines.findIndex((line) => headingPatterns.some((pattern) => pattern.test(line.trim())))
  if (start < 0) return ''
  const collected = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^#{1,6}\s+/.test(line.trim())) break
    collected.push(line)
  }
  return collected.join('\n').trim()
}

function compactText(input, maxChars = 260) {
  const text = String(input || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`_[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 3))}...`
}

function inferSummary(body, frontmatter) {
  const explicit = firstScalar(frontmatter.summary || frontmatter.description)
  if (explicit) return explicit

  const summarySection = extractSection(body, [
    /^##\s*(?:📌\s*)?摘要\s*$/u,
    /^##\s*summary\s*$/iu,
  ])
  if (summarySection) return compactText(summarySection)

  const firstParagraph = String(body || '')
    .replace(/^#\s+.+$/m, '')
    .split(/\n\s*\n/g)
    .map((item) => compactText(item))
    .find(Boolean)
  return firstParagraph || ''
}

function statusForIntakeStage(frontmatterStatus, intakeStage) {
  const normalized = normalizeEnum(frontmatterStatus, VALID_STATUSES, '')
  if (normalized === 'archived') return 'archived'
  if (String(intakeStage || '') === 'wiki-candidate') return 'active'
  return 'draft'
}

function buildKnowledgePayload({ root, filePath, raw }) {
  const relativePath = toPosixPath(path.relative(root, filePath))
  const defaults = pathDefaults(relativePath)
  const { frontmatter, body } = parseFrontmatter(raw)
  const sourceType = normalizeEnum(frontmatter.sourceType || frontmatter.type, VALID_SOURCE_TYPES, defaults.sourceType)
  const sourceSubtype = firstScalar(frontmatter.sourceSubtype || frontmatter.subtype) || defaults.sourceSubtype
  const intakeStage = normalizeEnum(frontmatter.intakeStage || frontmatter.stage, VALID_INTAKE_STAGES, defaults.intakeStage)
  const confidence = normalizeEnum(frontmatter.confidence, VALID_CONFIDENCE, defaults.confidence)
  const contentHash = stableSha1(raw)
  const id = firstScalar(frontmatter.id) || stableOpenClawId(relativePath)
  const tags = dedupeList([
    'openclaw',
    defaults.pathTag,
    sourceSubtype,
    ...arrayValue(frontmatter.tags),
  ])
  const project = firstScalar(frontmatter.project)
  const topic = firstScalar(frontmatter.topic)
  const keyQuestion = firstScalar(frontmatter.keyQuestion)
  const decisionNote = firstScalar(frontmatter.decisionNote)
  const bodyTitle = titleFromBody(body)
  const title = firstScalar(frontmatter.title)
    || (isGenericTitle(bodyTitle) ? '' : bodyTitle)
    || keyQuestion
    || firstMeaningfulBodyLine(body)
    || titleFromPath(relativePath)

  return {
    id,
    sourceType,
    sourceSubtype,
    status: statusForIntakeStage(frontmatter.status, intakeStage),
    title,
    content: body.trim(),
    summary: inferSummary(body, frontmatter),
    sourceUrl: firstScalar(frontmatter.sourceUrl || frontmatter.url),
    sourceFile: filePath,
    tags,
    meta: {
      sourceSystem: 'openclaw',
      project,
      topic,
      intakeStage,
      confidence,
      keyQuestion,
      decisionNote,
      contentHash,
      openclawPath: relativePath,
      openclawRoot: root,
      openclawId: id,
    },
  }
}

async function walkMarkdownFiles(root) {
  const files = []

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const filePath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(filePath)
        continue
      }
      if (!entry.isFile()) continue
      if (!entry.name.toLowerCase().endsWith('.md')) continue
      files.push(filePath)
    }
  }

  await walk(root)
  return files.sort((a, b) => toPosixPath(a).localeCompare(toPosixPath(b)))
}

async function loadOpenClawPayloads(root) {
  const files = await walkMarkdownFiles(root)
  const payloads = []
  const issues = []
  for (const filePath of files) {
    try {
      const raw = await readFile(filePath, 'utf-8')
      const payload = buildKnowledgePayload({ root, filePath, raw })
      if (!payload.content && !payload.title) {
        issues.push({ path: toPosixPath(path.relative(root, filePath)), issue: 'empty-title-and-content' })
        continue
      }
      payloads.push(payload)
    } catch (error) {
      issues.push({
        path: toPosixPath(path.relative(root, filePath)),
        issue: String(error?.message || error || 'read-failed'),
      })
    }
  }

  const byHash = new Map()
  for (const payload of payloads) {
    const contentHash = String(payload?.meta?.contentHash || '').trim()
    if (!contentHash) continue
    if (!byHash.has(contentHash)) byHash.set(contentHash, [])
    byHash.get(contentHash).push(payload)
  }

  const dedupedPayloads = []
  const duplicates = []

  for (const [, group] of byHash) {
    const sorted = group
      .slice()
      .sort((left, right) => String(left?.meta?.openclawPath || '').localeCompare(String(right?.meta?.openclawPath || '')))
    const canonical = sorted.at(-1)
    if (!canonical) continue
    dedupedPayloads.push(canonical)

    for (const duplicate of sorted.slice(0, -1)) {
      duplicates.push({
        action: 'deduped',
        id: duplicate.id,
        title: duplicate.title,
        sourceType: duplicate.sourceType,
        sourceSubtype: duplicate.sourceSubtype,
        status: duplicate.status,
        intakeStage: duplicate?.meta?.intakeStage || '',
        confidence: duplicate?.meta?.confidence || '',
        openclawPath: duplicate?.meta?.openclawPath || '',
        canonicalId: canonical.id,
        canonicalPath: canonical?.meta?.openclawPath || '',
      })
    }
  }

  dedupedPayloads.sort((left, right) =>
    String(left?.meta?.openclawPath || '').localeCompare(String(right?.meta?.openclawPath || '')),
  )

  return {
    payloads: dedupedPayloads,
    issues,
    duplicates,
    scannedFiles: files.length,
    dedupedCount: duplicates.length,
  }
}

async function inspectPayloads(payloads, options = {}) {
  const { getKnowledgeItemByIdInDb, listKnowledgeItemsInDb } = await loadDbApi()
  const duplicateRows = Array.isArray(options?.duplicates) ? options.duplicates : []
  const rows = []
  const currentIds = new Set((Array.isArray(payloads) ? payloads : []).map((payload) => String(payload?.id || '').trim()).filter(Boolean))
  for (const payload of payloads) {
    const existing = await getKnowledgeItemByIdInDb(payload.id).catch(() => null)
    const existingHash = String(existing?.meta?.contentHash || '')
    const nextHash = String(payload?.meta?.contentHash || '')
    const action = !existing
      ? 'new'
      : existingHash === nextHash
        ? 'unchanged'
        : 'changed'
    rows.push({
      action,
      id: payload.id,
      title: payload.title,
      sourceType: payload.sourceType,
      sourceSubtype: payload.sourceSubtype,
      status: payload.status,
      intakeStage: payload.meta.intakeStage,
      confidence: payload.meta.confidence,
      openclawPath: payload.meta.openclawPath,
      existingUpdatedAt: existing?.updatedAt || '',
    })
  }

  const existingOpenClaw = await listKnowledgeItemsInDb({ limit: 5000, status: 'all', q: 'sourceSystem":"openclaw' })
    .catch(() => ({ items: [] }))
  for (const item of Array.isArray(existingOpenClaw?.items) ? existingOpenClaw.items : []) {
    const id = String(item?.id || '').trim()
    if (!id || currentIds.has(id)) continue
    const sourceSystem = String(item?.meta?.sourceSystem || '').trim()
    const syncState = String(item?.meta?.syncState || '').trim()
    if (sourceSystem !== 'openclaw' || syncState === 'missing') continue
    rows.push({
      action: 'missing',
      id,
      title: String(item?.title || ''),
      sourceType: String(item?.sourceType || ''),
      sourceSubtype: String(item?.sourceSubtype || ''),
      status: 'archived',
      intakeStage: String(item?.meta?.intakeStage || ''),
      confidence: String(item?.meta?.confidence || ''),
      openclawPath: String(item?.meta?.openclawPath || item?.sourceFile || ''),
      existingUpdatedAt: item?.updatedAt || '',
    })
  }

  const existingRowIds = new Set(rows.map((item) => String(item?.id || '').trim()).filter(Boolean))
  for (const row of duplicateRows) {
    const id = String(row?.id || '').trim()
    if (!id || existingRowIds.has(id)) continue
    rows.push({
      action: 'deduped',
      id,
      title: String(row?.title || ''),
      sourceType: String(row?.sourceType || ''),
      sourceSubtype: String(row?.sourceSubtype || ''),
      status: String(row?.status || ''),
      intakeStage: String(row?.intakeStage || ''),
      confidence: String(row?.confidence || ''),
      openclawPath: String(row?.openclawPath || ''),
      existingUpdatedAt: '',
      reason: String(row?.canonicalPath || '').trim() || 'duplicate-content',
    })
    existingRowIds.add(id)
  }
  return rows
}

function summarizeRows(rows, issues = [], options = {}) {
  const dedupedSeed = Math.max(0, Number(options?.dedupedCount || 0))
  const summary = {
    scanned: Math.max(0, Number(options?.scannedFiles || 0)),
    total: rows.length,
    new: 0,
    changed: 0,
    unchanged: 0,
    missing: 0,
    deduped: dedupedSeed,
    imported: 0,
    archived: 0,
    skipped: 0,
    issues: issues.length,
  }
  for (const row of rows) {
    if (row.action === 'deduped') {
      if (!dedupedSeed) summary.deduped += 1
      summary.skipped += 1
      continue
    }
    if (row.action in summary) summary[row.action] += 1
    if (row.action === 'new' || row.action === 'changed') summary.imported += 1
    else if (row.action === 'missing') summary.archived += 1
    else summary.skipped += 1
  }
  if (!summary.scanned) summary.scanned = summary.total
  return summary
}

function printTable(rows, issues, { imported = false, scannedFiles = 0, dedupedCount = 0 } = {}) {
  const summary = summarizeRows(rows, issues, { scannedFiles, dedupedCount })
  const verb = imported ? 'Import result' : 'Preview result'
  console.log(
    `${verb}: scanned=${summary.scanned}, planned=${summary.total}, ${summary.new} new, ${summary.changed} changed, ${summary.missing} missing, ${summary.deduped} deduped, ${summary.unchanged} unchanged, ${summary.issues} issues.`,
  )

  for (const row of rows.slice(0, 80)) {
    console.log(
      [
        `- [${row.action}]`,
        row.openclawPath,
        `=> ${row.sourceType}/${row.sourceSubtype}`,
        `stage=${row.intakeStage}`,
        `status=${row.status}`,
        `title="${row.title}"`,
      ].join(' '),
    )
  }
  if (rows.length > 80) console.log(`... ${rows.length - 80} more rows omitted`)

  if (issues.length) {
    console.log('')
    console.log('Issues:')
    for (const item of issues.slice(0, 40)) {
      console.log(`- ${item.path}: ${item.issue}`)
    }
    if (issues.length > 40) console.log(`... ${issues.length - 40} more issues omitted`)
  }
}

async function ensureRoot(root) {
  try {
    await readdir(root)
  } catch {
    throw new Error(`OpenClaw inbox not found: ${root}`)
  }
}

async function runPreview(args) {
  const root = path.resolve(expandHome(argValue(args, '--root')) || DEFAULT_OPENCLAW_KNOWLEDGE_ROOT)
  const json = hasFlag(args, '--json')
  const { summary, rows, issues } = await previewOpenClawKnowledge({ root })
  if (json) {
    console.log(JSON.stringify({ root, summary, rows, issues }, null, 2))
    return
  }
  console.log(`OpenClaw inbox: ${root}`)
  printTable(rows, issues, {
    scannedFiles: Number(summary?.scanned || 0),
    dedupedCount: Number(summary?.deduped || 0),
  })
}

async function runImport(args) {
  const root = path.resolve(expandHome(argValue(args, '--root')) || DEFAULT_OPENCLAW_KNOWLEDGE_ROOT)
  const json = hasFlag(args, '--json')
  const { summary, rows: importedRows, issues } = await importOpenClawKnowledge({ root })
  if (json) {
    console.log(JSON.stringify({ root, summary, rows: importedRows, issues }, null, 2))
    return
  }

  console.log(`OpenClaw inbox: ${root}`)
  console.log(`Import result: ${summary.imported} imported, ${summary.skipped} skipped, ${summary.failed} failed, ${summary.issues} issues.`)
  for (const row of importedRows.slice(0, 80)) {
    const suffix = row.reason ? ` reason=${row.reason}` : ''
    console.log(`- [${row.action}] ${row.openclawPath} => ${row.id}${suffix}`)
  }
  if (importedRows.length > 80) console.log(`... ${importedRows.length - 80} more rows omitted`)
}

export async function previewOpenClawKnowledge(options = {}) {
  const root = path.resolve(expandHome(options.root) || DEFAULT_OPENCLAW_KNOWLEDGE_ROOT)
  await ensureRoot(root)
  const { payloads, issues, duplicates, scannedFiles, dedupedCount } = await loadOpenClawPayloads(root)
  const rows = await inspectPayloads(payloads, { duplicates })
  const summary = summarizeRows(rows, issues, { scannedFiles, dedupedCount })
  return { root, summary, rows, issues }
}

export async function importOpenClawKnowledge(options = {}) {
  const { patchKnowledgeItemMetaInDb, upsertKnowledgeItemInDb } = await loadDbApi()
  const root = path.resolve(expandHome(options.root) || DEFAULT_OPENCLAW_KNOWLEDGE_ROOT)
  await ensureRoot(root)
  const { payloads, issues, duplicates, scannedFiles } = await loadOpenClawPayloads(root)
  const rows = await inspectPayloads(payloads, { duplicates })
  const importResults = []

  for (const row of rows) {
    if (row.action !== 'new' && row.action !== 'changed') {
      if (row.action === 'missing') {
        try {
          const item = await patchKnowledgeItemMetaInDb({
            id: row.id,
            status: 'archived',
            metaPatch: {
              syncState: 'missing',
              missingFromOpenClawAt: new Date().toISOString(),
            },
          })
          importResults.push({ ...row, imported: Boolean(item), archived: Boolean(item), reason: item ? 'missing-from-openclaw' : 'archive-returned-empty' })
        } catch (error) {
          importResults.push({ ...row, imported: false, archived: false, reason: String(error?.message || error || 'archive-failed') })
        }
        continue
      }
      if (row.action === 'deduped') {
        importResults.push({ ...row, imported: false, reason: String(row?.reason || 'deduped') })
        continue
      }
      importResults.push({ ...row, imported: false, reason: 'unchanged' })
      continue
    }

    const payload = payloads.find((item) => item.id === row.id)
    if (!payload) {
      importResults.push({ ...row, imported: false, reason: 'payload-not-found' })
      continue
    }

    try {
      const item = await upsertKnowledgeItemInDb({
        ...payload,
        meta: {
          ...(payload.meta || {}),
          syncState: 'active',
          missingFromOpenClawAt: '',
        },
      })
      importResults.push({ ...row, imported: Boolean(item), reason: item ? '' : 'upsert-returned-empty' })
    } catch (error) {
      importResults.push({ ...row, imported: false, reason: String(error?.message || error || 'import-failed') })
    }
  }

  const importedRows = importResults.map((row) => ({
    ...row,
    action: row.archived ? 'archived' : row.imported ? 'imported' : row.action,
  }))
  const summary = {
    scanned: Math.max(0, Number(scannedFiles || 0)),
    total: rows.length,
    deduped: importResults.filter((row) => row.action === 'deduped').length,
    imported: importResults.filter((row) => row.imported).length,
    archived: importResults.filter((row) => row.archived).length,
    skipped: importResults.filter((row) => !row.imported && (row.reason === 'unchanged' || row.action === 'deduped')).length,
    failed: importResults.filter((row) => !row.imported && row.reason !== 'unchanged' && row.action !== 'deduped').length,
    issues: issues.length,
  }
  return { root, summary, rows: importedRows, issues }
}

async function main() {
  loadLocalEnv()
  const args = process.argv.slice(2)
  const command = args[0] || ''

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    usage()
    return
  }

  if (command === 'preview') {
    await runPreview(args.slice(1))
    return
  }

  if (command === 'import') {
    await runImport(args.slice(1))
    return
  }

  usage()
  process.exitCode = 1
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === entryPoint) {
  main().catch((error) => {
    console.error(String(error?.message || error))
    process.exitCode = 1
  })
}
