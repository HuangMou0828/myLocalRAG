#!/usr/bin/env node
import path from 'node:path'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { loadLocalEnv } from '../server/lib/load-env.mjs'
import { listKnowledgeAtomsInDb, listKnowledgeItemsInDb } from '../server/lib/db.mjs'

const DEFAULT_LIMIT = 5000
const DEFAULT_OUT_DIR = path.resolve(process.cwd(), 'vault', '.gbrain-v2-feed')
const READER_FIRST_BUCKETS = ['projects', 'patterns', 'issues', 'syntheses']

function usage() {
  console.log(
    [
      'Usage:',
      '  node scripts/gbrain-v2-feed.mjs dry-run [--limit <n>] [--include-raw]',
      '  node scripts/gbrain-v2-feed.mjs export [--limit <n>] [--out <dir>] [--include-raw] [--clean]',
      '',
      'Examples:',
      '  node scripts/gbrain-v2-feed.mjs dry-run',
      '  node scripts/gbrain-v2-feed.mjs export --out vault/.gbrain-v2-feed --clean',
      '  node scripts/gbrain-v2-feed.mjs export --include-raw',
    ].join('\n'),
  )
}

function argValue(args, key, fallback = '') {
  const index = args.indexOf(key)
  if (index < 0) return fallback
  return args[index + 1] || fallback
}

function hasFlag(args, key) {
  return args.includes(key)
}

function toNumber(input, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(input)
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function nowIso() {
  return new Date().toISOString()
}

function normalizeText(input) {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripFrontmatter(markdown) {
  const raw = String(markdown || '')
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (!match) return raw
  return raw.slice(match[0].length)
}

function parseFrontmatter(markdown) {
  const raw = String(markdown || '')
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return {}
  const frontmatter = {}
  for (const line of String(match[1] || '').split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/)
    if (!kv) continue
    frontmatter[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '')
  }
  return frontmatter
}

function firstHeading(markdown) {
  const match = String(markdown || '').match(/^#\s+(.+?)\s*$/m)
  return match ? match[1].trim() : ''
}

function toJsonLine(value) {
  return `${JSON.stringify(value)}\n`
}

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true })
}

async function collectReaderFirstPages(vaultRoot) {
  const records = []
  for (const bucket of READER_FIRST_BUCKETS) {
    const bucketDir = path.join(vaultRoot, bucket)
    let entries = []
    try {
      entries = await readdir(bucketDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.md') continue
      const filePath = path.join(bucketDir, entry.name)
      const raw = await readFile(filePath, 'utf8').catch(() => '')
      if (!raw) continue

      const frontmatter = parseFrontmatter(raw)
      const body = stripFrontmatter(raw)
      const title = normalizeText(frontmatter.title || firstHeading(body) || entry.name.replace(/\.md$/i, ''))
      const summary = normalizeText(firstHeading(body))
      const pageId = `${bucket}/${entry.name.replace(/\.md$/i, '')}`
      const canonicalId = normalizeText(frontmatter.canonicalId || frontmatter.canonical_id)

      records.push({
        id: `page:${pageId}`,
        layer: 'reader-first',
        pageId,
        canonicalId,
        title,
        summary,
        body: normalizeText(body).slice(0, 12000),
        sourcePath: filePath,
        updatedAt: nowIso(),
      })
    }
  }
  return records
}

function buildAtomRecord(atom) {
  const topics = Array.isArray(atom?.topics) ? atom.topics : []
  const sourceRefs = Array.isArray(atom?.sourceRefs) ? atom.sourceRefs : []
  return {
    id: `atom:${String(atom?.atomId || '')}`,
    layer: 'atom',
    atomId: String(atom?.atomId || ''),
    rawId: String(atom?.rawId || ''),
    canonicalId: String(atom?.canonicalId || ''),
    pageId: String(atom?.pageId || ''),
    kind: String(atom?.kind || ''),
    title: String(atom?.title || ''),
    summary: String(atom?.summary || ''),
    topics,
    sourceRefs,
    text: normalizeText(
      [
        atom?.title,
        atom?.summary,
        topics.join(' '),
        sourceRefs.map((ref) => `${ref.type}:${ref.value}`).join(' '),
      ].join('\n'),
    ),
    qualityTier: String(atom?.qualityTier || ''),
    qualityScore: Number(atom?.qualityScore || 0),
    status: String(atom?.status || ''),
    updatedAt: String(atom?.updatedAt || ''),
  }
}

function buildRawRecord(item) {
  return {
    id: `raw:${String(item?.id || '')}`,
    layer: 'raw',
    rawId: String(item?.id || ''),
    title: String(item?.title || ''),
    summary: String(item?.summary || ''),
    text: normalizeText(item?.content).slice(0, 12000),
    sourceType: String(item?.sourceType || ''),
    sourceSubtype: String(item?.sourceSubtype || ''),
    status: String(item?.status || ''),
    updatedAt: String(item?.updatedAt || ''),
  }
}

async function collectFeedRecords({ limit = DEFAULT_LIMIT, includeRaw = false } = {}) {
  const atoms = await listKnowledgeAtomsInDb({
    limit,
    status: 'visible',
    kind: 'all',
    qualityTier: 'all',
  })
  const atomRecords = atoms.map(buildAtomRecord)
  const readerFirstRecords = await collectReaderFirstPages(path.resolve(process.cwd(), 'vault'))

  const records = [...atomRecords, ...readerFirstRecords]

  if (includeRaw) {
    const rawItems = await listKnowledgeItemsInDb({ limit, status: 'all', sourceType: 'all' })
    const rawRecords = (Array.isArray(rawItems?.items) ? rawItems.items : []).map(buildRawRecord)
    records.push(...rawRecords)
  }

  return {
    records,
    stats: {
      atoms: atomRecords.length,
      readerFirst: readerFirstRecords.length,
      raw: includeRaw ? records.filter((item) => item.layer === 'raw').length : 0,
      total: records.length,
    },
  }
}

async function runDryRun(args) {
  const limit = toNumber(argValue(args, '--limit', String(DEFAULT_LIMIT)), DEFAULT_LIMIT, { min: 1, max: 5000 })
  const includeRaw = hasFlag(args, '--include-raw')
  const result = await collectFeedRecords({ limit, includeRaw })
  console.log('[gbrain-v2-feed] dry-run summary')
  console.log(`- atoms: ${result.stats.atoms}`)
  console.log(`- reader-first: ${result.stats.readerFirst}`)
  console.log(`- raw: ${result.stats.raw}`)
  console.log(`- total: ${result.stats.total}`)
}

async function runExport(args) {
  const limit = toNumber(argValue(args, '--limit', String(DEFAULT_LIMIT)), DEFAULT_LIMIT, { min: 1, max: 5000 })
  const outDir = path.resolve(argValue(args, '--out', DEFAULT_OUT_DIR))
  const includeRaw = hasFlag(args, '--include-raw')
  const shouldClean = hasFlag(args, '--clean')
  const generatedAt = nowIso()

  if (shouldClean) {
    await rm(outDir, { recursive: true, force: true })
  }
  await ensureDir(outDir)

  const result = await collectFeedRecords({ limit, includeRaw })
  const recordsPath = path.join(outDir, 'records.jsonl')
  const manifestPath = path.join(outDir, 'manifest.json')

  const chunks = result.records.map((record) => toJsonLine(record)).join('')
  await writeFile(recordsPath, chunks, 'utf8')
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        version: 'gbrain-v2-feed.v1',
        generatedAt,
        includeRaw,
        limit,
        stats: result.stats,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  console.log('[gbrain-v2-feed] export completed')
  console.log(`- outDir: ${outDir}`)
  console.log(`- records: ${recordsPath}`)
  console.log(`- manifest: ${manifestPath}`)
  console.log(`- total: ${result.stats.total}`)
}

async function main() {
  loadLocalEnv()
  const args = process.argv.slice(2)
  const command = String(args[0] || '').trim().toLowerCase()

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage()
    return
  }

  if (command === 'dry-run') {
    await runDryRun(args.slice(1))
    return
  }

  if (command === 'export') {
    await runExport(args.slice(1))
    return
  }

  usage()
  process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

