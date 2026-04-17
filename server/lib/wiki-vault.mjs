import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { createTwoFilesPatch } from 'diff'
import { ensureObsidianReady, isObsidianCliEnabled, runObsidianCli } from './obsidian-cli.mjs'
import { askModel } from './ask-model.mjs'
import { listKnowledgeItemsInDb, loadModelSettingsInDb, patchKnowledgeItemMetaInDb } from './db.mjs'
import { loadIndex } from './scanner.mjs'

function normalizeText(input) {
  return stripConversationArtifacts(String(input || ''))
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function stripConversationArtifacts(input) {
  return String(input || '')
    .replace(/<\s*\/?\s*user_query\s*>/gi, ' ')
    .replace(/<\s*\/?\s*assistant_response\s*>/gi, ' ')
    .replace(/<\s*\/?\s*assistant_reply\s*>/gi, ' ')
    .replace(/<\s*\/?\s*user_message\s*>/gi, ' ')
    .replace(/<\s*\/?\s*system_message\s*>/gi, ' ')
    .replace(/\[\s*REDACTED\s*\]/gi, ' ')
    .replace(/<\s*REDACTED\s*>/gi, ' ')
}

function clipText(input, maxChars = 180) {
  const text = normalizeText(input).replace(/\n+/g, ' ')
  if (!text) return ''
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 3))}...`
}

function stableHash32(input) {
  let h = 2166136261
  const text = String(input || '')
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function stableSha1(input) {
  return createHash('sha1').update(String(input || '')).digest('hex')
}

const CONCEPT_PAGE_SCHEMA_VERSION = '2'
const READER_PAGE_SCHEMA_VERSION = '1'
const OBSIDIAN_TEMPLATE_AUTO_CREATE_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.KB_OBSIDIAN_TEMPLATE_AUTO_CREATE_ENABLED || '1').trim())
const OBSIDIAN_POST_PUBLISH_OPEN_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.KB_OBSIDIAN_POST_PUBLISH_OPEN_ENABLED || '1').trim())

function toFileSlug(input, fallback = 'untitled') {
  const normalized = String(input || '')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*#[\]\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 80)

  return normalized || fallback
}

function escapeYamlString(input) {
  return String(input || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escapeMarkdownText(input) {
  return String(input || '').replace(/\]\(/g, ']\\(')
}

function formatIsoLocal(iso) {
  const date = iso ? new Date(iso) : new Date()
  if (Number.isNaN(date.getTime())) return String(iso || '')
  return date.toISOString().replace('T', ' ').slice(0, 16)
}

function extractMentionedFiles(messages = [], maxItems = 6) {
  const joined = (Array.isArray(messages) ? messages : [])
    .map((item) => String(item?.content || ''))
    .join('\n')

  const pattern = /(?:\/Users\/[^\s"'`()]+|(?:src|server|docs|scripts|app|components|features)\/[^\s"'`()]+\.[A-Za-z0-9]+|\.[/][^\s"'`()]+)/g
  const matched = joined.match(pattern) || []
  const unique = []
  const seen = new Set()

  for (const raw of matched) {
    const value = String(raw || '').trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(value)
    if (unique.length >= maxItems) break
  }

  return unique
}

function countRoles(messages = []) {
  let user = 0
  let assistant = 0
  let other = 0

  for (const item of Array.isArray(messages) ? messages : []) {
    const role = String(item?.role || '').trim().toLowerCase()
    if (role === 'user') user += 1
    else if (role === 'assistant') assistant += 1
    else other += 1
  }

  return { user, assistant, other }
}

function extractManualNotes(existingMarkdown) {
  return extractProtectedMarkdownSection(existingMarkdown, 'My Notes', '-')
}

function extractMarkdownSection(existingMarkdown, heading) {
  const raw = String(existingMarkdown || '')
  const safeHeading = String(heading || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = raw.match(new RegExp(`## ${safeHeading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|\\s*$)`))
  const body = match?.[1] ? match[1].trim() : ''
  return body || ''
}

function extractProtectedMarkdownSection(existingMarkdown, heading, fallback = '-') {
  const body = extractMarkdownSection(existingMarkdown, heading)
  return body || fallback
}

function buildMarkdownFrontmatter(fields = {}) {
  const lines = ['---']
  for (const [key, rawValue] of Object.entries(fields || {})) {
    if (rawValue === undefined || rawValue === null) continue
    if (Array.isArray(rawValue)) {
      lines.push(`${key}:`)
      if (!rawValue.length) {
        lines.push('  []')
        continue
      }
      for (const entry of rawValue) {
        lines.push(`  - "${escapeYamlString(entry)}"`)
      }
      continue
    }
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      lines.push(`${key}: ${rawValue}`)
      continue
    }
    if (typeof rawValue === 'boolean') {
      lines.push(`${key}: ${rawValue ? 'true' : 'false'}`)
      continue
    }
    lines.push(`${key}: "${escapeYamlString(rawValue)}"`)
  }
  lines.push('---', '')
  return lines
}

function renderMarkdownSection(title, lines = [], emptyText = '-') {
  const rendered = [`## ${title}`, '']
  const normalized = (Array.isArray(lines) ? lines : [lines])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
  if (!normalized.length) rendered.push(emptyText)
  else rendered.push(...normalized)
  rendered.push('')
  return rendered
}

function parseSimpleFrontmatterValue(markdownText, key) {
  const frontmatterMatch = String(markdownText || '').match(/^---\n([\s\S]*?)\n---/)
  if (!frontmatterMatch?.[1]) return ''
  const line = frontmatterMatch[1]
    .split('\n')
    .find((item) => item.startsWith(`${key}:`))
  if (!line) return ''
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, '')
}

function parseMarkdownFrontmatterMap(markdownText = '') {
  const frontmatterMatch = String(markdownText || '').match(/^---\n([\s\S]*?)\n---/)
  if (!frontmatterMatch?.[1]) return {}
  const meta = {}
  for (const line of frontmatterMatch[1].split('\n')) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/)
    if (!match) continue
    const key = String(match[1] || '').trim()
    const value = String(match[2] || '').trim().replace(/^"|"$/g, '')
    meta[key] = value
  }
  return meta
}

function stripFrontmatter(markdownText = '') {
  return String(markdownText || '').replace(/^---\n[\s\S]*?\n---\n?/, '')
}

function parseWikiLinks(markdownText = '') {
  const cleaned = String(markdownText || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
  return [...cleaned.matchAll(/\[\[([^\]]+)\]\]/g)]
    .map((item) => String(item?.[1] || '').split('|')[0]?.split('#')[0] || '')
    .map((item) => toWikiPath(item))
    .filter(Boolean)
}

function hasUnpublishedConceptLinks(markdownText = '', conceptCatalog = null) {
  if (!(conceptCatalog instanceof Map)) return false
  return parseWikiLinks(markdownText)
    .filter((target) => target.startsWith('concepts/'))
    .some((target) => {
      const slug = path.posix.basename(target, '.md')
      return !conceptCatalog.has(slug)
    })
}

function extractLintSummary(markdownText = '') {
  const body = stripFrontmatter(markdownText)
  const summaryCallout = body.match(/>\s*\[!summary\][^\n]*\n((?:>\s?.*\n?){1,6})/i)
  if (summaryCallout?.[1]) {
    return normalizeText(summaryCallout[1].replace(/^>\s?/gm, ' '))
  }

  const firstParagraph = body
    .split(/\n\s*\n/g)
    .map((item) => normalizeText(item))
    .find((item) => item && !item.startsWith('#'))

  return firstParagraph || ''
}

function isWeakSectionBody(body = '') {
  const value = normalizeText(String(body || ''))
  if (!value) return true
  return (
    /^[-_*]?_?no\b/i.test(value)
    || /^[-_*]?_?暂无/u.test(value)
    || /^[-_*]?_?尚无/u.test(value)
    || /^[-_*]?_?no stable\b/i.test(value)
    || /^[-_*]?_?no clear\b/i.test(value)
    || /^[-_*]?_?no related\b/i.test(value)
  )
}

function parseGeneratedMeta(markdownText, relativePath) {
  const raw = String(markdownText || '')
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!frontmatterMatch?.[1]) return null

  const lines = frontmatterMatch[1].split('\n')
  const meta = {
    title: '',
    type: '',
    provider: '',
    updatedAt: '',
    messageCount: 0,
    sessionId: '',
    tags: [],
    concepts: [],
    relativePath,
  }

  let currentListKey = ''
  for (const line of lines) {
    const listMatch = line.match(/^\s*-\s+"?(.*?)"?\s*$/)
    if (listMatch && currentListKey) {
      const value = listMatch[1].trim()
      if (!value) continue
      if (currentListKey === 'tags') meta.tags.push(value)
      if (currentListKey === 'concepts') meta.concepts.push(parseConceptValue(value))
      continue
    }
    const match = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/)
    if (!match) continue
    currentListKey = match[1]
    const value = match[2].trim().replace(/^"|"$/g, '')
    if (currentListKey === 'messageCount') meta.messageCount = Number(value || 0)
    else if (currentListKey === 'sessionId') meta.sessionId = value
    else if (currentListKey === 'tags') meta.tags = []
    else if (currentListKey === 'concepts') meta.concepts = []
    else if (currentListKey in meta) meta[currentListKey] = value
  }

  if (!meta.title || meta.type !== 'source-session') return null
  return meta
}

export function getVaultPaths() {
  const root = path.resolve(process.env.KB_VAULT_DIR || path.join(process.cwd(), 'vault'))
  return {
    root,
    home: path.join(root, 'Home.md'),
    index: path.join(root, 'index.md'),
    log: path.join(root, 'log.md'),
    readme: path.join(root, 'README.md'),
    agents: path.join(root, 'AGENTS.md'),
    inboxReadme: path.join(root, 'inbox', 'README.md'),
    lintReport: path.join(root, 'inbox', 'wiki-lint-report.md'),
    promotionQueue: path.join(root, 'inbox', 'promotion-queue.md'),
    promotionState: path.join(root, 'inbox', 'promotion-state.json'),
    sourcesReadme: path.join(root, 'sources', 'README.md'),
    conceptsReadme: path.join(root, 'concepts', 'README.md'),
    entitiesReadme: path.join(root, 'entities', 'README.md'),
    projectsReadme: path.join(root, 'projects', 'README.md'),
    patternsReadme: path.join(root, 'patterns', 'README.md'),
    issuesReadme: path.join(root, 'issues', 'README.md'),
    synthesesReadme: path.join(root, 'syntheses', 'README.md'),
    providersReadme: path.join(root, 'providers', 'README.md'),
    templatesReadme: path.join(root, 'Templates', 'README.md'),
    captureTemplate: path.join(root, 'Templates', 'Quick Capture.md'),
    sourceConversationTemplate: path.join(root, 'Templates', 'Source Conversation.md'),
    conceptTemplate: path.join(root, 'Templates', 'Concept Draft.md'),
    entityTemplate: path.join(root, 'Templates', 'Entity Note.md'),
    codingPatternTemplate: path.join(root, 'Templates', 'Coding Pattern.md'),
    issueTemplate: path.join(root, 'Templates', 'Issue Note.md'),
    projectTemplate: path.join(root, 'Templates', 'Project Hub.md'),
    synthesisTemplate: path.join(root, 'Templates', 'Synthesis Note.md'),
    reviewTemplate: path.join(root, 'Templates', 'Weekly Review.md'),
    sourcesDir: path.join(root, 'sources'),
    conceptsDir: path.join(root, 'concepts'),
    entitiesDir: path.join(root, 'entities'),
    projectsDir: path.join(root, 'projects'),
    patternsDir: path.join(root, 'patterns'),
    issuesDir: path.join(root, 'issues'),
    synthesesDir: path.join(root, 'syntheses'),
    providersDir: path.join(root, 'providers'),
    assetsDir: path.join(root, 'assets'),
    inboxDir: path.join(root, 'inbox'),
    templatesDir: path.join(root, 'Templates'),
  }
}

const PROMOTION_STATE_SCHEMA_VERSION = 1

function normalizeVaultRelativePath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/g, '')
    .trim()
}

function resolveGeneratedNoteTemplateName(relativePath = '') {
  const normalized = normalizeVaultRelativePath(relativePath)
  if (!normalized) return ''
  if (normalized.startsWith('sources/')) return 'Source Conversation'
  if (normalized.startsWith('issues/')) return 'Issue Note'
  if (normalized.startsWith('patterns/')) return 'Coding Pattern'
  if (normalized.startsWith('projects/')) return 'Project Hub'
  if (normalized.startsWith('syntheses/')) return 'Synthesis Note'
  if (normalized.startsWith('concepts/')) return 'Concept Draft'
  if (normalized.startsWith('entities/')) return 'Entity Note'
  return ''
}

async function seedVaultNoteFromTemplate(relativePath = '', templateName = '') {
  const normalizedPath = normalizeVaultRelativePath(relativePath)
  const normalizedTemplate = String(templateName || resolveGeneratedNoteTemplateName(normalizedPath)).trim()
  if (!normalizedPath || !normalizedTemplate) {
    return { engine: 'legacy', seeded: false, path: normalizedPath, template: normalizedTemplate }
  }
  if (!OBSIDIAN_TEMPLATE_AUTO_CREATE_ENABLED || !isObsidianCliEnabled()) {
    return { engine: 'legacy', seeded: false, path: normalizedPath, template: normalizedTemplate }
  }

  const ready = await ensureObsidianReady({
    autoLaunch: true,
    readyTimeoutMs: 3000,
    probeTimeoutMs: 1000,
  })
  if (!ready) {
    return { engine: 'legacy', seeded: false, path: normalizedPath, template: normalizedTemplate, reason: 'obsidian-not-ready' }
  }

  try {
    await runObsidianCli(['create', `path=${normalizedPath}`, `template=${normalizedTemplate}`], {
      ensureReady: false,
      autoLaunch: false,
      timeoutMs: 4500,
    })
    return { engine: 'obsidian-cli', seeded: true, path: normalizedPath, template: normalizedTemplate }
  } catch {
    return { engine: 'obsidian-cli', seeded: false, path: normalizedPath, template: normalizedTemplate, reason: 'create-failed' }
  }
}

async function readExistingMarkdownWithTemplateSeed(relativePath = '', filePath = '', templateName = '') {
  let markdown = await readFile(filePath, 'utf-8').catch(() => '')
  if (markdown) return { markdown, seeded: false }

  const seedResult = await seedVaultNoteFromTemplate(relativePath, templateName)
  if (!seedResult.seeded) return { markdown: '', seeded: false, seedResult }

  markdown = await readFile(filePath, 'utf-8').catch(() => '')
  return {
    markdown,
    seeded: Boolean(markdown),
    seedResult,
  }
}

async function runObsidianPostPublishRefresh(pathToOpen = 'index.md') {
  const targetPath = normalizeVaultRelativePath(pathToOpen) || 'index.md'
  if (!OBSIDIAN_POST_PUBLISH_OPEN_ENABLED || !isObsidianCliEnabled()) {
    return { engine: 'legacy', opened: false, path: targetPath }
  }

  const ready = await ensureObsidianReady({
    autoLaunch: true,
    readyTimeoutMs: 3000,
    probeTimeoutMs: 1000,
  })
  if (!ready) {
    return { engine: 'legacy', opened: false, path: targetPath, reason: 'obsidian-not-ready' }
  }

  try {
    await runObsidianCli(['open', `path=${targetPath}`], {
      ensureReady: false,
      autoLaunch: false,
      timeoutMs: 4500,
    })
    return { engine: 'obsidian-cli', opened: true, path: targetPath }
  } catch {
    return { engine: 'obsidian-cli', opened: false, path: targetPath, reason: 'open-failed' }
  }
}

function createEmptyPromotionState() {
  return {
    version: PROMOTION_STATE_SCHEMA_VERSION,
    issues: {},
    patterns: {},
    syntheses: {},
  }
}

function normalizePromotionRecordMap(records = {}, mapper = (value) => value) {
  const normalized = {}
  for (const [key, value] of Object.entries(records || {})) {
    const recordKey = String(key || '').trim()
    if (!recordKey || !value || typeof value !== 'object') continue
    normalized[recordKey] = mapper(value)
  }
  return normalized
}

function normalizePromotionState(state = {}) {
  const normalized = createEmptyPromotionState()

  normalized.issues = normalizePromotionRecordMap(state?.issues, (value) => ({
    slug: String(value?.slug || '').trim(),
    title: String(value?.title || '').trim(),
    currentPath: normalizeVaultRelativePath(value?.currentPath || ''),
    project: String(value?.project || '').trim(),
    summary: String(value?.summary || '').trim(),
    evidenceItems: dedupeList(Array.isArray(value?.evidenceItems) ? value.evidenceItems : [], 20)
      .map((item) => normalizeVaultRelativePath(item))
      .filter(Boolean),
    decision: String(value?.decision || 'approved').trim() || 'approved',
    sourceKind: String(value?.sourceKind || 'manual-review').trim() || 'manual-review',
    approvedAt: String(value?.approvedAt || '').trim(),
    updatedAt: String(value?.updatedAt || '').trim(),
  }))

  normalized.patterns = normalizePromotionRecordMap(state?.patterns, (value) => ({
    slug: String(value?.slug || '').trim(),
    title: String(value?.title || '').trim(),
    targetPath: normalizeVaultRelativePath(value?.targetPath || ''),
    project: String(value?.project || '').trim(),
    summary: String(value?.summary || '').trim(),
    evidenceItems: dedupeList(Array.isArray(value?.evidenceItems) ? value.evidenceItems : [], 20)
      .map((item) => normalizeVaultRelativePath(item))
      .filter(Boolean),
    decision: String(value?.decision || 'approved').trim() || 'approved',
    sourceKind: String(value?.sourceKind || 'manual-review').trim() || 'manual-review',
    approvedAt: String(value?.approvedAt || '').trim(),
    updatedAt: String(value?.updatedAt || '').trim(),
  }))

  normalized.syntheses = normalizePromotionRecordMap(state?.syntheses, (value) => ({
    targetPath: normalizeVaultRelativePath(value?.targetPath || ''),
    title: String(value?.title || '').trim(),
    question: String(value?.question || '').trim(),
    project: String(value?.project || '').trim(),
    summary: String(value?.summary || '').trim(),
    evidenceItems: dedupeList(Array.isArray(value?.evidenceItems) ? value.evidenceItems : [], 20)
      .map((item) => normalizeVaultRelativePath(item))
      .filter(Boolean),
    decision: String(value?.decision || 'approved').trim() || 'approved',
    sourceKind: String(value?.sourceKind || 'manual-review').trim() || 'manual-review',
    approvedAt: String(value?.approvedAt || '').trim(),
    updatedAt: String(value?.updatedAt || '').trim(),
  }))

  return normalized
}

function isApprovedPromotionRecord(record = null) {
  return Boolean(record) && String(record?.decision || 'approved').trim() !== 'dismissed'
}

function isDismissedPromotionRecord(record = null) {
  return Boolean(record) && String(record?.decision || '').trim() === 'dismissed'
}

async function loadPromotionState() {
  const paths = await ensureVaultScaffold()
  const raw = await readFile(paths.promotionState, 'utf-8').catch(() => '')
  if (!raw.trim()) return createEmptyPromotionState()

  try {
    return normalizePromotionState(JSON.parse(raw))
  } catch {
    return createEmptyPromotionState()
  }
}

async function savePromotionState(state = {}) {
  const paths = await ensureVaultScaffold()
  const normalized = normalizePromotionState(state)
  await writeFile(paths.promotionState, `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8')
  return normalized
}

async function ensureFile(filePath, content) {
  try {
    await readFile(filePath, 'utf-8')
  } catch {
    await writeFile(filePath, content, 'utf-8')
  }
}

export async function ensureVaultScaffold() {
  const paths = getVaultPaths()
  await mkdir(paths.root, { recursive: true })
  await mkdir(paths.sourcesDir, { recursive: true })
  await mkdir(paths.conceptsDir, { recursive: true })
  await mkdir(paths.entitiesDir, { recursive: true })
  await mkdir(paths.projectsDir, { recursive: true })
  await mkdir(paths.patternsDir, { recursive: true })
  await mkdir(paths.issuesDir, { recursive: true })
  await mkdir(paths.synthesesDir, { recursive: true })
  await mkdir(paths.providersDir, { recursive: true })
  await mkdir(paths.assetsDir, { recursive: true })
  await mkdir(paths.inboxDir, { recursive: true })
  await mkdir(paths.templatesDir, { recursive: true })

  await ensureFile(
    paths.home,
    [
      '# Home',
      '',
      '> [!tip] Start Here',
      '> Open [[index]] to browse published sessions, then use backlinks and graph view to explore related notes.',
      '',
      '## Spaces',
      '',
      '- [[index|Vault Index]]',
      '- [[projects/README|Projects]]',
      '- [[patterns/README|Patterns]]',
      '- [[issues/README|Issues]]',
      '- [[syntheses/README|Syntheses]]',
      '- [[sources/README|Sources]]',
      '- [[providers/README|Providers]]',
      '- [[concepts/README|Concepts]]',
      '- [[entities/README|Entities]]',
      '- [[Templates/README|Templates]]',
      '- [[log|Log]]',
      '',
      '## Try In Obsidian',
      '',
      '- Open the right sidebar to view backlinks for any note.',
      '- Switch to graph view to see how sessions connect to provider hubs.',
      '- Pin `Home` and `index` as your primary navigation notes.',
      '',
    ].join('\n'),
  )

  await ensureFile(
    paths.readme,
    [
      '# myLocalRAG Vault',
      '',
      'This vault is the Obsidian-facing publication layer for myLocalRAG.',
      '',
      '- `sources/` stores generated source/session evidence pages.',
      '- `projects/`, `patterns/`, `issues/`, `syntheses/` are the primary human-reading layer.',
      '- `concepts/` and `entities/` store more general topic/entity pages.',
      '- `log.md` records ingest and publish actions chronologically.',
      '',
      'Open [[Home]] for the Obsidian-friendly starting page.',
      '',
      'Use Obsidian to read and navigate this vault. Use myLocalRAG admin/CLI to publish updates.',
      '',
    ].join('\n'),
  )

  await ensureFile(
    paths.index,
    [
      '# Vault Index',
      '',
      'This file is regenerated by myLocalRAG when session pages are published.',
      '',
      '## Sessions',
      '',
      '_No published session pages yet._',
      '',
    ].join('\n'),
  )

  await ensureFile(
    paths.log,
    [
      '# Vault Log',
      '',
      'Chronological record of publish operations.',
      '',
    ].join('\n'),
  )

  await ensureFile(
    paths.agents,
    [
      '# Vault Maintenance Guide',
      '',
      'This vault is maintained by myLocalRAG.',
      '',
      '## Core Model',
      '',
      '- `raw` evidence is the source of truth. The vault is a compiled knowledge layer.',
      '- `sources/` is evidence-first. It is allowed to be rougher and more machine-oriented.',
      '- `projects/`, `patterns/`, `issues/`, and `syntheses/` are reader-first. They should be concise and pleasant to scan in Obsidian.',
      '- Query answers that reveal stable insight should be filed back into the vault instead of disappearing into chat history.',
      '',
      '## Page Types',
      '',
      '- `source-conversation`: one LLM session or source, lightly normalized, evidence-heavy, may be overwritten.',
      '- `pattern-note`: reusable coding or workflow pattern extracted from multiple sessions.',
      '- `issue-note`: bug, failure mode, or troubleshooting page.',
      '- `project-hub`: top-level project page linking patterns, issues, concepts, and evidence.',
      '- `synthesis-note`: a higher-level conclusion, comparison, or memo created from one or more sources.',
      '',
      '## Writing Rules',
      '',
      '- Put the conclusion first. Readers should understand the page in the first screenful.',
      '- Keep direct chat transcript snippets short. Prefer normalized summaries over raw dialogue.',
      '- Do not dump long code blocks into reader-first pages unless the snippet is essential and reusable.',
      '- Use links intentionally. Prefer a few meaningful cross-links over many weak ones.',
      '- Always include an `## Evidence` section on reader-first pages.',
      '- When multiple providers say similar things, merge them into one neutral summary instead of preserving provider tone.',
      '',
      '## Maintenance Rules',
      '',
      '- Raw evidence lives outside the vault in the source database and source files.',
      '- Generated pages in `sources/` may be overwritten on republish.',
      '- Preserve human edits inside the `## My Notes` section whenever possible.',
      '- Keep `index.md` and `log.md` up to date after each publish batch.',
      '- Periodically lint for duplicates, stale claims, orphan pages, and missing cross-links.',
      '',
    ].join('\n'),
  )

  await ensureFile(
    paths.inboxReadme,
    [
      '# Inbox',
      '',
      'Temporary notes, review tasks, and generated promotion queues live here.',
      '',
      '- [[inbox/promotion-queue|Promotion Queue]]',
      '- [[inbox/wiki-lint-report|Wiki Lint Report]]',
      '',
    ].join('\n'),
  )
  await ensureFile(paths.sourcesReadme, '# Sources\n\nPublished source and conversation evidence pages live here. Treat this directory as evidence-first, not reader-first.\n')
  await ensureFile(paths.providersReadme, '# Providers\n\nProvider hub pages will live here.\n')
  await ensureFile(paths.conceptsReadme, '# Concepts\n\nGeneral concept pages live here.\n')
  await ensureFile(paths.entitiesReadme, '# Entities\n\nEntity pages live here.\n')
  await ensureFile(paths.projectsReadme, '# Projects\n\nProject hub pages live here. This is one of the main human-reading entry points.\n')
  await ensureFile(paths.patternsReadme, '# Patterns\n\nReusable coding, workflow, and decision patterns live here.\n')
  await ensureFile(paths.issuesReadme, '# Issues\n\nBug, failure mode, and troubleshooting pages live here.\n')
  await ensureFile(paths.synthesesReadme, '# Syntheses\n\nHigher-level analyses, comparisons, and memos live here.\n')
  await ensureFile(
    paths.templatesReadme,
    [
      '# Templates',
      '',
      'These templates are designed for the Obsidian Templates or Templater plugin.',
      '',
      '## Evidence Layer',
      '',
      '- [[Templates/Quick Capture|Quick Capture]]: short-lived fragments, links, snippets, or one-off ideas.',
      '- [[Templates/Source Conversation|Source Conversation]]: compact evidence page for a single LLM conversation or imported source.',
      '',
      '## Reader-First Layer',
      '',
      '- [[Templates/Coding Pattern|Coding Pattern]]: reusable coding or workflow pattern.',
      '- [[Templates/Issue Note|Issue Note]]: failure mode, bug, or troubleshooting page.',
      '- [[Templates/Project Hub|Project Hub]]: project overview and navigation page.',
      '- [[Templates/Synthesis Note|Synthesis Note]]: analysis, comparison, or conclusion page.',
      '- [[Templates/Concept Draft|Concept Draft]]: a human-curated concept page before it is folded into generated wiki pages.',
      '- [[Templates/Entity Note|Entity Note]]: project, product, person, repo, or company notes.',
      '- [[Templates/Weekly Review|Weekly Review]]: periodic review and cleanup pass.',
      '',
    ].join('\n'),
  )
  await ensureFile(
    paths.captureTemplate,
    [
      '---',
      'type: capture',
      'status: inbox',
      'sourceType: manual',
      'capturedAt: <% tp.date.now("YYYY-MM-DD HH:mm") %>',
      'tags:',
      '  - inbox',
      '---',
      '',
      '# Capture',
      '',
      '> [!summary] Why Capture This',
      '> Write one sentence explaining why this fragment deserves to exist.',
      '',
      '## Snippet',
      '',
      '',
      '## Why It Matters',
      '',
      '-',
      '',
      '## Source',
      '',
      '- URL:',
      '- Context:',
      '',
      '## Next Step',
      '',
      '-',
      '',
    ].join('\n'),
  )
  await ensureFile(
    paths.sourceConversationTemplate,
    [
      '---',
      'type: source-conversation',
      'sourceKind: llm-chat',
      'provider: chatgpt',
      'project:',
      'topics: []',
      'quality: medium',
      'capturedAt: <% tp.date.now("YYYY-MM-DD HH:mm") %>',
      'updatedAt: <% tp.date.now("YYYY-MM-DD HH:mm") %>',
      'evidenceWeight: primary',
      'tags:',
      '  - source',
      '  - conversation',
      '---',
      '',
      '# Source Conversation Title',
      '',
      '> [!summary] What This Session Is About',
      '> One or two sentences that tell a human why this page matters.',
      '',
      '## Context Reconstructed',
      '',
      '- User intent:',
      '- Project or repo:',
      '- What was implicit but important:',
      '',
      '## Key Takeaways',
      '',
      '-',
      '',
      '## Useful Evidence',
      '',
      '- Important files:',
      '- Important commands:',
      '- Important errors:',
      '- Important decisions:',
      '',
      '## Reusable Patterns Triggered',
      '',
      '- [[patterns/...]]',
      '',
      '## Caveats',
      '',
      '- Conversation style was noisy / incomplete / provider-specific.',
      '- Long code blocks were omitted unless essential.',
      '',
      '## Raw Snippets',
      '',
      '> Keep only short, high-value excerpts here. Do not paste the entire transcript.',
      '',
      '## My Notes',
      '',
      '-',
      '',
    ].join('\n'),
  )
  await ensureFile(
    paths.conceptTemplate,
    [
      '---',
      'type: concept-draft',
      'status: draft',
      'createdAt: <% tp.date.now("YYYY-MM-DD HH:mm") %>',
      'tags:',
      '  - concept',
      '---',
      '',
      '# Concept Name',
      '',
      '> [!summary] Definition In One Breath',
      '> Write the shortest possible explanation first.',
      '',
      '## Definition',
      '',
      '',
      '## Why It Matters',
      '',
      '-',
      '',
      '## Evidence',
      '',
      '- [[sources/...]]',
      '',
      '## Related Concepts',
      '',
      '- [[concepts/...]]',
      '',
      '## Open Questions',
      '',
      '-',
      '',
    ].join('\n'),
  )
  await ensureFile(
    paths.entityTemplate,
    [
      '---',
      'type: entity-note',
      'entityType: project',
      'status: draft',
      'createdAt: <% tp.date.now("YYYY-MM-DD HH:mm") %>',
      'tags:',
      '  - entity',
      '---',
      '',
      '# Entity Name',
      '',
      '> [!summary] One-Line Snapshot',
      '> What is this entity and why is it in the wiki?',
      '',
      '## Snapshot',
      '',
      '- Type:',
      '- Status:',
      '- Owner:',
      '',
      '## Summary',
      '',
      '',
      '## Related Sources',
      '',
      '- [[sources/...]]',
      '',
      '## Related Concepts',
      '',
      '- [[concepts/...]]',
      '',
      '## Notes',
      '',
      '-',
      '',
    ].join('\n'),
  )
  await ensureFile(
    paths.codingPatternTemplate,
    [
      '---',
      'type: pattern-note',
      'patternType: coding',
      'status: active',
      'projects: []',
      'topics: []',
      'sourcesCount: 0',
      'updatedAt: <% tp.date.now("YYYY-MM-DD HH:mm") %>',
      'tags:',
      '  - pattern',
      '  - coding',
      '---',
      '',
      '# Pattern Name',
      '',
      '> [!summary] Short Answer',
      '> State the pattern in two or three lines. This is the main reading surface.',
      '',
      '## When To Use',
      '',
      '-',
      '',
      '## Recommended Shape',
      '',
      '1. ',
      '2. ',
      '3. ',
      '',
      '## Tradeoffs',
      '',
      '-',
      '',
      '## In This Repo',
      '',
      '- [/Users/hm/myLocalRAG/src/... ](/Users/hm/myLocalRAG/src/...)',
      '',
      '## Related',
      '',
      '- [[projects/...]]',
      '- [[issues/...]]',
      '- [[concepts/...]]',
      '',
      '## Evidence',
      '',
      '- [[sources/...]]',
      '',
      '## My Notes',
      '',
      '-',
      '',
    ].join('\n'),
  )
  await ensureFile(
    paths.issueTemplate,
    [
      '---',
      'type: issue-note',
      'status: active',
      'severity: medium',
      'projects: []',
      'topics: []',
      'errorKeys: []',
      'updatedAt: <% tp.date.now("YYYY-MM-DD HH:mm") %>',
      'tags:',
      '  - issue',
      '---',
      '',
      '# Issue Title',
      '',
      '> [!summary] Symptom',
      '> Describe the failure in one sentence a future-you would immediately recognize.',
      '',
      '## Symptom',
      '',
      '-',
      '',
      '## Likely Causes',
      '',
      '-',
      '',
      '## Fix Pattern',
      '',
      '1. ',
      '2. ',
      '3. ',
      '',
      '## Validation',
      '',
      '- How to know it is fixed:',
      '',
      '## Related',
      '',
      '- [[patterns/...]]',
      '- [[projects/...]]',
      '',
      '## Evidence',
      '',
      '- [[sources/...]]',
      '',
      '## My Notes',
      '',
      '-',
      '',
    ].join('\n'),
  )
  await ensureFile(
    paths.projectTemplate,
    [
      '---',
      'type: project-hub',
      'status: active',
      'repo:',
      'owners: []',
      'updatedAt: <% tp.date.now("YYYY-MM-DD HH:mm") %>',
      'tags:',
      '  - project',
      '---',
      '',
      '# Project Name',
      '',
      '> [!summary] What It Is',
      '> Explain the project in one paragraph without assuming prior context.',
      '',
      '## Current Shape',
      '',
      '- Main goal:',
      '- Important capabilities:',
      '- Current focus:',
      '',
      '## Important Areas',
      '',
      '- Key files:',
      '- Key modules:',
      '',
      '## Key Patterns',
      '',
      '- [[patterns/...]]',
      '',
      '## Known Issues',
      '',
      '- [[issues/...]]',
      '',
      '## Related Concepts',
      '',
      '- [[concepts/...]]',
      '',
      '## Evidence',
      '',
      '- [[sources/...]]',
      '',
      '## Open Questions',
      '',
      '-',
      '',
    ].join('\n'),
  )
  await ensureFile(
    paths.synthesisTemplate,
    [
      '---',
      'type: synthesis-note',
      'status: draft',
      'question:',
      'projects: []',
      'topics: []',
      'updatedAt: <% tp.date.now("YYYY-MM-DD HH:mm") %>',
      'tags:',
      '  - synthesis',
      '---',
      '',
      '# Synthesis Title',
      '',
      '> [!summary] Main Conclusion',
      '> Start with the answer, not the journey.',
      '',
      '## Short Answer',
      '',
      '',
      '## Main Decisions Or Claims',
      '',
      '-',
      '',
      '## Why This Conclusion Holds',
      '',
      '-',
      '',
      '## Counterpoints Or Uncertainty',
      '',
      '-',
      '',
      '## Evidence',
      '',
      '- [[sources/...]]',
      '- [[patterns/...]]',
      '- [[issues/...]]',
      '',
      '## Follow-up Questions',
      '',
      '-',
      '',
    ].join('\n'),
  )
  await ensureFile(
    paths.reviewTemplate,
    [
      '---',
      'type: review',
      'period: weekly',
      'createdAt: <% tp.date.now("YYYY-MM-DD") %>',
      'tags:',
      '  - review',
      '---',
      '',
      '# Weekly Review',
      '',
      '> [!summary] Purpose',
      '> Use this page to merge duplicates, promote strong signals, and decide what should become durable knowledge.',
      '',
      '## New Signals',
      '',
      '-',
      '',
      '## Stable Conclusions',
      '',
      '-',
      '',
      '## Conflicts Or Duplicates',
      '',
      '-',
      '',
      '## Worth Upgrading Into Concepts',
      '',
      '- [[concepts/...]]',
      '',
      '## Follow-ups',
      '',
      '-',
      '',
    ].join('\n'),
  )

  return paths
}

export async function createVaultNoteFromTemplate({ path: relativePath = '', template = '' } = {}) {
  const normalizedPath = normalizeVaultRelativePath(relativePath)
  if (!normalizedPath || normalizedPath.includes('..')) {
    throw new Error('Invalid vault path')
  }

  const paths = await ensureVaultScaffold()
  const templateName = String(template || resolveGeneratedNoteTemplateName(normalizedPath)).trim()
  if (!templateName) throw new Error('template 必填')

  const absolutePath = path.join(paths.root, normalizedPath)
  const existing = await readFile(absolutePath, 'utf-8').catch(() => '')
  if (existing) {
    return {
      engine: 'legacy',
      created: false,
      path: normalizedPath,
      template: templateName,
      reason: 'already-exists',
    }
  }

  const seeded = await seedVaultNoteFromTemplate(normalizedPath, templateName)
  if (seeded.seeded) {
    return {
      engine: seeded.engine,
      created: true,
      path: normalizedPath,
      template: templateName,
      mode: 'obsidian-cli',
    }
  }

  const fallbackTemplatePath = path.join(paths.templatesDir, `${templateName}.md`)
  const fallbackTemplateContent = await readFile(fallbackTemplatePath, 'utf-8').catch(() => '')
  const fallbackTitle = path.posix.basename(normalizedPath, '.md').replace(/[-_]+/g, ' ').trim() || 'Untitled'
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(
    absolutePath,
    fallbackTemplateContent || `# ${fallbackTitle}\n\n`,
    'utf-8',
  )
  return {
    engine: 'legacy',
    created: true,
    path: normalizedPath,
    template: templateName,
    mode: 'filesystem-fallback',
  }
}

function buildSessionFileName(session) {
  const provider = toFileSlug(session?.provider || 'session', 'session')
  const title = toFileSlug(session?.title || '', 'untitled')
  const idPart = stableHash32(session?.id || `${provider}-${title}`)
  return `${provider}__${title}__${idPart}.md`
}

function buildSessionSummary(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : []
  const firstUser = messages.find((item) => String(item?.role || '').toLowerCase() === 'user')?.content || ''
  const lastAssistant = [...messages].reverse().find((item) => String(item?.role || '').toLowerCase() === 'assistant')?.content || ''
  const roles = countRoles(messages)
  const files = extractMentionedFiles(messages)

  return {
    firstUser: clipText(firstUser, 220),
    lastAssistant: clipText(lastAssistant, 220),
    roles,
    files,
  }
}

function toWikiPath(relativePath) {
  return String(relativePath || '').replace(/\\/g, '/').replace(/\.md$/i, '')
}

function sanitizeWikiLinkLabel(label = '') {
  return normalizeText(String(label || '').replace(/[\[\]|]/g, ' ')) || ''
}

function toWikiLink(relativePath, label = '') {
  const target = toWikiPath(relativePath)
  const safeLabel = sanitizeWikiLinkLabel(label)
  return safeLabel ? `[[${target}|${safeLabel}]]` : `[[${target}]]`
}

const LINT_NOTE_SPACES = ['root', 'sources', 'providers', 'projects', 'patterns', 'issues', 'syntheses', 'concepts', 'entities']
const LINT_READER_FIRST_SPACES = new Set(['projects', 'patterns', 'issues', 'syntheses', 'concepts', 'entities'])
const LINT_READER_FIRST_TYPES = new Set(['project-hub', 'pattern-note', 'issue-note', 'synthesis-note', 'concept-hub', 'entity-note'])

function normalizeLintTitleKey(title = '') {
  return normalizeText(String(title || '').toLowerCase())
}

function severityRank(level = '') {
  if (level === 'high') return 3
  if (level === 'medium') return 2
  return 1
}

function createLintFinding({ severity = 'low', code = 'generic', relativePath = '', title = '', detail = '', suggestion = '' } = {}) {
  return {
    severity,
    code,
    relativePath,
    title,
    detail,
    suggestion,
  }
}

function createBrokenWikiLinkFinding(item = {}) {
  const target = String(item?.target || '').trim()
  if (target.startsWith('projects/')) {
    return createLintFinding({
      severity: 'high',
      code: 'missing-project-hub',
      relativePath: item.from,
      title: item.title,
      detail: `Project link points to a missing hub: ${target}`,
      suggestion: 'Rebuild the wiki index. If it remains, normalize the project metadata or create the project hub.',
    })
  }
  if (target.startsWith('concepts/')) {
    return createLintFinding({
      severity: 'medium',
      code: 'missing-concept-page',
      relativePath: item.from,
      title: item.title,
      detail: `Concept link points to a concept page that was not published: ${target}`,
      suggestion: 'Keep Related Concepts limited to published concept pages, or promote enough evidence for this concept.',
    })
  }
  return createLintFinding({
    severity: 'high',
    code: 'broken-wikilink',
    relativePath: item.from,
    title: item.title,
    detail: `Links to missing note: ${target}`,
    suggestion: 'Fix the target path or create the missing note.',
  })
}

function normalizeObsidianNotePath(value = '') {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/g, '')
    .replace(/^\.\//g, '')
    .replace(/^vault\//i, '')
    .replace(/#.*$/g, '')
    .trim()
  if (!normalized) return ''
  return normalized.endsWith('.md') ? normalized : `${normalized}.md`
}

function pickFirstString(input = {}, keys = []) {
  for (const key of keys) {
    const value = String(input?.[key] || '').trim()
    if (value) return value
  }
  return ''
}

function parseObsidianPayload(raw = '') {
  const text = String(raw || '').trim()
  if (!text) return []
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function parseObsidianUnresolvedLinks(payload) {
  const normalizedPayload = typeof payload === 'string' ? parseObsidianPayload(payload) : payload
  const items = Array.isArray(normalizedPayload)
    ? normalizedPayload
    : Array.isArray(normalizedPayload?.results)
      ? normalizedPayload.results
      : Array.isArray(normalizedPayload?.items)
        ? normalizedPayload.items
        : []
  if (!items.length && typeof normalizedPayload === 'string') {
    return String(normalizedPayload || '')
      .split(/\r?\n/g)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => ({ from: '', target: toWikiPath(normalizeObsidianNotePath(item)) }))
      .filter((item) => item.target)
  }
  const links = []
  for (const item of items) {
    if (typeof item === 'string') {
      const target = toWikiPath(normalizeObsidianNotePath(item))
      if (target) links.push({ from: '', target })
      continue
    }
    const fromPath = toWikiPath(normalizeObsidianNotePath(pickFirstString(item, ['from', 'source', 'origin', 'file', 'notePath'])))
    const targetPath = toWikiPath(normalizeObsidianNotePath(pickFirstString(item, ['target', 'link', 'missing', 'unresolved', 'to', 'note', 'path'])))
    if (!targetPath) continue
    links.push({
      from: fromPath,
      target: targetPath,
    })
  }
  return links
}

function parseObsidianOrphanNotes(payload) {
  const normalizedPayload = typeof payload === 'string' ? parseObsidianPayload(payload) : payload
  const items = Array.isArray(normalizedPayload)
    ? normalizedPayload
    : Array.isArray(normalizedPayload?.results)
      ? normalizedPayload.results
      : Array.isArray(normalizedPayload?.items)
        ? normalizedPayload.items
        : []
  const paths = new Set()
  if (!items.length && typeof normalizedPayload === 'string') {
    for (const line of String(normalizedPayload || '').split(/\r?\n/g)) {
      const target = toWikiPath(normalizeObsidianNotePath(line))
      if (target) paths.add(target)
    }
    return paths
  }
  for (const item of items) {
    if (typeof item === 'string') {
      const target = toWikiPath(normalizeObsidianNotePath(item))
      if (target) paths.add(target)
      continue
    }
    const target = toWikiPath(normalizeObsidianNotePath(pickFirstString(item, ['path', 'file', 'notePath', 'target', 'note', 'source'])))
    if (target) paths.add(target)
  }
  return paths
}

function dedupeBrokenLinks(items = []) {
  const unique = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    const from = String(item?.from || '').trim()
    const target = String(item?.target || '').trim()
    if (!from || !target) continue
    const key = `${from}::${target}`
    if (!unique.has(key)) unique.set(key, item)
  }
  return Array.from(unique.values())
}

function collectMissingProviderTargetsForLint(notes = [], noteByWikiPath = new Map()) {
  const missing = new Set()
  for (const note of Array.isArray(notes) ? notes : []) {
    const outboundLinks = Array.isArray(note?.outboundLinks) ? note.outboundLinks : []
    for (const target of outboundLinks) {
      const normalizedTarget = toWikiPath(target)
      if (!normalizedTarget || !normalizedTarget.startsWith('providers/')) continue
      if (noteByWikiPath.has(normalizedTarget)) continue
      if (normalizedTarget === 'providers/README.md') continue
      missing.add(normalizedTarget)
    }
  }
  return Array.from(missing)
}

async function runLintProviderHubCalibration(missingProviderTargets = []) {
  const targets = Array.isArray(missingProviderTargets)
    ? missingProviderTargets.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  if (!targets.length) {
    return { attempted: false, applied: false, targets: [] }
  }
  try {
    const sourceEvidences = await loadPublishedSourceEvidences()
    const promotionState = await loadPromotionState()
    const knowledgeEvidences = await loadKnowledgePromotionEvidences({ writeEvidence: false })
    const approvedKnowledgeEvidences = filterApprovedKnowledgeEvidences(knowledgeEvidences, promotionState)
    await rebuildProviderPages([...sourceEvidences, ...approvedKnowledgeEvidences])
    return { attempted: true, applied: true, targets }
  } catch {
    return { attempted: true, applied: false, targets }
  }
}

async function loadObsidianLintSnapshot() {
  if (!isObsidianCliEnabled()) return null
  try {
    const [unresolvedResult, orphansResult] = await Promise.all([
      runObsidianCli(['unresolved', 'format=json'], {
        ensureReady: true,
        autoLaunch: true,
        timeoutMs: 5000,
        readyTimeoutMs: 5000,
      }),
      runObsidianCli(['orphans', 'format=json'], {
        ensureReady: true,
        autoLaunch: true,
        timeoutMs: 5000,
        readyTimeoutMs: 5000,
      }),
    ])
    return {
      unresolved: parseObsidianUnresolvedLinks(unresolvedResult?.stdout || ''),
      orphanPaths: parseObsidianOrphanNotes(orphansResult?.stdout || ''),
    }
  } catch {
    return null
  }
}

function isLintReaderFirstNote(note = {}) {
  const relativePath = String(note?.relativePath || '')
  if (!relativePath || /(^|\/)README\.md$/i.test(relativePath)) return false
  if (relativePath.startsWith('Templates/')) return false
  return LINT_READER_FIRST_SPACES.has(note?.space) || LINT_READER_FIRST_TYPES.has(note?.type)
}

function daysSinceIso(isoText = '') {
  const value = String(isoText || '').trim()
  if (!value) return Number.POSITIVE_INFINITY
  const parsed = +new Date(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor((Date.now() - parsed) / (24 * 60 * 60 * 1000)))
}

function buildLintReportMarkdown(report = {}) {
  const generatedAt = String(report.generatedAt || new Date().toISOString())
  const lintEngine = String(report.lintEngine || 'legacy')
  const summary = report.summary || {}
  const findings = Array.isArray(report.findings) ? report.findings : []
  const grouped = {
    high: findings.filter((item) => item.severity === 'high'),
    medium: findings.filter((item) => item.severity === 'medium'),
    low: findings.filter((item) => item.severity === 'low'),
  }
  const lines = [
    '---',
    'type: "vault-lint-report"',
    `generatedAt: "${escapeYamlString(generatedAt)}"`,
    `lintEngine: "${escapeYamlString(lintEngine)}"`,
    `totalFindings: ${Number(summary.totalFindings || 0)}`,
    `highCount: ${Number(summary.highCount || 0)}`,
    `mediumCount: ${Number(summary.mediumCount || 0)}`,
    `lowCount: ${Number(summary.lowCount || 0)}`,
    'status: "generated"',
    '---',
    '',
    '# Wiki Lint Report',
    '',
    '> [!summary] Health',
    `> High: \`${Number(summary.highCount || 0)}\` · Medium: \`${Number(summary.mediumCount || 0)}\` · Low: \`${Number(summary.lowCount || 0)}\` · Notes checked: \`${Number(summary.totalNotes || 0)}\``,
    '',
    '## Overview',
    '',
    `- Generated at: ${formatIsoLocal(generatedAt)}`,
    `- Notes checked: \`${Number(summary.totalNotes || 0)}\``,
    `- Reader-first notes: \`${Number(summary.readerFirstNotes || 0)}\``,
    `- Broken links: \`${Number(summary.brokenLinkCount || 0)}\``,
    `- Duplicate titles: \`${Number(summary.duplicateTitleCount || 0)}\``,
    `- Orphan notes: \`${Number(summary.orphanCount || 0)}\``,
    '',
    '## Next Actions',
    '',
  ]

  if (!findings.length) {
    lines.push('- No lint findings. The current wiki looks healthy.')
    lines.push('')
  } else {
    const prioritized = findings.slice(0, 8)
    for (const item of prioritized) {
      const label = item.relativePath ? toWikiLink(item.relativePath, item.title || item.relativePath) : `\`${escapeMarkdownText(item.title || item.code)}\``
      lines.push(`- [${item.severity.toUpperCase()}] ${label} — ${escapeMarkdownText(item.detail || item.code)}`)
    }
    lines.push('')
  }

  for (const severity of ['high', 'medium', 'low']) {
    const items = grouped[severity]
    lines.push(`## ${severity.charAt(0).toUpperCase() + severity.slice(1)} Findings`)
    lines.push('')
    if (!items.length) {
      lines.push(`_No ${severity} findings._`)
      lines.push('')
      continue
    }
    for (const item of items) {
      const label = item.relativePath ? toWikiLink(item.relativePath, item.title || item.relativePath) : `\`${escapeMarkdownText(item.title || item.code)}\``
      lines.push(`- ${label}`)
      lines.push(`  - Code: \`${escapeMarkdownText(item.code)}\``)
      lines.push(`  - Detail: ${escapeMarkdownText(item.detail || '-')}`)
      if (item.suggestion) lines.push(`  - Suggestion: ${escapeMarkdownText(item.suggestion)}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function buildProviderRelativePath(provider) {
  return `providers/${toFileSlug(provider || 'unknown', 'unknown')}.md`
}

function groupByProvider(entries = []) {
  const map = new Map()
  for (const entry of entries) {
    const provider = String(entry?.provider || 'unknown').trim() || 'unknown'
    if (!map.has(provider)) map.set(provider, [])
    map.get(provider).push(entry)
  }
  return map
}

function fileBaseToConcept(input) {
  let value = String(input || '').trim()
  value = value.replace(/[#?].*$/g, '')
  value = value.replace(/\.[A-Za-z0-9]+$/g, '')
  value = value.replace(/^\d+-/g, '')
  value = value.replace(/^feature-/g, '')
  value = value.replace(/^use(?=[A-Z])/, '')
  value = value.replace(/(Domain|Panel|Menu|Modal|Settings|View|Page|Component|Dialog|Field|Service|Runtime|Store|Block)$/g, '')
  value = value.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  value = value.replace(/[_\s]+/g, '-')
  value = value.replace(/-+/g, '-')
  value = value.replace(/^-|-$/g, '')
  return value.toLowerCase()
}

const GENERIC_CONCEPTS = new Set([
  'assistant',
  'user',
  'session',
  'sessions',
  'message',
  'messages',
  'source',
  'sources',
  'event-stream',
  'event',
  'stream',
  'jsonl',
  'json',
  'markdown',
  'index',
  'style',
  'styles',
  'layout',
  'readme',
  'home',
  'notes',
  'user-query',
  'button',
  'buttons',
  'file',
  'files',
  'src',
  'server',
  'docs',
  'app',
  'components',
  'feature',
  'features',
  'view',
  'list',
  'types',
  'utils',
  'local',
  'remote',
  'result',
  'mock',
  'css',
  'bug',
  'error',
  'errors',
  'openclaw',
  'open-claw',
  'request',
  'requests',
  'pattern',
  'patterns',
  'feature-request',
  'mac',
  'claude',
  'inbox',
  'unknown',
  'and',
  'the',
  'can',
  'you',
  'help',
  'better',
  'item',
  'name',
  'page',
  'pages',
  'record',
  'title',
  'task',
  'test',
  'initial',
  'demo',
  'create',
  'detail',
  'load',
  'loading',
  'group',
  'company',
  'document',
  'official',
  'first',
  'select',
  'send',
  'add',
  'set',
  'handle',
  'check',
  'calc',
  'match',
  'route',
  'path',
  'dir',
  'db',
  'map',
  'node',
  'package',
  'users',
  'user',
  'session-data',
  'session-filter',
  'provider-catalog',
  'record-detail',
  'record-list-item-block-top',
  'with',
  'for',
  'use',
  'when',
  'please',
  'etc',
  'browser',
  'lines',
  'const',
  'agents',
  'that',
  'https',
  'http',
  'instructions',
  'misc',
  'only',
  'them',
  'from',
])

const ENGLISH_CONCEPT_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'with', 'without', 'within', 'from', 'into', 'onto', 'over', 'under', 'after', 'before', 'between',
  'through', 'during', 'while', 'where', 'when', 'which', 'what', 'why', 'who', 'whom', 'whose',
  'you', 'your', 'yours', 'we', 'our', 'ours', 'they', 'them', 'their', 'theirs', 'he', 'him', 'his',
  'she', 'her', 'hers', 'it', 'its', 'me', 'my', 'mine', 'us',
  'can', 'could', 'should', 'would', 'will', 'may', 'might', 'must', 'shall',
  'only', 'just', 'also', 'still', 'already', 'again', 'please', 'maybe',
  'more', 'most', 'less', 'many', 'much', 'some', 'any', 'each', 'every', 'other', 'another',
  'same', 'different', 'new', 'old', 'first', 'second', 'third', 'last', 'next',
  'make', 'using', 'used', 'use', 'need', 'want', 'have', 'has', 'had', 'get', 'got',
  'help', 'better', 'good', 'bad', 'best', 'worse', 'demo', 'test', 'title', 'name', 'item',
  'page', 'pages', 'record', 'records', 'task', 'tasks', 'initial', 'create', 'detail', 'details',
  'load', 'loading', 'check', 'handle', 'add', 'set', 'only', 'them', 'that', 'from',
])

const CONCEPT_SLUG_ALIASES = {
  embeddings: 'embedding',
  prompts: 'prompt',
  skills: 'skill',
  pages: 'page',
  users: 'user',
  configuration: 'config',
  configurations: 'config',
  discoverys: 'discovery',
  overlayss: 'overlays',
}

const NOISY_TITLE_TOKENS = new Set([
  'and',
  'the',
  'can',
  'you',
  'help',
  'better',
  'item',
  'name',
  'title',
  'task',
  'test',
  'initial',
  'demo',
  'create',
  'detail',
  'load',
  'official',
  'first',
  'select',
  'send',
  'add',
  'set',
  'handle',
  'check',
  'calc',
  'with',
  'for',
  'use',
  'when',
  'please',
  'etc',
  'that',
  'https',
  'http',
  'instructions',
  'only',
  'them',
  'from',
])

const TOPIC_CONCEPT_SLUGS = new Set([
  'rag',
  'embedding',
  'obsidian',
  'syncthing',
  'memory',
  'cleanup-safety',
  'prompt',
  'feishu',
  'skill',
  'scanner',
  'playwright',
  'direnv',
  'vite',
  'vue',
  'api',
  'prompt-scorer',
  'login',
  'testing',
  'qrcode',
  'andun-qrcode',
])

const MODULE_CONCEPT_SLUGS = new Set([
  'session-management',
  'bug-trace',
  'model-settings',
  'component-library',
  'add-classification',
  'add-single',
  'arrange',
  'centralize',
  'config',
  'detail-single',
  'discovery',
  'navigation',
  'overlays',
  'wx-message',
  'wx-input',
  'classification-detail',
  'strategy-meeting',
  'session-workspace',
  'org-select',
  'select-classification',
  'select-user',
  'send-confirm-popup',
  'set-protected-time',
  'nvm-auto-use',
  'direnv-setup',
  'bug-inbox',
  'bug-locator',
  'component-settings',
])

const PINNED_CONCEPT_SLUGS = new Set([
  'rag',
  'embedding',
  'obsidian',
  'syncthing',
  'memory',
  'cleanup-safety',
  'qrcode',
  'session-management',
  'bug-trace',
  'model-settings',
  'prompt',
  'feishu',
  'component-library',
  'wx-message',
  'wx-input',
  'scanner',
  'playwright',
  'direnv',
  'nvm-auto-use',
  'skill',
  'prompt-scorer',
])

const KNOWN_CONCEPT_PATTERNS = [
  { slug: 'rag', label: 'RAG', patterns: [/\brag\b/i, /检索增强/iu, /向量检索/iu] },
  { slug: 'embedding', label: 'Embeddings', patterns: [/\bembedding(s)?\b/i, /向量\b/iu] },
  { slug: 'obsidian', label: 'Obsidian', patterns: [/\bobsidian\b/i] },
  { slug: 'syncthing', label: 'Syncthing', patterns: [/\bsyncthing\b/i] },
  { slug: 'memory', label: 'Memory', patterns: [/\bmemory\b/i, /记忆/u] },
  { slug: 'cleanup-safety', label: '清理安全', patterns: [/批量清理|清理[\s\S]{0,24}误删|误删/u] },
  { slug: 'qrcode', label: 'QRCode', patterns: [/\bqrcode\b/i, /二维码/iu] },
  { slug: 'session-management', label: '会话管理', patterns: [/会话管理/iu, /session management/i] },
  { slug: 'bug-trace', label: 'Bug Trace', patterns: [/\bbug[- ]?trace\b/i, /bug.*反查/iu, /代码反查/iu] },
  { slug: 'model-settings', label: '模型设置', patterns: [/模型设置/iu, /\bmodel settings?\b/i] },
  { slug: 'prompt', label: 'Prompt', patterns: [/\bprompt\b/i, /提示词/iu, /system prompt/i] },
  { slug: 'feishu', label: 'Feishu', patterns: [/\bfeishu\b/i, /飞书/iu] },
  { slug: 'component-library', label: '组件库', patterns: [/组件库/iu, /component library/i] },
]

function normalizeConceptLabel(slug, rawLabel = '') {
  const bySlug = {
    rag: 'RAG',
    embedding: 'Embeddings',
    obsidian: 'Obsidian',
    syncthing: 'Syncthing',
    memory: 'Memory',
    'cleanup-safety': '清理安全',
    qrcode: 'QRCode',
    'session-management': '会话管理',
    'bug-trace': 'Bug Trace',
    'model-settings': '模型设置',
    prompt: 'Prompt',
    feishu: 'Feishu',
    'component-library': '组件库',
    vue: 'Vue',
    git: 'Git',
    node: 'Node',
    playwright: 'Playwright',
    direnv: 'Direnv',
    scanner: 'Scanner',
    'wx-message': 'Wx Message',
    'wx-input': 'Wx Input',
    'bug-inbox': 'Bug Inbox',
    'bug-locator': 'Bug Locator',
    'component-settings': 'Component Settings',
    'prompt-scorer': 'Prompt Scorer',
    'strategy-meeting': 'Strategy Meeting',
    'model-management': '模型管理',
    'session-workspace': 'Session Workspace',
    'select-classification': 'Select Classification',
    'select-user': 'Select User',
    'send-confirm-popup': 'Send Confirm Popup',
    'set-protected-time': 'Set Protected Time',
    'org-select': 'Org Select',
    'nvm-auto-use': 'Nvm Auto Use',
    'direnv-setup': 'Direnv Setup',
    'add-single': 'Single Match Form',
    'detail-single': 'Single Match Detail',
    'add-classification': 'Add Classification',
    arrange: 'Scheduling',
    centralize: 'Centralized Input',
    config: 'Configuration',
    discovery: 'Source Discovery',
    overlays: 'Overlay Modals',
    login: 'Login Flow',
    testing: 'Test Automation',
    'srs-h5': 'SRS H5',
    'andun-qrcode': 'Andun QRCode',
    nuxt: 'Nuxt',
    https: 'HTTPS',
  }
  if (bySlug[slug]) return bySlug[slug]
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase()
      if (lower === 'rag') return 'RAG'
      if (lower === 'qrcode') return 'QRCode'
      if (lower === 'api') return 'API'
      if (lower === 'ui') return 'UI'
      if (lower === 'mcp') return 'MCP'
      if (lower === 'llm') return 'LLM'
      if (rawLabel && rawLabel.toLowerCase() === slug.toLowerCase()) return part.charAt(0).toUpperCase() + part.slice(1)
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')
}

function normalizeConceptSlug(slug = '') {
  const normalized = toFileSlug(slug || '', '')
  if (!normalized) return ''
  return CONCEPT_SLUG_ALIASES[normalized] || normalized
}

function inferConceptKind(slug, sourceTypes = new Set(), kindHint = '') {
  const normalizedSlug = normalizeConceptSlug(slug || '')
  if (kindHint === 'topic' || kindHint === 'module') return kindHint
  if (TOPIC_CONCEPT_SLUGS.has(normalizedSlug)) return 'topic'
  if (MODULE_CONCEPT_SLUGS.has(normalizedSlug)) return 'module'
  if (sourceTypes.has('feature-dir') || sourceTypes.has('file-base')) return 'module'
  return 'topic'
}

function addConcept(map, slug, label, weight = 1, options = {}) {
  const normalizedSlug = normalizeConceptSlug(slug || '')
  if (!isUsefulConceptSlug(normalizedSlug) || GENERIC_CONCEPTS.has(normalizedSlug)) return
  const normalizedLabel = normalizeConceptLabel(normalizedSlug, label)
  const current = map.get(normalizedSlug) || {
    slug: normalizedSlug,
    label: normalizedLabel,
    kind: '',
    weight: 0,
    sourceTypes: new Set(),
  }
  current.weight += weight
  if (!current.label && normalizedLabel) current.label = normalizedLabel
  if (options.sourceType) current.sourceTypes.add(String(options.sourceType))
  current.kind = inferConceptKind(normalizedSlug, current.sourceTypes, String(options.kindHint || current.kind || ''))
  map.set(normalizedSlug, current)
}

function isUsefulConceptSlug(slug) {
  const value = String(slug || '').trim().toLowerCase()
  if (!value) return false
  if (value.length < 2 || value.length > 40) return false
  if (/[.#/]/.test(value)) return false
  if (/^\d+$/.test(value)) return false
  if (/^l\d+$/i.test(value)) return false
  if (/-\d+$/.test(value)) return false
  if (/\d{3,}/.test(value)) return false
  if (/^app-/.test(value)) return false
  return true
}

function extractTitleTokens(text = '') {
  const tokens = []
  const latin = String(text || '').match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) || []
  for (const item of latin) {
    const normalized = fileBaseToConcept(item)
    if (!normalized || NOISY_TITLE_TOKENS.has(normalized) || GENERIC_CONCEPTS.has(normalized) || ENGLISH_CONCEPT_STOPWORDS.has(normalized)) continue
    tokens.push(item)
  }
  return tokens
}

function parseConceptValue(input) {
  const raw = String(input || '').trim()
  if (!raw) return null
  const [slugPart, labelPart, kindPart] = raw.split('|')
  const slug = normalizeConceptSlug(slugPart || '')
  if (!isUsefulConceptSlug(slug)) return null
  return {
    slug,
    label: normalizeConceptLabel(slug, labelPart || ''),
    kind: kindPart === 'module' ? 'module' : 'topic',
  }
}

function conceptToFrontmatterValue(concept) {
  return `${concept.slug}|${concept.label}|${concept.kind === 'module' ? 'module' : 'topic'}`
}

function buildConceptRelativePath(concept) {
  return `concepts/${concept.slug}.md`
}

export function extractSessionConcepts(session) {
  const conceptMap = new Map()
  const provider = toFileSlug(session?.provider || '', '')
  const messages = Array.isArray(session?.messages) ? session.messages : []
  const firstUser = messages.find((item) => String(item?.role || '').toLowerCase() === 'user')?.content || ''
  const contextText = [
    session?.title || '',
    firstUser,
    session?.conceptContext || '',
    ...(Array.isArray(session?.tags) ? session.tags : []),
  ].join('\n')

  for (const item of KNOWN_CONCEPT_PATTERNS) {
    if (item.patterns.some((pattern) => pattern.test(contextText))) {
      addConcept(conceptMap, item.slug, item.label, 5, {
        sourceType: 'known-pattern',
        kindHint: TOPIC_CONCEPT_SLUGS.has(item.slug) ? 'topic' : MODULE_CONCEPT_SLUGS.has(item.slug) ? 'module' : '',
      })
    }
  }

  for (const token of extractTitleTokens(contextText)) {
    const normalized = fileBaseToConcept(token)
    if (!normalized || normalized === provider || GENERIC_CONCEPTS.has(normalized)) continue
    addConcept(conceptMap, normalized, normalizeConceptLabel(normalized, token), 2, {
      sourceType: 'title-token',
    })
  }

  for (const filePath of extractMentionedFiles(messages, 10)) {
    const normalizedPath = String(filePath || '').replace(/\\/g, '/')
    const parts = normalizedPath.split('/').filter(Boolean)
    const base = parts[parts.length - 1] || ''
    const baseConcept = fileBaseToConcept(base)
    if (baseConcept && baseConcept !== provider) addConcept(conceptMap, baseConcept, '', 4, {
      sourceType: 'file-base',
    })

    const featureIndex = parts.findIndex((item) => item === 'features')
    if (featureIndex >= 0 && parts[featureIndex + 1]) {
      const featureConcept = fileBaseToConcept(parts[featureIndex + 1])
      if (featureConcept && featureConcept !== provider) addConcept(conceptMap, featureConcept, '', 3, {
        sourceType: 'feature-dir',
        kindHint: 'module',
      })
    }
  }

  return Array.from(conceptMap.values())
    .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))
    .filter((item) => Number(item.weight || 0) >= 3)
    .slice(0, 6)
    .map((item) => ({
      slug: item.slug,
      label: item.label,
      kind: item.kind === 'module' ? 'module' : 'topic',
      weight: item.weight,
    }))
}

function groupByConcept(entries = []) {
  const map = new Map()
  for (const entry of entries) {
    const concepts = Array.isArray(entry?.concepts) ? entry.concepts.filter(Boolean) : []
    for (const concept of concepts) {
      const slug = String(concept?.slug || '').trim()
      if (!slug) continue
      if (!map.has(slug)) map.set(slug, { concept, entries: [] })
      map.get(slug).entries.push(entry)
    }
  }
  return map
}

function buildConceptCatalogFromEntries(entries = []) {
  const groups = groupByConcept(entries)
  const catalog = new Map()

  for (const [slug, item] of groups.entries()) {
    const count = Array.isArray(item?.entries) ? item.entries.length : 0
    const kind = inferConceptKind(slug, new Set(), '')
    const shouldKeep = PINNED_CONCEPT_SLUGS.has(slug)
      || (kind === 'module' ? count >= 2 : count >= 2)
    if (!shouldKeep) continue
    catalog.set(slug, {
      ...item.concept,
      kind,
    })
  }

  return catalog
}

function groupSessionsByConcept(sessions = []) {
  const map = new Map()
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const concepts = extractSessionConcepts(session)
    for (const concept of concepts) {
      const slug = String(concept?.slug || '').trim()
      if (!slug) continue
      if (!map.has(slug)) map.set(slug, { concept, sessions: [] })
      map.get(slug).sessions.push(session)
    }
  }
  return map
}

function buildPublishedConceptCatalog(sessions = []) {
  const grouped = groupSessionsByConcept(sessions)
  const catalog = new Map()

  for (const [slug, item] of grouped.entries()) {
    const count = Array.isArray(item?.sessions) ? item.sessions.length : 0
    const kind = String(item?.concept?.kind || 'topic')
    const shouldKeep = PINNED_CONCEPT_SLUGS.has(slug)
      || (kind === 'module' ? count >= 2 : count >= 2)
    if (shouldKeep) {
      catalog.set(slug, item.concept)
    }
  }

  return catalog
}

function getPublishedConceptsForSession(session, conceptCatalog = null) {
  const concepts = extractSessionConcepts(session)
  if (!conceptCatalog) return concepts
  return concepts.filter((item) => conceptCatalog.has(String(item?.slug || '').trim()))
}

function buildSessionPublishedEntry(session) {
  const provider = String(session?.provider || 'unknown') || 'unknown'
  return {
    title: String(session?.title || 'Untitled Session'),
    type: 'source-session',
    provider,
    updatedAt: String(session?.updatedAt || ''),
    messageCount: Array.isArray(session?.messages) ? session.messages.length : 0,
    sessionId: String(session?.id || ''),
    tags: Array.isArray(session?.tags) ? session.tags : [],
    concepts: getPublishedConceptsForSession(session),
    relativePath: `sources/${buildSessionFileName(session)}`,
  }
}

async function buildConceptEntryDigestsFromSessions(sessions = []) {
  const digests = []
  const paths = getVaultPaths()

  for (const session of Array.isArray(sessions) ? sessions : []) {
    const entry = buildSessionPublishedEntry(session)
    const summary = buildSessionSummary(session)
    const filePath = path.join(paths.root, entry.relativePath)
    const existingMarkdown = await readFile(filePath, 'utf-8').catch(() => '')
    const manualNotes = extractManualNotes(existingMarkdown)

    digests.push({
      title: entry.title,
      provider: entry.provider,
      updatedAt: entry.updatedAt,
      messageCount: entry.messageCount,
      relativePath: entry.relativePath,
      firstUserIntent: summary.firstUser,
      latestAssistantReply: summary.lastAssistant,
      mentionedFiles: summary.files.join(', '),
      manualNotes: manualNotes !== '-' ? clipText(manualNotes, 220) : '',
    })
  }

  return digests
}

export async function buildWikiVaultSyncPreview(sessions = [], options = {}) {
  const list = Array.isArray(sessions) ? sessions.filter(Boolean) : []
  const syncMode = String(options.syncMode || 'publish-only')
  const conceptCatalog = buildPublishedConceptCatalog(list)
  const conceptGroups = groupSessionsByConcept(list)
  const filteredConceptGroups = new Map(
    Array.from(conceptGroups.entries()).filter(([slug]) => conceptCatalog.has(slug)),
  )
  const totalConcepts = filteredConceptGroups.size
  const summaryConfig = syncMode === 'publish-with-summary' ? await loadConceptSummaryConfig() : null
  let llmEligibleConcepts = 0
  let estimatedModelCalls = 0
  let reusableLlmConcepts = 0
  let skippedConcepts = 0

  for (const item of filteredConceptGroups.values()) {
    const entryDigests = await buildConceptEntryDigestsFromSessions(item.sessions)
    const conceptInputHash = buildConceptInputHash(item.concept, entryDigests)
    const filePath = path.join(getVaultPaths().root, buildConceptRelativePath(item.concept))
    const existingMarkdown = await readFile(filePath, 'utf-8').catch(() => '')
    const previousHash = parseSimpleFrontmatterValue(existingMarkdown, 'conceptInputHash')
    const previousSummaryMode = parseSimpleFrontmatterValue(existingMarkdown, 'summaryMode')
    const previousSummaryModel = parseSimpleFrontmatterValue(existingMarkdown, 'summaryModel')
    const previousKind = parseSimpleFrontmatterValue(existingMarkdown, 'kind')
    const previousSchemaVersion = parseSimpleFrontmatterValue(existingMarkdown, 'schemaVersion')
    const currentSummaryModel = String(summaryConfig?.model || '')
    const canReuseExistingSummary = (
      previousHash
      && previousHash === conceptInputHash
      && previousKind === (item.concept.kind === 'module' ? 'module' : 'topic')
      && previousSchemaVersion === CONCEPT_PAGE_SCHEMA_VERSION
      && !hasUnpublishedConceptLinks(existingMarkdown, conceptCatalog)
      && (
        !summaryConfig
        || entryDigests.length < 2
        || (
          previousSummaryMode === 'llm'
          && previousSummaryModel === currentSummaryModel
        )
      )
    )

    if (entryDigests.length >= 2) llmEligibleConcepts += 1

    if (canReuseExistingSummary) {
      skippedConcepts += 1
      if (previousSummaryMode === 'llm') reusableLlmConcepts += 1
      continue
    }

    if (syncMode === 'publish-with-summary' && summaryConfig && entryDigests.length >= 2) {
      estimatedModelCalls += 1
    }
  }

  return {
    syncMode,
    totalSessions: list.length,
    totalConcepts,
    llmEligibleConcepts,
    targetConcepts: Math.max(0, totalConcepts - skippedConcepts),
    estimatedSteps: list.length + totalConcepts,
    estimatedModelCalls,
    reusableLlmConcepts,
    skippedConcepts,
  }
}

function renderConversation(messages = [], maxMessages = 40) {
  const list = Array.isArray(messages) ? messages : []
  const trimmed = list.slice(Math.max(0, list.length - maxMessages))
  const omitted = Math.max(0, list.length - trimmed.length)
  const parts = []

  if (omitted > 0) {
    parts.push(`> Earlier messages omitted: ${omitted}`)
    parts.push('')
  }

  trimmed.forEach((item, index) => {
    const role = String(item?.role || 'assistant').trim().toLowerCase() || 'assistant'
    const heading = role.charAt(0).toUpperCase() + role.slice(1)
    const createdAt = item?.createdAt ? ` (${formatIsoLocal(item.createdAt)})` : ''
    const content = normalizeText(item?.content || '')
    if (!content) return

    parts.push(`### ${heading}${createdAt}`)
    parts.push('')
    parts.push(content)
    if (index < trimmed.length - 1) parts.push('')
  })

  return parts.join('\n').trim()
}

function extractSnapshotValue(markdownText, label) {
  const body = extractMarkdownSection(markdownText, 'Snapshot')
  if (!body) return ''
  const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = body.match(new RegExp(`^- ${escaped}:\\s*(.*)$`, 'm'))
  return match?.[1] ? normalizeText(match[1]) : ''
}

function extractSignalValue(markdownText, label) {
  const body = extractMarkdownSection(markdownText, 'Extracted Signals')
  if (!body) return ''
  const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = body.match(new RegExp(`^- ${escaped}:\\s*(.*)$`, 'm'))
  return match?.[1] ? normalizeText(match[1]) : ''
}

function stripWikiMarkup(text) {
  return String(text || '')
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/`/g, '')
    .trim()
}

async function buildConceptEntryDigests(entries = []) {
  const digests = []
  for (const entry of entries) {
    const filePath = path.join(getVaultPaths().root, String(entry?.relativePath || ''))
    const markdown = await readFile(filePath, 'utf-8').catch(() => '')
    const firstUserIntent = stripWikiMarkup(extractSignalValue(markdown, 'First user intent'))
    const latestAssistantReply = stripWikiMarkup(extractSignalValue(markdown, 'Latest assistant reply'))
    const mentionedFiles = stripWikiMarkup(extractSnapshotValue(markdown, 'Mentioned files'))
    const manualNotes = extractManualNotes(markdown)

    digests.push({
      title: String(entry?.title || ''),
      provider: String(entry?.provider || 'unknown'),
      updatedAt: String(entry?.updatedAt || ''),
      messageCount: Number(entry?.messageCount || 0),
      relativePath: String(entry?.relativePath || ''),
      firstUserIntent,
      latestAssistantReply,
      mentionedFiles,
      manualNotes: manualNotes !== '-' ? clipText(manualNotes, 220) : '',
    })
  }
  return digests
}

function buildConceptInputHash(concept, entryDigests = []) {
  return stableSha1(JSON.stringify({
    concept: {
      slug: String(concept?.slug || ''),
      label: String(concept?.label || ''),
    },
    entries: entryDigests.map((item) => ({
      title: item.title,
      provider: item.provider,
      updatedAt: item.updatedAt,
      messageCount: item.messageCount,
      relativePath: item.relativePath,
      firstUserIntent: item.firstUserIntent,
      latestAssistantReply: item.latestAssistantReply,
      mentionedFiles: item.mentionedFiles,
      manualNotes: item.manualNotes,
    })),
  }))
}

function splitEvidenceSentences(text = '') {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/[\n。！？!?；;]+/g)
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .map((item) => clipText(item, 280))
}

function parseMentionedFilesValue(value = '') {
  return String(value || '')
    .split(',')
    .map((item) => item.replace(/`/g, '').trim())
    .filter(Boolean)
}

function extractVisibleAssistantReplies(markdownText = '', limit = 4) {
  const body = extractMarkdownSection(markdownText, 'Conversation')
  if (!body) return []
  const matches = [...body.matchAll(/### Assistant(?:\s*\([^)]+\))?\n\n([\s\S]*?)(?=\n### |\s*$)/g)]
  return matches
    .map((item) => normalizeText(item?.[1] || ''))
    .filter(Boolean)
    .slice(0, limit)
}

const BEST_ANSWER_STRUCTURE_PATTERNS = [
  /(?:^|\n)\s*(?:\d+\.\s|[-*]\s)/u,
  /##\s+/u,
  /总结|结论|建议|推荐|最实用|组合拳|判断方法|鉴别方法|核心思路|关键点/u,
]

const BEST_ANSWER_NEGATIVE_PATTERNS = [
  /我来(?:先)?|让我(?:先)?|我先|继续看|继续改|先读|先检查|正在查看/u,
  /\b(?:let me|i(?:'| wi)ll|checking|inspecting|implementing|reading relevant files)\b/iu,
  /\b(?:apply_patch|sed -n|rg -n|npm run|pnpm |git )\b/iu,
]

function scoreBestAssistantAnswerCandidate(reply = '', firstUserIntent = '') {
  const normalizedReply = normalizeText(reply)
  if (!normalizedReply) return -Infinity

  let score = 0
  if (normalizedReply.length >= 240) score += 4
  else if (normalizedReply.length >= 140) score += 3
  else if (normalizedReply.length >= 80) score += 2

  if (BEST_ANSWER_STRUCTURE_PATTERNS.some((pattern) => pattern.test(reply))) score += 4
  if (/[?？]/u.test(firstUserIntent) || /怎么|如何|为什么|是否|区别|怎么判断|怎么选|should|how|why|compare|plan/iu.test(firstUserIntent)) score += 2
  if (BEST_ANSWER_NEGATIVE_PATTERNS.some((pattern) => pattern.test(normalizedReply))) score -= 5
  if (countTaskSegmentCodeSignals(reply) >= 3) score -= 2
  if (/^(可以|好的|行|继续|我来)/u.test(normalizedReply)) score -= 2

  return score
}

function pickBestAssistantAnswer(replies = [], firstUserIntent = '', latestAssistantReply = '') {
  const candidates = (Array.isArray(replies) ? replies : []).filter(Boolean)
  if (!candidates.length) return normalizeText(latestAssistantReply)

  const ranked = candidates
    .map((reply) => ({ reply, score: scoreBestAssistantAnswerCandidate(reply, firstUserIntent) }))
    .sort((a, b) => b.score - a.score || String(b.reply || '').length - String(a.reply || '').length)

  if ((ranked[0]?.score ?? -Infinity) < 2) {
    return normalizeText(latestAssistantReply || ranked[0]?.reply || '')
  }

  return normalizeText(ranked[0]?.reply || latestAssistantReply || '')
}

const REPO_FILE_MARKERS = ['src', 'server', 'docs', 'scripts', 'app', 'components', 'features', 'pages', 'routes', 'vault']

function canonicalizeProjectLabel(input = '') {
  const value = String(input || '').trim()
  if (!value) return ''
  const normalized = value.replace(/\\/g, '/').trim()
  const basename = normalized.split('/').filter(Boolean).slice(-1)[0] || normalized
  const slug = toFileSlug(basename, '')
  if (!slug) return value

  const workspaceAliasMatch = slug.match(/^(?:users?|home)-[a-z0-9_-]+-(?:work|workspace|projects)-(.+)$/i)
  if (workspaceAliasMatch?.[1]) return workspaceAliasMatch[1]

  const genericWorkspaceMatch = slug.match(/^(?:work|workspace|projects)-(.+)$/i)
  if (genericWorkspaceMatch?.[1]) return genericWorkspaceMatch[1]

  return value
}

function inferRepoNameFromFilePath(filePath = '') {
  const normalized = String(filePath || '').replace(/\\/g, '/').trim()
  if (!normalized) return ''

  const parts = normalized.split('/').filter(Boolean)
  const markerIndex = parts.findIndex((item) => REPO_FILE_MARKERS.includes(item))
  if (markerIndex > 0) {
    const candidate = String(parts[markerIndex - 1] || '').trim()
    if (candidate && !candidate.startsWith('.') && !['Users', 'users', 'work', 'Desktop', 'Documents', 'Downloads', 'Library', 'Application Support', 'appdata', 'projects'].includes(candidate)) {
      return canonicalizeProjectLabel(candidate)
    }
  }

  const macTail = normalized.match(/^\/Users\/[^/]+\/(.+)$/)?.[1]?.split('/').filter(Boolean) || []
  if (macTail.length) {
    const candidate = macTail.find((item) => item && !item.startsWith('.') && !['work', 'Desktop', 'Documents', 'Downloads', 'Library', 'Application Support', 'projects'].includes(item))
    if (candidate) return canonicalizeProjectLabel(candidate)
  }

  const windowsTail = normalized.match(/^[A-Za-z]:\/(?:Users|users)\/[^/]+\/(.+)$/)?.[1]?.split('/').filter(Boolean) || []
  if (windowsTail.length) {
    const candidate = windowsTail.find((item) => item && !item.startsWith('.') && !['Desktop', 'Documents', 'Downloads', 'AppData', 'appdata', 'projects'].includes(item))
    if (candidate) return canonicalizeProjectLabel(candidate)
  }

  return ''
}

function normalizeProjectKey(input = '') {
  return toFileSlug(canonicalizeProjectLabel(input || ''), '')
}

function buildProjectRelativePath(projectKey = '') {
  return `projects/${normalizeProjectKey(projectKey) || 'unknown-project'}.md`
}

function buildIssueRelativePath(issueSlug = '') {
  return `issues/${toFileSlug(issueSlug || '', 'issue')}.md`
}

function buildPatternRelativePath(patternSlug = '') {
  return `patterns/${toFileSlug(patternSlug || '', 'pattern')}.md`
}

function normalizeRepoFileReference(filePath = '', projectKey = '') {
  const raw = String(filePath || '').replace(/\\/g, '/').replace(/`/g, '').trim()
  if (!raw || /^https?:\/\//i.test(raw)) return ''

  const hashIndex = raw.indexOf('#')
  const basePath = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw
  const anchor = hashIndex >= 0 ? raw.slice(hashIndex) : ''
  const normalizedBase = basePath.replace(/^\.\//, '').trim()
  const detectedProject = inferRepoNameFromFilePath(normalizedBase)
  const normalizedProject = normalizeProjectKey(projectKey)
  if (normalizedProject && detectedProject && normalizeProjectKey(detectedProject) !== normalizedProject) return ''

  const parts = normalizedBase.split('/').filter(Boolean)
  let relativeParts = parts

  if (normalizedProject) {
    const projectIndex = parts.findIndex((item) => normalizeProjectKey(item) === normalizedProject)
    if (projectIndex >= 0) relativeParts = parts.slice(projectIndex + 1)
  }

  const markerIndex = relativeParts.findIndex((item) => REPO_FILE_MARKERS.includes(item))
  if (markerIndex >= 0) {
    relativeParts = relativeParts.slice(markerIndex)
  } else if (!REPO_FILE_MARKERS.includes(relativeParts[0] || '')) {
    return ''
  }

  const relativePath = relativeParts.join('/')
  const fileName = relativeParts[relativeParts.length - 1] || ''
  if (!relativePath || !/\.[A-Za-z0-9]+$/.test(fileName)) return ''
  return `${relativePath}${anchor}`
}

function curateRepoFileReferences(files = [], projectKey = '', limit = 12) {
  const curated = []
  const seen = new Set()
  for (const item of Array.isArray(files) ? files : []) {
    const normalized = normalizeRepoFileReference(item, projectKey)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    curated.push(normalized)
    if (curated.length >= limit) break
  }
  return curated
}

async function buildSourceEntryEvidence(entry) {
  const relativePath = String(entry?.relativePath || '')
  const filePath = path.join(getVaultPaths().root, relativePath)
  const markdown = await readFile(filePath, 'utf-8').catch(() => '')
  const firstUserIntent = stripWikiMarkup(extractSignalValue(markdown, 'First user intent'))
  const latestAssistantReply = stripWikiMarkup(extractSignalValue(markdown, 'Latest assistant reply'))
  const mentionedFilesValue = stripWikiMarkup(extractSnapshotValue(markdown, 'Mentioned files'))
  const mentionedFiles = parseMentionedFilesValue(mentionedFilesValue)
  const assistantVisibleReplies = extractVisibleAssistantReplies(markdown, 4)
  const bestAssistantAnswer = pickBestAssistantAnswer(assistantVisibleReplies, firstUserIntent, latestAssistantReply)
  const concepts = Array.isArray(entry?.concepts) ? entry.concepts.filter(Boolean) : []
  const candidateProjects = mentionedFiles
    .map((item) => inferRepoNameFromFilePath(item))
    .filter(Boolean)
  const projectCounts = new Map()
  for (const name of candidateProjects) {
    projectCounts.set(name, (projectCounts.get(name) || 0) + 1)
  }
  const project = Array.from(projectCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || ''

  return {
    title: String(entry?.title || ''),
    provider: String(entry?.provider || 'unknown'),
    updatedAt: String(entry?.updatedAt || ''),
    messageCount: Number(entry?.messageCount || 0),
    sessionId: String(entry?.sessionId || ''),
    relativePath,
    firstUserIntent,
    latestAssistantReply,
    bestAssistantAnswer,
    assistantVisibleReplies,
    mentionedFiles,
    concepts,
    project,
  }
}

async function buildSourceEntryEvidenceList(entries = []) {
  const evidences = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    evidences.push(await buildSourceEntryEvidence(entry))
  }

  for (let pass = 0; pass < 2; pass += 1) {
    const conceptVotes = new Map()
    const fileVotes = new Map()

    for (const evidence of evidences) {
      const project = normalizeProjectKey(evidence?.project || '')
      if (!project) continue

      for (const concept of Array.isArray(evidence?.concepts) ? evidence.concepts : []) {
        const slug = String(concept?.slug || '').trim()
        if (!slug) continue
        if (!conceptVotes.has(slug)) conceptVotes.set(slug, [])
        conceptVotes.get(slug).push(evidence.project)
      }

      for (const file of Array.isArray(evidence?.mentionedFiles) ? evidence.mentionedFiles : []) {
        const key = normalizeText(file).toLowerCase()
        if (!key) continue
        if (!fileVotes.has(key)) fileVotes.set(key, [])
        fileVotes.get(key).push(evidence.project)
      }
    }

    let changed = false
    for (const evidence of evidences) {
      if (normalizeProjectKey(evidence?.project || '')) continue
      const candidates = []

      for (const concept of Array.isArray(evidence?.concepts) ? evidence.concepts : []) {
        const slug = String(concept?.slug || '').trim()
        if (!slug || !conceptVotes.has(slug)) continue
        candidates.push(...conceptVotes.get(slug))
      }

      for (const file of Array.isArray(evidence?.mentionedFiles) ? evidence.mentionedFiles : []) {
        const key = normalizeText(file).toLowerCase()
        if (!key || !fileVotes.has(key)) continue
        candidates.push(...fileVotes.get(key))
      }

      const inferredProject = pickDominantProject(candidates)
      if (!normalizeProjectKey(inferredProject)) continue
      evidence.project = inferredProject
      changed = true
    }

    if (!changed) break
  }

  return evidences
}

async function loadPublishedSourceEntries() {
  const paths = await ensureVaultScaffold()
  const entries = []
  const files = await readdir(paths.sourcesDir, { withFileTypes: true }).catch(() => [])

  for (const item of files) {
    if (!item.isFile() || !item.name.endsWith('.md')) continue
    const filePath = path.join(paths.sourcesDir, item.name)
    const meta = parseGeneratedMeta(await readFile(filePath, 'utf-8').catch(() => ''), `sources/${item.name}`)
    if (!meta) continue
    entries.push(meta)
  }

  return entries
}

async function loadPublishedSourceEvidences() {
  return buildSourceEntryEvidenceList(await loadPublishedSourceEntries())
}

function normalizeKnowledgeIntakeStage(value = '') {
  const normalized = String(value || '').trim().toLowerCase()
  if (['inbox', 'needs-context', 'search-candidate', 'wiki-candidate', 'reference-only'].includes(normalized)) return normalized
  return 'inbox'
}

function normalizeKnowledgeConfidence(value = '') {
  const normalized = String(value || '').trim().toLowerCase()
  if (['low', 'medium', 'high'].includes(normalized)) return normalized
  return 'medium'
}

function getKnowledgeMetaString(item = {}, key = '') {
  const meta = item?.meta && typeof item.meta === 'object' ? item.meta : {}
  return String(meta?.[key] || '').trim()
}

function isKnowledgeItemPromotionCandidate(item = {}) {
  const status = String(item?.status || '').trim().toLowerCase()
  if (status === 'archived') return false
  const title = String(item?.title || '').trim()
  const content = String(item?.content || '').trim()
  if (!title && !content) return false
  const promotionDecision = getKnowledgeMetaString(item, 'promotionDecision')
  if (promotionDecision === 'approved' || promotionDecision === 'dismissed') return true
  const stage = normalizeKnowledgeIntakeStage(getKnowledgeMetaString(item, 'intakeStage'))
  return stage === 'wiki-candidate' || status === 'active'
}

function isKnowledgePromotionQueueCandidate(evidence = {}) {
  const decision = String(evidence?.promotionDecision || '').trim()
  return decision !== 'approved' && decision !== 'dismissed'
}

function buildKnowledgeItemRelativePath(item = {}) {
  const idPart = toFileSlug(String(item?.id || stableHash32(item?.title || item?.content || 'knowledge')).replace(/^knowledge[_-]?/u, ''), 'item')
  const titlePart = toFileSlug(item?.title || 'knowledge', 'knowledge').slice(0, 48)
  return `inbox/knowledge__${titlePart}__${idPart}.md`
}

function inferKnowledgePromotionKind(evidence = {}) {
  const combined = [
    evidence.title,
    evidence.firstUserIntent,
    evidence.bestAssistantAnswer,
    evidence.latestAssistantReply,
    ...(Array.isArray(evidence.mentionedFiles) ? evidence.mentionedFiles : []),
  ].filter(Boolean).join('\n')

  if (hasIssueSignal(combined)) return 'issue-review'
  if (/(架构|设计|方案|tradeoff|取舍|抽象|拆分|workflow|pipeline|schema|模式|pattern|最佳实践|规范|机制|复用)/iu.test(combined)) {
    return 'pattern-candidate'
  }
  return 'synthesis-candidate'
}

function getKnowledgeConfidenceScore(item = {}, floor = 0.58) {
  const confidence = normalizeKnowledgeConfidence(item?.confidence || getKnowledgeMetaString(item, 'confidence'))
  if (confidence === 'high') return Math.max(floor, 0.78)
  if (confidence === 'low') return Math.max(0.5, floor - 0.08)
  return Math.max(floor, 0.66)
}

function buildKnowledgeItemEvidence(item = {}) {
  const title = String(item?.title || '').trim() || '未命名采集项'
  const content = normalizeText(item?.content || '')
  const summary = String(item?.summary || '').trim()
    || getKnowledgeMetaString(item, 'decisionNote')
    || buildPromotionQueueExcerpt(content, title)
  const keyQuestion = getKnowledgeMetaString(item, 'keyQuestion')
  const project = getKnowledgeMetaString(item, 'project')
  const topic = getKnowledgeMetaString(item, 'topic')
  const tags = Array.isArray(item?.tags) ? item.tags.map((entry) => String(entry || '').trim()).filter(Boolean) : []
  const sourceFile = String(item?.sourceFile || '').trim()
  const mentionedFiles = sourceFile ? [sourceFile] : []
  const concepts = extractSessionConcepts({
    title: [title, topic, tags.join(' ')].filter(Boolean).join(' · '),
    tags,
    conceptContext: [
      title,
      topic,
      tags.join(' '),
      keyQuestion,
      summary,
      content,
    ].filter(Boolean).join('\n'),
    messages: [
      { role: 'user', content: keyQuestion || title },
      { role: 'assistant', content: content || summary },
    ],
  })

  return {
    title,
    provider: 'knowledge',
    updatedAt: String(item?.updatedAt || ''),
    messageCount: 1,
    sessionId: String(item?.id || ''),
    segmentId: String(item?.id || ''),
    relativePath: buildKnowledgeItemRelativePath(item),
    firstUserIntent: keyQuestion || title,
    latestAssistantReply: summary || buildPromotionQueueExcerpt(content, ''),
    bestAssistantAnswer: content || summary,
    assistantVisibleReplies: [buildPromotionQueueExcerpt(content || summary, '')].filter(Boolean),
    mentionedFiles,
    concepts,
    project,
    knowledgeItemId: String(item?.id || ''),
    knowledgeSourceType: String(item?.sourceType || ''),
    sourceUrl: String(item?.sourceUrl || ''),
    sourceFile,
    tags,
    intakeStage: normalizeKnowledgeIntakeStage(getKnowledgeMetaString(item, 'intakeStage')),
    confidence: normalizeKnowledgeConfidence(getKnowledgeMetaString(item, 'confidence')),
    decisionNote: getKnowledgeMetaString(item, 'decisionNote'),
    promotionDecision: getKnowledgeMetaString(item, 'promotionDecision'),
    promotionKind: getKnowledgeMetaString(item, 'promotionKind'),
    promotionTargetPath: normalizeVaultRelativePath(getKnowledgeMetaString(item, 'promotionTargetPath')),
    promotionDecidedAt: getKnowledgeMetaString(item, 'promotionDecidedAt'),
    summary,
    content,
  }
}

function renderKnowledgeItemEvidenceMarkdown(evidence = {}) {
  const tags = Array.isArray(evidence.tags) ? evidence.tags : []
  const lines = [
    ...buildMarkdownFrontmatter({
      title: evidence.title || 'Knowledge Item',
      type: 'knowledge-evidence',
      provider: 'knowledge',
      source: 'knowledge-items',
      knowledgeItemId: evidence.knowledgeItemId || '',
      sourceType: evidence.knowledgeSourceType || '',
      project: evidence.project || '',
      updatedAt: evidence.updatedAt || '',
      intakeStage: evidence.intakeStage || 'inbox',
      confidence: evidence.confidence || 'medium',
    }),
    `# ${escapeMarkdownText(evidence.title || 'Knowledge Item')}`,
    '',
    '> [!info] Knowledge Evidence',
    '> 这页由 Raw Inbox 采集条目生成，用作 reader-first 升格审核的可追溯证据。',
    '',
    '## Snapshot',
    '',
    `- Knowledge item: \`${escapeMarkdownText(evidence.knowledgeItemId || '')}\``,
    `- Source type: \`${escapeMarkdownText(evidence.knowledgeSourceType || 'unknown')}\``,
    `- Intake stage: \`${escapeMarkdownText(evidence.intakeStage || 'inbox')}\``,
    `- Confidence: \`${escapeMarkdownText(evidence.confidence || 'medium')}\``,
    evidence.project ? `- Project: ${toWikiLink(buildProjectRelativePath(evidence.project), evidence.project)}` : '- Project: `待确认`',
  ]

  if (evidence.sourceUrl) lines.push(`- Source URL: ${escapeMarkdownText(evidence.sourceUrl)}`)
  if (evidence.sourceFile) lines.push(`- Source file: \`${escapeMarkdownText(evidence.sourceFile)}\``)
  if (tags.length) lines.push(`- Tags: ${tags.map((tag) => `\`${escapeMarkdownText(tag)}\``).join(', ')}`)
  if (evidence.promotionDecision) lines.push(`- Promotion decision: \`${escapeMarkdownText(evidence.promotionDecision)}\``)
  if (evidence.promotionTargetPath) lines.push(`- Promotion target: ${toWikiLink(evidence.promotionTargetPath)}`)

  lines.push('')
  lines.push('## Extracted Signals')
  lines.push('')
  lines.push(`- First user intent: ${escapeMarkdownText(evidence.firstUserIntent || 'n/a')}`)
  lines.push(`- Latest assistant reply: ${escapeMarkdownText(evidence.latestAssistantReply || 'n/a')}`)
  if (evidence.decisionNote) lines.push(`- Decision note: ${escapeMarkdownText(evidence.decisionNote)}`)
  lines.push('')
  lines.push('## Content')
  lines.push('')
  lines.push(evidence.content || evidence.summary || '-')
  lines.push('')

  return lines.join('\n')
}

async function writeKnowledgeItemEvidenceNotes(evidences = []) {
  const paths = await ensureVaultScaffold()
  const expected = new Set()
  for (const evidence of Array.isArray(evidences) ? evidences : []) {
    const relativePath = normalizeVaultRelativePath(evidence?.relativePath || '')
    if (!relativePath || !relativePath.startsWith('inbox/knowledge__')) continue
    const fileName = path.basename(relativePath)
    expected.add(fileName)
    await writeFile(path.join(paths.inboxDir, fileName), renderKnowledgeItemEvidenceMarkdown(evidence), 'utf-8')
  }

  const existing = await readdir(paths.inboxDir, { withFileTypes: true }).catch(() => [])
  for (const item of existing) {
    if (!item.isFile() || !item.name.startsWith('knowledge__') || !item.name.endsWith('.md')) continue
    if (expected.has(item.name)) continue
    await unlink(path.join(paths.inboxDir, item.name)).catch(() => {})
  }
}

async function loadKnowledgePromotionEvidences(options = {}) {
  const result = await listKnowledgeItemsInDb({ limit: 500, status: 'all' }).catch(() => ({ items: [] }))
  const evidences = (Array.isArray(result?.items) ? result.items : [])
    .filter((item) => isKnowledgeItemPromotionCandidate(item))
    .map((item) => buildKnowledgeItemEvidence(item))
  if (options.writeEvidence !== false) {
    await writeKnowledgeItemEvidenceNotes(evidences)
  }
  return evidences
}

async function loadPromotionQueueEvidences(options = {}) {
  const sourceEvidences = await loadPublishedSourceEvidences()
  const knowledgeEvidences = await loadKnowledgePromotionEvidences(options)
  return {
    sourceEvidences,
    knowledgeEvidences,
    allEvidences: [...sourceEvidences, ...knowledgeEvidences],
  }
}

function filterApprovedKnowledgeEvidences(knowledgeEvidences = [], promotionState = createEmptyPromotionState()) {
  const approvedEvidencePaths = collectApprovedPromotionEvidencePaths(promotionState)
  return (Array.isArray(knowledgeEvidences) ? knowledgeEvidences : [])
    .filter((item) => approvedEvidencePaths.has(normalizeVaultRelativePath(item?.relativePath || '')))
}

const ISSUE_SIGNAL_PATTERNS = [
  /报错|错误|异常|没反应|无响应|失败|失效|卡住|超时|搜不到|没有数据|一直是|不生效|故障/u,
  /(?:没有|缺少)\s*(?:embedding|embed|数据|结果|索引|响应)/iu,
  /\berror\b|\bfailed\b|\bfallback\b|\btimeout\b|\bundefined\b|\bnull\b|\bnot found\b|\bno response\b/iu,
]

const ISSUE_CAUSE_PATTERNS = [
  /原因|根因|因为|导致|问题点|定位到|根本原因/u,
  /\bcause\b|\bbecause\b|\broot cause\b|\bdue to\b/iu,
]

const ISSUE_FIX_PATTERNS = [
  /修好了|修掉了|修复|改成|改为|加一层|调整为|现在会|直接修|解决了|处理成/u,
  /\bfix\b|\bpatched\b|\bchanged\b|\bupdated\b|\bresolved\b/iu,
]

const ISSUE_VALIDATION_PATTERNS = [
  /重启|再调|再试|应该|返回|看到|验证|正常应该|步骤|刷新后/u,
  /\brestart\b|\bshould\b|\bverify\b|\bvalidation\b|\brefresh\b/iu,
]

const ISSUE_CLUSTER_RULES = [
  {
    slug: 'embedding-remote-fallback-local',
    title: 'Embedding 远端调用回退到本地',
    minMatches: 2,
    patterns: [/embedding[\s\S]{0,24}(fallback|local)/iu, /remote[\s\S]{0,24}local/iu, /一直是\s*local/u],
  },
  {
    slug: 'retrieval-semantic-query-miss',
    title: '语义检索查询召回缺失',
    minMatches: 2,
    patterns: [/搜不到|没有数据|无结果/u, /\bllm\b/iu, /ai大模型/u, /retrieve|检索/u],
  },
  {
    slug: 'ui-button-no-response',
    title: '按钮点击无响应',
    minMatches: 2,
    patterns: [/button|按钮/iu, /没反应|无响应/u],
  },
  {
    slug: 'wiki-sync-llm-slow',
    title: 'Wiki 深度汇总同步过慢',
    minMatches: 2,
    patterns: [/同步[\s\S]{0,12}慢/u, /publish-with-summary/iu, /llm[\s\S]{0,20}慢/u],
  },
]

const PATTERN_CLUSTER_RULES = [
  {
    slug: 'embedding-retrieval-workflow',
    title: 'Embedding 检索与重建流程',
    minMatches: 2,
    patterns: [/(embedding|embed)/iu, /(retrieve|检索|fallback|local|remote|重建)/u],
    summary: '把 query embedding、chunk embedding、fallback 和手动重建拆成可观测链路，能显著降低检索调试成本。',
    whenToUse: [
      '需要排查语义检索为什么命中差、一直 fallback 或模型信息不透明。',
      '需要把本地/远端 embedding、重建任务和检索元信息暴露给界面或 API。',
    ],
    shape: [
      '把 query embedding 和 chunk embedding 的状态显式写回元数据。',
      '把手动重建、预览、统计和在线检索拆成独立入口。',
      '在 UI 中显示 source/model/fallback/error，避免只看到“有结果/没结果”。',
    ],
    tradeoffs: [
      '状态更多，接口和前端展示会更复杂。',
      '如果 embedding provider 不稳定，需要额外处理重试、超时和 fallback 文案。',
    ],
  },
  {
    slug: 'bug-trace-panel-result-linkage',
    title: 'Bug Trace 面板动作与结果联动',
    minMatches: 2,
    patterns: [/(bug[ -]?trace|bug定位|代码反查|buglocatorpanel)/iu, /(button|按钮|详情|展开|命中|预览|结果)/u],
    summary: 'Bug Trace 类面板要把按钮动作、域层状态和右侧结果展示绑定成一条完整链路，否则很容易出现“点击了但像没反应”。',
    whenToUse: [
      '面板里既有搜索动作，又有结果卡片、详情展开和文件预览。',
      '一个动作会更新多个 UI 状态，例如选中项、展开态、预览内容和 loading。',
    ],
    shape: [
      '先定位动作按钮是否真正触发域层方法。',
      '再检查结果返回后是否同步更新选中态、展开态和详情区。',
      '把“有数据但 UI 没变化”和“请求根本没发出”区分开。',
    ],
    tradeoffs: [
      '交互链路越完整，状态同步点越多。',
      '如果域层和组件层边界不清，回归 bug 会比较多。',
    ],
  },
  {
    slug: 'session-workspace-evidence-first-ui',
    title: '会话工作区的证据优先展示',
    minMatches: 2,
    patterns: [/(session workspace|会话管理|命中片段|命中详情|锚点|anchor|evidence)/iu, /(展示|高亮|turn|片段|详情|导航)/u],
    summary: '在长会话场景里，优先展示命中证据、锚点导航和相关片段，比完整展开聊天记录更适合人读和调试。',
    whenToUse: [
      '长会话很多，用户更关心命中原因而不是完整聊天过程。',
      '需要把检索结果、命中轮次和原始会话阅读串起来。',
    ],
    shape: [
      '先显示命中摘要、命中片段和 turn anchors。',
      '再允许用户按需跳转到原始轮次和完整上下文。',
      '把 reasoning 和主要回答拆开展示，降低阅读噪音。',
    ],
    tradeoffs: [
      '需要额外维护命中 turn、snippet 和跳转锚点。',
      '过度摘要会损失原始上下文，需要保留 evidence 回链。',
    ],
  },
  {
    slug: 'obsidian-wiki-publication-pipeline',
    title: 'Obsidian Wiki 发布与知识升格流程',
    minMatches: 2,
    patterns: [/(obsidian|vault|wiki)/iu, /(publish|sync|concept|index|log|模板|template)/u],
    summary: '把原始 source 页和 reader-first 知识页分层，再通过发布、概念汇总和知识升格维护 Obsidian，可同时兼顾 AI 检索和人类阅读。',
    whenToUse: [
      '知识库既要给 AI 检索，也要给人浏览和持续维护。',
      'source 内容噪音大，需要编译成更稳定的知识层。',
    ],
    shape: [
      '保留 evidence-first 的 source 页。',
      '维护 projects/patterns/issues/syntheses 作为 reader-first 层。',
      '通过 index/log/README 提供稳定入口，而不是只靠 graph 漫游。',
    ],
    tradeoffs: [
      '需要维护更多页面类型和发布规则。',
      '如果 promotion 规则太松，wiki 很快会膨胀成噪音。',
    ],
  },
]

function hasIssueSignal(text = '') {
  const value = String(text || '')
  return ISSUE_SIGNAL_PATTERNS.some((pattern) => pattern.test(value))
}

function findIssueClusterRule(text = '') {
  const value = String(text || '')
  return ISSUE_CLUSTER_RULES.find((rule) => {
    const matches = rule.patterns.filter((pattern) => pattern.test(value)).length
    return matches >= Math.max(1, Number(rule.minMatches || rule.patterns.length || 1))
  }) || null
}

function cleanIssueLabel(text = '', fallback = 'Issue') {
  const pathIssueTitle = buildIssueTitleFromPath(text)
  if (pathIssueTitle) return pathIssueTitle
  const value = normalizeText(String(text || '')
    .replace(/^我(?:发现|看了|现在|这个项目)?/u, '')
    .replace(/^有个问题[:：]?\s*/u, '')
    .replace(/^问题是[:：]?\s*/u, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim())
  return clipText(value, 48) || fallback
}

function buildIssueTitleFromPath(text = '') {
  const raw = String(text || '')
  const match = raw.match(/@?((?:src|server|docs|scripts|app|components|features|pages|routes)\/[^\s,，:：)]+?\.(?:vue|js|ts|tsx|jsx|mjs))/)
  const filePath = String(match?.[1] || '').trim()
  if (!filePath) return ''
  const base = filePath.split('/').pop() || ''
  const label = normalizeConceptLabel(fileBaseToConcept(base), base.replace(/\.[A-Za-z0-9]+$/g, ''))
  if (/抛出|报错|异常/u.test(raw)) return `${label} 页面进入异常`
  if (/没反应|无响应/u.test(raw)) return `${label} 交互无响应`
  return ''
}

function extractIssueEvidenceLines(text = '', patterns = [], limit = 3) {
  const lines = splitEvidenceSentences(text)
  return lines.filter((line) => patterns.some((pattern) => pattern.test(line))).slice(0, limit)
}

function cleanIssueEvidenceLine(text = '') {
  return clipText(normalizeText(String(text || '')
    .replace(/^\d+[.)]\s*/u, '')
    .replace(/^\*+\s*/u, '')
    .replace(/^(?:可能原因|原因在于|定位到根因|根因是|正在修复|修复思路|验证结果|结论)[:：]\s*/u, '')
    .replace(/^[-*]\s*/u, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim()), 220)
}

function isWeakIssueEvidenceLine(text = '') {
  const value = normalizeText(String(text || ''))
  const plain = value.replace(/[：:]+$/u, '').trim()
  if (!value) return true
  if (/^(?:理清流程并定位根因|定位到根因|原因在于 Promise 链|正在修复|定位到根因，正在修复)$/u.test(plain)) return true
  if (/^\d+:\d+:(?:src|server|docs|scripts)\//u.test(value)) return true
  if (/(?:export function|const |let |var |=>).{20,}/u.test(value) && value.length > 120) return true
  return false
}

function buildIssueReaderSummary(issue = {}) {
  const title = String(issue?.title || '').trim()
  const symptom = cleanIssueEvidenceLine(Array.isArray(issue?.symptoms) ? issue.symptoms[0] || '' : '')
  const causes = (Array.isArray(issue?.causes) ? issue.causes : []).map((item) => cleanIssueEvidenceLine(item)).filter(Boolean)
  const fixes = (Array.isArray(issue?.fixes) ? issue.fixes : []).map((item) => cleanIssueEvidenceLine(item)).filter(Boolean)
  const validation = (Array.isArray(issue?.validation) ? issue.validation : []).map((item) => cleanIssueEvidenceLine(item)).filter(Boolean)
  const candidates = [
    symptom,
    ...causes,
    ...fixes,
    ...validation,
  ].filter(Boolean)

  const strongCandidate = candidates.find((item) => item.length >= 24 && normalizeText(item) !== normalizeText(title))
  if (strongCandidate) {
    if (strongCandidate.includes(title) || !title) return strongCandidate
    return clipText(`${title}：${strongCandidate}`, 220)
  }

  if (title && symptom && normalizeText(symptom) !== normalizeText(title)) {
    return clipText(`${title}：${symptom}`, 220)
  }
  if (title) return clipText(`${title}，当前仍需补充更稳定的原因、修复和验证证据。`, 220)
  return 'A repeated issue extracted from source evidence.'
}

function dedupeList(items = [], limit = 8) {
  const unique = []
  const seen = new Set()
  for (const item of Array.isArray(items) ? items : []) {
    const value = normalizeText(item)
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(value)
    if (unique.length >= limit) break
  }
  return unique
}

function dedupeConcepts(items = [], limit = 10) {
  const unique = []
  const seen = new Set()
  for (const item of Array.isArray(items) ? items : []) {
    const slug = String(item?.slug || '').trim()
    const label = String(item?.label || '').trim()
    if (!slug || !label) continue
    if (seen.has(slug)) continue
    seen.add(slug)
    unique.push({ slug, label })
    if (unique.length >= limit) break
  }
  return unique
}

function filterPublishedConcepts(items = [], conceptCatalog = null, limit = 10) {
  const concepts = dedupeConcepts(items, limit)
  if (!(conceptCatalog instanceof Map)) return concepts
  return concepts.filter((item) => conceptCatalog.has(String(item?.slug || '').trim()))
}

function pickDominantProject(candidates = []) {
  const counts = new Map()
  for (const item of Array.isArray(candidates) ? candidates : []) {
    const label = String(item || '').trim()
    const key = normalizeProjectKey(label)
    if (!label || !key) continue
    const current = counts.get(key) || { key, label, count: 0 }
    current.count += 1
    counts.set(key, current)
  }
  const ranked = Array.from(counts.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  return ranked[0]?.label || ''
}

function buildIssueCandidate(evidence) {
  const title = String(evidence?.title || '')
  const firstUserIntent = String(evidence?.firstUserIntent || '')
  const latestAssistantReply = String(evidence?.latestAssistantReply || '')
  const assistantContext = dedupeList([
    ...(Array.isArray(evidence?.assistantVisibleReplies) ? evidence.assistantVisibleReplies : []),
    latestAssistantReply,
  ], 4).join('\n')
  const combined = [title, firstUserIntent, assistantContext].filter(Boolean).join('\n')
  if (!(hasIssueSignal(title) || hasIssueSignal(firstUserIntent))) return null

  const rule = findIssueClusterRule(combined)
  const symptom = cleanIssueLabel(firstUserIntent || title, rule?.title || 'Issue')
  const causes = extractIssueEvidenceLines(assistantContext, ISSUE_CAUSE_PATTERNS)
    .map((item) => cleanIssueEvidenceLine(item))
    .filter((item) => !isWeakIssueEvidenceLine(item))
  const fixes = extractIssueEvidenceLines(assistantContext, ISSUE_FIX_PATTERNS)
    .map((item) => cleanIssueEvidenceLine(item))
    .filter((item) => !isWeakIssueEvidenceLine(item))
  const validation = extractIssueEvidenceLines(assistantContext, ISSUE_VALIDATION_PATTERNS)
    .map((item) => cleanIssueEvidenceLine(item))
    .filter((item) => !isWeakIssueEvidenceLine(item))
  const files = dedupeList(evidence?.mentionedFiles || [], 10)
  const project = String(evidence?.project || '').trim()

  let confidence = 0
  if (symptom && hasIssueSignal(symptom)) confidence += 0.35
  if (causes.length) confidence += 0.2
  if (fixes.length) confidence += 0.2
  if (validation.length) confidence += 0.1
  if (files.length) confidence += 0.1

  const issueSlug = rule?.slug || `issue-${stableHash32([symptom, files[0] || '', project].join('::'))}`
  const issueTitle = rule?.title || symptom

  return {
    slug: issueSlug,
    title: issueTitle,
    symptom,
    causes,
    fixes,
    validation,
    files,
    project,
    confidence: Number(confidence.toFixed(2)),
    evidence,
  }
}

function groupIssueCandidates(candidates = []) {
  const map = new Map()
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const slug = String(candidate?.slug || '').trim()
    if (!slug) continue
    if (!map.has(slug)) {
      map.set(slug, {
        slug,
        title: String(candidate?.title || 'Issue'),
        candidates: [],
      })
    }
    const current = map.get(slug)
    current.candidates.push(candidate)
  }
  return map
}

function findPatternClusterRules(text = '') {
  const value = String(text || '')
  return PATTERN_CLUSTER_RULES.filter((rule) => {
    const matches = rule.patterns.filter((pattern) => pattern.test(value)).length
    return matches >= Math.max(1, Number(rule.minMatches || rule.patterns.length || 1))
  })
}

function buildPatternCandidates(evidence) {
  const title = String(evidence?.title || '')
  const firstUserIntent = String(evidence?.firstUserIntent || '')
  const latestAssistantReply = String(evidence?.latestAssistantReply || '')
  const conceptsText = (Array.isArray(evidence?.concepts) ? evidence.concepts.map((item) => `${item?.slug || ''} ${item?.label || ''}`) : []).join(' ')
  const filesText = (Array.isArray(evidence?.mentionedFiles) ? evidence.mentionedFiles : []).join(' ')
  const assistantContext = dedupeList([
    ...(Array.isArray(evidence?.assistantVisibleReplies) ? evidence.assistantVisibleReplies : []),
    latestAssistantReply,
  ], 4).join('\n')
  const combined = [title, firstUserIntent, assistantContext, conceptsText, filesText].filter(Boolean).join('\n')
  const matchedRules = findPatternClusterRules(combined)

  return matchedRules.map((rule) => ({
    slug: rule.slug,
    title: rule.title,
    project: String(evidence?.project || '').trim(),
    summary: rule.summary,
    whenToUse: Array.isArray(rule.whenToUse) ? rule.whenToUse : [],
    shape: Array.isArray(rule.shape) ? rule.shape : [],
    tradeoffs: Array.isArray(rule.tradeoffs) ? rule.tradeoffs : [],
    files: dedupeList(evidence?.mentionedFiles || [], 10),
    concepts: dedupeConcepts(Array.isArray(evidence?.concepts) ? evidence.concepts : [], 8),
    evidence,
  }))
}

function groupPatternCandidates(candidates = []) {
  const map = new Map()
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const slug = String(candidate?.slug || '').trim()
    if (!slug) continue
    if (!map.has(slug)) {
      map.set(slug, {
        slug,
        title: String(candidate?.title || 'Pattern'),
        summary: String(candidate?.summary || ''),
        whenToUse: Array.isArray(candidate?.whenToUse) ? candidate.whenToUse : [],
        shape: Array.isArray(candidate?.shape) ? candidate.shape : [],
        tradeoffs: Array.isArray(candidate?.tradeoffs) ? candidate.tradeoffs : [],
        candidates: [],
      })
    }
    const current = map.get(slug)
    current.candidates.push(candidate)
  }
  return map
}

function collectIssueArtifacts(sourceEvidences = [], options = {}) {
  const conceptCatalog = options.conceptCatalog instanceof Map ? options.conceptCatalog : null
  const candidates = (Array.isArray(sourceEvidences) ? sourceEvidences : [])
    .map((item) => buildIssueCandidate(item))
    .filter((item) => item && Number(item.confidence || 0) >= 0.55)
  const grouped = groupIssueCandidates(candidates)
  return Array.from(grouped.values())
    .map((group) => {
      const allCandidates = Array.isArray(group.candidates) ? group.candidates : []
      const symptoms = dedupeList(allCandidates.map((item) => item.symptom), 5)
      const causes = dedupeList(
        allCandidates
          .flatMap((item) => item.causes || [])
          .map((item) => cleanIssueEvidenceLine(item))
          .filter((item) => !isWeakIssueEvidenceLine(item)),
        6,
      )
      const fixes = dedupeList(
        allCandidates
          .flatMap((item) => item.fixes || [])
          .map((item) => cleanIssueEvidenceLine(item))
          .filter((item) => !isWeakIssueEvidenceLine(item)),
        6,
      )
      const validation = dedupeList(
        allCandidates
          .flatMap((item) => item.validation || [])
          .map((item) => cleanIssueEvidenceLine(item))
          .filter((item) => !isWeakIssueEvidenceLine(item)),
        6,
      )
      const evidenceItems = dedupeList(allCandidates.map((item) => item?.evidence?.relativePath || ''), 20)
      const project = pickDominantProject(allCandidates.map((item) => item?.project || ''))
      const files = curateRepoFileReferences(allCandidates.flatMap((item) => item.files || []), project, 12)
      const concepts = filterPublishedConcepts(
        allCandidates.flatMap((item) => (Array.isArray(item?.evidence?.concepts) ? item.evidence.concepts : [])),
        conceptCatalog,
        8,
      )
      return {
        slug: group.slug,
        title: group.title,
        project,
        symptoms,
        causes,
        fixes,
        validation,
        files,
        concepts,
        evidenceItems,
        evidenceCount: allCandidates.length,
        updatedAt: allCandidates
          .map((item) => String(item?.evidence?.updatedAt || ''))
          .filter(Boolean)
          .sort()
          .slice(-1)[0] || '',
      }
    })
    .sort((a, b) => b.evidenceCount - a.evidenceCount || a.title.localeCompare(b.title))
}

function renderIssueMarkdown(issue, existingMarkdown = '', promotionRecord = null) {
  const manualNotes = extractManualNotes(existingMarkdown)
  const issueStatus = issue.evidenceCount <= 1 && !promotionRecord ? 'draft' : 'active'
  const issueSummary = buildIssueReaderSummary(issue)
  const lines = [
    ...buildMarkdownFrontmatter({
      title: issue.title,
      type: 'issue-note',
      schemaVersion: READER_PAGE_SCHEMA_VERSION,
      issue: issue.slug,
      status: issueStatus,
      project: issue.project || '',
      evidenceCount: issue.evidenceCount,
      updatedAt: issue.updatedAt || '',
      promotionState: promotionRecord ? 'approved' : 'auto',
      approvedAt: promotionRecord?.approvedAt || '',
    }),
    `# ${escapeMarkdownText(issue.title)}`,
    '',
    '> [!summary] Symptom',
    `> ${escapeMarkdownText(issueSummary)}`,
    '',
    ...renderConceptBulletSection('Symptom', issue.symptoms, '_No stable symptom extracted yet._'),
    ...renderConceptBulletSection('Likely Causes', issue.causes, '_No stable cause extracted yet._'),
    ...renderConceptBulletSection('Fix Pattern', issue.fixes, '_No stable fix pattern extracted yet._'),
    ...renderConceptBulletSection('Validation', issue.validation, '_No validation signal recorded yet._'),
  ]

  if (issue.files.length) {
    lines.push(...renderMarkdownSection(
      'Related Files',
      issue.files.map((item) => `- \`${escapeMarkdownText(item)}\``),
    ))
  }

  const relatedLines = []
  if (issue.project) relatedLines.push(`- Project: ${toWikiLink(buildProjectRelativePath(issue.project), issue.project)}`)
  if (issue.concepts.length) relatedLines.push(`- Concepts: ${issue.concepts.map((item) => toWikiLink(buildConceptRelativePath(item), item.label)).join(' · ')}`)
  lines.push(...renderMarkdownSection('Related', relatedLines, '- _No related pages yet._'))
  lines.push(...renderMarkdownSection(
    'Evidence',
    issue.evidenceItems.map((item) => `- ${toWikiLink(item)}`),
    '- _No evidence links recorded yet._',
  ))
  lines.push(...renderMarkdownSection('My Notes', manualNotes, '-'))
  return lines.join('\n')
}

function collectPatternArtifacts(sourceEvidences = [], options = {}) {
  const promotionState = options.promotionState || createEmptyPromotionState()
  const conceptCatalog = options.conceptCatalog instanceof Map ? options.conceptCatalog : null
  const dismissedPatternSlugs = new Set(
    Object.entries(promotionState.patterns || {})
      .filter(([, record]) => isDismissedPromotionRecord(record))
      .map(([slug]) => String(slug || '').trim())
      .filter(Boolean),
  )
  const issueList = Array.isArray(options.issues) ? options.issues : []
  const candidates = (Array.isArray(sourceEvidences) ? sourceEvidences : [])
    .flatMap((item) => buildPatternCandidates(item))
  const grouped = groupPatternCandidates(candidates)
  return Array.from(grouped.values())
    .map((group) => {
      const allCandidates = Array.isArray(group.candidates) ? group.candidates : []
      const evidenceItems = dedupeList(allCandidates.map((item) => item?.evidence?.relativePath || ''), 20)
      const project = pickDominantProject(allCandidates.map((item) => item?.project || ''))
      const files = curateRepoFileReferences(allCandidates.flatMap((item) => item.files || []), project, 12)
      const concepts = filterPublishedConcepts(allCandidates.flatMap((item) => item.concepts || []), conceptCatalog, 10)
      const relatedIssues = issueList.filter((issue) => normalizeProjectKey(issue?.project || '') === normalizeProjectKey(project || ''))
      return {
        slug: group.slug,
        title: group.title,
        summary: group.summary,
        whenToUse: dedupeList(group.whenToUse, 6),
        shape: dedupeList(group.shape, 6),
        tradeoffs: dedupeList(group.tradeoffs, 6),
        files,
        concepts,
        project,
        relatedIssues,
        evidenceItems,
        evidenceCount: evidenceItems.length,
        manuallyApproved: isApprovedPromotionRecord(promotionState.patterns[group.slug]),
        updatedAt: allCandidates
          .map((item) => String(item?.evidence?.updatedAt || ''))
          .filter(Boolean)
          .sort()
          .slice(-1)[0] || '',
      }
    })
    .filter((item) => !dismissedPatternSlugs.has(String(item?.slug || '').trim()))
    .filter((item) => item.evidenceCount >= 2 || item.manuallyApproved)
    .sort((a, b) => b.evidenceCount - a.evidenceCount || a.title.localeCompare(b.title))
}

function renderPatternMarkdown(pattern, existingMarkdown = '', promotionRecord = null) {
  const manualNotes = extractManualNotes(existingMarkdown)
  const lines = [
    ...buildMarkdownFrontmatter({
      title: pattern.title,
      type: 'pattern-note',
      schemaVersion: READER_PAGE_SCHEMA_VERSION,
      pattern: pattern.slug,
      project: pattern.project || '',
      evidenceCount: pattern.evidenceCount,
      updatedAt: pattern.updatedAt || '',
      status: 'active',
      promotionState: promotionRecord ? 'approved' : 'auto',
      approvedAt: promotionRecord?.approvedAt || '',
    }),
    `# ${escapeMarkdownText(pattern.title)}`,
    '',
    '> [!summary] Short Answer',
    `> ${escapeMarkdownText(pattern.summary || 'A reusable pattern extracted from multiple source notes.')}`,
    '',
    ...renderConceptBulletSection('When To Use', pattern.whenToUse, '_No stable usage guidance extracted yet._'),
    ...renderConceptBulletSection('Recommended Shape', pattern.shape, '_No stable shape extracted yet._'),
    ...renderConceptBulletSection('Tradeoffs', pattern.tradeoffs, '_No clear tradeoffs extracted yet._'),
  ]

  if (pattern.files.length) {
    lines.push(...renderMarkdownSection(
      'In This Repo',
      pattern.files.map((item) => `- \`${escapeMarkdownText(item)}\``),
    ))
  }

  const relatedLines = []
  if (pattern.project) relatedLines.push(`- Project: ${toWikiLink(buildProjectRelativePath(pattern.project), pattern.project)}`)
  if (pattern.concepts.length) relatedLines.push(`- Concepts: ${pattern.concepts.map((item) => toWikiLink(buildConceptRelativePath(item), item.label)).join(' · ')}`)
  if (pattern.relatedIssues.length) {
    relatedLines.push(`- Issues: ${pattern.relatedIssues.slice(0, 6).map((item) => toWikiLink(buildIssueRelativePath(item.slug), item.title)).join(' · ')}`)
  }
  lines.push(...renderMarkdownSection('Related', relatedLines, '- _No related pages yet._'))
  lines.push(...renderMarkdownSection(
    'Evidence',
    pattern.evidenceItems.map((item) => `- ${toWikiLink(item)}`),
    '- _No evidence links recorded yet._',
  ))
  lines.push(...renderMarkdownSection('My Notes', manualNotes, '-'))
  return lines.join('\n')
}

function renderSynthesisMarkdown(record, evidenceByPath = new Map(), existingMarkdown = '') {
  const manualNotes = extractManualNotes(existingMarkdown)
  const evidenceItems = dedupeList(Array.isArray(record.evidenceItems) ? record.evidenceItems : [], 12)
    .map((item) => normalizeVaultRelativePath(item))
    .filter(Boolean)
  const evidenceDigests = evidenceItems.map((item) => evidenceByPath.get(item)).filter(Boolean)
  const title = String(record.title || buildPromotionQueueTitle(evidenceDigests[0]?.firstUserIntent || '', 'Synthesis')).trim()
  const question = String(record.question || evidenceDigests[0]?.firstUserIntent || '').trim()
  const project = String(record.project || pickDominantProject(evidenceDigests.map((item) => item?.project || '')) || '').trim()
  const summary = String(record.summary || buildPromotionQueueExcerpt(evidenceDigests[0]?.bestAssistantAnswer || evidenceDigests[0]?.latestAssistantReply || question, '待补充结论')).trim()
  const openQuestions = extractMarkdownSection(existingMarkdown, 'Open Questions')
    || extractMarkdownSection(existingMarkdown, 'Follow-up Questions')
    || `- ${escapeMarkdownText(question || '这个结论还缺少哪些补证？')}`
  const supportingPoints = dedupeList([
    ...evidenceDigests.map((item) => buildPromotionQueueExcerpt(item?.bestAssistantAnswer || item?.latestAssistantReply || '', '')),
    ...evidenceDigests.map((item) => buildPromotionQueueExcerpt(item?.firstUserIntent || '', '')),
  ].filter(Boolean), 4)
  const reasoningPoints = dedupeList([
    project ? `当前结论主要落在 ${project} 这条工作线上。` : '',
    evidenceItems.length >= 2 ? `已有 ${evidenceItems.length} 条 source evidence 指向相近问题，可以先沉淀为长期答案页。` : '目前主要来自单条 source evidence，后续需要继续补证。',
    ...evidenceDigests
      .map((item) => buildPromotionQueueExcerpt(item?.bestAssistantAnswer || item?.latestAssistantReply || '', ''))
      .filter((item) => String(item || '').length >= 48),
  ], 4)
  const uncertaintyPoints = dedupeList([
    evidenceItems.length < 2 ? '还缺少更多独立来源来验证这个结论是否稳定。' : '不同上下文下的适用边界仍需要继续补证。',
    !project ? '项目归属还不够稳定，后续可以再补项目入口页与交叉链接。' : '',
  ].filter(Boolean), 3)

  const lines = [
    ...buildMarkdownFrontmatter({
      title,
      type: 'synthesis-note',
      schemaVersion: READER_PAGE_SCHEMA_VERSION,
      question,
      project,
      status: 'active',
      evidenceCount: evidenceItems.length,
      updatedAt: record.updatedAt || record.approvedAt || new Date().toISOString(),
      promotionState: 'approved',
      approvedAt: record.approvedAt || '',
    }),
    `# ${escapeMarkdownText(title)}`,
    '',
    '> [!summary] Main Conclusion',
    `> ${escapeMarkdownText(summary || '待补充结论。')}`,
    '',
    '## Short Answer',
    '',
    summary ? escapeMarkdownText(summary) : '待补充结论。',
    '',
  ]

  lines.push(...renderConceptBulletSection('Main Decisions Or Claims', supportingPoints, '_待补充更稳定的结论要点。_'))
  lines.push(...renderConceptBulletSection('Why This Conclusion Holds', reasoningPoints, '_当前主要基于 source evidence 的初步归纳。_'))
  lines.push(...renderConceptBulletSection('Counterpoints Or Uncertainty', uncertaintyPoints, '_暂无。_'))
  lines.push(...renderMarkdownSection(
    'Evidence',
    evidenceItems.map((item) => `- ${toWikiLink(item)}`),
    '- _No evidence links recorded yet._',
  ))
  lines.push(...renderMarkdownSection('Open Questions', openQuestions, '-'))
  lines.push(...renderMarkdownSection('My Notes', manualNotes, '-'))
  return lines.join('\n')
}

function createMarkdownDiff(relativePath = '', previousMarkdown = '', nextMarkdown = '') {
  if (String(previousMarkdown || '') === String(nextMarkdown || '')) return ''
  return createTwoFilesPatch(
    relativePath || 'before.md',
    relativePath || 'after.md',
    String(previousMarkdown || ''),
    String(nextMarkdown || ''),
    'before',
    'after',
    { context: 3 },
  )
}

function analyzePromotionPreviewChange(previousMarkdown = '', nextMarkdown = '') {
  const previousFrontmatter = parseMarkdownFrontmatterMap(previousMarkdown)
  const nextFrontmatter = parseMarkdownFrontmatterMap(nextMarkdown)
  const previousBody = normalizeText(stripFrontmatter(previousMarkdown))
  const nextBody = normalizeText(stripFrontmatter(nextMarkdown))
  const frontmatterKeys = Array.from(new Set([
    ...Object.keys(previousFrontmatter),
    ...Object.keys(nextFrontmatter),
  ]))
  const frontmatterChanges = frontmatterKeys
    .map((field) => ({
      field,
      before: String(previousFrontmatter[field] || ''),
      after: String(nextFrontmatter[field] || ''),
    }))
    .filter((item) => item.before !== item.after)

  const lightweightFields = new Set(['status', 'promotionState', 'approvedAt', 'updatedAt', 'schemaVersion'])
  const onlyLightweightFrontmatter = (
    frontmatterChanges.length > 0
    && frontmatterChanges.every((item) => lightweightFields.has(item.field))
  )
  const bodyChanged = previousBody !== nextBody

  if (!previousMarkdown.trim()) {
    return {
      category: 'create',
      bodyChanged: true,
      frontmatterChanges,
    }
  }

  if (!bodyChanged && onlyLightweightFrontmatter) {
    return {
      category: 'lightweight-confirmation',
      bodyChanged: false,
      frontmatterChanges,
    }
  }

  return {
    category: 'content-update',
    bodyChanged,
    frontmatterChanges,
  }
}

export async function buildPromotionCandidatePreview(payload = {}) {
  const kind = String(payload?.kind || '').trim()
  if (!['issue-review', 'pattern-candidate', 'synthesis-candidate'].includes(kind)) {
    throw new Error('Unsupported promotion kind')
  }

  const now = new Date().toISOString()
  const title = String(payload?.title || '').trim()
  const project = String(payload?.project || '').trim()
  const summary = String(payload?.summary || '').trim()
  const evidenceItems = dedupeList(Array.isArray(payload?.evidenceItems) ? payload.evidenceItems : [], 12)
    .map((item) => normalizeVaultRelativePath(item))
    .filter(Boolean)
  const { allEvidences: sourceEvidences } = await loadPromotionQueueEvidences({ writeEvidence: true })
  const state = await loadPromotionState()
  const previewState = normalizePromotionState(JSON.parse(JSON.stringify(state)))
  const conceptCatalog = buildConceptCatalogFromEntries(sourceEvidences)
  const paths = await ensureVaultScaffold()

  let relativePath = ''
  let generatedMarkdown = ''
  let previewTitle = title
  let evidenceCount = evidenceItems.length
  let protectedSections = ['My Notes']

  if (kind === 'issue-review') {
    const currentPath = normalizeVaultRelativePath(payload?.currentPath || '')
    const issueSlug = toFileSlug(path.posix.basename(currentPath || title, '.md') || title, 'issue')
    relativePath = currentPath || buildIssueRelativePath(issueSlug)
    previewState.issues[issueSlug] = {
      slug: issueSlug,
      title: title || issueSlug,
      currentPath: relativePath,
      project,
      summary,
      evidenceItems,
      approvedAt: previewState.issues[issueSlug]?.approvedAt || now,
      updatedAt: now,
    }
    const issues = collectIssueArtifacts(sourceEvidences, {
      conceptCatalog,
    })
    const issue = issues.find((item) => String(item?.slug || '') === issueSlug)
    if (!issue) throw new Error('未找到可预览的 issue note')
    previewTitle = issue.title
    evidenceCount = Number(issue.evidenceCount || 0)
    const existingMarkdown = await readFile(path.join(paths.root, relativePath), 'utf-8').catch(() => '')
    generatedMarkdown = renderIssueMarkdown(issue, existingMarkdown, previewState.issues[issueSlug] || null)
    const analysis = analyzePromotionPreviewChange(existingMarkdown, generatedMarkdown)
    const diff = createMarkdownDiff(relativePath, existingMarkdown, generatedMarkdown)
    return {
      ok: true,
      kind,
      relativePath,
      title: previewTitle,
      question: '',
      summary,
      mode: existingMarkdown.trim() ? 'update' : 'create',
      category: analysis.category,
      bodyChanged: analysis.bodyChanged,
      evidenceCount,
      frontmatterChanges: analysis.frontmatterChanges,
      protectedSections: protectedSections.map((heading) => ({
        heading,
        content: extractProtectedMarkdownSection(existingMarkdown, heading, '-'),
      })),
      diff,
      generatedMarkdown,
    }
  }

  if (kind === 'pattern-candidate') {
    const targetPath = normalizeVaultRelativePath(payload?.targetPath || '')
    const patternSlug = toFileSlug(path.posix.basename(targetPath || title, '.md') || title, 'pattern')
    relativePath = targetPath || buildPatternRelativePath(patternSlug)
    previewState.patterns[patternSlug] = {
      slug: patternSlug,
      title: title || patternSlug,
      targetPath: relativePath,
      project,
      summary,
      evidenceItems,
      approvedAt: previewState.patterns[patternSlug]?.approvedAt || now,
      updatedAt: now,
    }
    const issues = collectIssueArtifacts(sourceEvidences, {
      conceptCatalog,
    })
    const patterns = collectPatternArtifacts(sourceEvidences, {
      issues,
      promotionState: previewState,
      conceptCatalog,
    })
    const pattern = patterns.find((item) => String(item?.slug || '') === patternSlug)
    if (!pattern) throw new Error('未找到可预览的 pattern note')
    previewTitle = pattern.title
    evidenceCount = Number(pattern.evidenceCount || 0)
    const existingMarkdown = await readFile(path.join(paths.root, relativePath), 'utf-8').catch(() => '')
    generatedMarkdown = renderPatternMarkdown(pattern, existingMarkdown, previewState.patterns[patternSlug] || null)
    const analysis = analyzePromotionPreviewChange(existingMarkdown, generatedMarkdown)
    const diff = createMarkdownDiff(relativePath, existingMarkdown, generatedMarkdown)
    return {
      ok: true,
      kind,
      relativePath,
      title: previewTitle,
      question: '',
      summary,
      mode: existingMarkdown.trim() ? 'update' : 'create',
      category: analysis.category,
      bodyChanged: analysis.bodyChanged,
      evidenceCount,
      frontmatterChanges: analysis.frontmatterChanges,
      protectedSections: protectedSections.map((heading) => ({
        heading,
        content: extractProtectedMarkdownSection(existingMarkdown, heading, '-'),
      })),
      diff,
      generatedMarkdown,
    }
  }

  const targetPath = normalizeVaultRelativePath(payload?.targetPath || '')
    || `syntheses/${toFileSlug(title || 'synthesis', 'synthesis')}.md`
  relativePath = targetPath
  previewState.syntheses[targetPath] = {
    targetPath,
    title: title || path.posix.basename(targetPath, '.md'),
    question: String(payload?.question || '').trim(),
    project,
    summary,
    evidenceItems,
    approvedAt: previewState.syntheses[targetPath]?.approvedAt || now,
    updatedAt: now,
  }
  const existingMarkdown = await readFile(path.join(paths.root, relativePath), 'utf-8').catch(() => '')
  protectedSections = ['Open Questions', 'My Notes']
  generatedMarkdown = renderSynthesisMarkdown(
    previewState.syntheses[targetPath],
    new Map(sourceEvidences.map((item) => [String(item?.relativePath || ''), item])),
    existingMarkdown,
  )
  const analysis = analyzePromotionPreviewChange(existingMarkdown, generatedMarkdown)
  const diff = createMarkdownDiff(relativePath, existingMarkdown, generatedMarkdown)
  return {
    ok: true,
    kind,
    relativePath,
    title: previewState.syntheses[targetPath].title,
    question: previewState.syntheses[targetPath].question || '',
    summary: previewState.syntheses[targetPath].summary || '',
    mode: existingMarkdown.trim() ? 'update' : 'create',
    category: analysis.category,
    bodyChanged: analysis.bodyChanged,
    evidenceCount,
    frontmatterChanges: analysis.frontmatterChanges,
    protectedSections: protectedSections.map((heading) => ({
      heading,
      content: extractProtectedMarkdownSection(existingMarkdown, heading, '-'),
    })),
    diff,
    generatedMarkdown,
  }
}

function extractJsonCandidate(rawText) {
  const text = String(rawText || '').trim()
  if (!text) return ''
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) return text

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fencedMatch?.[1]) return fencedMatch[1].trim()

  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) return text.slice(firstBrace, lastBrace + 1)
  return ''
}

function parseConceptSummaryResponse(rawText) {
  const candidate = extractJsonCandidate(rawText)
  if (candidate) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
          summary: normalizeText(parsed.summary || parsed.overview || rawText),
          takeaways: Array.isArray(parsed.takeaways) ? parsed.takeaways.map((item) => clipText(item, 220)).filter(Boolean) : [],
          openQuestions: Array.isArray(parsed.open_questions || parsed.openQuestions)
            ? (parsed.open_questions || parsed.openQuestions).map((item) => clipText(item, 220)).filter(Boolean)
            : [],
          sourcePatterns: Array.isArray(parsed.source_patterns || parsed.sourcePatterns)
            ? (parsed.source_patterns || parsed.sourcePatterns).map((item) => clipText(item, 220)).filter(Boolean)
            : [],
        }
      }
    } catch {
      // ignore and fall back to raw text
    }
  }

  return {
    summary: clipText(rawText, 500),
    takeaways: [],
    openQuestions: [],
    sourcePatterns: [],
  }
}

function buildFallbackConceptSummary(concept, entryDigests = []) {
  const providerNames = [...new Set(entryDigests.map((item) => item.provider).filter(Boolean))]
  const firstUserIntents = entryDigests
    .map((item) => item.firstUserIntent)
    .filter(Boolean)
    .slice(0, 3)
  const titles = entryDigests
    .map((item) => item.title)
    .filter(Boolean)
    .slice(0, 3)

  const summary = entryDigests.length <= 1
    ? `${concept.label} 当前主要来自单条来源，已经作为可追溯入口页保留，后续随着更多相关材料进入再做更强的跨来源汇总。`
    : `${concept.label} 当前覆盖 ${entryDigests.length} 条来源，分布在 ${providerNames.length || 1} 个 provider 上。该页面先用规则摘要兜底，等模型可用时会升级为更完整的跨来源总结。`

  const takeaways = [
    titles.length ? `关联来源主要包括：${titles.join('、')}` : '',
    firstUserIntents.length ? `高频关注点集中在：${firstUserIntents.join('；')}` : '',
  ].filter(Boolean)

  return {
    mode: 'fallback',
    summary,
    takeaways,
    openQuestions: entryDigests.length <= 1 ? ['还缺少更多来源，暂时难以判断这一主题的稳定共识。'] : [],
    sourcePatterns: providerNames.length ? [`涉及 provider：${providerNames.join('、')}`] : [],
    model: '',
    generatedAt: new Date().toISOString(),
  }
}

async function loadConceptSummaryConfig() {
  try {
    const settings = await loadModelSettingsInDb()
    const assistant = settings?.assistant || {}
    if (!assistant.apiKey || !assistant.apiBase || !assistant.model) return null
    return {
      model: assistant.model,
      apiBase: assistant.apiBase,
      apiKey: assistant.apiKey,
      timeoutMs: Math.max(15000, Number(assistant.timeoutMs || 60000)),
    }
  } catch {
    return null
  }
}

function buildConceptSummaryMessages(concept, entryDigests = []) {
  const evidenceLines = entryDigests
    .slice(0, 8)
    .map((item, index) => [
      `${index + 1}. 标题: ${item.title || 'Untitled'}`,
      `   Provider: ${item.provider || 'unknown'}`,
      `   更新时间: ${item.updatedAt ? formatIsoLocal(item.updatedAt) : 'unknown'}`,
      `   消息数: ${item.messageCount || 0}`,
      item.firstUserIntent ? `   用户意图: ${item.firstUserIntent}` : '',
      item.latestAssistantReply ? `   最近回答: ${item.latestAssistantReply}` : '',
      item.mentionedFiles ? `   相关文件: ${item.mentionedFiles}` : '',
      item.manualNotes ? `   人工备注: ${item.manualNotes}` : '',
    ].filter(Boolean).join('\n'))
    .join('\n\n')

  return [
    {
      role: 'system',
      content:
        '你在维护一个长期积累的 Obsidian 知识 wiki。请基于给定来源，为某个 concept 生成严格可追溯、克制的中文总结。不要编造来源中没有的事实；如果证据不足，要明确指出。只输出 JSON，不要输出 Markdown。JSON 结构为 {"summary": string, "takeaways": string[], "open_questions": string[], "source_patterns": string[]}。',
    },
    {
      role: 'user',
      content: [
        `Concept: ${concept.label} (${concept.slug})`,
        `Source count: ${entryDigests.length}`,
        '',
        '请做一份适合写入 wiki concept 页的总结：',
        '- summary: 2 到 4 句，强调这个主题目前在这些来源里到底讨论了什么。',
        '- takeaways: 3 到 5 条关键结论，必须尽量贴近来源。',
        '- open_questions: 0 到 3 条尚不确定、还需要更多证据的问题。',
        '- source_patterns: 0 到 3 条关于来源分布/讨论侧重点的观察。',
        '',
        '来源证据如下：',
        evidenceLines || '暂无证据。',
      ].join('\n'),
    },
  ]
}

async function summarizeConceptWithModel(concept, entryDigests = [], summaryConfig) {
  if (!summaryConfig || entryDigests.length < 2) {
    return buildFallbackConceptSummary(concept, entryDigests)
  }

  try {
    const result = await askModel({
      messages: buildConceptSummaryMessages(concept, entryDigests),
      model: summaryConfig.model,
      apiBase: summaryConfig.apiBase,
      apiKey: summaryConfig.apiKey,
      timeoutMs: summaryConfig.timeoutMs,
      temperature: 0.1,
      topP: 1,
      maxTokens: 1200,
    })

    const parsed = parseConceptSummaryResponse(result?.answer || '')
    return {
      mode: 'llm',
      summary: parsed.summary || buildFallbackConceptSummary(concept, entryDigests).summary,
      takeaways: parsed.takeaways,
      openQuestions: parsed.openQuestions,
      sourcePatterns: parsed.sourcePatterns,
      model: String(result?.model || summaryConfig.model || ''),
      generatedAt: new Date().toISOString(),
    }
  } catch (error) {
    const fallback = buildFallbackConceptSummary(concept, entryDigests)
    return {
      ...fallback,
      mode: 'fallback',
      sourcePatterns: [
        ...fallback.sourcePatterns,
        `LLM summary unavailable: ${clipText(error?.message || error || 'unknown error', 180)}`,
      ].filter(Boolean),
    }
  }
}

function renderConceptBulletSection(title, items = [], emptyText = '_No items yet._') {
  const lines = [`## ${title}`, '']
  if (!Array.isArray(items) || !items.length) {
    lines.push(emptyText)
    lines.push('')
    return lines
  }
  for (const item of items) lines.push(`- ${escapeMarkdownText(item)}`)
  lines.push('')
  return lines
}

function renderSessionMarkdown(session, manualNotes = '-', maxMessages = 40, conceptsOverride = null) {
  const summary = buildSessionSummary(session)
  const sourceTags = Array.isArray(session?.tags) ? session.tags.map((item) => clipText(item, 60)).filter(Boolean) : []
  const messages = Array.isArray(session?.messages) ? session.messages : []
  const provider = String(session?.provider || 'unknown') || 'unknown'
  const providerPath = buildProviderRelativePath(provider)
  const concepts = Array.isArray(conceptsOverride) ? conceptsOverride : extractSessionConcepts(session)
  const tags = [
    'source/session',
    `provider/${toFileSlug(provider, 'unknown')}`,
    ...sourceTags,
  ]
  const lines = [
    '---',
    `title: "${escapeYamlString(session?.title || 'Untitled Session')}"`,
    `aliases: ["${escapeYamlString(session?.title || 'Untitled Session')}"]`,
    'type: "source-session"',
    `sessionId: "${escapeYamlString(session?.id || '')}"`,
    `provider: "${escapeYamlString(provider)}"`,
    `sourceId: "${escapeYamlString(session?.sourceId || '')}"`,
    `updatedAt: "${escapeYamlString(session?.updatedAt || '')}"`,
    `messageCount: ${messages.length}`,
    'tags:',
  ]

  if (tags.length) {
    for (const tag of tags) lines.push(`  - "${escapeYamlString(tag)}"`)
  } else {
    lines.push('  - "session"')
  }

  lines.push('concepts:')
  if (concepts.length) {
    for (const concept of concepts) lines.push(`  - "${escapeYamlString(conceptToFrontmatterValue(concept))}"`)
  }

  lines.push('---')
  lines.push('')
  lines.push(`# ${escapeMarkdownText(session?.title || 'Untitled Session')}`)
  lines.push('')
  lines.push('> [!info] Generated Note')
  lines.push('> Generated by myLocalRAG for the Obsidian + Syncthing MVP. The `## My Notes` section is preserved across republishes.')
  lines.push('')
  lines.push('## Navigation')
  lines.push('')
  lines.push(`- Home: ${toWikiLink('Home.md', 'Home')}`)
  lines.push(`- Index: ${toWikiLink('index.md', 'Vault Index')}`)
  lines.push(`- Provider Hub: ${toWikiLink(providerPath, provider)}`)
  lines.push(`- Publish Log: ${toWikiLink('log.md', 'Log')}`)
  lines.push('')
  lines.push('## Related Concepts')
  lines.push('')
  if (concepts.length) lines.push(`- ${concepts.map((concept) => toWikiLink(buildConceptRelativePath(concept), concept.label)).join(' · ')}`)
  else lines.push('- _No concept links yet._')
  lines.push('')
  lines.push('## Snapshot')
  lines.push('')
  lines.push(`- Provider: ${toWikiLink(providerPath, provider)}`)
  lines.push(`- Session ID: \`${session?.id || ''}\``)
  lines.push(`- Updated: ${session?.updatedAt ? `\`${formatIsoLocal(session.updatedAt)}\`` : 'unknown'}`)
  lines.push(`- Message count: \`${messages.length}\``)
  lines.push(`- Role breakdown: user \`${summary.roles.user}\`, assistant \`${summary.roles.assistant}\`, other \`${summary.roles.other}\``)
  if (summary.files.length) lines.push(`- Mentioned files: ${summary.files.map((item) => `\`${item}\``).join(', ')}`)
  lines.push('')
  lines.push('## My Notes')
  lines.push('')
  lines.push(manualNotes || '-')
  lines.push('')
  lines.push('## Extracted Signals')
  lines.push('')
  lines.push(`- First user intent: ${summary.firstUser || 'n/a'}`)
  lines.push(`- Latest assistant reply: ${summary.lastAssistant || 'n/a'}`)
  lines.push('')
  lines.push('## Conversation')
  lines.push('')
  lines.push(renderConversation(messages, maxMessages))
  lines.push('')

  return lines.join('\n')
}

export async function publishSessionsToVault(sessions = [], options = {}) {
  const paths = await ensureVaultScaffold()
  const list = Array.isArray(sessions) ? sessions.filter(Boolean) : []
  const conceptCatalog = buildPublishedConceptCatalog(list)
  const published = []
  const maxMessages = Math.max(10, Number(options.maxMessages || 40))
  const conceptSummaryMode = String(options.conceptSummaryMode || 'llm')
  const sourceFiles = await readdir(paths.sourcesDir, { withFileTypes: true }).catch(() => [])
  const existingBySessionId = new Map()
  const expectedFileNames = new Set()

  for (const item of sourceFiles) {
    if (!item.isFile() || !item.name.endsWith('.md')) continue
    const filePath = path.join(paths.sourcesDir, item.name)
    const meta = parseGeneratedMeta(await readFile(filePath, 'utf-8').catch(() => ''), `sources/${item.name}`)
    if (!meta?.sessionId) continue
    existingBySessionId.set(meta.sessionId, item.name)
  }

  for (const session of list) {
    const fileName = buildSessionFileName(session)
    expectedFileNames.add(fileName)
    const relativePath = `sources/${fileName}`
    const filePath = path.join(paths.sourcesDir, fileName)
    const existingName = existingBySessionId.get(String(session?.id || '').trim())
    if (existingName && existingName !== fileName) {
      await unlink(path.join(paths.sourcesDir, existingName)).catch(() => {})
    }
    const existingMarkdownResult = await readExistingMarkdownWithTemplateSeed(relativePath, filePath, 'Source Conversation')
    const manualNotes = extractManualNotes(existingMarkdownResult.markdown)

    const markdown = renderSessionMarkdown(session, manualNotes, maxMessages, getPublishedConceptsForSession(session, conceptCatalog))
    await writeFile(filePath, markdown, 'utf-8')

    const publishedItem = {
      title: String(session?.title || 'Untitled Session'),
      provider: String(session?.provider || ''),
      sessionId: String(session?.id || ''),
      messageCount: Array.isArray(session?.messages) ? session.messages.length : 0,
      updatedAt: String(session?.updatedAt || ''),
      fileName,
      relativePath,
    }
    published.push(publishedItem)
    if (typeof options.onSessionPublished === 'function') {
      await options.onSessionPublished({
        processed: published.length,
        total: list.length,
        item: publishedItem,
      })
    }
  }

  if (options.pruneMissingSources) {
    for (const item of sourceFiles) {
      if (!item.isFile() || !item.name.endsWith('.md')) continue
      if (item.name === 'README.md') continue
      if (expectedFileNames.has(item.name)) continue
      await unlink(path.join(paths.sourcesDir, item.name)).catch(() => {})
    }
  }

  const propertySync = await syncPublishedSessionPropertiesWithObsidian(published)
  const indexResult = await rebuildVaultIndex({
    conceptSummaryMode,
    onConceptProgress: options.onConceptProgress,
  })
  await appendVaultLog({
    action: 'publish-sessions',
    published,
  })
  const obsidianPostPublish = await runObsidianPostPublishRefresh('index.md')

  return {
    vaultDir: paths.root,
    published,
    conceptStats: indexResult.conceptStats || null,
    issueStats: indexResult.issueStats || null,
    patternStats: indexResult.patternStats || null,
    projectStats: indexResult.projectStats || null,
    synthesisStats: indexResult.synthesisStats || null,
    promotionStats: indexResult.promotionStats || null,
    lintStats: indexResult.lintStats || null,
    propertySync,
    obsidianPostPublish,
  }
}

export async function rebuildVaultIndex(options = {}) {
  const paths = await ensureVaultScaffold()
  const entries = []
  const files = await readdir(paths.sourcesDir, { withFileTypes: true })

  for (const item of files) {
    if (!item.isFile() || !item.name.endsWith('.md')) continue
    const filePath = path.join(paths.sourcesDir, item.name)
    const meta = parseGeneratedMeta(await readFile(filePath, 'utf-8'), `sources/${item.name}`)
    if (!meta) continue
    entries.push(meta)
  }

  entries.sort((a, b) => +new Date(b.updatedAt || 0) - +new Date(a.updatedAt || 0))
  const sourceEvidences = await buildSourceEntryEvidenceList(entries)
  const knowledgeEvidences = await loadKnowledgePromotionEvidences({
    writeEvidence: options.writeKnowledgeEvidence !== false,
  })
  const promotionState = await loadPromotionState()
  const approvedKnowledgeEvidences = filterApprovedKnowledgeEvidences(knowledgeEvidences, promotionState)
  const readerFirstEvidences = [...sourceEvidences, ...approvedKnowledgeEvidences]
  const providerEntries = [...entries, ...approvedKnowledgeEvidences]
  await rebuildProviderPages(providerEntries)
  const conceptEntries = readerFirstEvidences
  const conceptCatalog = buildConceptCatalogFromEntries(conceptEntries)
  const issueStats = await rebuildIssuePages(readerFirstEvidences, {
    conceptCatalog,
  })
  const patternStats = await rebuildPatternPages(readerFirstEvidences, {
    issues: issueStats.issues,
    conceptCatalog,
  })
  const projectStats = await rebuildProjectPages(readerFirstEvidences, {
    issues: issueStats.issues,
    patterns: patternStats.patterns,
    conceptCatalog,
  })
  const synthesisStats = await rebuildSynthesisPages(readerFirstEvidences)

  const providerGroups = groupByProvider(providerEntries)
  const providerNames = Array.from(providerGroups.keys()).sort((a, b) => a.localeCompare(b))
  const conceptStats = await rebuildConceptPages(conceptEntries, {
    summaryMode: options.conceptSummaryMode || 'llm',
    onProgress: options.onConceptProgress,
  })
  const conceptGroups = groupByConcept(conceptEntries)
  const publishedConceptGroups = new Map(
    Array.from(conceptGroups.entries()).filter(([slug]) => conceptCatalog.has(slug)),
  )
  const conceptCount = publishedConceptGroups.size

  const lines = [
    '# Vault Index',
    '',
    'This file is regenerated by myLocalRAG when session pages are published.',
    '',
    '## Dashboard',
    '',
    `- Total published sessions: \`${entries.length}\``,
    `- Providers: \`${providerNames.length}\``,
    `- Projects: \`${Number(projectStats?.totalProjects || 0)}\``,
    `- Patterns: \`${Number(patternStats?.totalPatterns || 0)}\``,
    `- Issues: \`${Number(issueStats?.totalIssues || 0)}\``,
    `- Syntheses: \`${Number(synthesisStats?.totalSyntheses || 0)}\``,
    `- Concepts: \`${conceptCount}\``,
    `- Home: ${toWikiLink('Home.md', 'Home')}`,
    `- Projects: ${toWikiLink('projects/README.md', 'Project Hubs')}`,
    `- Patterns: ${toWikiLink('patterns/README.md', 'Pattern Pages')}`,
    `- Issues: ${toWikiLink('issues/README.md', 'Issue Pages')}`,
    `- Syntheses: ${toWikiLink('syntheses/README.md', 'Synthesis Pages')}`,
    `- Providers: ${toWikiLink('providers/README.md', 'Provider Hubs')}`,
    `- Concepts: ${toWikiLink('concepts/README.md', 'Concept Pages')}`,
    '',
    '## Sessions',
    '',
  ]

  if (!entries.length) {
    lines.push('_No published session pages yet._')
    lines.push('')
  } else {
    for (const entry of entries) {
      const updated = entry.updatedAt ? formatIsoLocal(entry.updatedAt) : 'unknown'
      lines.push(`- [${escapeMarkdownText(entry.title)}](${entry.relativePath}) — \`${entry.provider || 'unknown'}\` · ${updated} · ${entry.messageCount || 0} messages`)
    }
    lines.push('')
  }

  lines.push('## Providers')
  lines.push('')
  if (!providerNames.length) {
    lines.push('_No provider hubs yet._')
    lines.push('')
  } else {
    for (const provider of providerNames) {
      const items = providerGroups.get(provider) || []
      lines.push(`- ${toWikiLink(buildProviderRelativePath(provider), provider)} — \`${items.length}\` sessions`)
    }
    lines.push('')
  }

  lines.push('## Projects')
  lines.push('')
  if (!Array.isArray(projectStats?.projects) || !projectStats.projects.length) {
    lines.push('_No project hubs yet._')
    lines.push('')
  } else {
    for (const project of projectStats.projects.slice(0, 20)) {
      lines.push(`- ${toWikiLink(buildProjectRelativePath(project.key), project.label)} — \`${project.evidenceCount}\` evidence notes`)
    }
    lines.push('')
  }

  lines.push('## Patterns')
  lines.push('')
  if (!Array.isArray(patternStats?.patterns) || !patternStats.patterns.length) {
    lines.push('_No pattern pages yet._')
    lines.push('')
  } else {
    for (const pattern of patternStats.patterns.slice(0, 20)) {
      lines.push(`- ${toWikiLink(buildPatternRelativePath(pattern.slug), pattern.title)} — \`${pattern.evidenceCount}\` evidence notes`)
    }
    lines.push('')
  }

  lines.push('## Issues')
  lines.push('')
  if (!Array.isArray(issueStats?.issues) || !issueStats.issues.length) {
    lines.push('_No issue pages yet._')
    lines.push('')
  } else {
    for (const issue of issueStats.issues.slice(0, 20)) {
      lines.push(`- ${toWikiLink(buildIssueRelativePath(issue.slug), issue.title)} — \`${issue.evidenceCount}\` evidence notes`)
    }
    lines.push('')
  }

  lines.push('## Concepts')
  lines.push('')
  if (!conceptCount) {
    lines.push('_No concept pages yet._')
    lines.push('')
  } else {
    const concepts = Array.from(publishedConceptGroups.values())
      .sort((a, b) => b.entries.length - a.entries.length || a.concept.label.localeCompare(b.concept.label))
      .slice(0, 20)
    for (const item of concepts) {
      lines.push(`- ${toWikiLink(buildConceptRelativePath(item.concept), item.concept.label)} — \`${item.entries.length}\` sessions`)
    }
    lines.push('')
  }

  lines.push('## Syntheses')
  lines.push('')
  if (!Array.isArray(synthesisStats?.syntheses) || !synthesisStats.syntheses.length) {
    lines.push('_No synthesis pages yet._')
    lines.push('')
  } else {
    for (const synthesis of synthesisStats.syntheses.slice(0, 20)) {
      lines.push(`- ${toWikiLink(synthesis.targetPath, synthesis.title || path.basename(synthesis.targetPath || '', '.md'))}`)
    }
    lines.push('')
  }

  lines.push('## Try In Obsidian')
  lines.push('')
  lines.push('- Open any session note, then view backlinks in the right sidebar.')
  lines.push('- Open graph view to see how source notes connect through provider hubs.')
  lines.push('- Keep [[Home]] and [[index]] pinned as your main map-of-content notes.')
  lines.push('')
  lines.push('## Spaces')
  lines.push('')
  lines.push(`- ${toWikiLink('projects/README.md', 'Projects')}`)
  lines.push(`- ${toWikiLink('patterns/README.md', 'Patterns')}`)
  lines.push(`- ${toWikiLink('issues/README.md', 'Issues')}`)
  lines.push(`- ${toWikiLink('syntheses/README.md', 'Syntheses')}`)
  lines.push(`- ${toWikiLink('sources/README.md', 'Sources')}`)
  lines.push(`- ${toWikiLink('providers/README.md', 'Providers')}`)
  lines.push(`- ${toWikiLink('concepts/README.md', 'Concepts')}`)
  lines.push(`- ${toWikiLink('entities/README.md', 'Entities')}`)
  lines.push(`- ${toWikiLink('log.md', 'Log')}`)
  lines.push('')

  await writeFile(paths.index, lines.join('\n'), 'utf-8')
  const promotionStats = await buildPromotionQueue({
    sourceEvidences,
    knowledgeEvidences,
    issues: issueStats?.issues || [],
    patterns: patternStats?.patterns || [],
    writeReport: options.writePromotionQueue !== false,
  })
  const lintStats = await lintWikiVault({
    writeReport: options.writeLintReport !== false,
  })
  return {
    vaultDir: paths.root,
    entries,
    conceptStats,
    issueStats,
    patternStats,
    projectStats,
    synthesisStats,
    promotionStats,
    lintStats,
  }
}

export async function rebuildProviderPages(entries = []) {
  const paths = await ensureVaultScaffold()
  const providerGroups = groupByProvider(entries)
  const providerNames = Array.from(providerGroups.keys()).sort((a, b) => a.localeCompare(b))
  const existingFiles = await readdir(paths.providersDir, { withFileTypes: true }).catch(() => [])
  const expected = new Set(['README.md', ...providerNames.map((item) => `${toFileSlug(item || 'unknown', 'unknown')}.md`)])
  for (const item of existingFiles) {
    if (!item.isFile()) continue
    if (expected.has(item.name)) continue
    await unlink(path.join(paths.providersDir, item.name)).catch(() => {})
  }

  const readmeLines = [
    '# Providers',
    '',
    'Provider hub pages group session notes by source provider. These pages are useful entry points for backlinks and graph view.',
    '',
  ]

  if (!providerNames.length) {
    readmeLines.push('_No provider hubs yet._')
    readmeLines.push('')
  } else {
    for (const provider of providerNames) {
      readmeLines.push(`- ${toWikiLink(buildProviderRelativePath(provider), provider)}`)
    }
    readmeLines.push('')
  }

  await writeFile(paths.providersReadme, readmeLines.join('\n'), 'utf-8')

  for (const provider of providerNames) {
    const relativePath = buildProviderRelativePath(provider)
    const filePath = path.join(paths.root, relativePath)
    const items = (providerGroups.get(provider) || []).slice().sort((a, b) => +new Date(b.updatedAt || 0) - +new Date(a.updatedAt || 0))
    const lines = [
      '---',
      `title: "${escapeYamlString(provider)}"`,
      'type: "provider-hub"',
      `provider: "${escapeYamlString(provider)}"`,
      `sessionCount: ${items.length}`,
      '---',
      '',
      `# ${escapeMarkdownText(provider)}`,
      '',
      '> [!tip] Provider Hub',
      '> Use this page as a stable entry point for backlinks, graph view, and browsing all sessions from one provider.',
      '',
      '## Navigation',
      '',
      `- ${toWikiLink('Home.md', 'Home')}`,
      `- ${toWikiLink('index.md', 'Vault Index')}`,
      `- ${toWikiLink('providers/README.md', 'All Providers')}`,
      '',
      '## Sessions',
      '',
    ]

    if (!items.length) {
      lines.push('_No sessions published yet._')
      lines.push('')
    } else {
      for (const item of items) {
        const updated = item.updatedAt ? formatIsoLocal(item.updatedAt) : 'unknown'
        lines.push(`- ${toWikiLink(item.relativePath, item.title)} — ${updated} · ${item.messageCount || 0} messages`)
      }
      lines.push('')
    }

    await writeFile(filePath, lines.join('\n'), 'utf-8')
  }
}

export async function rebuildIssuePages(sourceEvidences = [], options = {}) {
  const paths = await ensureVaultScaffold()
  const promotionState = await loadPromotionState()
  const conceptCatalog = options.conceptCatalog instanceof Map ? options.conceptCatalog : null
  const dismissedIssueSlugs = new Set(
    Object.entries(promotionState.issues || {})
      .filter(([, record]) => isDismissedPromotionRecord(record))
      .map(([slug]) => String(slug || '').trim())
      .filter(Boolean),
  )
  const candidates = (Array.isArray(sourceEvidences) ? sourceEvidences : [])
    .map((item) => buildIssueCandidate(item))
    .filter((item) => item && Number(item.confidence || 0) >= 0.55)
  const grouped = groupIssueCandidates(candidates)
  const issues = Array.from(grouped.values())
    .map((group) => {
      const allCandidates = Array.isArray(group.candidates) ? group.candidates : []
      const symptoms = dedupeList(allCandidates.map((item) => item.symptom), 5)
      const causes = dedupeList(
        allCandidates
          .flatMap((item) => item.causes || [])
          .map((item) => cleanIssueEvidenceLine(item))
          .filter((item) => !isWeakIssueEvidenceLine(item)),
        6,
      )
      const fixes = dedupeList(
        allCandidates
          .flatMap((item) => item.fixes || [])
          .map((item) => cleanIssueEvidenceLine(item))
          .filter((item) => !isWeakIssueEvidenceLine(item)),
        6,
      )
      const validation = dedupeList(
        allCandidates
          .flatMap((item) => item.validation || [])
          .map((item) => cleanIssueEvidenceLine(item))
          .filter((item) => !isWeakIssueEvidenceLine(item)),
        6,
      )
      const evidenceItems = dedupeList(allCandidates.map((item) => item?.evidence?.relativePath || ''), 20)
      const project = pickDominantProject(allCandidates.map((item) => item?.project || ''))
      const files = curateRepoFileReferences(allCandidates.flatMap((item) => item.files || []), project, 12)
      const concepts = filterPublishedConcepts(
        allCandidates.flatMap((item) => (Array.isArray(item?.evidence?.concepts) ? item.evidence.concepts : [])),
        conceptCatalog,
        8,
      )
      return {
        slug: group.slug,
        title: group.title,
        project,
        symptoms,
        causes,
        fixes,
        validation,
        files,
        concepts,
        evidenceItems,
        evidenceCount: allCandidates.length,
        updatedAt: allCandidates
          .map((item) => String(item?.evidence?.updatedAt || ''))
          .filter(Boolean)
          .sort()
          .slice(-1)[0] || '',
      }
    })
    .filter((item) => !dismissedIssueSlugs.has(String(item?.slug || '').trim()))
    .sort((a, b) => b.evidenceCount - a.evidenceCount || a.title.localeCompare(b.title))

  const existingFiles = await readdir(paths.issuesDir, { withFileTypes: true }).catch(() => [])
  const expected = new Set(['README.md', ...issues.map((item) => `${toFileSlug(item.slug, 'issue')}.md`)])
  for (const item of existingFiles) {
    if (!item.isFile()) continue
    if (expected.has(item.name)) continue
    await unlink(path.join(paths.issuesDir, item.name)).catch(() => {})
  }

  for (const issue of issues) {
    const relativePath = buildIssueRelativePath(issue.slug)
    const filePath = path.join(paths.root, relativePath)
    const existingMarkdownResult = await readExistingMarkdownWithTemplateSeed(relativePath, filePath, 'Issue Note')
    const existingMarkdown = existingMarkdownResult.markdown
    const manualNotes = extractManualNotes(existingMarkdown)
    const manualApproval = isApprovedPromotionRecord(promotionState.issues[issue.slug]) ? promotionState.issues[issue.slug] : null
    const issueStatus = issue.evidenceCount <= 1 && !manualApproval ? 'draft' : 'active'
    const issueSummary = buildIssueReaderSummary(issue)
    const lines = [
      ...buildMarkdownFrontmatter({
        title: issue.title,
        type: 'issue-note',
        schemaVersion: READER_PAGE_SCHEMA_VERSION,
        issue: issue.slug,
        status: issueStatus,
        project: issue.project || '',
        evidenceCount: issue.evidenceCount,
        updatedAt: issue.updatedAt || '',
        promotionState: manualApproval ? 'approved' : 'auto',
        approvedAt: manualApproval?.approvedAt || '',
      }),
      `# ${escapeMarkdownText(issue.title)}`,
      '',
      '> [!summary] Symptom',
      `> ${escapeMarkdownText(issueSummary)}`,
      '',
      ...renderConceptBulletSection('Symptom', issue.symptoms, '_No stable symptom extracted yet._'),
      ...renderConceptBulletSection('Likely Causes', issue.causes, '_No stable cause extracted yet._'),
      ...renderConceptBulletSection('Fix Pattern', issue.fixes, '_No stable fix pattern extracted yet._'),
      ...renderConceptBulletSection('Validation', issue.validation, '_No validation signal recorded yet._'),
    ]

    if (issue.files.length) {
      lines.push(...renderMarkdownSection(
        'Related Files',
        issue.files.map((item) => `- \`${escapeMarkdownText(item)}\``),
      ))
    }

    const relatedLines = []
    if (issue.project) relatedLines.push(`- Project: ${toWikiLink(buildProjectRelativePath(issue.project), issue.project)}`)
    if (issue.concepts.length) relatedLines.push(`- Concepts: ${issue.concepts.map((item) => toWikiLink(buildConceptRelativePath(item), item.label)).join(' · ')}`)
    lines.push(...renderMarkdownSection('Related', relatedLines, '- _No related pages yet._'))
    lines.push(...renderMarkdownSection(
      'Evidence',
      issue.evidenceItems.map((item) => `- ${toWikiLink(item)}`),
      '- _No evidence links recorded yet._',
    ))
    lines.push(...renderMarkdownSection('My Notes', manualNotes, '-'))

    await writeFile(filePath, lines.join('\n'), 'utf-8')
  }

  const readmeLines = [
    '# Issues',
    '',
    'Issue pages summarize repeated bugs, failure modes, and troubleshooting paths extracted from source conversations.',
    '',
  ]

  if (!issues.length) {
    readmeLines.push('_No issue pages yet._')
    readmeLines.push('')
  } else {
    for (const issue of issues) {
      readmeLines.push(`- ${toWikiLink(buildIssueRelativePath(issue.slug), issue.title)} — \`${issue.evidenceCount}\` evidence notes`)
    }
    readmeLines.push('')
  }

  await writeFile(paths.issuesReadme, readmeLines.join('\n'), 'utf-8')
  return {
    totalIssues: issues.length,
    issues,
  }
}

export async function rebuildPatternPages(sourceEvidences = [], options = {}) {
  const paths = await ensureVaultScaffold()
  const promotionState = await loadPromotionState()
  const issueList = Array.isArray(options.issues) ? options.issues : []
  const conceptCatalog = options.conceptCatalog instanceof Map ? options.conceptCatalog : null
  const dismissedPatternSlugs = new Set(
    Object.entries(promotionState.patterns || {})
      .filter(([, record]) => isDismissedPromotionRecord(record))
      .map(([slug]) => String(slug || '').trim())
      .filter(Boolean),
  )
  const candidates = (Array.isArray(sourceEvidences) ? sourceEvidences : [])
    .flatMap((item) => buildPatternCandidates(item))
  const grouped = groupPatternCandidates(candidates)
  const patterns = Array.from(grouped.values())
    .map((group) => {
      const allCandidates = Array.isArray(group.candidates) ? group.candidates : []
      const evidenceItems = dedupeList(allCandidates.map((item) => item?.evidence?.relativePath || ''), 20)
      const project = pickDominantProject(allCandidates.map((item) => item?.project || ''))
      const files = curateRepoFileReferences(allCandidates.flatMap((item) => item.files || []), project, 12)
      const concepts = filterPublishedConcepts(allCandidates.flatMap((item) => item.concepts || []), conceptCatalog, 10)
      const relatedIssues = issueList.filter((issue) => normalizeProjectKey(issue?.project || '') === normalizeProjectKey(project || ''))
      return {
        slug: group.slug,
        title: group.title,
        summary: group.summary,
        whenToUse: dedupeList(group.whenToUse, 6),
        shape: dedupeList(group.shape, 6),
        tradeoffs: dedupeList(group.tradeoffs, 6),
        files,
        concepts,
        project,
        relatedIssues,
        evidenceItems,
        evidenceCount: evidenceItems.length,
        manuallyApproved: isApprovedPromotionRecord(promotionState.patterns[group.slug]),
        updatedAt: allCandidates
          .map((item) => String(item?.evidence?.updatedAt || ''))
          .filter(Boolean)
          .sort()
          .slice(-1)[0] || '',
      }
    })
    .filter((item) => !dismissedPatternSlugs.has(String(item?.slug || '').trim()))
    .filter((item) => item.evidenceCount >= 2 || item.manuallyApproved)
    .sort((a, b) => b.evidenceCount - a.evidenceCount || a.title.localeCompare(b.title))

  const existingFiles = await readdir(paths.patternsDir, { withFileTypes: true }).catch(() => [])
  const expected = new Set(['README.md', ...patterns.map((item) => `${toFileSlug(item.slug, 'pattern')}.md`)])
  for (const item of existingFiles) {
    if (!item.isFile()) continue
    if (expected.has(item.name)) continue
    await unlink(path.join(paths.patternsDir, item.name)).catch(() => {})
  }

  for (const pattern of patterns) {
    const relativePath = buildPatternRelativePath(pattern.slug)
    const filePath = path.join(paths.root, relativePath)
    const existingMarkdownResult = await readExistingMarkdownWithTemplateSeed(relativePath, filePath, 'Coding Pattern')
    const existingMarkdown = existingMarkdownResult.markdown
    const manualNotes = extractManualNotes(existingMarkdown)
    const manualApproval = isApprovedPromotionRecord(promotionState.patterns[pattern.slug]) ? promotionState.patterns[pattern.slug] : null
    const lines = [
      ...buildMarkdownFrontmatter({
        title: pattern.title,
        type: 'pattern-note',
        schemaVersion: READER_PAGE_SCHEMA_VERSION,
        pattern: pattern.slug,
        project: pattern.project || '',
        evidenceCount: pattern.evidenceCount,
        updatedAt: pattern.updatedAt || '',
        status: 'active',
        promotionState: manualApproval ? 'approved' : 'auto',
        approvedAt: manualApproval?.approvedAt || '',
      }),
      `# ${escapeMarkdownText(pattern.title)}`,
      '',
      '> [!summary] Short Answer',
      `> ${escapeMarkdownText(pattern.summary || 'A reusable pattern extracted from multiple source notes.')}`,
      '',
      ...renderConceptBulletSection('When To Use', pattern.whenToUse, '_No stable usage guidance extracted yet._'),
      ...renderConceptBulletSection('Recommended Shape', pattern.shape, '_No stable shape extracted yet._'),
      ...renderConceptBulletSection('Tradeoffs', pattern.tradeoffs, '_No clear tradeoffs extracted yet._'),
    ]

    if (pattern.files.length) {
      lines.push(...renderMarkdownSection(
        'In This Repo',
        pattern.files.map((item) => `- \`${escapeMarkdownText(item)}\``),
      ))
    }

    const relatedLines = []
    if (pattern.project) relatedLines.push(`- Project: ${toWikiLink(buildProjectRelativePath(pattern.project), pattern.project)}`)
    if (pattern.concepts.length) relatedLines.push(`- Concepts: ${pattern.concepts.map((item) => toWikiLink(buildConceptRelativePath(item), item.label)).join(' · ')}`)
    if (pattern.relatedIssues.length) {
      relatedLines.push(`- Issues: ${pattern.relatedIssues.slice(0, 6).map((item) => toWikiLink(buildIssueRelativePath(item.slug), item.title)).join(' · ')}`)
    }
    lines.push(...renderMarkdownSection('Related', relatedLines, '- _No related pages yet._'))
    lines.push(...renderMarkdownSection(
      'Evidence',
      pattern.evidenceItems.map((item) => `- ${toWikiLink(item)}`),
      '- _No evidence links recorded yet._',
    ))
    lines.push(...renderMarkdownSection('My Notes', manualNotes, '-'))

    await writeFile(filePath, lines.join('\n'), 'utf-8')
  }

  const readmeLines = [
    '# Patterns',
    '',
    'Pattern pages summarize recurring implementation, workflow, and architecture shapes extracted from multiple source notes.',
    '',
  ]

  if (!patterns.length) {
    readmeLines.push('_No pattern pages yet._')
    readmeLines.push('')
  } else {
    for (const pattern of patterns) {
      readmeLines.push(`- ${toWikiLink(buildPatternRelativePath(pattern.slug), pattern.title)} — \`${pattern.evidenceCount}\` evidence notes`)
    }
    readmeLines.push('')
  }

  await writeFile(paths.patternsReadme, readmeLines.join('\n'), 'utf-8')
  return {
    totalPatterns: patterns.length,
    patterns,
  }
}

export async function rebuildProjectPages(sourceEvidences = [], options = {}) {
  const paths = await ensureVaultScaffold()
  const issueList = Array.isArray(options.issues) ? options.issues : []
  const patternList = Array.isArray(options.patterns) ? options.patterns : []
  const conceptCatalog = options.conceptCatalog instanceof Map ? options.conceptCatalog : null
  const projectGroups = new Map()

  for (const evidence of Array.isArray(sourceEvidences) ? sourceEvidences : []) {
    const project = normalizeProjectKey(evidence?.project || '')
    if (!project) continue
    if (!projectGroups.has(project)) {
      projectGroups.set(project, {
        project,
        label: String(evidence?.project || project),
        evidences: [],
      })
    }
    projectGroups.get(project).evidences.push(evidence)
  }

  const projects = Array.from(projectGroups.values())
    .map((group) => {
      const evidences = Array.isArray(group.evidences) ? group.evidences : []
      const files = curateRepoFileReferences(evidences.flatMap((item) => item.mentionedFiles || []), group.project, 12)
      const hasKnowledgeEvidence = evidences.some((item) => item?.knowledgeItemId)
      const concepts = filterPublishedConcepts(
        evidences.flatMap((item) => (Array.isArray(item.concepts) ? item.concepts : [])),
        conceptCatalog,
        10,
      )
      const issueRefs = issueList.filter((issue) => normalizeProjectKey(issue?.project || '') === group.project)
      const patternRefs = patternList.filter((pattern) => normalizeProjectKey(pattern?.project || '') === group.project)
      return {
        key: group.project,
        label: group.label,
        evidenceCount: evidences.length,
        files,
        concepts,
        issues: issueRefs,
        patterns: patternRefs,
        hasKnowledgeEvidence,
        evidences: evidences
          .slice()
          .sort((a, b) => +new Date(b.updatedAt || 0) - +new Date(a.updatedAt || 0)),
        updatedAt: evidences
          .map((item) => String(item?.updatedAt || ''))
          .filter(Boolean)
          .sort()
          .slice(-1)[0] || '',
      }
    })
    .filter((item) => item.evidenceCount >= 2 || item.hasKnowledgeEvidence || item.issues.length || item.patterns.length)
    .sort((a, b) => b.evidenceCount - a.evidenceCount || a.label.localeCompare(b.label))

  const existingFiles = await readdir(paths.projectsDir, { withFileTypes: true }).catch(() => [])
  const expected = new Set(['README.md', ...projects.map((item) => `${normalizeProjectKey(item.key) || 'unknown-project'}.md`)])
  for (const item of existingFiles) {
    if (!item.isFile()) continue
    if (expected.has(item.name)) continue
    await unlink(path.join(paths.projectsDir, item.name)).catch(() => {})
  }

  for (const project of projects) {
    const relativePath = buildProjectRelativePath(project.key)
    const filePath = path.join(paths.root, relativePath)
    const existingMarkdownResult = await readExistingMarkdownWithTemplateSeed(relativePath, filePath, 'Project Hub')
    const existingMarkdown = existingMarkdownResult.markdown
    const openQuestions = extractProtectedMarkdownSection(existingMarkdown, 'Open Questions', '-')
    const manualNotes = extractManualNotes(existingMarkdown)
    const lines = [
      ...buildMarkdownFrontmatter({
        title: project.label,
        type: 'project-hub',
        schemaVersion: READER_PAGE_SCHEMA_VERSION,
        project: project.key,
        evidenceCount: project.evidenceCount,
        updatedAt: project.updatedAt || '',
        status: 'active',
      }),
      `# ${escapeMarkdownText(project.label)}`,
      '',
      '> [!summary] What It Is',
      `> This hub aggregates source evidence, recurring issues, and important concepts for ${escapeMarkdownText(project.label)}.`,
      '',
      ...renderMarkdownSection('Current Shape', [
        `- Evidence notes: \`${project.evidenceCount}\``,
        `- Pattern pages: \`${project.patterns.length}\``,
        `- Issue pages: \`${project.issues.length}\``,
        `- Concepts: \`${project.concepts.length}\``,
      ]),
    ]

    if (project.files.length) {
      lines.push(...renderMarkdownSection(
        'Important Areas',
        project.files.map((item) => `- \`${escapeMarkdownText(item)}\``),
      ))
    }

    if (!project.patterns.length) {
      lines.push(...renderMarkdownSection('Key Patterns', [], '- _No pattern pages yet._'))
    } else {
      lines.push(...renderMarkdownSection('Key Patterns', project.patterns.map((pattern) => (
        `- ${toWikiLink(buildPatternRelativePath(pattern.slug), pattern.title)} — \`${pattern.evidenceCount}\` evidence notes`
      ))))
    }

    if (!project.issues.length) {
      lines.push(...renderMarkdownSection('Known Issues', [], '- _No issue pages yet._'))
    } else {
      lines.push(...renderMarkdownSection('Known Issues', project.issues.map((issue) => (
        `- ${toWikiLink(buildIssueRelativePath(issue.slug), issue.title)} — \`${issue.evidenceCount}\` evidence notes`
      ))))
    }

    if (!project.concepts.length) {
      lines.push(...renderMarkdownSection('Related Concepts', [], '- _No concept links yet._'))
    } else {
      lines.push(...renderMarkdownSection(
        'Related Concepts',
        [`- ${project.concepts.map((item) => toWikiLink(buildConceptRelativePath(item), item.label)).join(' · ')}`],
      ))
    }
    lines.push(...renderMarkdownSection(
      'Evidence',
      project.evidences.slice(0, 20).map((evidence) => {
        const updated = evidence.updatedAt ? formatIsoLocal(evidence.updatedAt) : 'unknown'
        return `- ${toWikiLink(evidence.relativePath, evidence.title || 'Untitled Session')} — ${toWikiLink(buildProviderRelativePath(evidence.provider), evidence.provider || 'unknown')} · ${updated}`
      }),
      '- _No evidence links recorded yet._',
    ))
    lines.push(...renderMarkdownSection('Open Questions', openQuestions, '-'))
    lines.push(...renderMarkdownSection('My Notes', manualNotes, '-'))

    await writeFile(filePath, lines.join('\n'), 'utf-8')
  }

  const readmeLines = [
    '# Projects',
    '',
    'Project hub pages collect related evidence, issue notes, and concept links for a repo or workstream.',
    '',
  ]

  if (!projects.length) {
    readmeLines.push('_No project pages yet._')
    readmeLines.push('')
  } else {
    for (const project of projects) {
      readmeLines.push(`- ${toWikiLink(buildProjectRelativePath(project.key), project.label)} — \`${project.evidenceCount}\` evidence notes`)
    }
    readmeLines.push('')
  }

  await writeFile(paths.projectsReadme, readmeLines.join('\n'), 'utf-8')
  return {
    totalProjects: projects.length,
    projects,
  }
}

export async function rebuildConceptPages(entries = [], options = {}) {
  const paths = await ensureVaultScaffold()
  const conceptCatalog = buildConceptCatalogFromEntries(entries)
  const conceptGroups = new Map(
    Array.from(groupByConcept(entries).entries()).filter(([slug]) => conceptCatalog.has(slug)),
  )
  const concepts = Array.from(conceptGroups.values())
    .sort((a, b) => b.entries.length - a.entries.length || a.concept.label.localeCompare(b.concept.label))
  const summaryMode = String(options.summaryMode || 'llm')
  const summaryConfig = summaryMode === 'llm' ? await loadConceptSummaryConfig() : null
  const conceptStats = {
    totalConcepts: concepts.length,
    llmConceptCount: 0,
    fallbackConceptCount: 0,
    skippedConceptCount: 0,
    reusedLlmConceptCount: 0,
    reusedFallbackConceptCount: 0,
  }

  const existingFiles = await readdir(paths.conceptsDir, { withFileTypes: true }).catch(() => [])
  const expected = new Set(['README.md', ...concepts.map((item) => `${item.concept.slug}.md`)])
  for (const item of existingFiles) {
    if (!item.isFile()) continue
    if (expected.has(item.name)) continue
    await unlink(path.join(paths.conceptsDir, item.name)).catch(() => {})
  }

  let processedConcepts = 0
  const writtenConcepts = []
  for (const item of concepts) {
    const concept = {
      ...item.concept,
      kind: inferConceptKind(item?.concept?.slug || '', new Set(), ''),
    }
    const relativePath = buildConceptRelativePath(concept)
    const filePath = path.join(paths.root, relativePath)
    const existingMarkdownResult = await readExistingMarkdownWithTemplateSeed(relativePath, filePath, 'Concept Draft')
    const existingMarkdown = existingMarkdownResult.markdown
    const entryDigests = await buildConceptEntryDigests(
      item.entries.slice().sort((a, b) => +new Date(b.updatedAt || 0) - +new Date(a.updatedAt || 0)),
    )
    const conceptInputHash = buildConceptInputHash(concept, entryDigests)
    const previousHash = parseSimpleFrontmatterValue(existingMarkdown, 'conceptInputHash')
    const previousSummaryMode = parseSimpleFrontmatterValue(existingMarkdown, 'summaryMode')
    const previousSummaryModel = parseSimpleFrontmatterValue(existingMarkdown, 'summaryModel')
    const previousKind = parseSimpleFrontmatterValue(existingMarkdown, 'kind')
    const previousSchemaVersion = parseSimpleFrontmatterValue(existingMarkdown, 'schemaVersion')
    const currentSummaryModel = String(summaryConfig?.model || '')
    const canReuseExistingSummary = (
      previousHash
      && previousHash === conceptInputHash
      && previousKind === (concept.kind === 'module' ? 'module' : 'topic')
      && previousSchemaVersion === CONCEPT_PAGE_SCHEMA_VERSION
      && !hasUnpublishedConceptLinks(existingMarkdown, conceptCatalog)
      && (
        !summaryConfig
        || entryDigests.length < 2
        || (
          previousSummaryMode === 'llm'
          && previousSummaryModel === currentSummaryModel
        )
      )
    )
    if (canReuseExistingSummary) {
      writtenConcepts.push({
        concept,
        sessionCount: item.entries.length,
      })
      conceptStats.skippedConceptCount += 1
      if (previousSummaryMode === 'llm') conceptStats.reusedLlmConceptCount += 1
      else conceptStats.reusedFallbackConceptCount += 1
      processedConcepts += 1
      if (typeof options.onProgress === 'function') {
        await options.onProgress({
          processed: processedConcepts,
          total: concepts.length,
          concept: concept.slug,
          llmConceptCount: conceptStats.llmConceptCount,
          fallbackConceptCount: conceptStats.fallbackConceptCount,
          skippedConceptCount: conceptStats.skippedConceptCount,
          reusedLlmConceptCount: conceptStats.reusedLlmConceptCount,
          reusedFallbackConceptCount: conceptStats.reusedFallbackConceptCount,
        })
      }
      continue
    }

    const manualNotes = extractManualNotes(existingMarkdown)
    const providerGroups = groupByProvider(item.entries)
    const providerNames = Array.from(providerGroups.keys()).sort((a, b) => a.localeCompare(b))
    const relatedConcepts = Array.from(
      new Map(
        item.entries
          .flatMap((entry) => Array.isArray(entry?.concepts) ? entry.concepts : [])
          .filter((entryConcept) => (
            entryConcept?.slug
            && entryConcept.slug !== concept.slug
            && conceptCatalog.has(entryConcept.slug)
          ))
          .map((entryConcept) => [entryConcept.slug, entryConcept]),
      ).values(),
    )
      .slice(0, 8)
    const summary = await summarizeConceptWithModel(concept, entryDigests, summaryConfig)
    if (summary.mode === 'llm') conceptStats.llmConceptCount += 1
    else conceptStats.fallbackConceptCount += 1
    const lines = [
      '---',
      `title: "${escapeYamlString(concept.label)}"`,
      'type: "concept-hub"',
      `schemaVersion: "${CONCEPT_PAGE_SCHEMA_VERSION}"`,
      `concept: "${escapeYamlString(concept.slug)}"`,
      `kind: "${escapeYamlString(concept.kind === 'module' ? 'module' : 'topic')}"`,
      `sessionCount: ${item.entries.length}`,
      `conceptInputHash: "${escapeYamlString(conceptInputHash)}"`,
      `summaryMode: "${escapeYamlString(summary.mode || 'fallback')}"`,
      `summaryModel: "${escapeYamlString(summary.model || '')}"`,
      `summaryGeneratedAt: "${escapeYamlString(summary.generatedAt || '')}"`,
      '---',
      '',
      `# ${escapeMarkdownText(concept.label)}`,
      '',
      '> [!note] Concept Hub',
      `> Type: \`${concept.kind === 'module' ? 'module' : 'topic'}\` · This page acts as a persistent wiki summary: it keeps source links, provider coverage, and an LLM-written synthesis when enough related evidence exists.`,
      '',
      '## Navigation',
      '',
      `- ${toWikiLink('Home.md', 'Home')}`,
      `- ${toWikiLink('index.md', 'Vault Index')}`,
      `- ${toWikiLink('concepts/README.md', 'All Concepts')}`,
      '',
    ]

    lines.push('## Summary')
    lines.push('')
    lines.push(summary.summary || 'No summary yet.')
    lines.push('')

    lines.push(...renderConceptBulletSection('Key Takeaways', summary.takeaways, '_No stable takeaways yet._'))
    lines.push(...renderConceptBulletSection('Open Questions', summary.openQuestions, '_No open questions recorded._'))
    lines.push(...renderConceptBulletSection('Source Patterns', summary.sourcePatterns, '_No source pattern notes yet._'))

    lines.push('## Provider Coverage')
    lines.push('')

    if (!providerNames.length) {
      lines.push('- _No providers yet._')
      lines.push('')
    } else {
      for (const provider of providerNames) {
        const count = (providerGroups.get(provider) || []).length
        lines.push(`- ${toWikiLink(buildProviderRelativePath(provider), provider)} — \`${count}\``)
      }
      lines.push('')
    }

    lines.push('## Related Concepts')
    lines.push('')
    if (!relatedConcepts.length) {
      lines.push('_No nearby concepts yet._')
      lines.push('')
    } else {
      lines.push(`- ${relatedConcepts.map((item) => toWikiLink(buildConceptRelativePath(item), item.label)).join(' · ')}`)
      lines.push('')
    }

    lines.push('## Source Highlights')
    lines.push('')
    if (!entryDigests.length) {
      lines.push('_No source highlights yet._')
      lines.push('')
    } else {
      for (const digest of entryDigests.slice(0, 8)) {
        const updated = digest.updatedAt ? formatIsoLocal(digest.updatedAt) : 'unknown'
        lines.push(`### ${toWikiLink(digest.relativePath, digest.title || 'Untitled Session')}`)
        lines.push('')
        lines.push(`- Provider: ${toWikiLink(buildProviderRelativePath(digest.provider), digest.provider || 'unknown')}`)
        lines.push(`- Updated: ${updated}`)
        lines.push(`- Message count: \`${digest.messageCount || 0}\``)
        if (digest.firstUserIntent) lines.push(`- User intent: ${escapeMarkdownText(digest.firstUserIntent)}`)
        if (digest.latestAssistantReply) lines.push(`- Latest assistant reply: ${escapeMarkdownText(digest.latestAssistantReply)}`)
        if (digest.mentionedFiles) lines.push(`- Mentioned files: ${escapeMarkdownText(digest.mentionedFiles)}`)
        if (digest.manualNotes) lines.push(`- Human notes: ${escapeMarkdownText(digest.manualNotes)}`)
        lines.push('')
      }
    }

    lines.push('## Related Sessions')
    lines.push('')
    for (const entry of item.entries.slice().sort((a, b) => +new Date(b.updatedAt || 0) - +new Date(a.updatedAt || 0))) {
      const updated = entry.updatedAt ? formatIsoLocal(entry.updatedAt) : 'unknown'
      lines.push(`- ${toWikiLink(entry.relativePath, entry.title)} — ${toWikiLink(buildProviderRelativePath(entry.provider), entry.provider || 'unknown')} · ${updated}`)
    }
    lines.push('')

    lines.push('## My Notes')
    lines.push('')
    lines.push(manualNotes || '-')
    lines.push('')

    await writeFile(filePath, lines.join('\n'), 'utf-8')
    writtenConcepts.push({
      concept,
      sessionCount: item.entries.length,
    })
    processedConcepts += 1
    if (typeof options.onProgress === 'function') {
      await options.onProgress({
        processed: processedConcepts,
        total: concepts.length,
        concept: concept.slug,
        llmConceptCount: conceptStats.llmConceptCount,
        fallbackConceptCount: conceptStats.fallbackConceptCount,
        skippedConceptCount: conceptStats.skippedConceptCount,
        reusedLlmConceptCount: conceptStats.reusedLlmConceptCount,
        reusedFallbackConceptCount: conceptStats.reusedFallbackConceptCount,
      })
    }
  }

  const conceptReadmeEntries = []
  const currentFiles = await readdir(paths.conceptsDir, { withFileTypes: true }).catch(() => [])
  for (const item of currentFiles) {
    if (!item.isFile() || !item.name.endsWith('.md') || item.name === 'README.md') continue
    const markdown = await readFile(path.join(paths.conceptsDir, item.name), 'utf-8').catch(() => '')
    const slug = parseSimpleFrontmatterValue(markdown, 'concept')
    const title = parseSimpleFrontmatterValue(markdown, 'title')
    const inferredKind = MODULE_CONCEPT_SLUGS.has(slug) ? 'module' : TOPIC_CONCEPT_SLUGS.has(slug) ? 'topic' : 'topic'
    const storedKind = parseSimpleFrontmatterValue(markdown, 'kind')
    const kind = storedKind === 'module' || storedKind === 'topic' ? storedKind : inferredKind
    const sessionCount = Number(parseSimpleFrontmatterValue(markdown, 'sessionCount') || 0)
    if (!slug || !title) continue
    conceptReadmeEntries.push({
      concept: { slug, label: title, kind },
      sessionCount,
    })
  }

  conceptReadmeEntries.sort((a, b) => b.sessionCount - a.sessionCount || a.concept.label.localeCompare(b.concept.label))

  const readmeLines = [
    '# Concepts',
    '',
    'Concept pages are generated from session titles, tags, referenced files, and LLM-written cross-source summaries when enough evidence is available.',
    '',
  ]

  if (!conceptReadmeEntries.length) {
    readmeLines.push('_No concept pages yet._')
    readmeLines.push('')
  } else {
    const groupedByKind = {
      topic: conceptReadmeEntries.filter((item) => item.concept.kind !== 'module'),
      module: conceptReadmeEntries.filter((item) => item.concept.kind === 'module'),
    }

    if (groupedByKind.topic.length) {
      readmeLines.push('## Topics')
      readmeLines.push('')
      for (const item of groupedByKind.topic) {
        readmeLines.push(`- ${toWikiLink(buildConceptRelativePath(item.concept), item.concept.label)} — \`${item.sessionCount}\` sessions`)
      }
      readmeLines.push('')
    }

    if (groupedByKind.module.length) {
      readmeLines.push('## Modules')
      readmeLines.push('')
      for (const item of groupedByKind.module) {
        readmeLines.push(`- ${toWikiLink(buildConceptRelativePath(item.concept), item.concept.label)} — \`${item.sessionCount}\` sessions`)
      }
      readmeLines.push('')
    }
  }

  await writeFile(paths.conceptsReadme, readmeLines.join('\n'), 'utf-8')

  return conceptStats
}

const SYNTHESIS_PROMOTION_PATTERNS = [
  /怎么做|如何做|应该怎么|为什么|为何|路线图|roadmap|下一步|方案|对比|比较|取舍|架构|设计|规划/u,
  /\bhow\b|\bwhy\b|\bcompare\b|\bcomparison\b|\bplan\b|\broadmap\b|\btradeoff\b|\barchitecture\b/iu,
]

const SYNTHESIS_NEGATIVE_PATTERNS = [
  /@(?:src|server|docs|scripts)\//iu,
  /(?:^|[\s(])(?:src|server|docs|scripts)\/[^\s]+/iu,
  /\.(?:vue|js|ts|tsx|jsx|mjs)\b/iu,
  /按钮|没反应|无响应|白屏|报错|异常|bug|修复|定位|点击|diff|patch/u,
  /\bbutton\b|\berror\b|\bfailed\b|\bfix\b|\bpatch\b|\bdiff\b/iu,
]

const SYNTHESIS_STRONG_PATTERNS = [
  /理念|设想|knowledge base|知识库|wiki|roadmap|路线图|方案|对比|比较|取舍|机制|规范|最佳实践|架构|设计/u,
  /\bwiki\b|\broadmap\b|\bplan\b|\barchitecture\b|\bdesign\b|\bworkflow\b|\bbest practice\b/iu,
]

function buildPromotionQueueTitle(text = '', fallback = '候选结论') {
  return clipText(normalizeText(String(text || '')
    .replace(/^@[^ ]+\s*/u, '')
    .replace(/^请问[:：]?\s*/u, '')
    .replace(/^想知道[:：]?\s*/u, '')
    .replace(/^我想知道[:：]?\s*/u, '')
    .replace(/^问题是[:：]?\s*/u, '')
    .replace(/[?？]+$/u, '')
    .trim()), 72) || fallback
}

function buildPromotionQueueExcerpt(text = '', fallback = '') {
  return clipText(normalizeText(String(text || '').replace(/\s+/g, ' ').trim()), 220) || fallback
}

function scoreSynthesisPromotion(evidence) {
  const title = normalizeText(evidence?.title || '')
  const userIntent = normalizeText(evidence?.firstUserIntent || '')
  const bestAnswer = normalizeText(evidence?.bestAssistantAnswer || '')
  const latestReply = normalizeText(evidence?.latestAssistantReply || '')
  const combined = [title, userIntent, bestAnswer || latestReply].filter(Boolean).join('\n')
  let score = 0

  if (SYNTHESIS_NEGATIVE_PATTERNS.some((pattern) => pattern.test(combined))) score -= 0.35
  if (SYNTHESIS_PROMOTION_PATTERNS.some((pattern) => pattern.test(userIntent))) score += 0.4
  if (SYNTHESIS_PROMOTION_PATTERNS.some((pattern) => pattern.test(title))) score += 0.2
  if (SYNTHESIS_STRONG_PATTERNS.some((pattern) => pattern.test(combined))) score += 0.25
  if (/[?？]/u.test(userIntent) || /怎么|如何|为什么|should|how|why|compare|plan/iu.test(userIntent)) score += 0.15
  if (String(evidence?.project || '').trim()) score += 0.1
  if (Array.isArray(evidence?.concepts) && evidence.concepts.length) score += 0.05
  if (String(bestAnswer || latestReply || '').length >= 120) score += 0.1
  if (BEST_ANSWER_STRUCTURE_PATTERNS.some((pattern) => pattern.test(bestAnswer || latestReply))) score += 0.08
  if (hasIssueSignal(userIntent) && !/对比|比较|路线图|下一步|方案|架构|设计|机制/u.test(userIntent)) score -= 0.25
  if (SYNTHESIS_NEGATIVE_PATTERNS.some((pattern) => pattern.test(userIntent)) && !SYNTHESIS_STRONG_PATTERNS.some((pattern) => pattern.test(userIntent))) score -= 0.15

  return Number(Math.max(0, Math.min(1, score)).toFixed(2))
}

function buildPromotionQueueMarkdown(report = {}) {
  const generatedAt = String(report?.generatedAt || '')
  const summary = report?.summary || {}
  const issueReviews = Array.isArray(report?.issueReviews) ? report.issueReviews : []
  const patternCandidates = Array.isArray(report?.patternCandidates) ? report.patternCandidates : []
  const synthesisCandidates = Array.isArray(report?.synthesisCandidates) ? report.synthesisCandidates : []
  const approvedIssues = Array.isArray(report?.approvedIssues) ? report.approvedIssues : []
  const approvedPatterns = Array.isArray(report?.approvedPatterns) ? report.approvedPatterns : []
  const approvedSyntheses = Array.isArray(report?.approvedSyntheses) ? report.approvedSyntheses : []
  const lines = [
    '# Promotion Queue',
    '',
    '> [!summary] What This Is',
    '> This queue holds candidate wiki updates that should be reviewed before they become durable reader-first notes.',
    '',
    '## Snapshot',
    '',
    `- Generated: ${generatedAt ? `\`${formatIsoLocal(generatedAt)}\`` : 'unknown'}`,
    `- Total queued items: \`${Number(summary.totalItems || 0)}\``,
    `- Draft issue reviews: \`${Number(summary.issueReviewCount || 0)}\``,
    `- Pattern candidates: \`${Number(summary.patternCandidateCount || 0)}\``,
    `- Synthesis candidates: \`${Number(summary.synthesisCandidateCount || 0)}\``,
    `- Approved issues: \`${Number(summary.approvedIssueCount || 0)}\``,
    `- Approved patterns: \`${Number(summary.approvedPatternCount || 0)}\``,
    `- Approved syntheses: \`${Number(summary.approvedSynthesisCount || 0)}\``,
    '',
    '## How To Use',
    '',
    '- Review `issue` drafts first if they are blocking active work.',
    '- Promote `pattern` candidates only when the shape feels reusable beyond one session.',
    '- Promote `synthesis` candidates when the conclusion is durable enough to deserve a long-lived note.',
    '',
  ]

  const renderQueueSection = (title, items, emptyText, withTasks = false) => {
    lines.push(`## ${title}`)
    lines.push('')
    if (!items.length) {
      lines.push(emptyText)
      lines.push('')
      return
    }
    for (const item of items) {
      if (withTasks) {
        const checked = item?.taskChecked === true ? 'x' : ' '
        const token = String(item?.taskToken || '').trim()
        const tokenComment = token ? ` <!-- ${escapeMarkdownText(token)} -->` : ''
        lines.push(`- [${checked}] ${escapeMarkdownText(item.title || 'Untitled Candidate')}${tokenComment}`)
      } else {
        lines.push(`### ${escapeMarkdownText(item.title || 'Untitled Candidate')}`)
      }
      lines.push('')
      const bulletPrefix = withTasks ? '  -' : '-'
      lines.push(`${bulletPrefix} Kind: \`${escapeMarkdownText(item.kind || 'candidate')}\``)
      if (item.sourceLabel) lines.push(`${bulletPrefix} Source: \`${escapeMarkdownText(item.sourceLabel)}\``)
      if (item.currentPath) lines.push(`${bulletPrefix} Current note: ${toWikiLink(item.currentPath, item.currentLabel || item.title || 'Current Note')}`)
      if (item.targetPath) lines.push(`${bulletPrefix} Suggested target: \`${escapeMarkdownText(item.targetPath)}\``)
      if (item.project) lines.push(`${bulletPrefix} Project: ${toWikiLink(buildProjectRelativePath(item.project), item.project)}`)
      if (item.confidence !== undefined) lines.push(`${bulletPrefix} Confidence: \`${Number(item.confidence || 0).toFixed(2)}\``)
      if (item.reason) lines.push(`${bulletPrefix} Why queued: ${escapeMarkdownText(item.reason)}`)
      if (item.summary) lines.push(`${bulletPrefix} Summary: ${escapeMarkdownText(item.summary)}`)
      if (Array.isArray(item.suggestedActions) && item.suggestedActions.length) {
        lines.push(`${bulletPrefix} Suggested action: ${escapeMarkdownText(item.suggestedActions.join('；'))}`)
      }
      if (Array.isArray(item.evidenceItems) && item.evidenceItems.length) {
        lines.push(`${bulletPrefix} Evidence: ${item.evidenceItems.map((entry) => toWikiLink(entry)).join(' · ')}`)
      }
      lines.push('')
    }
  }

  renderQueueSection('Issue Reviews', issueReviews, '_No draft issue reviews right now._', true)
  renderQueueSection('Pattern Candidates', patternCandidates, '_No pattern candidates right now._', true)
  renderQueueSection('Synthesis Candidates', synthesisCandidates, '_No synthesis candidates right now._', true)
  renderQueueSection('Approved Issues', approvedIssues, '_No manually approved issue pages right now._')
  renderQueueSection('Approved Patterns', approvedPatterns, '_No manually approved pattern pages right now._')
  renderQueueSection('Approved Syntheses', approvedSyntheses, '_No manually approved synthesis pages right now._')
  return lines.join('\n')
}

function buildPromotionQueueIdentity(item = {}) {
  if (item?.sourceKind === 'manual-submit' && item?.segmentId) {
    return `${String(item?.kind || '').trim()}::${String(item.segmentId || '').trim()}`
  }
  const pathKey = String(item?.currentPath || item?.targetPath || '').trim()
  const titleKey = String(item?.title || '').trim()
  return `${String(item?.kind || '').trim()}::${pathKey || titleKey}`
}

function buildPromotionQueueTaskToken(item = {}) {
  const explicitToken = String(item?.taskToken || '').trim()
  if (/^pq:[A-Za-z0-9_-]+$/.test(explicitToken)) return explicitToken
  const identity = buildPromotionQueueIdentity(item)
  if (!identity) return ''
  return `pq:${Buffer.from(identity, 'utf-8').toString('base64url')}`
}

function extractPromotionQueueTaskToken(text = '') {
  const match = String(text || '').match(/\bpq:[A-Za-z0-9_-]+\b/)
  return String(match?.[0] || '').trim()
}

function parsePromotionQueueTaskStatesFromMarkdown(markdown = '') {
  const states = new Map()
  const lines = String(markdown || '').split(/\r?\n/g)
  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || '')
    const match = line.match(/^\s*-\s*\[([ xX])\]\s+(.+)$/)
    if (!match) continue
    const token = extractPromotionQueueTaskToken(match[2] || '')
    if (!token) continue
    states.set(token, {
      checked: String(match[1] || '').toLowerCase() === 'x',
      line: index + 1,
    })
  }
  return states
}

function parseObsidianTaskTodo(payload = '') {
  const normalizedPayload = typeof payload === 'string' ? parseObsidianPayload(payload) : payload
  const items = Array.isArray(normalizedPayload)
    ? normalizedPayload
    : Array.isArray(normalizedPayload?.results)
      ? normalizedPayload.results
      : Array.isArray(normalizedPayload?.items)
        ? normalizedPayload.items
        : []
  const entries = []
  for (const item of items) {
    const text = pickFirstString(item, ['text', 'task', 'lineText'])
    const token = extractPromotionQueueTaskToken(text)
    if (!token) continue
    const file = normalizeVaultRelativePath(pickFirstString(item, ['file', 'path']))
    const line = Number(pickFirstString(item, ['line', 'lineNumber']) || 0)
    const status = pickFirstString(item, ['status'])
    const ref = file && line > 0 ? `${file}:${line}` : ''
    entries.push({
      token,
      ref,
      file,
      line,
      checked: String(status || '').trim().toLowerCase() === 'x',
      text,
    })
  }
  return entries
}

async function loadPromotionQueueTaskOpenRefs(paths, options = {}) {
  if (!isObsidianCliEnabled()) return new Map()
  const queueRelativePath = `inbox/${path.basename(paths.promotionQueue)}`
  const result = await runObsidianCli(['tasks', 'todo', `path=${queueRelativePath}`, 'format=json'], {
    ensureReady: options.ensureReady === true,
    autoLaunch: options.autoLaunch === true,
    timeoutMs: Math.max(900, Number(options.timeoutMs || 2600)),
    readyTimeoutMs: options.readyTimeoutMs,
    probeTimeoutMs: options.probeTimeoutMs,
  }).catch(() => null)
  if (!result?.stdout) return new Map()
  const entries = parseObsidianTaskTodo(result.stdout)
  const refs = new Map()
  for (const entry of entries) {
    if (!entry?.token || !entry?.ref) continue
    refs.set(entry.token, entry.ref)
  }
  return refs
}

async function buildPromotionQueueTaskMetadata(paths) {
  const queueRelativePath = `inbox/${path.basename(paths.promotionQueue)}`
  const existingMarkdown = await readFile(paths.promotionQueue, 'utf-8').catch(() => '')
  const stateByToken = parsePromotionQueueTaskStatesFromMarkdown(existingMarkdown)
  const openRefByToken = await loadPromotionQueueTaskOpenRefs(paths, {
    ensureReady: false,
    autoLaunch: false,
    timeoutMs: 2200,
  }).catch(() => new Map())
  return {
    queueRelativePath,
    stateByToken,
    openRefByToken,
  }
}

function attachPromotionQueueTaskMetadata(items = [], metadata = {}) {
  const queueRelativePath = String(metadata?.queueRelativePath || '').trim()
  const stateByToken = metadata?.stateByToken instanceof Map ? metadata.stateByToken : new Map()
  const openRefByToken = metadata?.openRefByToken instanceof Map ? metadata.openRefByToken : new Map()
  return (Array.isArray(items) ? items : []).map((item) => {
    const token = buildPromotionQueueTaskToken(item)
    const state = token ? stateByToken.get(token) : null
    const openRef = token ? String(openRefByToken.get(token) || '').trim() : ''
    const fallbackRef = state?.line ? `${queueRelativePath}:${Number(state.line || 0)}` : ''
    return {
      ...item,
      taskToken: token || undefined,
      taskChecked: Boolean(state?.checked),
      taskRef: openRef || (state?.line ? fallbackRef : undefined),
    }
  })
}

function normalizePromotionQueueTaskRef(value = '', queueRelativePath = '') {
  const raw = String(value || '').trim()
  const match = raw.match(/^(.+):(\d+)$/)
  if (!match) return ''
  const file = normalizeVaultRelativePath(match[1])
  const line = Number(match[2] || 0)
  if (!file || line <= 0) return ''
  const queuePath = normalizeVaultRelativePath(queueRelativePath)
  if (queuePath && file !== queuePath) return ''
  return `${file}:${line}`
}

async function loadPromotionQueueTaskRefFromMarkdown(paths, token = '') {
  const normalizedToken = String(token || '').trim()
  if (!normalizedToken) return ''
  const queueRelativePath = `inbox/${path.basename(paths.promotionQueue)}`
  const existingMarkdown = await readFile(paths.promotionQueue, 'utf-8').catch(() => '')
  const stateByToken = parsePromotionQueueTaskStatesFromMarkdown(existingMarkdown)
  const state = stateByToken.get(normalizedToken)
  if (!state?.line) return ''
  return `${queueRelativePath}:${Number(state.line || 0)}`
}

async function markPromotionQueueTaskDoneFallback(paths, options = {}) {
  const queueRelativePath = `inbox/${path.basename(paths.promotionQueue)}`
  const token = String(options?.token || '').trim()
  const rawRef = normalizePromotionQueueTaskRef(options?.ref, queueRelativePath)
  if (!token && !rawRef) {
    return {
      engine: 'markdown-fallback',
      done: false,
      ref: '',
      reason: 'fallback-target-missing',
    }
  }

  const markdown = await readFile(paths.promotionQueue, 'utf-8').catch(() => '')
  if (!markdown) {
    return {
      engine: 'markdown-fallback',
      done: false,
      ref: '',
      reason: 'queue-markdown-missing',
    }
  }

  const lines = String(markdown || '').split(/\r?\n/g)
  let targetLine = -1

  if (rawRef) {
    const lineNumber = Number(String(rawRef).split(':').at(-1) || 0)
    if (lineNumber > 0 && lineNumber <= lines.length) {
      const candidate = String(lines[lineNumber - 1] || '')
      if (token) {
        if (candidate.includes(token)) targetLine = lineNumber - 1
      } else {
        targetLine = lineNumber - 1
      }
    }
  }

  if (targetLine < 0 && token) {
    targetLine = lines.findIndex((line) => String(line || '').includes(token))
  }

  if (targetLine < 0) {
    return {
      engine: 'markdown-fallback',
      done: false,
      ref: rawRef || '',
      reason: 'fallback-target-not-found',
    }
  }

  const line = String(lines[targetLine] || '')
  const taskMatch = line.match(/^(\s*-\s*\[)([ xX])(\]\s+.*)$/)
  if (!taskMatch) {
    return {
      engine: 'markdown-fallback',
      done: false,
      ref: `${queueRelativePath}:${targetLine + 1}`,
      reason: 'fallback-line-not-task',
    }
  }

  if (String(taskMatch[2] || '').toLowerCase() === 'x') {
    return {
      engine: 'markdown-fallback',
      done: true,
      ref: `${queueRelativePath}:${targetLine + 1}`,
      mode: 'already-checked',
    }
  }

  lines[targetLine] = `${taskMatch[1]}x${taskMatch[3]}`
  await writeFile(paths.promotionQueue, `${lines.join('\n')}\n`, 'utf-8')
  return {
    engine: 'markdown-fallback',
    done: true,
    ref: `${queueRelativePath}:${targetLine + 1}`,
    mode: 'token-mark',
  }
}

async function markPromotionQueueTaskDone(payload = {}) {
  const paths = await ensureVaultScaffold()
  const cliEnabled = isObsidianCliEnabled()
  const queueRelativePath = `inbox/${path.basename(paths.promotionQueue)}`
  const payloadRef = normalizePromotionQueueTaskRef(payload?.taskRef, queueRelativePath)
  const token = buildPromotionQueueTaskToken(payload)
  if (String(payload?.decision || '').trim() === 'revoke') {
    return {
      engine: cliEnabled ? 'obsidian-cli' : 'markdown-fallback',
      done: false,
      token,
      reason: 'revoke-skipped',
    }
  }

  if (!cliEnabled) {
    const fallback = await markPromotionQueueTaskDoneFallback(paths, {
      token,
      ref: payloadRef || '',
    }).catch(() => null)
    if (fallback?.done) {
      return {
        ...fallback,
        token,
      }
    }
    return {
      engine: 'markdown-fallback',
      done: false,
      token,
      ref: payloadRef || '',
      reason: fallback?.reason || 'cli-disabled-and-fallback-failed',
    }
  }

  let tokenTodoRef = ''
  let tokenMarkdownRef = ''
  if (token) {
    const [refsByToken, markdownRef] = await Promise.all([
      loadPromotionQueueTaskOpenRefs(paths, {
        ensureReady: true,
        autoLaunch: true,
        timeoutMs: 4200,
        readyTimeoutMs: 5000,
        probeTimeoutMs: 1200,
      }).catch(() => new Map()),
      loadPromotionQueueTaskRefFromMarkdown(paths, token).catch(() => ''),
    ])
    tokenTodoRef = String(refsByToken.get(token) || '').trim()
    tokenMarkdownRef = normalizePromotionQueueTaskRef(markdownRef, queueRelativePath)
  }
  const refs = dedupeList([payloadRef, tokenTodoRef, tokenMarkdownRef], 3).filter(Boolean)
  if (!refs.length) {
    const fallback = await markPromotionQueueTaskDoneFallback(paths, {
      token,
      ref: payloadRef || tokenMarkdownRef || '',
    }).catch(() => null)
    if (fallback?.done) {
      return {
        ...fallback,
        token,
      }
    }
    return {
      engine: 'obsidian-cli',
      done: false,
      token,
      ref: payloadRef || tokenTodoRef || tokenMarkdownRef,
      reason: 'task-ref-missing',
    }
  }
  for (const ref of refs) {
    try {
      await runObsidianCli(['task', 'done', `ref=${ref}`], {
        ensureReady: true,
        autoLaunch: true,
        timeoutMs: 5000,
        readyTimeoutMs: 5000,
        probeTimeoutMs: 1200,
      })
      return {
        engine: 'obsidian-cli',
        done: true,
        token,
        ref,
      }
    } catch {
      // Try the next ref candidate. Obsidian task indexing can lag right after queue rewrites.
    }
  }
  const fallback = await markPromotionQueueTaskDoneFallback(paths, {
    token,
    ref: refs[0] || payloadRef || tokenMarkdownRef || '',
  }).catch(() => null)
  if (fallback?.done) {
    return {
      ...fallback,
      token,
    }
  }
  return {
    engine: 'obsidian-cli',
    done: false,
    token,
    ref: refs[0] || payloadRef || tokenTodoRef || tokenMarkdownRef || '',
    error: 'task-done-failed',
  }
}

function mergePromotionQueueItems(items = []) {
  const merged = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    const key = buildPromotionQueueIdentity(item)
    if (!key) continue
    const previous = merged.get(key)
    if (!previous) {
      merged.set(key, item)
      continue
    }

    const preferCurrent = item?.sourceKind === 'manual-submit' && previous?.sourceKind !== 'manual-submit'
    const base = preferCurrent ? item : previous
    const overlay = preferCurrent ? previous : item
    merged.set(key, {
      ...overlay,
      ...base,
      confidence: Math.max(Number(previous?.confidence || 0), Number(item?.confidence || 0)),
      evidenceItems: dedupeList([
        ...(Array.isArray(previous?.evidenceItems) ? previous.evidenceItems : []),
        ...(Array.isArray(item?.evidenceItems) ? item.evidenceItems : []),
      ], 12),
      suggestedActions: dedupeList([
        ...(Array.isArray(previous?.suggestedActions) ? previous.suggestedActions : []),
        ...(Array.isArray(item?.suggestedActions) ? item.suggestedActions : []),
      ], 6),
      updatedAt: String(base?.updatedAt || overlay?.updatedAt || ''),
    })
  }
  return Array.from(merged.values())
}

const TASK_SEGMENT_LOW_CONTEXT_PATTERNS = [
  /^可以[，,\s]*(继续|了)?$/u,
  /^继续[吧呀啊]?$/u,
  /^然后呢[？?]?$/u,
  /^这个呢[？?]?$/u,
  /^还有呢[？?]?$/u,
  /^行[吧呀啊]?$/u,
  /^好的?$/u,
  /^嗯[嗯啊哦]?$/u,
  /^ok$/iu,
  /^按照?(刚才|上面|前面)那个/u,
]

function getTaskSegmentMessageRole(value) {
  return String(value || '').trim().toLowerCase()
}

function getTaskSegmentCorpus(segment) {
  return (Array.isArray(segment?.messages) ? segment.messages : [])
    .map((item) => String(item?.content || ''))
    .join('\n')
}

function extractTaskSegmentFileHints(value = '') {
  const matches = new Set()
  const source = String(value || '')
  for (const match of source.matchAll(/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+(?:\.[A-Za-z0-9_-]+)?/g)) {
    const normalized = String(match[0] || '').trim()
    if (normalized) matches.add(normalized.toLowerCase())
  }
  for (const match of source.matchAll(/\b[A-Za-z0-9._-]+\.(?:ts|tsx|js|jsx|vue|mjs|cjs|json|md|css|scss|html)\b/g)) {
    const normalized = String(match[0] || '').trim()
    if (normalized) matches.add(normalized.toLowerCase())
  }
  return matches
}

function hasTaskSegmentFollowUpCue(value = '') {
  return /^(继续|然后|接着|再看|再改|这里|这个|这个地方|那这里|那现在|现在|所以|基于这个|按这个|照这个|顺着这个)/u
    .test(String(value || '').trim())
}

function hasTaskSegmentExplicitTopicShift(value = '') {
  return /^(另外|另一个|换个|再问一个|新问题|顺便|题外话|切到|回到另外一个)/u
    .test(String(value || '').trim())
}

function countTaskSegmentCodeSignals(value = '') {
  const text = String(value || '')
  const patterns = [
    /```/u,
    /\b(?:const|let|function|return|import|export|await|async|npm|pnpm|node|vue|react|typescript|js|ts)\b/iu,
    /(?:src|server|docs|scripts|components|pages|routes)\/[^\s]+/u,
    /\b(?:error|exception|trace|stack|bug|fix|lint|build|compile|deploy)\b/iu,
  ]
  return patterns.filter((pattern) => pattern.test(text)).length
}

function inferTaskSegmentType(session, firstUserIntent = '', latestAssistantReply = '', segmentCorpus = '') {
  const corpus = [session?.title || '', firstUserIntent, latestAssistantReply, segmentCorpus, ...(session?.tags || [])].join('\n')
  const normalized = String(corpus || '')

  if (TASK_SEGMENT_LOW_CONTEXT_PATTERNS.some((pattern) => pattern.test(firstUserIntent))) return 'context-fragment'
  if (/(bug|报错|异常|修复|定位|无响应|没反应|故障|crash|error|trace)/iu.test(normalized)) return 'bug-investigation'
  if (/(架构|设计|方案|tradeoff|取舍|抽象|拆分|workflow|pipeline|schema)/iu.test(normalized)) return 'architecture-discussion'
  if (/(prompt|提示词|system prompt|instruction|优化 prompt|agent)/iu.test(normalized)) return 'prompt-design'
  if (countTaskSegmentCodeSignals(normalized) >= 2) return 'coding-task'
  if (/(天气|饮食|翻译|常识|怎么说|百科|区别|定义|生活)/u.test(normalized)) return 'general-knowledge'
  if (normalized.length <= 48) return 'chitchat'
  return 'general-knowledge'
}

function areTaskSegmentTypesCompatible(left = '', right = '') {
  if (left === right) return true
  const productTypes = new Set(['bug-investigation', 'coding-task', 'architecture-discussion', 'prompt-design'])
  if (productTypes.has(left) && productTypes.has(right)) return true
  if (left === 'context-fragment' || right === 'context-fragment') return true
  return false
}

function buildTaskTurnSegmentsFromSession(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : []
  const userIndexes = messages
    .map((item, index) => ({ role: getTaskSegmentMessageRole(item?.role), index }))
    .filter((item) => item.role === 'user')
    .map((item) => item.index)

  if (!userIndexes.length) {
    return [{
      id: `${session?.id || 'session'}::segment-1`,
      index: 0,
      total: 1,
      messages,
      firstUserIntent: '',
      latestAssistantReply: clipText(
        String(messages.filter((item) => getTaskSegmentMessageRole(item?.role) === 'assistant').slice(-1)[0]?.content || ''),
        220,
      ),
    }]
  }

  return userIndexes.map((userIndex, segmentIndex) => {
    const nextUserIndex = userIndexes[segmentIndex + 1]
    const startIndex = segmentIndex === 0 ? 0 : userIndex
    const endIndex = typeof nextUserIndex === 'number' ? nextUserIndex - 1 : messages.length - 1
    const segmentMessages = messages.slice(startIndex, endIndex + 1)
    const firstUserIntent = clipText(String(messages[userIndex]?.content || ''), 180)
    const latestAssistantReply = clipText(
      String(segmentMessages.filter((item) => getTaskSegmentMessageRole(item?.role) === 'assistant').slice(-1)[0]?.content || ''),
      220,
    )
    return {
      id: `${session?.id || 'session'}::segment-${segmentIndex + 1}`,
      index: segmentIndex,
      total: userIndexes.length,
      messages: segmentMessages,
      firstUserIntent,
      latestAssistantReply,
    }
  })
}

function shouldMergeTaskSegmentsInSession(session, previous, next) {
  if (hasTaskSegmentExplicitTopicShift(next?.firstUserIntent || '')) return false

  const previousCorpus = [previous?.firstUserIntent || '', previous?.latestAssistantReply || '', getTaskSegmentCorpus(previous)].join('\n')
  const nextCorpus = [next?.firstUserIntent || '', next?.latestAssistantReply || '', getTaskSegmentCorpus(next)].join('\n')
  const previousType = inferTaskSegmentType(session, previous?.firstUserIntent || '', previous?.latestAssistantReply || '', previousCorpus)
  const nextType = inferTaskSegmentType(session, next?.firstUserIntent || '', next?.latestAssistantReply || '', nextCorpus)
  const previousFiles = extractTaskSegmentFileHints(previousCorpus)
  const nextFiles = extractTaskSegmentFileHints(nextCorpus)
  const hasSharedFiles = Array.from(previousFiles).some((file) => nextFiles.has(file))
  const nextLowContext = TASK_SEGMENT_LOW_CONTEXT_PATTERNS.some((pattern) => pattern.test(String(next?.firstUserIntent || '')))
  const nextFollowUp = hasTaskSegmentFollowUpCue(next?.firstUserIntent || '')
  const previousCodeHeavy = countTaskSegmentCodeSignals(previousCorpus) >= 2
  const nextCodeHeavy = countTaskSegmentCodeSignals(nextCorpus) >= 2
  const compatibleTypes = areTaskSegmentTypesCompatible(previousType, nextType)
  const sameProject = hasSharedFiles || Boolean((session?.tags || []).length)

  let score = 0
  if (hasSharedFiles) score += 3
  if (nextLowContext || nextFollowUp) score += 2
  if (previousType === nextType) score += 2
  else if (compatibleTypes) score += 1
  if (sameProject && previousCodeHeavy && nextCodeHeavy) score += 1
  if (String(next?.firstUserIntent || '').length <= 24) score += 1
  if (!compatibleTypes) score -= 2
  if ((previousType === 'general-knowledge') !== (nextType === 'general-knowledge')) score -= 1
  if ((previousType === 'chitchat') !== (nextType === 'chitchat')) score -= 2

  const hasCarrySignal = hasSharedFiles || nextLowContext || nextFollowUp || (sameProject && compatibleTypes && (previousCodeHeavy || nextCodeHeavy))
  return hasCarrySignal && score >= 3
}

function mergeTaskSegmentSlices(parts = []) {
  return parts.reduce((merged, part) => {
    if (!merged) return { ...part, messages: Array.isArray(part?.messages) ? part.messages.slice() : [] }
    return {
      ...merged,
      messages: [...(Array.isArray(merged.messages) ? merged.messages : []), ...(Array.isArray(part?.messages) ? part.messages : [])],
      latestAssistantReply: String(part?.latestAssistantReply || '') || merged.latestAssistantReply,
    }
  }, null)
}

function buildTaskSegmentsForSession(session) {
  const turnSegments = buildTaskTurnSegmentsFromSession(session)
  if (turnSegments.length <= 1) return turnSegments

  const mergedSegments = []
  for (const segment of turnSegments) {
    const previous = mergedSegments[mergedSegments.length - 1]
    if (previous && shouldMergeTaskSegmentsInSession(session, previous, segment)) {
      const nextMerged = mergeTaskSegmentSlices([previous, segment])
      if (nextMerged) mergedSegments[mergedSegments.length - 1] = nextMerged
      continue
    }
    mergedSegments.push({ ...segment, messages: Array.isArray(segment?.messages) ? segment.messages.slice() : [] })
  }

  const total = mergedSegments.length
  return mergedSegments.map((segment, index) => ({
    ...segment,
    id: `${session?.id || 'session'}::segment-${index + 1}`,
    index,
    total,
  }))
}

function buildManualPromotionEvidenceFromSegment(session, segment, sourceEvidence = null) {
  const messages = Array.isArray(segment?.messages) ? segment.messages : []
  const mentionedFiles = extractMentionedFiles(messages)
  const firstUserIntent = String(segment?.firstUserIntent || '')
  const latestAssistantReply = String(segment?.latestAssistantReply || '')
  const assistantVisibleReplies = messages
    .filter((item) => getTaskSegmentMessageRole(item?.role) === 'assistant')
    .map((item) => clipText(String(item?.content || ''), 220))
    .filter(Boolean)
    .slice(-4)
  const bestAssistantAnswer = pickBestAssistantAnswer(
    assistantVisibleReplies,
    firstUserIntent,
    latestAssistantReply,
  )
  const concepts = extractSessionConcepts({
    ...session,
    title: firstUserIntent || session?.title || '',
    messages,
  })
  const project = pickDominantProject([
    String(sourceEvidence?.project || '').trim(),
    ...mentionedFiles.map((item) => inferRepoNameFromFilePath(item)).filter(Boolean),
  ])

  return {
    title: clipText(firstUserIntent || String(sourceEvidence?.title || session?.title || ''), 72),
    provider: String(sourceEvidence?.provider || session?.provider || 'unknown'),
    updatedAt: String(sourceEvidence?.updatedAt || session?.updatedAt || ''),
    messageCount: messages.length,
    sessionId: String(session?.id || ''),
    segmentId: String(segment?.id || ''),
    segmentLabel: `任务段 ${Number(segment?.index || 0) + 1}/${Math.max(1, Number(segment?.total || 1))}`,
    relativePath: String(sourceEvidence?.relativePath || ''),
    firstUserIntent,
    latestAssistantReply,
    bestAssistantAnswer: String(bestAssistantAnswer || sourceEvidence?.bestAssistantAnswer || latestAssistantReply || ''),
    assistantVisibleReplies,
    mentionedFiles: mentionedFiles.length ? mentionedFiles : Array.isArray(sourceEvidence?.mentionedFiles) ? sourceEvidence.mentionedFiles : [],
    concepts: concepts.length ? concepts : Array.isArray(sourceEvidence?.concepts) ? sourceEvidence.concepts : [],
    project: String(project || sourceEvidence?.project || '').trim(),
  }
}

async function buildManualPromotionQueueEntries(sourceEvidences = [], promotionState = {}) {
  const index = await loadIndex().catch(() => ({ sessions: [] }))
  const sessions = Array.isArray(index?.sessions) ? index.sessions : []
  const sourceEvidenceBySessionId = new Map(
    (Array.isArray(sourceEvidences) ? sourceEvidences : [])
      .map((item) => [String(item?.sessionId || '').trim(), item])
      .filter(([sessionId]) => Boolean(sessionId)),
  )

  const issueReviews = []
  const patternCandidates = []
  const synthesisCandidates = []

  for (const session of sessions) {
    const sessionId = String(session?.id || '').trim()
    if (!sessionId) continue
    const segmentReviews = session?.meta?.taskReviewSegments
    if (!segmentReviews || typeof segmentReviews !== 'object') continue
    const segments = buildTaskSegmentsForSession(session)
    const segmentById = new Map(segments.map((segment) => [String(segment?.id || '').trim(), segment]))

    for (const [segmentId, review] of Object.entries(segmentReviews)) {
      const note = String(review?.note || '').trim()
      const status = String(review?.status || 'pending').trim().toLowerCase()
      if (!/knowledge-workbench:\s*promote-candidate/u.test(note) || status !== 'kept') continue
      const segment = segmentById.get(String(segmentId || '').trim())
      if (!segment) continue

      const evidence = buildManualPromotionEvidenceFromSegment(session, segment, sourceEvidenceBySessionId.get(sessionId))
      const evidenceItems = evidence.relativePath ? [evidence.relativePath] : []
      const issueCandidate = buildIssueCandidate(evidence)
      if (issueCandidate) {
        const slug = String(issueCandidate.slug || '').trim()
        if (!slug || promotionState?.issues?.[slug]) continue
        issueReviews.push({
          kind: 'issue-review',
          sourceKind: 'manual-submit',
          sourceLabel: '手动送审',
          segmentId: evidence.segmentId,
          segmentLabel: evidence.segmentLabel,
          title: String(issueCandidate.title || buildPromotionQueueTitle(evidence.firstUserIntent || session?.title || '', 'Issue Review')),
          currentPath: buildIssueRelativePath(slug),
          currentLabel: String(issueCandidate.title || 'Issue'),
          project: String(issueCandidate.project || evidence.project || '').trim(),
          confidence: Math.max(0.68, Number(issueCandidate.confidence || 0)),
          reason: `This candidate was manually forwarded from task review (${evidence.segmentLabel}) and should enter promotion review even before enough corroborating evidence accumulates.`,
          summary: buildIssueReaderSummary({
            title: issueCandidate.title,
            project: issueCandidate.project,
            symptoms: [issueCandidate.symptom].filter(Boolean),
            causes: issueCandidate.causes,
            fixes: issueCandidate.fixes,
            validation: issueCandidate.validation,
            evidenceItems,
            evidenceCount: Math.max(1, evidenceItems.length),
          }),
          suggestedActions: [
            'Review the manually submitted segment first',
            'Promote if the issue is already stable enough to keep as wiki memory',
          ],
          evidenceItems,
          updatedAt: String(evidence.updatedAt || ''),
        })
        continue
      }

      const patternCandidate = buildPatternCandidates(evidence)[0] || null
      if (patternCandidate) {
        const slug = String(patternCandidate.slug || '').trim()
        if (!slug || promotionState?.patterns?.[slug]) continue
        patternCandidates.push({
          kind: 'pattern-candidate',
          sourceKind: 'manual-submit',
          sourceLabel: '手动送审',
          segmentId: evidence.segmentId,
          segmentLabel: evidence.segmentLabel,
          title: String(patternCandidate.title || buildPromotionQueueTitle(evidence.firstUserIntent || session?.title || '', 'Pattern Candidate')),
          targetPath: buildPatternRelativePath(slug),
          project: String(patternCandidate.project || evidence.project || '').trim(),
          confidence: 0.7,
          reason: `This candidate was manually forwarded from task review (${evidence.segmentLabel}) as a reusable pattern worth review.`,
          summary: String(patternCandidate.summary || buildPromotionQueueExcerpt(evidence.bestAssistantAnswer || evidence.latestAssistantReply || evidence.firstUserIntent || '', 'Manual pattern candidate')),
          suggestedActions: [
            'Review the manually submitted segment first',
            'Promote when the reuse shape already feels stable enough',
          ],
          evidenceItems,
          updatedAt: String(evidence.updatedAt || ''),
        })
        continue
      }

      const title = buildPromotionQueueTitle(evidence.firstUserIntent || evidence.title || session?.title || '', '候选结论')
      const targetPath = `syntheses/${toFileSlug(title, `synthesis-${stableHash32(title || segmentId)}`)}.md`
      if (promotionState?.syntheses?.[targetPath]) continue
      synthesisCandidates.push({
        kind: 'synthesis-candidate',
        sourceKind: 'manual-submit',
        sourceLabel: '手动送审',
        segmentId: evidence.segmentId,
        segmentLabel: evidence.segmentLabel,
        title,
        targetPath,
        project: String(evidence.project || '').trim(),
        confidence: Math.max(0.66, scoreSynthesisPromotion(evidence)),
        reason: `This candidate was manually forwarded from task review (${evidence.segmentLabel}) and should be checked as a durable answer page.`,
        summary: buildPromotionQueueExcerpt(evidence.bestAssistantAnswer || evidence.latestAssistantReply || evidence.firstUserIntent || '', 'Manual synthesis candidate'),
        suggestedActions: [
          'Review the manually submitted segment first',
          'Promote if the conclusion still feels durable after a quick scan',
        ],
        evidenceItems,
        updatedAt: String(evidence.updatedAt || ''),
      })
    }
  }

  return {
    issueReviews,
    patternCandidates,
    synthesisCandidates,
  }
}

function buildKnowledgePromotionQueueEntries(knowledgeEvidences = [], promotionState = {}) {
  const issueReviews = []
  const patternCandidates = []
  const synthesisCandidates = []

  for (const evidence of Array.isArray(knowledgeEvidences) ? knowledgeEvidences : []) {
    if (!isKnowledgePromotionQueueCandidate(evidence)) continue
    const evidenceItems = [String(evidence?.relativePath || '')].filter(Boolean)
    if (!evidenceItems.length) continue
    const preferredKind = inferKnowledgePromotionKind(evidence)
    const sourceLabel = '知识采集'
    const common = {
      sourceKind: 'knowledge-item',
      sourceLabel,
      segmentId: String(evidence?.knowledgeItemId || evidence?.segmentId || ''),
      segmentLabel: `${sourceLabel} · ${evidence?.knowledgeSourceType || 'item'}`,
      project: String(evidence?.project || '').trim(),
      evidenceItems,
      updatedAt: String(evidence?.updatedAt || ''),
    }

    if (preferredKind === 'issue-review') {
      const issueCandidate = buildIssueCandidate(evidence)
      if (issueCandidate?.slug && !promotionState?.issues?.[issueCandidate.slug]) {
        issueReviews.push({
          ...common,
          kind: 'issue-review',
          title: String(issueCandidate.title || buildPromotionQueueTitle(evidence.firstUserIntent || evidence.title || '', 'Issue Review')),
          currentPath: buildIssueRelativePath(issueCandidate.slug),
          currentLabel: String(issueCandidate.title || 'Issue'),
          confidence: getKnowledgeConfidenceScore(evidence, Math.max(0.62, Number(issueCandidate.confidence || 0))),
          reason: 'Raw Inbox 条目已标记为 Wiki 编译原料，并带有明显问题/故障信号，适合进入 Issue Review。',
          summary: buildIssueReaderSummary({
            title: issueCandidate.title,
            project: issueCandidate.project,
            symptoms: [issueCandidate.symptom].filter(Boolean),
            causes: issueCandidate.causes,
            fixes: issueCandidate.fixes,
            validation: issueCandidate.validation,
            evidenceItems,
            evidenceCount: evidenceItems.length,
          }),
          suggestedActions: [
            '核对采集内容是否足够描述症状、原因和修复路径',
            '确认后升格为 issue note，证据会回链到 Raw Inbox 证据页',
          ],
        })
        continue
      }
    }

    if (preferredKind === 'pattern-candidate') {
      const patternCandidate = buildPatternCandidates(evidence)[0] || null
      if (patternCandidate?.slug && !promotionState?.patterns?.[patternCandidate.slug]) {
        patternCandidates.push({
          ...common,
          kind: 'pattern-candidate',
          title: String(patternCandidate.title || buildPromotionQueueTitle(evidence.firstUserIntent || evidence.title || '', 'Pattern Candidate')),
          targetPath: buildPatternRelativePath(patternCandidate.slug),
          confidence: getKnowledgeConfidenceScore(evidence, 0.64),
          reason: 'Raw Inbox 条目已标记为 Wiki 编译原料，并包含可复用做法或架构形状。',
          summary: String(patternCandidate.summary || buildPromotionQueueExcerpt(evidence.bestAssistantAnswer || evidence.latestAssistantReply || evidence.firstUserIntent || '', 'Knowledge pattern candidate')),
          suggestedActions: [
            '检查这条采集是否已经脱离单次上下文',
            '确认复用边界后升格为 pattern note',
          ],
        })
        continue
      }
    }

    const title = buildPromotionQueueTitle(evidence.firstUserIntent || evidence.title || '', '候选结论')
    const targetPath = `syntheses/${toFileSlug(title, `synthesis-${stableHash32(title || evidence.relativePath || '')}`)}.md`
    if (promotionState?.syntheses?.[targetPath]) continue
    synthesisCandidates.push({
      ...common,
      kind: 'synthesis-candidate',
      title,
      targetPath,
      confidence: getKnowledgeConfidenceScore(evidence, Math.max(0.6, scoreSynthesisPromotion(evidence))),
      reason: 'Raw Inbox 条目已标记为 Wiki 编译原料，适合先作为长期结论页候选进入审核。',
      summary: buildPromotionQueueExcerpt(evidence.bestAssistantAnswer || evidence.latestAssistantReply || evidence.firstUserIntent || '', 'Knowledge synthesis candidate'),
      suggestedActions: [
        '检查采集内容是否已经足够自洽',
        '确认后升格为 synthesis note，后续可继续补证',
      ],
    })
  }

  return {
    issueReviews,
    patternCandidates,
    synthesisCandidates,
  }
}

function collectApprovedPromotionEvidencePaths(promotionState = {}) {
  return new Set(
    [
      ...Object.values(promotionState.issues || {}),
      ...Object.values(promotionState.patterns || {}),
      ...Object.values(promotionState.syntheses || {}),
    ]
      .filter((record) => isApprovedPromotionRecord(record))
      .flatMap((record) => (Array.isArray(record?.evidenceItems) ? record.evidenceItems : []))
      .map((item) => normalizeVaultRelativePath(item))
      .filter(Boolean),
  )
}

async function patchKnowledgePromotionLifecycle(payload = {}) {
  const decision = String(payload?.decision || '').trim()
  const kind = String(payload?.kind || '').trim()
  const relativePath = normalizeVaultRelativePath(payload?.relativePath || '')
  const evidenceItems = dedupeList(Array.isArray(payload?.evidenceItems) ? payload.evidenceItems : [], 12)
    .map((item) => normalizeVaultRelativePath(item))
    .filter(Boolean)
  const ids = new Set()
  const directId = String(payload?.knowledgeItemId || '').trim()
  const segmentId = String(payload?.segmentId || '').trim()
  if (directId) ids.add(directId)
  if (String(payload?.sourceKind || '').trim() === 'knowledge-item' && segmentId) ids.add(segmentId)

  if (evidenceItems.some((item) => item.startsWith('inbox/knowledge__'))) {
    const evidences = await loadKnowledgePromotionEvidences({ writeEvidence: false })
    const evidencePathSet = new Set(evidenceItems)
    for (const evidence of evidences) {
      if (evidencePathSet.has(normalizeVaultRelativePath(evidence?.relativePath || '')) && evidence?.knowledgeItemId) {
        ids.add(String(evidence.knowledgeItemId || '').trim())
      }
    }
  }

  if (!ids.size) return []

  const promotionDecision = decision === 'approve'
    ? 'approved'
    : decision === 'dismiss'
      ? 'dismissed'
      : 'revoked'
  const updated = []
  for (const id of ids) {
    const item = await patchKnowledgeItemMetaInDb({
      id,
      status: 'active',
      metaPatch: {
        promotionDecision,
        promotionKind: kind,
        promotionTargetPath: relativePath,
        promotionTitle: String(payload?.title || '').trim(),
        promotionProject: String(payload?.project || '').trim(),
        promotionSummary: String(payload?.summary || '').trim(),
        promotionDecidedAt: String(payload?.decidedAt || new Date().toISOString()),
        intakeStage: promotionDecision === 'revoked' ? 'wiki-candidate' : 'reference-only',
      },
    }).catch(() => null)
    if (item) updated.push(item)
  }

  return updated
}

export async function buildPromotionQueue(options = {}) {
  const paths = await ensureVaultScaffold()
  const promotionState = await loadPromotionState()
  const approvedIssueRecords = Object.values(promotionState.issues || {}).filter((record) => isApprovedPromotionRecord(record))
  const approvedPatternRecords = Object.values(promotionState.patterns || {}).filter((record) => isApprovedPromotionRecord(record))
  const approvedSynthesisRecords = Object.values(promotionState.syntheses || {}).filter((record) => isApprovedPromotionRecord(record))
  let sourceEvidences = Array.isArray(options.sourceEvidences) ? options.sourceEvidences : []
  let knowledgeEvidences = Array.isArray(options.knowledgeEvidences) ? options.knowledgeEvidences : []
  let issues = Array.isArray(options.issues) ? options.issues : []
  let patterns = Array.isArray(options.patterns) ? options.patterns : []

  if (!sourceEvidences.length) {
    sourceEvidences = await loadPublishedSourceEvidences()
  }
  if (!knowledgeEvidences.length) {
    knowledgeEvidences = await loadKnowledgePromotionEvidences({
      writeEvidence: options.writeReport !== false,
    })
  }

  if (!issues.length) {
    issues = Array.from(groupIssueCandidates(
      sourceEvidences
        .map((item) => buildIssueCandidate(item))
        .filter((item) => item && Number(item.confidence || 0) >= 0.55),
    ).values()).map((group) => {
      const allCandidates = Array.isArray(group.candidates) ? group.candidates : []
      return {
        slug: group.slug,
        title: String(group.title || 'Issue'),
        project: pickDominantProject(allCandidates.map((item) => item?.project || '')),
        symptoms: dedupeList(allCandidates.map((item) => item?.symptom || ''), 5),
        causes: dedupeList(allCandidates.flatMap((item) => item?.causes || []), 6),
        fixes: dedupeList(allCandidates.flatMap((item) => item?.fixes || []), 6),
        validation: dedupeList(allCandidates.flatMap((item) => item?.validation || []), 6),
        evidenceItems: dedupeList(allCandidates.map((item) => item?.evidence?.relativePath || ''), 20),
        evidenceCount: allCandidates.length,
      }
    })
  }

  if (!patterns.length) {
    const files = await readdir(paths.patternsDir, { withFileTypes: true }).catch(() => [])
    patterns = []
    for (const item of files) {
      if (!item.isFile() || !item.name.endsWith('.md') || item.name === 'README.md') continue
      const markdown = await readFile(path.join(paths.patternsDir, item.name), 'utf-8').catch(() => '')
      if (!markdown) continue
      patterns.push({
        slug: parseSimpleFrontmatterValue(markdown, 'pattern'),
        title: parseSimpleFrontmatterValue(markdown, 'title'),
      })
    }
  }

  const issueReviews = issues
    .filter((issue) => Number(issue?.evidenceCount || 0) <= 1)
    .filter((issue) => !promotionState.issues[String(issue?.slug || '').trim()])
    .map((issue) => ({
      kind: 'issue-review',
      sourceKind: 'auto-generated',
      sourceLabel: '自动候选',
      title: String(issue?.title || 'Issue Review'),
      currentPath: buildIssueRelativePath(issue?.slug || ''),
      currentLabel: String(issue?.title || 'Issue'),
      project: String(issue?.project || '').trim(),
      confidence: 0.58,
      reason: 'This issue is backed by only one evidence note, so it stays draft until more corroborating evidence arrives or a human confirms it.',
      summary: buildIssueReaderSummary(issue),
      suggestedActions: [
        'Look for more similar source notes to merge into this issue',
        'Promote manually if this bug is already stable and worth keeping',
      ],
      evidenceItems: Array.isArray(issue?.evidenceItems) ? issue.evidenceItems.slice(0, 6) : [],
    }))
    .sort((a, b) => (b.evidenceItems?.length || 0) - (a.evidenceItems?.length || 0) || a.title.localeCompare(b.title))

  const publishedPatternSlugs = new Set([
    ...(Array.isArray(patterns) ? patterns : []).map((item) => String(item?.slug || '').trim()).filter(Boolean),
    ...Object.keys(promotionState.patterns || {}),
  ])
  const groupedPatternCandidates = groupPatternCandidates(
    sourceEvidences.flatMap((item) => buildPatternCandidates(item)),
  )
  const patternCandidates = Array.from(groupedPatternCandidates.values())
    .map((group) => {
      const candidates = Array.isArray(group?.candidates) ? group.candidates : []
      const evidenceItems = dedupeList(candidates.map((item) => item?.evidence?.relativePath || ''), 8)
      const project = pickDominantProject(candidates.map((item) => item?.project || ''))
      return {
        slug: group.slug,
        title: String(group.title || 'Pattern Candidate'),
        summary: String(group.summary || ''),
        project,
        evidenceItems,
      }
    })
    .filter((item) => !publishedPatternSlugs.has(item.slug))
    .filter((item) => item.evidenceItems.length >= 1)
    .map((item) => ({
      kind: 'pattern-candidate',
      sourceKind: 'auto-generated',
      sourceLabel: '自动候选',
      title: item.title,
      targetPath: buildPatternRelativePath(item.slug),
      project: item.project,
      confidence: item.evidenceItems.length >= 2 ? 0.72 : 0.56,
      reason: item.evidenceItems.length >= 2
        ? 'This pattern already appears in multiple evidence notes and looks close to promotion.'
        : 'This pattern shape looks reusable, but it currently appears in only one evidence note.',
      summary: item.summary,
      suggestedActions: item.evidenceItems.length >= 2
        ? ['Promote into a reader-first pattern note', 'Check whether tradeoffs and repo examples are stable enough']
        : ['Wait for another corroborating source', 'Promote manually only if the reuse value is already obvious'],
      evidenceItems: item.evidenceItems,
    }))
    .sort((a, b) => (b.evidenceItems?.length || 0) - (a.evidenceItems?.length || 0) || a.title.localeCompare(b.title))

  const synthesisSeen = new Set()
  const synthesisCandidates = sourceEvidences
    .map((evidence) => {
      const confidence = scoreSynthesisPromotion(evidence)
      const title = buildPromotionQueueTitle(evidence?.firstUserIntent || evidence?.title || '', '候选结论')
      const targetPath = `syntheses/${toFileSlug(title, `synthesis-${stableHash32(title || evidence?.relativePath || '')}`)}.md`
      return {
        kind: 'synthesis-candidate',
        sourceKind: 'auto-generated',
        sourceLabel: '自动候选',
        title,
        targetPath,
        project: String(evidence?.project || '').trim(),
        confidence,
        reason: 'This source looks question-driven and may deserve a durable synthesis note instead of staying only in chat history.',
        summary: buildPromotionQueueExcerpt(evidence?.bestAssistantAnswer || evidence?.latestAssistantReply || evidence?.firstUserIntent || '', 'Potential synthesis candidate'),
        suggestedActions: [
          'Promote if the conclusion still feels durable after a quick manual scan',
          'Prefer synthesis over issue/pattern only when the page is clearly answer-driven',
        ],
        evidenceItems: [String(evidence?.relativePath || '')].filter(Boolean),
        updatedAt: String(evidence?.updatedAt || ''),
      }
    })
    .filter((item) => Number(item.confidence || 0) >= 0.55)
    .filter((item) => !promotionState.syntheses[String(item.targetPath || '').trim()])
    .filter((item) => {
      if (!item.targetPath || synthesisSeen.has(item.targetPath)) return false
      synthesisSeen.add(item.targetPath)
      return true
    })
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, 12)

  const manualQueue = await buildManualPromotionQueueEntries(sourceEvidences, promotionState)
  const knowledgeQueue = buildKnowledgePromotionQueueEntries(knowledgeEvidences, promotionState)
  const mergedIssueReviews = mergePromotionQueueItems([
    ...issueReviews,
    ...manualQueue.issueReviews,
    ...knowledgeQueue.issueReviews,
  ]).sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0) || a.title.localeCompare(b.title))
  const mergedPatternCandidates = mergePromotionQueueItems([
    ...patternCandidates,
    ...manualQueue.patternCandidates,
    ...knowledgeQueue.patternCandidates,
  ]).sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0) || a.title.localeCompare(b.title))
  const mergedSynthesisCandidates = mergePromotionQueueItems([
    ...synthesisCandidates,
    ...manualQueue.synthesisCandidates,
    ...knowledgeQueue.synthesisCandidates,
  ]).sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  const taskMetadata = await buildPromotionQueueTaskMetadata(paths)
  const queueIssueReviews = attachPromotionQueueTaskMetadata(mergedIssueReviews, taskMetadata)
  const queuePatternCandidates = attachPromotionQueueTaskMetadata(mergedPatternCandidates, taskMetadata)
  const queueSynthesisCandidates = attachPromotionQueueTaskMetadata(mergedSynthesisCandidates, taskMetadata)

  const approvedIssues = approvedIssueRecords
    .map((record) => ({
      kind: 'issue-review',
      sourceKind: 'manual-review',
      sourceLabel: '人工确认',
      title: String(record?.title || 'Issue'),
      currentPath: normalizeVaultRelativePath(record?.currentPath || ''),
      project: String(record?.project || '').trim(),
      summary: String(record?.summary || '').trim(),
      evidenceItems: dedupeList(Array.isArray(record?.evidenceItems) ? record.evidenceItems : [], 12),
      updatedAt: String(record?.updatedAt || record?.approvedAt || '').trim(),
    }))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))

  const approvedPatterns = approvedPatternRecords
    .map((record) => ({
      kind: 'pattern-candidate',
      sourceKind: 'manual-review',
      sourceLabel: '人工确认',
      title: String(record?.title || 'Pattern'),
      targetPath: normalizeVaultRelativePath(record?.targetPath || ''),
      project: String(record?.project || '').trim(),
      summary: String(record?.summary || '').trim(),
      evidenceItems: dedupeList(Array.isArray(record?.evidenceItems) ? record.evidenceItems : [], 12),
      updatedAt: String(record?.updatedAt || record?.approvedAt || '').trim(),
    }))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))

  const approvedSyntheses = approvedSynthesisRecords
    .map((record) => ({
      kind: 'synthesis-candidate',
      sourceKind: 'manual-review',
      sourceLabel: '人工确认',
      title: String(record?.title || 'Synthesis'),
      targetPath: normalizeVaultRelativePath(record?.targetPath || ''),
      project: String(record?.project || '').trim(),
      summary: String(record?.summary || '').trim(),
      evidenceItems: dedupeList(Array.isArray(record?.evidenceItems) ? record.evidenceItems : [], 12),
      updatedAt: String(record?.updatedAt || record?.approvedAt || '').trim(),
    }))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))

  const summary = {
    totalItems: queueIssueReviews.length + queuePatternCandidates.length + queueSynthesisCandidates.length,
    issueReviewCount: queueIssueReviews.length,
    patternCandidateCount: queuePatternCandidates.length,
    synthesisCandidateCount: queueSynthesisCandidates.length,
    approvedIssueCount: approvedIssues.length,
    approvedPatternCount: approvedPatterns.length,
    approvedSynthesisCount: approvedSyntheses.length,
    openTaskCount: [...queueIssueReviews, ...queuePatternCandidates, ...queueSynthesisCandidates]
      .filter((item) => item?.taskChecked !== true)
      .length,
  }
  const report = {
    generatedAt: new Date().toISOString(),
    summary,
    issueReviews: queueIssueReviews,
    patternCandidates: queuePatternCandidates,
    synthesisCandidates: queueSynthesisCandidates,
    approvedIssues,
    approvedPatterns,
    approvedSyntheses,
    reportPath: `inbox/${path.basename(paths.promotionQueue)}`,
  }

  if (options.writeReport !== false) {
    await writeFile(paths.promotionQueue, buildPromotionQueueMarkdown(report), 'utf-8')
  }

  return report
}

export async function rebuildSynthesisPages(sourceEvidences = []) {
  const paths = await ensureVaultScaffold()
  const promotionState = await loadPromotionState()
  const evidenceByPath = new Map(
    (Array.isArray(sourceEvidences) ? sourceEvidences : []).map((item) => [String(item?.relativePath || ''), item]),
  )
  const syntheses = Object.values(promotionState.syntheses || {})
    .filter((item) => isApprovedPromotionRecord(item))
    .filter((item) => item?.targetPath)
    .sort((a, b) => String(b?.updatedAt || b?.approvedAt || '').localeCompare(String(a?.updatedAt || a?.approvedAt || '')))

  const expected = new Set(['README.md', ...syntheses.map((item) => path.basename(String(item.targetPath || '')))])
  const existingFiles = await readdir(paths.synthesesDir, { withFileTypes: true }).catch(() => [])
  for (const item of existingFiles) {
    if (!item.isFile() || item.name === 'README.md') continue
    if (expected.has(item.name)) continue
    await unlink(path.join(paths.synthesesDir, item.name)).catch(() => {})
  }

  for (const record of syntheses) {
    const targetPath = normalizeVaultRelativePath(record.targetPath || '')
    if (!targetPath) continue

    const filePath = path.join(paths.root, targetPath)
    const existingMarkdownResult = await readExistingMarkdownWithTemplateSeed(targetPath, filePath, 'Synthesis Note')
    const existingMarkdown = existingMarkdownResult.markdown
    const manualNotes = extractManualNotes(existingMarkdown)
    const evidenceItems = dedupeList(Array.isArray(record.evidenceItems) ? record.evidenceItems : [], 12)
      .map((item) => normalizeVaultRelativePath(item))
      .filter(Boolean)
    const evidenceDigests = evidenceItems.map((item) => evidenceByPath.get(item)).filter(Boolean)
    const title = String(record.title || buildPromotionQueueTitle(evidenceDigests[0]?.firstUserIntent || '', 'Synthesis')).trim()
    const question = String(record.question || evidenceDigests[0]?.firstUserIntent || '').trim()
    const project = String(record.project || pickDominantProject(evidenceDigests.map((item) => item?.project || '')) || '').trim()
    const summary = String(record.summary || buildPromotionQueueExcerpt(evidenceDigests[0]?.bestAssistantAnswer || evidenceDigests[0]?.latestAssistantReply || question, '待补充结论')).trim()
    const openQuestions = extractMarkdownSection(existingMarkdown, 'Open Questions')
      || extractMarkdownSection(existingMarkdown, 'Follow-up Questions')
      || `- ${escapeMarkdownText(question || '这个结论还缺少哪些补证？')}`
    const supportingPoints = dedupeList([
      ...evidenceDigests.map((item) => buildPromotionQueueExcerpt(item?.bestAssistantAnswer || item?.latestAssistantReply || '', '')),
      ...evidenceDigests.map((item) => buildPromotionQueueExcerpt(item?.firstUserIntent || '', '')),
    ].filter(Boolean), 4)
    const reasoningPoints = dedupeList([
      project ? `当前结论主要落在 ${project} 这条工作线上。` : '',
      evidenceItems.length >= 2 ? `已有 ${evidenceItems.length} 条 source evidence 指向相近问题，可以先沉淀为长期答案页。` : '目前主要来自单条 source evidence，后续需要继续补证。',
      ...evidenceDigests
        .map((item) => buildPromotionQueueExcerpt(item?.bestAssistantAnswer || item?.latestAssistantReply || '', ''))
        .filter((item) => String(item || '').length >= 48),
    ], 4)
    const uncertaintyPoints = dedupeList([
      evidenceItems.length < 2 ? '还缺少更多独立来源来验证这个结论是否稳定。' : '不同上下文下的适用边界仍需要继续补证。',
      !project ? '项目归属还不够稳定，后续可以再补项目入口页与交叉链接。' : '',
    ].filter(Boolean), 3)

    const lines = [
      ...buildMarkdownFrontmatter({
        title,
        type: 'synthesis-note',
        schemaVersion: READER_PAGE_SCHEMA_VERSION,
        question,
        project,
        status: 'active',
        evidenceCount: evidenceItems.length,
        updatedAt: record.updatedAt || record.approvedAt || new Date().toISOString(),
        promotionState: 'approved',
        approvedAt: record.approvedAt || '',
      }),
      `# ${escapeMarkdownText(title)}`,
      '',
      '> [!summary] Main Conclusion',
      `> ${escapeMarkdownText(summary || '待补充结论。')}`,
      '',
      '## Short Answer',
      '',
      summary ? escapeMarkdownText(summary) : '待补充结论。',
      '',
    ]

    lines.push(...renderConceptBulletSection('Main Decisions Or Claims', supportingPoints, '_待补充更稳定的结论要点。_'))
    lines.push(...renderConceptBulletSection('Why This Conclusion Holds', reasoningPoints, '_当前主要基于 source evidence 的初步归纳。_'))
    lines.push(...renderConceptBulletSection('Counterpoints Or Uncertainty', uncertaintyPoints, '_暂无。_'))
    lines.push(...renderMarkdownSection(
      'Evidence',
      evidenceItems.map((item) => `- ${toWikiLink(item)}`),
      '- _No evidence links recorded yet._',
    ))
    lines.push(...renderMarkdownSection('Open Questions', openQuestions, '-'))
    lines.push(...renderMarkdownSection('My Notes', manualNotes, '-'))

    await writeFile(filePath, lines.join('\n'), 'utf-8')
  }

  const readmeLines = [
    '# Syntheses',
    '',
    'Higher-level analyses, comparisons, and memos promoted from source evidence live here.',
    '',
  ]

  if (!syntheses.length) {
    readmeLines.push('_No synthesis pages yet._')
    readmeLines.push('')
  } else {
    for (const item of syntheses) {
      readmeLines.push(`- ${toWikiLink(item.targetPath, item.title || path.basename(item.targetPath, '.md'))}`)
    }
    readmeLines.push('')
  }

  await writeFile(paths.synthesesReadme, readmeLines.join('\n'), 'utf-8')
  return {
    totalSyntheses: syntheses.length,
    syntheses,
  }
}

async function refreshPromotionArtifacts(options = {}) {
  const loaded = await loadPromotionQueueEvidences({ writeEvidence: options.writePromotionQueue !== false })
  const baseSourceEvidences = Array.isArray(options.sourceEvidences) && options.sourceEvidences.length
    ? options.sourceEvidences
    : loaded.sourceEvidences
  const promotionState = await loadPromotionState()
  const approvedKnowledgeEvidences = filterApprovedKnowledgeEvidences(loaded.knowledgeEvidences, promotionState)
  const rebuildSourceEvidences = [...baseSourceEvidences, ...approvedKnowledgeEvidences]
  const conceptCatalog = buildConceptCatalogFromEntries(rebuildSourceEvidences)
  const issueStats = await rebuildIssuePages(rebuildSourceEvidences, {
    conceptCatalog,
  })
  const patternStats = await rebuildPatternPages(rebuildSourceEvidences, {
    issues: issueStats.issues,
    conceptCatalog,
  })
  const projectStats = await rebuildProjectPages(rebuildSourceEvidences, {
    issues: issueStats.issues,
    patterns: patternStats.patterns,
    conceptCatalog,
  })
  const synthesisStats = await rebuildSynthesisPages(rebuildSourceEvidences)
  const promotionStats = await buildPromotionQueue({
    sourceEvidences: baseSourceEvidences,
    knowledgeEvidences: loaded.knowledgeEvidences,
    issues: issueStats.issues,
    patterns: patternStats.patterns,
    writeReport: options.writePromotionQueue !== false,
  })
  const lintStats = await lintWikiVault({
    writeReport: options.writeLintReport !== false,
  })

  return {
    sourceEvidences: rebuildSourceEvidences,
    issueStats,
    patternStats,
    projectStats,
    synthesisStats,
    promotionStats,
    lintStats,
  }
}

export async function cleanSynthesisEvidenceItems(targetPath = '') {
  const normalized = normalizeVaultRelativePath(targetPath)
  if (!normalized || !normalized.startsWith('syntheses/')) {
    throw new Error('只支持 syntheses/ 路径')
  }

  const paths = await ensureVaultScaffold()
  const state = await loadPromotionState()
  const record = state.syntheses?.[normalized]
  if (!record) throw new Error(`未找到 synthesis 记录: ${normalized}`)

  const before = Array.isArray(record.evidenceItems) ? record.evidenceItems : []
  const { access } = await import('node:fs/promises')
  const alive = []
  const removed = []
  for (const item of before) {
    const abs = path.join(paths.root, normalizeVaultRelativePath(item))
    const exists = await access(abs).then(() => true).catch(() => false)
    if (exists) alive.push(item)
    else removed.push(item)
  }

  if (!removed.length) return { ok: true, targetPath: normalized, removed: [], rebuilt: false }

  record.evidenceItems = alive
  record.updatedAt = new Date().toISOString()
  await savePromotionState(state)

  // Rebuild just this synthesis file
  const filePath = path.join(paths.root, normalized)
  const existingMarkdown = await readFile(filePath, 'utf-8').catch(() => '')
  const evidenceByPath = new Map()
  const markdown = renderSynthesisMarkdown(record, evidenceByPath, existingMarkdown)
  await writeFile(filePath, markdown, 'utf-8')

  return { ok: true, targetPath: normalized, removed, rebuilt: true }
}

export async function decidePromotionCandidate(payload = {}) {
  const kind = String(payload?.kind || '').trim()
  if (!['issue-review', 'pattern-candidate', 'synthesis-candidate'].includes(kind)) {
    throw new Error('Unsupported promotion kind')
  }
  const decision = String(payload?.decision || 'approve').trim()
  if (!['approve', 'dismiss', 'revoke'].includes(decision)) {
    throw new Error('Unsupported promotion decision')
  }

  const now = new Date().toISOString()
  const title = String(payload?.title || '').trim()
  const project = String(payload?.project || '').trim()
  const summary = String(payload?.summary || '').trim()
  const evidenceItems = dedupeList(Array.isArray(payload?.evidenceItems) ? payload.evidenceItems : [], 12)
    .map((item) => normalizeVaultRelativePath(item))
    .filter(Boolean)
  const state = await loadPromotionState()

  let relativePath = ''
  if (kind === 'issue-review') {
    const currentPath = normalizeVaultRelativePath(payload?.currentPath || '')
    const issueSlug = toFileSlug(path.posix.basename(currentPath || title, '.md') || title, 'issue')
    relativePath = currentPath || buildIssueRelativePath(issueSlug)
    if (decision === 'revoke') {
      delete state.issues[issueSlug]
    } else {
      state.issues[issueSlug] = {
        slug: issueSlug,
        title: title || issueSlug,
        currentPath: relativePath,
        project,
        summary,
        evidenceItems,
        decision: decision === 'approve' ? 'approved' : 'dismissed',
        sourceKind: 'manual-review',
        approvedAt: state.issues[issueSlug]?.approvedAt || now,
        updatedAt: now,
      }
    }
  }

  if (kind === 'pattern-candidate') {
    const targetPath = normalizeVaultRelativePath(payload?.targetPath || '')
    const patternSlug = toFileSlug(path.posix.basename(targetPath || title, '.md') || title, 'pattern')
    relativePath = targetPath || buildPatternRelativePath(patternSlug)
    if (decision === 'revoke') {
      delete state.patterns[patternSlug]
    } else {
      state.patterns[patternSlug] = {
        slug: patternSlug,
        title: title || patternSlug,
        targetPath: relativePath,
        project,
        summary,
        evidenceItems,
        decision: decision === 'approve' ? 'approved' : 'dismissed',
        sourceKind: 'manual-review',
        approvedAt: state.patterns[patternSlug]?.approvedAt || now,
        updatedAt: now,
      }
    }
  }

  if (kind === 'synthesis-candidate') {
    const targetPath = normalizeVaultRelativePath(payload?.targetPath || '')
      || `syntheses/${toFileSlug(title || 'synthesis', 'synthesis')}.md`
    relativePath = targetPath
    if (decision === 'revoke') {
      delete state.syntheses[targetPath]
    } else {
      state.syntheses[targetPath] = {
        targetPath,
        title: title || path.posix.basename(targetPath, '.md'),
        question: String(payload?.question || '').trim(),
        project,
        summary,
        evidenceItems,
        decision: decision === 'approve' ? 'approved' : 'dismissed',
        sourceKind: 'manual-review',
        approvedAt: state.syntheses[targetPath]?.approvedAt || now,
        updatedAt: now,
      }
    }
  }

  const knowledgeItems = await patchKnowledgePromotionLifecycle({
    ...payload,
    decision,
    kind,
    title,
    project,
    summary,
    relativePath,
    evidenceItems,
    decidedAt: now,
  })
  const taskSync = await markPromotionQueueTaskDone({
    kind,
    sourceKind: String(payload?.sourceKind || '').trim(),
    segmentId: String(payload?.segmentId || '').trim(),
    taskToken: String(payload?.taskToken || '').trim(),
    title,
    currentPath: kind === 'issue-review' ? relativePath : '',
    targetPath: kind === 'issue-review' ? '' : relativePath,
    taskRef: String(payload?.taskRef || '').trim(),
    decision,
  })

  await savePromotionState(state)
  const refreshed = await refreshPromotionArtifacts({
    writePromotionQueue: true,
    writeLintReport: true,
  })

  return {
    ok: true,
    decision,
    kind,
    relativePath,
    promotionStats: refreshed.promotionStats,
    lintStats: refreshed.lintStats,
    issueStats: refreshed.issueStats,
    patternStats: refreshed.patternStats,
    synthesisStats: refreshed.synthesisStats,
    knowledgeItems,
    taskSync,
  }
}

export async function applyPromotionCandidate(payload = {}) {
  return decidePromotionCandidate({
    ...payload,
    decision: 'approve',
  })
}

async function loadLintNotes() {
  const paths = await ensureVaultScaffold()
  const specs = [
    { space: 'root', dir: paths.root, include: ['README.md', 'Home.md', 'index.md', 'AGENTS.md', 'log.md'] },
    { space: 'sources', dir: paths.sourcesDir },
    { space: 'providers', dir: paths.providersDir },
    { space: 'projects', dir: paths.projectsDir },
    { space: 'patterns', dir: paths.patternsDir },
    { space: 'issues', dir: paths.issuesDir },
    { space: 'syntheses', dir: paths.synthesesDir },
    { space: 'concepts', dir: paths.conceptsDir },
    { space: 'entities', dir: paths.entitiesDir },
    { space: 'inbox', dir: paths.inboxDir, prefixes: ['knowledge__'] },
    { space: 'Templates', dir: paths.templatesDir },
  ]
  const notes = []

  for (const spec of specs) {
      const entries = await readdir(spec.dir, { withFileTypes: true }).catch(() => [])
    for (const item of entries) {
      if (!item.isFile() || !item.name.endsWith('.md')) continue
      if (Array.isArray(spec.include) && !spec.include.includes(item.name)) continue
      if (Array.isArray(spec.prefixes) && !spec.prefixes.some((prefix) => item.name.startsWith(prefix))) continue
      const relativePath = spec.space === 'root' ? item.name : `${spec.space}/${item.name}`
      const markdown = await readFile(path.join(spec.dir, item.name), 'utf-8').catch(() => '')
      if (!markdown) continue
      const title = parseSimpleFrontmatterValue(markdown, 'title')
        || normalizeText(markdown.match(/^#\s+(.+)$/m)?.[1] || '')
        || item.name.replace(/\.md$/i, '')
      const type = parseSimpleFrontmatterValue(markdown, 'type')
      const summary = extractLintSummary(markdown)
      const body = stripFrontmatter(markdown)
      const bodyText = normalizeText(body.replace(/```[\s\S]*?```/g, ' '))
      const wikiPath = toWikiPath(relativePath)
      const outboundLinks = parseWikiLinks(markdown)
      notes.push({
        relativePath,
        wikiPath,
        title,
        type,
        space: spec.space,
        status: parseSimpleFrontmatterValue(markdown, 'status'),
        summary,
        markdown,
        body,
        bodyText,
        outboundLinks,
        evidenceCount: Number(parseSimpleFrontmatterValue(markdown, 'evidenceCount') || 0),
        sessionCount: Number(parseSimpleFrontmatterValue(markdown, 'sessionCount') || 0),
        project: parseSimpleFrontmatterValue(markdown, 'project'),
        updatedAt: parseSimpleFrontmatterValue(markdown, 'updatedAt'),
      })
    }
  }

  return notes
}

export async function lintWikiVault(options = {}) {
  const paths = await ensureVaultScaffold()
  let notes = await loadLintNotes()
  let noteByWikiPath = new Map(notes.map((item) => [item.wikiPath, item]))
  const missingProviderTargets = collectMissingProviderTargetsForLint(notes, noteByWikiPath)
  if (missingProviderTargets.length) {
    const calibration = await runLintProviderHubCalibration(missingProviderTargets)
    if (calibration.applied) {
      notes = await loadLintNotes()
      noteByWikiPath = new Map(notes.map((item) => [item.wikiPath, item]))
    }
  }
  const inboundCounts = new Map(notes.map((item) => [item.wikiPath, 0]))
  const readerFirstInboundCounts = new Map(notes.map((item) => [item.wikiPath, 0]))
  const findings = []
  const legacyBrokenLinks = []
  const duplicateTitleGroups = []
  const orphans = []
  let brokenLinks = []
  let lintEngine = 'legacy'
  const obsidianLintSnapshot = await loadObsidianLintSnapshot()

  for (const note of notes) {
    if (note.relativePath === 'log.md') continue
    const uniqueTargets = Array.from(new Set(note.outboundLinks))
    for (const target of uniqueTargets) {
      if (!target || /(?:^|\/)\.\.\.(?:\/|$)/.test(target) || target === '...') continue
      if (!noteByWikiPath.has(target)) {
        legacyBrokenLinks.push({ from: note.relativePath, target, title: note.title })
      } else if (target !== note.wikiPath) {
        inboundCounts.set(target, Number(inboundCounts.get(target) || 0) + 1)
        if (isLintReaderFirstNote(note)) {
          readerFirstInboundCounts.set(target, Number(readerFirstInboundCounts.get(target) || 0) + 1)
        }
      }
    }
  }

  if (obsidianLintSnapshot) {
    lintEngine = 'obsidian-cli'
    const unresolved = Array.isArray(obsidianLintSnapshot.unresolved) ? obsidianLintSnapshot.unresolved : []
    const unresolvedTargets = new Set(
      unresolved
        .map((item) => String(item?.target || '').trim().toLowerCase())
        .filter(Boolean),
    )
    const unresolvedWithFrom = dedupeBrokenLinks(unresolved
      .map((item) => {
        if (!item?.from || !item?.target) return null
        const source = noteByWikiPath.get(item.from)
        return {
          from: item.from,
          target: item.target,
          title: source?.title || '',
        }
      })
      .filter(Boolean))
    if (unresolvedWithFrom.length) {
      brokenLinks = unresolvedWithFrom
    } else if (unresolvedTargets.size) {
      brokenLinks = dedupeBrokenLinks(legacyBrokenLinks.filter((item) => unresolvedTargets.has(String(item?.target || '').trim().toLowerCase())))
    }
  }

  if (!brokenLinks.length) {
    brokenLinks = dedupeBrokenLinks(legacyBrokenLinks)
  }

  if (brokenLinks.length) {
    for (const item of brokenLinks) {
      findings.push(createBrokenWikiLinkFinding(item))
    }
  }

  const titleGroups = new Map()
  for (const note of notes.filter((item) => isLintReaderFirstNote(item))) {
    const key = normalizeLintTitleKey(note.title)
    if (!key) continue
    if (!titleGroups.has(key)) titleGroups.set(key, [])
    titleGroups.get(key).push(note)
  }

  for (const group of titleGroups.values()) {
    if (group.length < 2) continue
    duplicateTitleGroups.push(group.map((item) => item.relativePath))
    for (const note of group) {
      findings.push(createLintFinding({
        severity: 'medium',
        code: 'duplicate-title',
        relativePath: note.relativePath,
        title: note.title,
        detail: `Shares the same title with ${group.length - 1} other reader-first notes.`,
        suggestion: 'Merge the pages or make the title more specific.',
      }))
    }
  }

  for (const note of notes) {
    const isReaderFirst = isLintReaderFirstNote(note)
    if (!isReaderFirst) continue

    const inboundCount = Number(inboundCounts.get(note.wikiPath) || 0)
    const orphanedByObsidian = obsidianLintSnapshot?.orphanPaths instanceof Set
      ? obsidianLintSnapshot.orphanPaths.has(note.wikiPath)
      : null
    const isOrphan = orphanedByObsidian === null ? inboundCount === 0 : orphanedByObsidian
    if (isOrphan) {
      orphans.push(note.relativePath)
      findings.push(createLintFinding({
        severity: 'medium',
        code: 'orphan-note',
        relativePath: note.relativePath,
        title: note.title,
        detail: 'No other note in the vault links to this reader-first page.',
        suggestion: 'Link it from a project hub, concept page, or index-like note.',
      }))
    }

    if (note.summary.length < 24) {
      findings.push(createLintFinding({
        severity: 'medium',
        code: 'weak-summary',
        relativePath: note.relativePath,
        title: note.title,
        detail: 'Summary is missing or too short to orient a reader quickly.',
        suggestion: 'Add a stronger summary callout near the top of the page.',
      }))
    }

    if (note.space === 'issues' || note.type === 'issue-note') {
      const causeBody = extractMarkdownSection(note.markdown, 'Likely Causes')
      const fixBody = extractMarkdownSection(note.markdown, 'Fix Pattern')
      const validationBody = extractMarkdownSection(note.markdown, 'Validation')
      const ageDays = daysSinceIso(note.updatedAt)
      if (Number(note.evidenceCount || 0) <= 1 && String(note.status || '').trim().toLowerCase() !== 'draft') {
        findings.push(createLintFinding({
          severity: 'low',
          code: 'thin-issue-evidence',
          relativePath: note.relativePath,
          title: note.title,
          detail: 'Issue page is backed by only one evidence note.',
          suggestion: 'Merge more related sessions into the issue or keep it as draft-level evidence.',
        }))
      }
      if (!note.project) {
        findings.push(createLintFinding({
          severity: 'medium',
          code: 'issue-missing-project',
          relativePath: note.relativePath,
          title: note.title,
          detail: 'Issue note is not linked to a project.',
          suggestion: 'Attach it to a project hub when the repo/workstream is known.',
        }))
      }
      if (isWeakSectionBody(causeBody) || isWeakSectionBody(fixBody) || isWeakSectionBody(validationBody)) {
        findings.push(createLintFinding({
          severity: 'medium',
          code: 'issue-incomplete-troubleshooting',
          relativePath: note.relativePath,
          title: note.title,
          detail: 'One or more troubleshooting sections are missing stable content.',
          suggestion: 'Strengthen cause, fix, and validation sections from source evidence.',
        }))
      }
      if (String(note.status || '').trim().toLowerCase() === 'draft' && Number(note.evidenceCount || 0) <= 1 && ageDays >= 14 && Number.isFinite(ageDays)) {
        findings.push(createLintFinding({
          severity: 'low',
          code: 'stale-draft-issue',
          relativePath: note.relativePath,
          title: note.title,
          detail: `Draft issue has stayed single-evidence for ${ageDays} days.`,
          suggestion: 'Either merge more corroborating evidence into it, promote it manually, or archive it from the reader-first layer.',
        }))
      }
    }

    if (note.space === 'patterns' || note.type === 'pattern-note') {
      const shapeBody = extractMarkdownSection(note.markdown, 'Recommended Shape')
      const tradeoffBody = extractMarkdownSection(note.markdown, 'Tradeoffs')
      if (!note.project) {
        findings.push(createLintFinding({
          severity: 'low',
          code: 'pattern-missing-project',
          relativePath: note.relativePath,
          title: note.title,
          detail: 'Pattern note is not attached to a project hub.',
          suggestion: 'Attach it to a project if it is repo-specific.',
        }))
      }
      if (isWeakSectionBody(shapeBody) || isWeakSectionBody(tradeoffBody)) {
        findings.push(createLintFinding({
          severity: 'medium',
          code: 'pattern-incomplete-shape',
          relativePath: note.relativePath,
          title: note.title,
          detail: 'Pattern note is missing a stable implementation shape or tradeoff section.',
          suggestion: 'Strengthen the reusable shape and tradeoff guidance.',
        }))
      }
    }

    if (note.space === 'projects' || note.type === 'project-hub') {
      const patternBody = extractMarkdownSection(note.markdown, 'Key Patterns')
      const issueBody = extractMarkdownSection(note.markdown, 'Known Issues')
      const hasPatterns = !isWeakSectionBody(patternBody)
      const hasIssues = !isWeakSectionBody(issueBody)
      if (Number(note.evidenceCount || 0) >= 12 && !hasPatterns && !hasIssues) {
        findings.push(createLintFinding({
          severity: 'medium',
          code: 'project-knowledge-gap',
          relativePath: note.relativePath,
          title: note.title,
          detail: `Project hub has ${note.evidenceCount} evidence notes but no promoted issues or patterns yet.`,
          suggestion: 'Promote a few stable issues/patterns so the project page becomes a knowledge hub instead of only an evidence list.',
        }))
      } else if (Number(note.evidenceCount || 0) >= 20 && !hasPatterns) {
        findings.push(createLintFinding({
          severity: 'low',
          code: 'project-missing-patterns',
          relativePath: note.relativePath,
          title: note.title,
          detail: `Project hub has ${note.evidenceCount} evidence notes but still no pattern pages.`,
          suggestion: 'Promote at least one reusable pattern so repeated implementation shapes are easier to revisit.',
        }))
      }
    }

    if (note.space === 'concepts' || note.type === 'concept-hub') {
      const readerFirstInbound = Number(readerFirstInboundCounts.get(note.wikiPath) || 0)
      if (Number(note.sessionCount || 0) >= 6 && readerFirstInbound === 0) {
        findings.push(createLintFinding({
          severity: 'low',
          code: 'concept-unanchored',
          relativePath: note.relativePath,
          title: note.title,
          detail: `Concept appears in ${note.sessionCount} sessions but is not linked from any other reader-first note.`,
          suggestion: 'Anchor it from a project, pattern, issue, or synthesis page so the concept becomes part of the main reading layer.',
        }))
      }
    }
  }

  findings.sort((a, b) => {
    const severityDelta = severityRank(b.severity) - severityRank(a.severity)
    if (severityDelta) return severityDelta
    return `${a.relativePath} ${a.code}`.localeCompare(`${b.relativePath} ${b.code}`)
  })

  const summary = {
    totalNotes: notes.length,
    readerFirstNotes: notes.filter((item) => isLintReaderFirstNote(item)).length,
    totalFindings: findings.length,
    highCount: findings.filter((item) => item.severity === 'high').length,
    mediumCount: findings.filter((item) => item.severity === 'medium').length,
    lowCount: findings.filter((item) => item.severity === 'low').length,
    brokenLinkCount: brokenLinks.length,
    duplicateTitleCount: duplicateTitleGroups.length,
    orphanCount: orphans.length,
  }

  const report = {
    generatedAt: new Date().toISOString(),
    lintEngine,
    summary,
    brokenLinks,
    duplicateTitleGroups,
    orphans,
    findings,
    reportPath: `inbox/${path.basename(paths.lintReport)}`,
  }

  if (options.writeReport !== false) {
    await writeFile(paths.lintReport, buildLintReportMarkdown(report), 'utf-8')
  }

  return report
}

export async function appendVaultLog({ action = 'publish', published = [] } = {}) {
  const paths = await ensureVaultScaffold()
  const timestamp = formatIsoLocal(new Date().toISOString())
  const lines = [`## [${timestamp}] ${action}`, '']

  if (!Array.isArray(published) || !published.length) {
    lines.push('- No files published.')
  } else {
    for (const item of published.slice(0, 30)) {
      lines.push(`- ${toWikiLink(item.relativePath, item.title)} — ${toWikiLink(buildProviderRelativePath(item.provider), item.provider || 'unknown')}`)
    }
    if (published.length > 30) lines.push(`- ...and ${published.length - 30} more`)
  }

  const content = `${lines.join('\n')}\n`
  if (isObsidianCliEnabled()) {
    try {
      await runObsidianCli(['append', 'path=log.md', `content=${content}`], {
        ensureReady: true,
        autoLaunch: true,
        timeoutMs: 6000,
        readyTimeoutMs: 4000,
      })
      return
    } catch {}
  }

  const existing = await readFile(paths.log, 'utf-8').catch(() => '# Vault Log\n\n')
  const fallbackLines = [existing.trimEnd(), '', ...lines, '']
  await writeFile(paths.log, fallbackLines.join('\n'), 'utf-8')
}

async function syncPublishedSessionPropertiesWithObsidian(published = []) {
  if (!isObsidianCliEnabled()) return { engine: 'legacy', synced: 0 }
  const items = (Array.isArray(published) ? published : [])
    .map((item) => ({
      path: String(item?.relativePath || '').trim(),
      updatedAt: String(item?.updatedAt || '').trim(),
    }))
    .filter((item) => item.path.startsWith('sources/'))
  if (!items.length) return { engine: 'obsidian-cli', synced: 0 }
  const ready = await ensureObsidianReady({
    autoLaunch: true,
    readyTimeoutMs: 2500,
    probeTimeoutMs: 900,
  })
  if (!ready) return { engine: 'legacy', synced: 0 }

  let synced = 0
  for (const item of items) {
    try {
      await runObsidianCli(['property:set', 'name=status', 'value=published', `path=${item.path}`], {
        ensureReady: false,
        autoLaunch: false,
        timeoutMs: 4000,
      })
      if (item.updatedAt) {
        await runObsidianCli(['property:set', 'name=updatedAt', `value=${item.updatedAt}`, `path=${item.path}`], {
          ensureReady: false,
          autoLaunch: false,
          timeoutMs: 3000,
        })
      }
      synced += 1
    } catch {}
  }

  return {
    engine: 'obsidian-cli',
    synced,
  }
}
