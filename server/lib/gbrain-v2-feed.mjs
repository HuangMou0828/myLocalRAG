import path from 'node:path'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { listKnowledgeAtomsInDb, listKnowledgeItemsInDb } from './db.mjs'

export const GBRAIN_V2_FEED_DEFAULT_LIMIT = 5000
export const GBRAIN_V2_FEED_DEFAULT_OUT_DIR = path.resolve(process.cwd(), 'vault', '.gbrain-v2-feed')
const READER_FIRST_BUCKETS = ['projects', 'patterns', 'issues', 'syntheses']

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

function normalizeFeedMode(feedMode) {
  const normalized = normalizeText(feedMode).toLowerCase()
  if (normalized === 'atom-only') return 'atom-only'
  if (normalized === 'reader-first-only') return 'reader-first-only'
  return 'atom-reader-first'
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

export async function collectGbrainV2FeedRecords({
  limit = GBRAIN_V2_FEED_DEFAULT_LIMIT,
  includeRaw = false,
  feedMode = 'atom-reader-first',
} = {}) {
  const normalizedFeedMode = normalizeFeedMode(feedMode)
  const useAtoms = normalizedFeedMode !== 'reader-first-only'
  const useReaderFirst = normalizedFeedMode !== 'atom-only'

  const atomRecords = useAtoms
    ? (await listKnowledgeAtomsInDb({
      limit,
      status: 'visible',
      kind: 'all',
      qualityTier: 'all',
    })).map(buildAtomRecord)
    : []
  const readerFirstRecords = useReaderFirst
    ? await collectReaderFirstPages(path.resolve(process.cwd(), 'vault'))
    : []

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
    feedMode: normalizedFeedMode,
  }
}

export async function exportGbrainV2Feed({
  limit = GBRAIN_V2_FEED_DEFAULT_LIMIT,
  outDir = GBRAIN_V2_FEED_DEFAULT_OUT_DIR,
  includeRaw = false,
  clean = false,
  feedMode = 'atom-reader-first',
} = {}) {
  const normalizedOutDir = path.resolve(String(outDir || GBRAIN_V2_FEED_DEFAULT_OUT_DIR))
  const generatedAt = nowIso()
  const normalizedFeedMode = normalizeFeedMode(feedMode)
  if (clean) await rm(normalizedOutDir, { recursive: true, force: true })
  await ensureDir(normalizedOutDir)

  const result = await collectGbrainV2FeedRecords({
    limit,
    includeRaw,
    feedMode: normalizedFeedMode,
  })
  const recordsPath = path.join(normalizedOutDir, 'records.jsonl')
  const manifestPath = path.join(normalizedOutDir, 'manifest.json')

  const chunks = result.records.map((record) => toJsonLine(record)).join('')
  await writeFile(recordsPath, chunks, 'utf8')
  const manifest = {
    version: 'gbrain-v2-feed.v2',
    generatedAt,
    includeRaw,
    limit,
    feedMode: normalizedFeedMode,
    stats: result.stats,
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  return {
    outDir: normalizedOutDir,
    recordsPath,
    manifestPath,
    manifest,
    ...result,
  }
}

