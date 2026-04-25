import http from 'node:http'
import { URL } from 'node:url'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { loadLocalEnv } from './lib/load-env.mjs'
import {
  deleteSessionById,
  loadIndex,
  loadSources,
  loadSessionsByIds,
  mergeIndex,
  querySessions,
  retrieveChunkCandidates,
  saveSources,
  scanSources,
  updateSessionReview,
  updateMessageTags,
  listSessionChunksForEmbedding,
  listSessionsForEmbedding,
  loadChunkEmbeddingsByIds,
  loadEmbeddingBuildStats,
  saveEmbeddingBuildRecord,
  upsertChunkEmbeddings,
} from './lib/scanner.mjs'
import { discoverSourceSuggestions } from './lib/discovery.mjs'
import { adaptFolderToStandard, adaptTextFilesToStandard, toIndexFromStandard } from './lib/adapter.mjs'
import { dataDir, files } from './lib/storage.mjs'
import { assessPromptEffectWithCache, getPromptRubric, loadPromptEffectAssessment, scorePromptDetailed, scorePrompts } from './lib/prompt-scorer.mjs'
import { optimizePrompt } from './lib/prompt-optimizer.mjs'
import { buildChunkEmbeddingText, cosineSimilarity, embedText, embedTexts } from './lib/embedding.mjs'
import { buildEffectiveFeishuProjectSettings, buildFeishuProjectSettingsView, mergeFeishuProjectSettings } from './lib/feishu-project-settings.mjs'
import { askModel } from './lib/ask-model.mjs'
import { buildEffectiveModelSettings, buildModelCapabilityList } from './lib/model-settings.mjs'
import { generateGroundedAnswer, rewriteRetrieveQuery } from './lib/rag.mjs'
import { isObsidianCliEnabled, runObsidianCliJson } from './lib/obsidian-cli.mjs'
import { applyPromotionCandidate, buildPromotionCandidatePreview, buildPromotionQueue, buildWikiVaultSyncPreview, cleanSynthesisEvidenceItems, createVaultNoteFromTemplate, decidePromotionCandidate, ensureVaultScaffold, getVaultPaths, lintWikiVault, publishSessionsToVault, rebuildVaultIndex } from './lib/wiki-vault.mjs'
import { importOpenClawKnowledge, previewOpenClawKnowledge } from '../scripts/openclaw-knowledge.mjs'
import {
  createBugInboxInDb,
  deleteBugInboxInDb,
  deleteKnowledgeItemInDb,
  getKnowledgeAtomStatsInDb,
  getBugInboxByIdInDb,
  listKnowledgeAtomsInDb,
  getKnowledgeLineageStatsInDb,
  loadGbrainV2SettingsInDb,
  loadFeishuProjectSettingsInDb,
  loadModelSettingsInDb,
  loadWikiVaultBuildStatsInDb,
  listBugInboxInDb,
  listKnowledgeItemsInDb,
  listKnowledgeLineageInDb,
  saveGbrainV2SettingsInDb,
  saveFeishuProjectSettingsInDb,
  saveModelSettingsInDb,
  saveWikiVaultBuildStatsInDb,
  upsertKnowledgeItemInDb,
  updateBugInboxDescriptionInDb,
  updateBugInboxMetaInDb,
  updateKnowledgeItemStatusInDb,
  deletePatchDirPresetInDb,
  listPatchDirPresetsInDb,
  upsertPatchDirPresetInDb,
} from './lib/db.mjs'

loadLocalEnv()

const PORT = Number(process.env.PORT || 3030)
const HOST = process.env.HOST || '127.0.0.1'
const DEFAULT_RETRIEVE_TOP_K = 8
const MAX_RETRIEVE_TOP_K = 30
const EMBEDDING_BATCH_SIZE = Math.max(1, Number(process.env.KB_EMBEDDING_BATCH_SIZE || 16))
const LOCAL_EMBEDDING_DIMS = 256
const EMBEDDING_MAX_RETRY_ATTEMPTS = Math.max(1, Number(process.env.KB_EMBEDDING_RETRY_ATTEMPTS || 6))
const EMBEDDING_RETRY_BASE_DELAY_MS = Math.max(1000, Number(process.env.KB_EMBEDDING_RETRY_BASE_DELAY_MS || 2500))
const BUG_TRACE_SNIPPET_CONTEXT_LINES = 4
const API_DOCS_DIR = path.resolve(process.cwd(), 'docs', 'api')
const OPENAPI_FILE = path.join(API_DOCS_DIR, 'openapi.yaml')
const OPENAPI_PUBLIC_FILE = path.join(API_DOCS_DIR, 'openapi.public.yaml')
const GBRAIN_V2_FEED_DIR = path.resolve(process.cwd(), 'vault', '.gbrain-v2-feed')
const GBRAIN_V2_FEED_MANIFEST = path.join(GBRAIN_V2_FEED_DIR, 'manifest.json')
const GBRAIN_V2_FEED_RECORDS = path.join(GBRAIN_V2_FEED_DIR, 'records.jsonl')
const GBRAIN_V2_DUAL_WRITE_ENABLED = process.env.KB_GBRAIN_V2_DUAL_WRITE !== '0'
const embeddingRebuildJobs = new Map()
const wikiVaultSyncJobs = new Map()

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

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(data))
}

function sendRaw(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(body)
}

function buildBaseCandidates(apiBase) {
  const base = String(apiBase || '').trim().replace(/\/+$/, '')
  if (!base) return []
  if (base.endsWith('/v1')) return [base]
  return [base, `${base}/v1`]
}

async function probeGateway(apiBase, apiKey, timeoutMs = 15000) {
  const candidates = buildBaseCandidates(apiBase)
  if (!candidates.length) {
    return {
      ok: false,
      resolvedBase: '',
      detail: 'API Base 未配置',
    }
  }

  const networkErrors = []
  for (const base of candidates) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(3000, Number(timeoutMs || 15000)))
    try {
      const response = await fetch(`${base}/models`, {
        method: 'GET',
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (response.ok) {
        return {
          ok: true,
          resolvedBase: base,
          detail: `/models 探活成功（status=${response.status}）`,
        }
      }

      if (response.status === 401 || response.status === 403) {
        return {
          ok: true,
          resolvedBase: base,
          detail: `网关可达，但鉴权失败（status=${response.status}）`,
        }
      }

      if (response.status === 404 || response.status === 405) {
        return {
          ok: true,
          resolvedBase: base,
          detail: `网关可达，但未暴露通用探活接口 /models（status=${response.status}）`,
        }
      }

      return {
        ok: true,
        resolvedBase: base,
        detail: `网关可达，返回 status=${response.status}`,
      }
    } catch (error) {
      clearTimeout(timer)
      networkErrors.push(`${base}: ${String(error?.message || error)}`)
    }
  }

  return {
    ok: false,
    resolvedBase: candidates[0] || '',
    detail: networkErrors.join(' | ') || '网关不可达',
  }
}

async function testModelOwnerConnectivity(owner, settings) {
  const effective = buildEffectiveModelSettings(settings)
  const ownerKey = String(owner || '').trim()
  const config = ownerKey === 'embedding'
    ? effective.embedding
    : ownerKey === 'dspy'
      ? effective.dspy
      : effective.assistant

  const probe = await probeGateway(config.apiBase, config.apiKey, config.timeoutMs)
  return {
    owner: ownerKey || 'assistant',
    ok: probe.ok,
    model: String(config.model || ''),
    apiBase: String(probe.resolvedBase || config.apiBase || ''),
    detail: probe.detail,
  }
}

function renderSwaggerUiHtml(specUrl, title) {
  const specPath = String(specUrl || '/api-docs/openapi.yaml')
  const pageTitle = String(title || 'API Docs')
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${pageTitle}</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body {
        margin: 0;
        background: #f3f6fb;
        color: #0f172a;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
      }
      .swagger-ui .topbar {
        display: none;
      }
      .api-docs-head {
        position: sticky;
        top: 0;
        z-index: 10;
        padding: 12px 18px;
        border-bottom: 1px solid rgba(15, 23, 42, 0.12);
        background: #0f172a;
        color: #f8fafc;
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        box-shadow: 0 6px 20px rgba(15, 23, 42, 0.24);
      }
      .api-docs-head a {
        color: #bfdbfe;
        font-weight: 600;
        text-decoration: none;
      }
      .api-docs-head a:hover {
        color: #dbeafe;
        text-decoration: underline;
      }
      #swagger-ui {
        max-width: 1280px;
        margin: 0 auto;
        padding: 18px 14px 32px;
      }
      .swagger-ui {
        color: #0f172a;
      }
      .swagger-ui .info {
        margin: 0 0 18px;
      }
      .swagger-ui .info .title {
        color: #0f172a;
        font-size: 30px;
        font-weight: 760;
        line-height: 1.2;
      }
      .swagger-ui .info p,
      .swagger-ui .info li,
      .swagger-ui .markdown p,
      .swagger-ui .markdown li {
        color: #334155;
        font-size: 14px;
        line-height: 1.72;
      }
      .swagger-ui .scheme-container {
        background: #ffffff;
        border: 1px solid #d7e0ec;
        border-radius: 12px;
        box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
        padding: 10px 14px;
      }
      .swagger-ui .opblock-tag {
        margin: 0;
        padding: 14px 10px;
        border-bottom: 1px solid #dde5f1;
        color: #0f172a;
        font-size: 19px;
        font-weight: 700;
      }
      .swagger-ui .opblock-tag small {
        color: #64748b;
      }
      .swagger-ui .opblock {
        margin: 0 0 10px;
        border: 1px solid #d7e0ec;
        border-radius: 12px;
        box-shadow: 0 4px 14px rgba(15, 23, 42, 0.05);
        overflow: hidden;
      }
      .swagger-ui .opblock .opblock-summary {
        padding: 9px 10px;
      }
      .swagger-ui .opblock .opblock-summary-path {
        color: #0f172a;
        font-size: 14px;
        font-weight: 650;
      }
      .swagger-ui .opblock .opblock-summary-description {
        color: #334155;
        font-size: 13px;
      }
      .swagger-ui .opblock.opblock-get {
        background: rgba(14, 116, 144, 0.08);
        border-color: rgba(14, 116, 144, 0.34);
      }
      .swagger-ui .opblock.opblock-post {
        background: rgba(22, 101, 52, 0.08);
        border-color: rgba(22, 101, 52, 0.34);
      }
      .swagger-ui .opblock.opblock-delete {
        background: rgba(153, 27, 27, 0.08);
        border-color: rgba(153, 27, 27, 0.32);
      }
      .swagger-ui .opblock.opblock-put,
      .swagger-ui .opblock.opblock-patch {
        background: rgba(180, 83, 9, 0.08);
        border-color: rgba(180, 83, 9, 0.34);
      }
      .swagger-ui .opblock .opblock-section-header {
        background: #eef3fb;
        border-bottom: 1px solid #d7e0ec;
      }
      .swagger-ui .opblock .opblock-section-header h4 {
        color: #1e293b;
      }
      .swagger-ui .responses-inner h4,
      .swagger-ui .responses-inner h5,
      .swagger-ui .parameters-container h4 {
        color: #1e293b;
      }
      .swagger-ui table thead tr td,
      .swagger-ui table thead tr th {
        color: #1e293b;
      }
      .swagger-ui table tbody tr td,
      .swagger-ui table tbody tr th {
        color: #334155;
      }
      .swagger-ui input[type='text'],
      .swagger-ui textarea {
        color: #0f172a;
        border: 1px solid #c8d4e4;
        border-radius: 8px;
        background: #fff;
      }
      .swagger-ui .btn.execute {
        border-color: #0f766e;
        background: #0f766e;
      }
      .swagger-ui .btn.execute:hover {
        border-color: #115e59;
        background: #115e59;
      }
      .swagger-ui .model-box {
        border-radius: 10px;
        border-color: #d7e0ec;
      }
      .swagger-ui .model-title,
      .swagger-ui .tab li,
      .swagger-ui .tab li button.tablinks {
        color: #1e293b;
      }
      @media (max-width: 760px) {
        .api-docs-head {
          padding: 10px 12px;
          font-size: 13px;
        }
        #swagger-ui {
          padding: 12px 8px 22px;
        }
        .swagger-ui .info .title {
          font-size: 24px;
        }
      }
    </style>
  </head>
  <body>
    <div class="api-docs-head">
      <strong>${pageTitle}</strong>
      <span style="margin: 0 8px; color: #64748b">|</span>
      <a href="/api-docs">Internal</a>
      <span style="margin: 0 6px; color: #64748b">·</span>
      <a href="/api-docs/public">Public</a>
      <span style="margin: 0 6px; color: #64748b">·</span>
      <a href="${specPath}" target="_blank" rel="noopener noreferrer">Raw Spec</a>
    </div>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: ${JSON.stringify(specPath)},
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
      })
    </script>
  </body>
</html>`
}

async function sendOpenApiFile(res, filePath) {
  try {
    const text = await readFile(filePath, 'utf-8')
    return sendRaw(res, 200, text, 'application/yaml; charset=utf-8')
  } catch {
    return send(res, 404, { error: `接口文档不存在: ${filePath}` })
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function id(prefix = 'src') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function validateSource(input) {
  if (!input?.name || !input?.provider || !input?.path) {
    return 'name/provider/path 必填'
  }

  const full = path.resolve(input.path)
  if (!existsSync(full)) {
    return `路径不存在: ${full}`
  }

  return null
}

function isOpenClawSessionPath(inputPath) {
  const resolved = path.resolve(String(inputPath || '').trim()).toLowerCase()
  if (!resolved) return false
  return resolved.includes('/.openclaw/') && resolved.includes('/sessions')
}

async function ensureProviderSources(provider, existingSources = []) {
  const normalizedProvider = normalizeProviderAlias(provider)
  const currentSources = Array.isArray(existingSources) ? existingSources : []
  if (!normalizedProvider || normalizedProvider === 'all') return currentSources

  // Sources are explicitly curated by the user; scanning should never auto-add paths.
  return currentSources
}

function validateImportPath(input) {
  if (!input?.path) return 'path 必填'
  const full = path.resolve(input.path)
  if (!existsSync(full)) return `路径不存在: ${full}`
  return null
}

function sanitizeUploadedFiles(rawFiles) {
  const list = Array.isArray(rawFiles) ? rawFiles : []
  return list
    .map((item) => ({
      path: String(item?.path || ''),
      content: String(item?.content || ''),
    }))
    .filter((item) => item.path && item.content)
}

function normalizeString(input) {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeProviderAlias(input) {
  const normalized = normalizeString(input).toLowerCase()
  if (normalized === 'claudecode' || normalized === 'claude_code' || normalized === 'claude code') return 'claude-code'
  return normalized
}

function normalizeReviewStatus(input) {
  const value = normalizeString(input).toLowerCase()
  if (value === 'kept' || value === 'downgraded' || value === 'hidden') return value
  return 'pending'
}

function getSessionReview(session) {
  return session?.meta && typeof session.meta === 'object' && session.meta.review && typeof session.meta.review === 'object'
    ? session.meta.review
    : {}
}

function buildMissingSyncSession(session) {
  const meta = session?.meta && typeof session.meta === 'object' ? session.meta : {}
  const sync = meta.sync && typeof meta.sync === 'object' ? meta.sync : {}
  return {
    ...session,
    meta: {
      ...meta,
      sync: {
        ...sync,
        syncStatus: 'missing',
      },
    },
  }
}

function mergeSyncedSessions(currentSessions = [], scannedSessions = [], { provider = '', pruneMissing = false } = {}) {
  const normalizedProvider = normalizeProviderAlias(provider)
  const next = new Map()
  const scannedIdSet = new Set(
    (Array.isArray(scannedSessions) ? scannedSessions : []).map((item) => String(item?.id || '')).filter(Boolean),
  )

  for (const session of Array.isArray(currentSessions) ? currentSessions : []) {
    const sessionId = String(session?.id || '').trim()
    if (!sessionId) continue
    const sameProvider = normalizedProvider
      ? String(session?.provider || '').toLowerCase() === normalizedProvider
      : true

    if (sameProvider && !scannedIdSet.has(sessionId)) {
      if (!pruneMissing) next.set(sessionId, buildMissingSyncSession(session))
      continue
    }

    next.set(sessionId, session)
  }

  for (const session of Array.isArray(scannedSessions) ? scannedSessions : []) {
    const sessionId = String(session?.id || '').trim()
    if (!sessionId) continue
    next.set(sessionId, session)
  }

  return Array.from(next.values()).sort((a, b) => +new Date(b.updatedAt || 0) - +new Date(a.updatedAt || 0))
}

async function refreshProviderSessions(provider, options = {}) {
  const requireSource = options?.requireSource !== false
  const normalizedProvider = normalizeProviderAlias(provider)
  if (!normalizedProvider || normalizedProvider === 'all') {
    throw new Error('provider 必填，且不能为 all')
  }

  const sources = await ensureProviderSources(normalizedProvider, await loadSources())
  const targetSources = (Array.isArray(sources) ? sources : []).filter(
    (source) =>
      String(source?.provider || '').toLowerCase() === normalizedProvider
      && !(normalizedProvider === 'codex' && isOpenClawSessionPath(source?.path)),
  )

  if (!targetSources.length) {
    if (requireSource) throw new Error(`未找到 provider=${normalizedProvider} 的数据源配置`)
    const current = await loadIndex()
    return {
      provider: normalizedProvider,
      scannedSources: 0,
      refreshed: 0,
      preservedExisting: false,
      total: Array.isArray(current?.sessions) ? current.sessions.length : 0,
      issues: [],
      updatedAt: current?.updatedAt || new Date().toISOString(),
      skipped: true,
    }
  }

  const current = await loadIndex()
  const scanned = await scanSources(targetSources, { persist: false })
  const oldSessions = Array.isArray(current.sessions) ? current.sessions : []
  const oldProviderSessions = oldSessions.filter((s) => String(s?.provider || '').toLowerCase() === normalizedProvider)
  const scannedSessions = Array.isArray(scanned.sessions) ? scanned.sessions : []
  const preservedExisting = oldProviderSessions.length > 0 && scannedSessions.length === 0
  const nextSessions = preservedExisting
    ? [...oldSessions]
    : mergeSyncedSessions(oldSessions, scannedSessions, {
      provider: normalizedProvider,
      pruneMissing: true,
    })

  const targetSourceIds = new Set(targetSources.map((source) => String(source.id || '')).filter(Boolean))
  const oldIssues = Array.isArray(current.issues) ? current.issues : []
  const keptIssues = oldIssues.filter((issue) => !targetSourceIds.has(String(issue?.sourceId || '')))
  const scannedIssues = Array.isArray(scanned.issues) ? scanned.issues : []

  const index = {
    updatedAt: new Date().toISOString(),
    sessions: nextSessions,
    issues: [...keptIssues, ...scannedIssues],
  }

  await mergeIndex(index)

  return {
    provider: normalizedProvider,
    scannedSources: targetSources.length,
    refreshed: scannedSessions.length,
    preservedExisting,
    total: nextSessions.length,
    issues: scannedIssues,
    updatedAt: index.updatedAt,
    skipped: false,
  }
}

function isSessionSearchEnabled(session) {
  const review = getSessionReview(session)
  const status = normalizeReviewStatus(review.status)
  if (status === 'hidden') return false
  if (typeof review.keepInSearch === 'boolean') return review.keepInSearch
  return true
}

function normalizeSearchQuery(input) {
  const raw = normalizeString(input)
  if (!raw) return ''
  return raw
    .replace(/([\p{Script=Latin}\p{N}])([\p{Script=Han}])/gu, '$1 $2')
    .replace(/([\p{Script=Han}])([\p{Script=Latin}\p{N}])/gu, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

function toSafeRelativePath(input) {
  const value = String(input || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim()
  if (!value || value.includes('..')) return ''
  return value
}

function tokenize(input) {
  return normalizeString(input)
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .slice(0, 24)
}

async function resolveFeishuProjectConfig() {
  const stored = await loadFeishuProjectSettingsInDb()
  return buildEffectiveFeishuProjectSettings(stored).effective
}

async function callFeishuProjectMcp(method, params = {}, id = Date.now(), configOverride = null) {
  const feishuConfig = configOverride || await resolveFeishuProjectConfig()
  if (!feishuConfig?.mcpUrl || !feishuConfig?.token) {
    throw new Error('缺少 FEISHU_PROJECT_MCP_URL / FEISHU_PROJECT_MCP_TOKEN 配置')
  }
  const response = await fetch(feishuConfig.mcpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mcp-Token': feishuConfig.token,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }),
  })
  const text = await response.text()
  let payload = {}
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`飞书 MCP 返回非 JSON：${text.slice(0, 200)}`)
  }
  if (!response.ok) {
    throw new Error(`飞书 MCP 请求失败：HTTP ${response.status}`)
  }
  if (payload?.error) {
    throw new Error(payload.error?.message || '飞书 MCP 返回错误')
  }
  return payload?.result || {}
}

function normalizeFeishuText(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractFeishuCandidates(input) {
  const out = []
  const seen = new Set()
  const queue = [input]
  let guard = 0
  while (queue.length && guard < 3000) {
    guard += 1
    const node = queue.shift()
    if (!node) continue
    if (Array.isArray(node)) {
      for (const item of node) queue.push(item)
      continue
    }
    if (typeof node !== 'object') continue

    const obj = node
    const id =
      normalizeFeishuText(obj.issue_id || obj.issueId || obj.work_item_id || obj.workItemId || obj.id || obj.key) || ''
    const title = normalizeFeishuText(obj.title || obj.name || obj.summary || obj.subject || obj.text || '') || ''
    const url = normalizeFeishuText(obj.url || obj.link || obj.href || '') || ''
    if (id || title || url) {
      const dedup = `${id}::${title}::${url}`
      if (!seen.has(dedup)) {
        seen.add(dedup)
        out.push({
          id: id || '',
          title: title || id || url || '候选项',
          url: url || '',
          status: normalizeFeishuText(obj.status || obj.state || ''),
          assignee: normalizeFeishuText(obj.assignee || obj.owner || ''),
        })
      }
    }
    for (const key of Object.keys(obj)) {
      const value = obj[key]
      if (value && typeof value === 'object') queue.push(value)
    }
  }
  return out.slice(0, 20)
}

function parseFeishuToolTextResult(result) {
  const content = Array.isArray(result?.content) ? result.content : []
  for (const item of content) {
    const text = String(item?.text || '').trim()
    if (!text.startsWith('{') && !text.startsWith('[')) continue
    try {
      return JSON.parse(text)
    } catch {
      continue
    }
  }
  return null
}

function parseFeishuToolPlainText(result) {
  const content = Array.isArray(result?.content) ? result.content : []
  return content
    .map((item) => String(item?.text || '').trim())
    .filter(Boolean)
    .join('\n')
}

function parseFeishuBriefMarkdown(markdownText) {
  const text = String(markdownText || '')
  if (!text) return { createdAt: '', requirement: '', reporter: '', status: '', discoveryStage: '', severity: '', category: '' }

  const fields = new Map()
  const lines = text.split('\n')
  for (const line of lines) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|$/)
    if (!match) continue
    const key = String(match[1] || '').trim()
    const value = String(match[2] || '').trim()
    if (!key || key === 'Key' || key === 'Value' || key === '字段名称' || key === '字段值') continue
    const list = fields.get(key) || []
    list.push(value)
    fields.set(key, list)
  }

  const pickFirst = (keys = []) => {
    for (const key of keys) {
      const list = fields.get(key)
      if (Array.isArray(list)) {
        const value = list.find((v) => String(v || '').trim())
        if (value) return String(value).trim()
      }
    }
    return ''
  }

  const pickTime = (keys = []) => {
    const pool = []
    for (const key of keys) {
      const list = fields.get(key)
      if (Array.isArray(list)) pool.push(...list.map((item) => String(item || '').trim()).filter(Boolean))
    }
    if (!pool.length) return ''
    const withTz = pool.find((item) => /T\d{2}:\d{2}/.test(item) && /[+-]\d{2}:\d{2}|Z$/.test(item))
    if (withTz) return withTz
    const dateOnly = pool.find((item) => /^\d{4}-\d{2}-\d{2}$/.test(item))
    if (dateOnly) return dateOnly
    return pool[0]
  }

  const parseRequirement = (rawValue) => {
    const raw = String(rawValue || '').trim()
    if (!raw) return ''
    if (raw.startsWith('{') || raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          const names = parsed
            .map((item) =>
              String(item?.['工作项名称'] || item?.name || item?.title || item?.work_item_name || item?.id || '').trim(),
            )
            .filter(Boolean)
          return names.join('、')
        }
        if (parsed && typeof parsed === 'object') {
          return String(
            parsed?.['工作项名称'] ||
              parsed?.name ||
              parsed?.title ||
              parsed?.work_item_name ||
              parsed?.['需求名称'] ||
              parsed?.id ||
              raw,
          ).trim()
        }
      } catch {
        return raw
      }
    }
    return raw
  }

  return {
    createdAt: pickTime(['提出时间', '报告时间', '创建时间', '创建日期']),
    requirement: parseRequirement(pickFirst(['关联需求', '__关联需求', '需求名称', '需求'])),
    reporter: pickFirst(['提出人', '报告人', '__报告人', '创建人', '创建者']),
    status: pickFirst(['工作项状态', '状态']),
    discoveryStage: parseRequirement(pickFirst(['发现环节', '__发现环节', '发现阶段'])),
    severity: parseRequirement(pickFirst(['严重程度', '__严重程度', '严重级别', '缺陷等级'])),
    category: parseRequirement(pickFirst(['缺陷分类', '__缺陷分类', '分类'])),
  }
}

async function enrichFeishuCandidatesWithBrief(candidates = [], projectKey = '') {
  const list = Array.isArray(candidates) ? candidates : []
  if (!list.length) return []
  const targetProjectKey = String(projectKey || '').trim()
  const enriched = []

  for (const candidate of list.slice(0, 20)) {
    const base = candidate && typeof candidate === 'object' ? candidate : {}
    try {
      const workItemId = normalizeFeishuText(base.id || base.title || '')
      if (!workItemId) {
        enriched.push(base)
        continue
      }
      const result = await callFeishuProjectMcp('tools/call', {
        name: 'get_workitem_brief',
        arguments: {
          project_key: targetProjectKey,
          work_item_id: workItemId,
          fields: [
            '关联需求',
            '__关联需求',
            '需求名称',
            '创建时间',
            '提出时间',
            '报告时间',
            '__报告人',
            '状态',
            '创建者',
            '发现环节',
            '__发现环节',
            '严重程度',
            '__严重程度',
            '缺陷分类',
            '__缺陷分类',
          ],
        },
      })
      const text = parseFeishuToolPlainText(result)
      const detail = parseFeishuBriefMarkdown(text)
      enriched.push({
        ...base,
        createdAt: normalizeFeishuText(detail.createdAt || base.createdAt || ''),
        requirement: normalizeFeishuText(detail.requirement || base.requirement || ''),
        reporter: normalizeFeishuText(base.reporter || detail.reporter || ''),
        creator: normalizeFeishuText(base.creator || ''),
        status: normalizeFeishuText(detail.status || base.status || ''),
        discoveryStage: normalizeFeishuText(detail.discoveryStage || base.discoveryStage || ''),
        severity: normalizeFeishuText(detail.severity || base.severity || ''),
        category: normalizeFeishuText(detail.category || base.category || ''),
      })
    } catch {
      enriched.push(base)
    }
  }

  if (list.length > enriched.length) enriched.push(...list.slice(enriched.length))
  return enriched
}

function parseFeishuMqlCandidates(resultPayload) {
  const normalizeFeishuDateTime = (rawValue) => {
    const raw = String(rawValue ?? '').trim()
    if (!raw) return ''
    const num = Number(raw)
    if (Number.isFinite(num) && /^\d+(\.\d+)?$/.test(raw)) {
      const ms = num < 1e12 ? num * 1000 : num
      const date = new Date(ms)
      if (!Number.isNaN(date.getTime())) return date.toISOString()
    }
    const date = new Date(raw)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
    return raw
  }

  const extractFeishuListText = (list) =>
    (Array.isArray(list) ? list : [])
      .map((item) =>
        String(
          item?.label ||
            item?.name ||
            item?.title ||
            item?.work_item_name ||
            item?.name_cn ||
            item?.name_en ||
            item?.email ||
            item?.key ||
            item?.id ||
            '',
        ).trim(),
      )
      .filter(Boolean)
      .join('、')

  const extractFeishuValueText = (value, valueType) => {
    if (valueType === 'string_value') return String(value?.string_value || '').trim()
    if (valueType === 'number_value') return String(value?.number_value || '').trim()
    if (valueType === 'date_time_value') return normalizeFeishuDateTime(value?.date_time_value || '')
    if (valueType === 'key_label_value_list') return extractFeishuListText(value?.key_label_value_list)
    if (valueType === 'work_item_value_list') return extractFeishuListText(value?.work_item_value_list)
    if (valueType === 'user_value_list') return extractFeishuListText(value?.user_value_list)
    return (
      extractFeishuListText(value?.work_item_value_list) ||
      extractFeishuListText(value?.key_label_value_list) ||
      extractFeishuListText(value?.user_value_list) ||
      String(value?.string_value || value?.number_value || '').trim()
    )
  }

  const parsed = resultPayload && typeof resultPayload === 'object' ? resultPayload : {}
  const data = parsed?.data && typeof parsed.data === 'object' ? parsed.data : {}
  const groups = Object.values(data).filter(Array.isArray)
  const rows = groups.flat()
  const candidates = []
  for (const row of rows) {
    const fields = Array.isArray(row?.moql_field_list) ? row.moql_field_list : []
    let title = ''
    let id = ''
    let status = ''
    let assignee = ''
    let creator = ''
    let reporter = ''
    let createdAt = ''
    let requirement = ''
    let discoveryStage = ''
    let severity = ''
    let category = ''
    for (const field of fields) {
      const name = String(field?.name || '')
      const valueType = String(field?.value_type || '')
      const value = field?.value || {}
      if (!title && name.includes('缺陷名称') && valueType === 'string_value') {
        title = String(value?.string_value || '')
      }
      if (!id && /(ID|编号)/i.test(name) && valueType === 'string_value') {
        id = String(value?.string_value || '')
      }
      if (!status && name === '状态' && valueType === 'key_label_value_list') {
        const first = Array.isArray(value?.key_label_value_list) ? value.key_label_value_list[0] : null
        status = String(first?.label || first?.key || '')
      }
      if (!assignee && (name.includes('当前负责人') || name.includes('修复经办人') || name.includes('缺陷责任人'))) {
        const first = Array.isArray(value?.user_value_list) ? value.user_value_list[0] : null
        assignee = String(first?.name_cn || first?.name_en || first?.email || '')
      }
      if (!creator && name.includes('创建者')) {
        const first = Array.isArray(value?.user_value_list) ? value.user_value_list[0] : null
        creator = String(first?.name_cn || first?.name_en || first?.email || '')
      }
      if (!reporter && name.includes('报告人')) {
        const first = Array.isArray(value?.user_value_list) ? value.user_value_list[0] : null
        reporter = String(first?.name_cn || first?.name_en || first?.email || '')
      }
      if (!createdAt && (name.includes('创建时间') || name.includes('创建日期') || name.includes('创建于'))) {
        if (valueType === 'date_time_value') createdAt = normalizeFeishuDateTime(value?.date_time_value || '')
        else if (valueType === 'string_value') createdAt = normalizeFeishuDateTime(value?.string_value || '')
        else if (valueType === 'number_value') createdAt = normalizeFeishuDateTime(value?.number_value || '')
      }
      if (!requirement && (name.includes('关联需求') || name.includes('需求名称') || name === '需求')) {
        requirement = extractFeishuValueText(value, valueType)
      }
      if (!discoveryStage && (name.includes('发现环节') || name.includes('发现阶段'))) {
        discoveryStage = extractFeishuValueText(value, valueType)
      }
      if (!severity && (name.includes('严重程度') || name.includes('严重级别') || name.includes('缺陷等级'))) {
        severity = extractFeishuValueText(value, valueType)
      }
      if (!category && (name.includes('缺陷分类') || name === '分类' || name.includes('问题分类'))) {
        category = extractFeishuValueText(value, valueType)
      }
    }
    if (!title) continue
    candidates.push({
      id: id || title,
      title,
      url: '',
      status,
      assignee,
      creator,
      reporter,
      createdAt,
      requirement,
      discoveryStage,
      severity,
      category,
    })
  }
  return candidates.slice(0, 50)
}

async function listFeishuTodoItems(action = 'todo', maxPages = 3) {
  const feishuConfig = await resolveFeishuProjectConfig()
  const rows = []
  for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
    const result = await callFeishuProjectMcp('tools/call', {
      name: 'list_todo',
      arguments: {
        action,
        page_num: pageNum,
      },
    }, Date.now(), feishuConfig)
    const parsed = parseFeishuToolTextResult(result)
    const list = Array.isArray(parsed?.list) ? parsed.list : []
    rows.push(...list)
    if (list.length < 50) break
  }
  return rows
}

function normalizeFeishuDateValue(rawValue) {
  const raw = String(rawValue ?? '').trim()
  if (!raw) return ''
  const num = Number(raw)
  if (Number.isFinite(num) && /^\d+(\.\d+)?$/.test(raw)) {
    const ms = num < 1e12 ? num * 1000 : num
    const date = new Date(ms)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  const date = new Date(raw)
  if (!Number.isNaN(date.getTime())) return date.toISOString()
  return raw
}

function pickFirstFeishuValue(candidates = []) {
  for (const item of candidates) {
    const value = normalizeFeishuText(item)
    if (value) return value
  }
  return ''
}

function toFeishuTodoListItem(row) {
  const source = row && typeof row === 'object' ? row : {}
  const work = source?.work_item_info && typeof source.work_item_info === 'object' ? source.work_item_info : {}
  const node = source?.node_info && typeof source.node_info === 'object' ? source.node_info : {}
  const todo = source?.todo_info && typeof source.todo_info === 'object' ? source.todo_info : {}
  const schedule = source?.schedule && typeof source.schedule === 'object' ? source.schedule : {}

  const id = pickFirstFeishuValue([
    work?.work_item_id,
    source?.work_item_id,
    source?.todo_id,
    todo?.todo_id,
    source?.id,
  ])
  const title = pickFirstFeishuValue([work?.work_item_name, source?.work_item_name, source?.title, source?.name])
  if (!id || !title) return null

  const projectKey = pickFirstFeishuValue([source?.project_key, source?.projectKey, work?.project_key])
  const workItemType = pickFirstFeishuValue([work?.work_item_type_key, source?.work_item_type_key, source?.workItemType])
  const projectName = pickFirstFeishuValue([source?.project_name, source?.projectName, work?.project_name, work?.project])
  const nodeName = pickFirstFeishuValue([node?.node_name, source?.node_name, source?.status, source?.state])
  const nodeStateKey = pickFirstFeishuValue([node?.node_state_key, source?.node_state_key, source?.nodeStateKey])
  const assignee = pickFirstFeishuValue([
    source?.assignee_name,
    source?.owner_name,
    source?.assignee,
    source?.owner,
    work?.assignee_name,
    node?.owner_name,
  ])
  const dueAtRaw = pickFirstFeishuValue([
    schedule?.end_time,
    source?.due_time,
    source?.deadline,
    source?.plan_end_time,
    source?.schedule_time,
    work?.due_time,
    work?.deadline,
    work?.plan_end_time,
    work?.schedule_time,
    todo?.due_time,
    todo?.deadline,
  ])
  const scheduleStartRaw = pickFirstFeishuValue([
    schedule?.start_time,
    source?.start_time,
    source?.schedule_start_time,
    work?.start_time,
    work?.schedule_start_time,
  ])
  const scheduleEndRaw = pickFirstFeishuValue([
    schedule?.end_time,
    source?.end_time,
    source?.schedule_end_time,
    work?.end_time,
    work?.schedule_end_time,
  ])
  const updatedAtRaw = pickFirstFeishuValue([
    source?.updated_at,
    source?.update_time,
    source?.updatedAt,
    work?.updated_at,
    work?.update_time,
    todo?.updated_at,
    todo?.update_time,
  ])
  const url = pickFirstFeishuValue([source?.url, source?.href, work?.url, todo?.url])

  return {
    id,
    title,
    workItemType,
    projectKey,
    projectName,
    nodeName,
    nodeStateKey,
    assignee,
    scheduleStart: normalizeFeishuDateValue(scheduleStartRaw),
    scheduleEnd: normalizeFeishuDateValue(scheduleEndRaw),
    dueAt: normalizeFeishuDateValue(dueAtRaw),
    updatedAt: normalizeFeishuDateValue(updatedAtRaw),
    url,
  }
}

function toFeishuTodoCandidates(items, mode = 'strict') {
  const list = Array.isArray(items) ? items : []
  const out = []
  for (const row of list) {
    const work = row?.work_item_info && typeof row.work_item_info === 'object' ? row.work_item_info : {}
    const node = row?.node_info && typeof row.node_info === 'object' ? row.node_info : {}
    const id = normalizeFeishuText(work?.work_item_id || '')
    const title = normalizeFeishuText(work?.work_item_name || '')
    const workType = normalizeFeishuText(work?.work_item_type_key || '')
    const nodeName = normalizeFeishuText(node?.node_name || '')
    if (!id || !title) continue

    const nodeLower = nodeName.toLowerCase()
    const titleLower = title.toLowerCase()
    const workTypeLower = workType.toLowerCase()
    const strictNodeHit =
      nodeName.includes('待修改BUG') ||
      nodeName.includes('待修改缺陷') ||
      nodeLower.includes('待修改bug') ||
      nodeName.includes('待修复BUG') ||
      nodeName.includes('待修复缺陷')
    const relaxedTypeHit =
      ['issue', 'bug', 'defect', '缺陷'].some((kw) => workTypeLower.includes(kw)) ||
      ['bug', '缺陷', '修复'].some((kw) => titleLower.includes(kw))
    const excluded = ['测试', 'mcp', 'demo', '示例', 'test'].some((kw) => titleLower.includes(kw))

    if (mode === 'strict') {
      if (!strictNodeHit) continue
    } else {
      if (excluded) continue
      if (!strictNodeHit && !relaxedTypeHit) continue
    }

    out.push({
      id,
      title,
      url: '',
      status: nodeName,
      assignee: normalizeFeishuText(row?.project_name || ''),
    })
    if (out.length >= 50) break
  }
  return out
}

async function listFeishuBugCandidatesForBinding() {
  const feishuConfig = await resolveFeishuProjectConfig()
  const projectKey = String(feishuConfig?.projectKey || '').trim()
  if (!projectKey) throw new Error('缺少 FEISHU_PROJECT_KEY 配置')
  const mqlBaseWhere =
    "FROM `券商SRS系统`.`缺陷` " +
    "WHERE `状态` NOT IN ('已关闭','已终止') " +
    "AND (any_match(`当前负责人`, x -> x = current_login_user()) " +
    "OR array_contains(`__修复经办人`, current_login_user()) " +
    "OR array_contains(`__缺陷责任人`, current_login_user())) LIMIT 50"

  const queryPlans = [
    {
      strategy: 'search_by_mql(含提出人/创建时间/关联需求/发现环节/严重程度/缺陷分类/状态)',
      mql:
        "SELECT `缺陷名称`,`状态`,`当前负责人`,`__修复经办人`,`__缺陷责任人`,`创建者`,`__报告人`,`创建时间`,`关联需求`,`发现环节`,`严重程度`,`缺陷分类` " +
        mqlBaseWhere,
    },
    {
      strategy: 'search_by_mql(含提出人/创建时间/__关联需求/__发现环节/__严重程度/__缺陷分类/状态)',
      mql:
        "SELECT `缺陷名称`,`状态`,`当前负责人`,`__修复经办人`,`__缺陷责任人`,`创建者`,`__报告人`,`创建时间`,`__关联需求`,`__发现环节`,`__严重程度`,`__缺陷分类` " +
        mqlBaseWhere,
    },
    {
      strategy: 'search_by_mql(含提出人/创建时间/需求名称/发现阶段/严重级别/分类/状态)',
      mql:
        "SELECT `缺陷名称`,`状态`,`当前负责人`,`__修复经办人`,`__缺陷责任人`,`创建者`,`__报告人`,`创建时间`,`需求名称`,`发现阶段`,`严重级别`,`分类` " +
        mqlBaseWhere,
    },
    {
      strategy: 'search_by_mql(含提出人/创建时间/状态)',
      mql:
        "SELECT `缺陷名称`,`状态`,`当前负责人`,`__修复经办人`,`__缺陷责任人`,`创建者`,`__报告人`,`创建时间` " +
        mqlBaseWhere,
    },
    {
      strategy: 'search_by_mql(缺陷 + 非关闭 + 当前负责人/修复经办人/缺陷责任人=我 + 创建者/报告人)',
      mql:
        "SELECT `缺陷名称`,`状态`,`当前负责人`,`__修复经办人`,`__缺陷责任人`,`创建者`,`__报告人` " +
        mqlBaseWhere,
    },
    {
      strategy: 'search_by_mql(缺陷 + 非关闭 + 当前负责人/修复经办人/缺陷责任人=我 + 创建者)',
      mql:
        "SELECT `缺陷名称`,`状态`,`当前负责人`,`__修复经办人`,`__缺陷责任人`,`创建者` " +
        mqlBaseWhere,
    },
  ]

  let result = null
  let strategy = queryPlans[queryPlans.length - 1].strategy
  let lastError = null

  for (const plan of queryPlans) {
    try {
      result = await callFeishuProjectMcp('tools/call', {
        name: 'search_by_mql',
        arguments: {
          project_key: projectKey,
          mql: plan.mql,
        },
      }, Date.now(), feishuConfig)
      strategy = plan.strategy
      lastError = null
      break
    } catch (error) {
      lastError = error
    }
  }

  if (!result && lastError) throw lastError

  const parsed = parseFeishuToolTextResult(result)
  const baseCandidates = parseFeishuMqlCandidates(parsed)
  const candidates = await enrichFeishuCandidatesWithBrief(baseCandidates, projectKey)
  return { candidates, strategy }
}

function buildFeishuBugQuery(item) {
  const chunks = [
    item.title,
    item.description,
    item.patchPath,
    item.patchFile,
    item.conversationId,
  ]
    .map((x) => normalizeFeishuText(x))
    .filter(Boolean)
  return chunks.join(' ').slice(0, 400)
}

function buildBugFragments(bugCode) {
  const lines = String(bugCode || '')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
  const trimmed = lines.map((line) => line.trim()).filter((line) => line.length >= 2)
  const singleLine = trimmed.filter((line) => line.length >= 6)
  const multiLine = []
  for (let i = 0; i < trimmed.length - 1; i += 1) {
    const first = trimmed[i]
    const second = trimmed[i + 1]
    if (!first || !second) continue
    const combined = `${first}\n${second}`.trim()
    if (combined.length >= 12) multiLine.push(combined)
  }
  return Array.from(new Set([...multiLine, ...singleLine]))
}

function normalizeCodeLine(input) {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function findBestSnippet(text, needles) {
  const source = String(text || '')
  const list = Array.isArray(needles) ? needles : []
  const target = list.find((item) => item && source.includes(item)) || list[0] || ''
  if (!target) return source.slice(0, 280)
  const idx = source.indexOf(target)
  if (idx < 0) return source.slice(0, 280)
  const start = Math.max(0, idx - 140)
  const end = Math.min(source.length, idx + target.length + 140)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < source.length ? '...' : ''
  return `${prefix}${source.slice(start, end)}${suffix}`.trim()
}

function normalizePatchFilePath(input) {
  return String(input || '')
    .replace(/^(before|after|a|b)\//, '')
    .trim()
}

function extractPatchEntriesFromPatch(patchRaw, options = {}) {
  const includeContext = Boolean(options?.includeContext)
  const lines = String(patchRaw || '').split('\n')
  const entries = []
  let currentOldFile = ''
  let currentNewFile = ''
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const parts = line.split(' ')
      const aPath = parts[2] || ''
      const bPath = parts[3] || ''
      currentOldFile = normalizePatchFilePath(aPath)
      currentNewFile = normalizePatchFilePath(bPath)
      oldLine = 0
      newLine = 0
      continue
    }

    if (line.startsWith('@@')) {
      const match = line.match(/^@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/)
      if (match) {
        oldLine = Number(match[1] || 0)
        newLine = Number(match[2] || 0)
      }
      continue
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      entries.push({
        filePath: currentNewFile || currentOldFile,
        side: 'new',
        lineNo: newLine,
        text: line.slice(1),
        changed: true,
      })
      newLine += 1
      continue
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      entries.push({
        filePath: currentOldFile || currentNewFile,
        side: 'old',
        lineNo: oldLine,
        text: line.slice(1),
        changed: true,
      })
      oldLine += 1
      continue
    }
    if (line.startsWith(' ')) {
      const content = line.slice(1)
      if (includeContext) {
        entries.push({
          filePath: currentOldFile || currentNewFile,
          side: 'old',
          lineNo: oldLine,
          text: content,
          changed: false,
        })
        entries.push({
          filePath: currentNewFile || currentOldFile,
          side: 'new',
          lineNo: newLine,
          text: content,
          changed: false,
        })
      }
      oldLine += 1
      newLine += 1
      continue
    }
  }

  return entries
}

function buildSnippetWithContext(entries, sourceEntry, contextLines = BUG_TRACE_SNIPPET_CONTEXT_LINES) {
  if (!sourceEntry || !Array.isArray(entries) || !entries.length) {
    return {
      snippet: '',
      startLineNo: Number(sourceEntry?.lineNo || 0) || 0,
    }
  }
  const filePath = String(sourceEntry.filePath || '')
  const side = String(sourceEntry.side || '')
  const scoped = entries.filter((entry) => String(entry.filePath || '') === filePath && String(entry.side || '') === side)
  if (!scoped.length) {
    return {
      snippet: String(sourceEntry.text || ''),
      startLineNo: Number(sourceEntry.lineNo || 0) || 0,
    }
  }
  const targetLineNo = Number(sourceEntry.lineNo || 0) || 0
  let centerIndex = scoped.findIndex(
    (entry) =>
      Number(entry.lineNo || 0) === targetLineNo &&
      String(entry.text || '') === String(sourceEntry.text || ''),
  )
  if (centerIndex < 0) {
    centerIndex = scoped.findIndex((entry) => Number(entry.lineNo || 0) === targetLineNo)
  }
  if (centerIndex < 0) centerIndex = 0

  const span = Math.max(0, Number(contextLines || 0))
  const start = Math.max(0, centerIndex - span)
  const end = Math.min(scoped.length - 1, centerIndex + span)
  const snippetEntries = scoped.slice(start, end + 1)
  const snippet = snippetEntries.map((entry) => String(entry.text || '')).join('\n')
  const startLineNo = Number(snippetEntries[0]?.lineNo || targetLineNo || 0) || 0
  return { snippet, startLineNo }
}

function buildMatchedSnippets(patchEntries, matchedLocations, matchedLinePool) {
  const lines = Array.isArray(matchedLinePool) ? matchedLinePool : []
  const locations = Array.isArray(matchedLocations) ? matchedLocations : []
  if (!locations.length) return []

  const snippetList = []
  const dedup = new Set()
  for (const location of locations) {
    const context = buildSnippetWithContext(patchEntries, location, BUG_TRACE_SNIPPET_CONTEXT_LINES)
    const snippet = String(context.snippet || location.text || '').trimEnd()
    if (!snippet) continue
    const source = {
      filePath: String(location.filePath || ''),
      side: String(location.side || '') === 'old' ? 'old' : 'new',
      lineNo: Number(context.startLineNo || location.lineNo || 0) || 0,
    }
    const dedupKey = `${source.filePath}::${source.side}::${source.lineNo}::${snippet}`
    if (dedup.has(dedupKey)) continue
    dedup.add(dedupKey)

    const hitKeywords = lines.filter((line) => line && snippet.includes(line)).slice(0, 12)
    snippetList.push({
      snippet,
      snippetSource: source,
      hitKeywords: hitKeywords.length ? hitKeywords : [String(location.text || '').trim()].filter(Boolean),
      matchedLines: hitKeywords.slice(0, 8),
      matchedLocations: [
        {
          filePath: source.filePath,
          side: source.side,
          lineNo: Number(location.lineNo || 0) || 0,
          text: String(location.text || ''),
        },
      ],
    })
    if (snippetList.length >= 6) break
  }
  return snippetList
}

function scorePatchAgainstBugCode(bugCode, patchText) {
  const bugRaw = String(bugCode || '')
  const patchRaw = String(patchText || '')
  const changedLinesOnly = patchRaw
    .split('\n')
    .map((line) => String(line || ''))
    .filter((line) => (line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---'))
    .map((line) => line.slice(1))
  const changedRaw = changedLinesOnly.join('\n')
  const patchEntries = extractPatchEntriesFromPatch(patchRaw, { includeContext: true })
  const changedEntries = patchEntries.filter((entry) => entry.changed)

  if (!bugRaw.trim() || !changedRaw.trim()) {
    return {
      score: 0,
      matchedLines: [],
      tokenHitRate: 0,
      hitKeywords: [],
      snippetSource: null,
      matchedLocations: [],
      matchedSnippets: [],
      snippet: '',
    }
  }

  const bugCompact = bugRaw.replace(/\s+/g, '')
  const patchCompact = changedRaw.replace(/\s+/g, '')
  const bugFragments = buildBugFragments(bugRaw).slice(0, 80)
  const bugSingleLines = bugFragments.filter((fragment) => !fragment.includes('\n')).slice(0, 80)
  const changedLineMap = new Map()
  for (const entry of changedEntries) {
    const normalized = normalizeCodeLine(entry.text)
    if (!normalized) continue
    const bucket = changedLineMap.get(normalized) || []
    bucket.push(entry)
    changedLineMap.set(normalized, bucket)
  }
  const matchedLines = []
  const matchedLocations = []
  const matchedLocationDedup = new Set()
  for (const rawLine of bugSingleLines) {
    const normalized = normalizeCodeLine(rawLine)
    if (!normalized || !changedLineMap.has(normalized)) continue
    matchedLines.push(rawLine)
    const rows = changedLineMap.get(normalized) || []
    for (const row of rows) {
      const key = `${row.filePath}::${row.side}::${row.lineNo}::${row.text}`
      if (matchedLocationDedup.has(key)) continue
      matchedLocationDedup.add(key)
      matchedLocations.push(row)
      if (matchedLocations.length >= 24) break
    }
    if (matchedLines.length >= 12 || matchedLocations.length >= 24) break
  }
  const matchedLinePool = Array.from(new Set(matchedLines))
  const matchedFragments = bugFragments.filter((fragment) => changedRaw.includes(fragment)).slice(0, 12)
  const fragmentHitRate = bugFragments.length ? matchedFragments.length / bugFragments.length : 0

  let score = 0
  if (bugCompact.length >= 12 && patchCompact.includes(bugCompact)) score += 1000
  score += matchedFragments.length * 32
  score += fragmentHitRate * 140
  score += matchedLinePool.length * 28

  const sourceEntry = matchedLocations[0] || null
  const matchedSnippets = buildMatchedSnippets(patchEntries, matchedLocations, matchedLinePool)
  const primarySnippet = matchedSnippets[0] || null

  const snippetNeedles = matchedFragments.length ? matchedFragments : matchedLines
  const contextSnippet = sourceEntry ? buildSnippetWithContext(patchEntries, sourceEntry, BUG_TRACE_SNIPPET_CONTEXT_LINES) : null
  return {
    score: Number(score.toFixed(3)),
    matchedLines: matchedLinePool.slice(0, 8),
    tokenHitRate: Number(fragmentHitRate.toFixed(4)),
    hitKeywords: primarySnippet?.hitKeywords?.slice(0, 12) || matchedLinePool.slice(0, 12),
    snippet: primarySnippet?.snippet || contextSnippet?.snippet || sourceEntry?.text || findBestSnippet(changedRaw, snippetNeedles),
    snippetSource: primarySnippet?.snippetSource || (sourceEntry
      ? {
          filePath: sourceEntry.filePath || '',
          side: String(sourceEntry.side || '') === 'old' ? 'old' : 'new',
          lineNo: Number(contextSnippet?.startLineNo || sourceEntry.lineNo || 0) || 0,
        }
      : null),
    matchedLocations,
    matchedSnippets,
  }
}

function normalizePatchStem(fileName) {
  const lower = String(fileName || '').toLowerCase()
  if (lower.endsWith('.meta.json')) return fileName.slice(0, -'.meta.json'.length)
  if (lower.endsWith('.patch')) return fileName.slice(0, -'.patch'.length)
  return ''
}

function pickPatchFileName(meta, stem, patchByStem) {
  const fromMeta = normalizeString(meta?.patch_file || meta?.patchFile || meta?.patch || '')
  if (fromMeta) return fromMeta
  if (patchByStem.has(stem)) return patchByStem.get(stem)
  return stem ? `${stem}.patch` : ''
}

async function readLegacyPatchRecords(patchDir) {
  const entries = await readdir(patchDir, { withFileTypes: true }).catch(() => [])
  const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  const metaByStem = new Map()
  const patchByStem = new Map()

  for (const fileName of fileNames) {
    const stem = normalizePatchStem(fileName)
    if (!stem) continue
    if (fileName.toLowerCase().endsWith('.meta.json')) metaByStem.set(stem, fileName)
    if (fileName.toLowerCase().endsWith('.patch')) patchByStem.set(stem, fileName)
  }

  const stems = new Set([...metaByStem.keys(), ...patchByStem.keys()])
  const records = []

  for (const stem of stems) {
    const metaName = metaByStem.get(stem) || ''
    const patchNameFromStem = patchByStem.get(stem) || ''
    let meta = {}

    if (metaName) {
      const metaPath = path.join(patchDir, metaName)
      try {
        const raw = await readFile(metaPath, 'utf-8')
        meta = JSON.parse(raw)
      } catch {
        meta = {}
      }
    }

    const patchName = pickPatchFileName(meta, stem, patchByStem) || patchNameFromStem
    if (!patchName) continue
    const patchPath = path.join(patchDir, patchName)
    let patchContent = ''
    try {
      patchContent = await readFile(patchPath, 'utf-8')
    } catch {
      continue
    }

    records.push({
      stem,
      meta,
      patchPath,
      patchFile: patchName,
      patchContent,
      turnDir: null,
      beforeDir: null,
      afterDir: null,
      layout: 'legacy',
    })
  }

  return records
}

async function readTurnBasedPatchRecords(patchDir) {
  const turnsRoot = path.join(patchDir, 'turns')
  if (!existsSync(turnsRoot)) return []

  const turnDirs = await readdir(turnsRoot, { withFileTypes: true }).catch(() => [])
  const records = []
  for (const entry of turnDirs) {
    if (!entry.isDirectory()) continue
    const turnDir = path.join(turnsRoot, entry.name)
    const metaPath = path.join(turnDir, 'meta.json')
    const patchPath = path.join(turnDir, 'changes.patch')
    if (!existsSync(metaPath) || !existsSync(patchPath)) continue

    let meta = {}
    let patchContent = ''
    try {
      meta = JSON.parse(await readFile(metaPath, 'utf-8'))
      patchContent = await readFile(patchPath, 'utf-8')
    } catch {
      continue
    }

    records.push({
      stem: entry.name,
      meta,
      patchPath,
      patchFile: 'changes.patch',
      patchContent,
      turnDir,
      beforeDir: existsSync(path.join(turnDir, 'before')) ? path.join(turnDir, 'before') : null,
      afterDir: existsSync(path.join(turnDir, 'after')) ? path.join(turnDir, 'after') : null,
      layout: 'turn-based',
    })
  }

  return records
}

async function readPatchRecords(patchDir) {
  const [legacy, turnBased] = await Promise.all([
    readLegacyPatchRecords(patchDir),
    readTurnBasedPatchRecords(patchDir),
  ])
  const merged = [...turnBased, ...legacy]
  const dedup = new Map()
  for (const item of merged) {
    const key = `${item.patchPath}::${item.stem}`
    if (!dedup.has(key)) dedup.set(key, item)
  }
  return Array.from(dedup.values())
}

function readCursorTextFromContent(content) {
  if (!content) return ''
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((item) => readCursorTextFromContent(item))
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  if (typeof content === 'object') {
    if (Array.isArray(content.parts)) return readCursorTextFromContent(content.parts)
    if (typeof content.text === 'string') return content.text.trim()
    if (typeof content.content === 'string') return content.content.trim()
    if (Array.isArray(content.content)) return readCursorTextFromContent(content.content)
    if (typeof content.value === 'string') return content.value.trim()
  }
  return ''
}

function cleanCursorTranscriptText(input) {
  return String(input || '')
    .replace(/<\s*user_query\s*>/gi, '')
    .replace(/<\s*\/\s*user_query\s*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function findCursorTranscriptByConversationId(cursorRoot, conversationId) {
  const root = String(cursorRoot || '').trim()
  const cid = String(conversationId || '').trim()
  if (!root || !cid) return null

  const projectDirs = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const project of projectDirs) {
    if (!project.isDirectory()) continue
    const transcriptDir = path.join(root, project.name, 'agent-transcripts', cid)
    if (!existsSync(transcriptDir)) continue
    const files = await readdir(transcriptDir, { withFileTypes: true }).catch(() => [])
    const jsonlNames = files
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl'))
      .map((entry) => entry.name)
    if (!jsonlNames.length) {
      return {
        project: project.name,
        transcriptDir,
        transcriptPath: '',
      }
    }

    let latestName = jsonlNames[0]
    let latestTs = 0
    for (const name of jsonlNames) {
      const full = path.join(transcriptDir, name)
      const info = await stat(full).catch(() => null)
      const ts = info?.mtimeMs || 0
      if (ts >= latestTs) {
        latestTs = ts
        latestName = name
      }
    }
    return {
      project: project.name,
      transcriptDir,
      transcriptPath: path.join(transcriptDir, latestName),
    }
  }
  return null
}

async function readCursorConversationSummary(transcriptPath) {
  if (!transcriptPath) return null
  const raw = await readFile(transcriptPath, 'utf-8').catch(() => '')
  if (!raw) return null

  const messages = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .map((row) => {
      const role = String(row.role || 'assistant').toLowerCase()
      const payload = row.message && typeof row.message === 'object' ? row.message : row
      const content = cleanCursorTranscriptText(readCursorTextFromContent(payload.content || row.content))
      if (!content) return null
      return {
        role,
        content,
        createdAt: row.createdAt || row.timestamp || null,
      }
    })
    .filter(Boolean)

  if (!messages.length) return null
  const firstUser = messages.find((item) => item.role === 'user')?.content || ''
  const title = cleanCursorTranscriptText(firstUser).slice(0, 80) || path.basename(transcriptPath)
  const turns = messages.filter((item) => item.role === 'user').length || messages.length
  const last = messages[messages.length - 1]

  return {
    title,
    turns,
    messageCount: messages.length,
    lastMessageAt: last?.createdAt || null,
    preview: firstUser.slice(0, 180),
  }
}

async function readCursorConversationDetail(transcriptPath, limitMessages = 500) {
  if (!transcriptPath) return null
  const raw = await readFile(transcriptPath, 'utf-8').catch(() => '')
  if (!raw) return null

  const messages = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .map((row) => {
      const role = String(row.role || 'assistant').toLowerCase()
      const payload = row.message && typeof row.message === 'object' ? row.message : row
      const content = cleanCursorTranscriptText(readCursorTextFromContent(payload.content || row.content))
      if (!content) return null
      return {
        role,
        content,
        createdAt: row.createdAt || row.timestamp || null,
      }
    })
    .filter(Boolean)
    .slice(0, Math.max(1, Math.min(2000, Number(limitMessages || 500))))

  if (!messages.length) return null
  const firstUser = messages.find((item) => item.role === 'user')?.content || ''
  const title = cleanCursorTranscriptText(firstUser).slice(0, 80) || path.basename(transcriptPath)
  const turns = messages.filter((item) => item.role === 'user').length || messages.length

  return {
    title,
    turns,
    messageCount: messages.length,
    messages,
  }
}

function toTimestamp(input) {
  const value = Date.parse(String(input || ''))
  return Number.isNaN(value) ? 0 : value
}

function inTimeRange(session, range) {
  if (!range || typeof range !== 'object') return true
  const ts = toTimestamp(session?.updatedAt)
  if (!ts) return true
  const from = toTimestamp(range.from)
  const to = toTimestamp(range.to)
  if (from && ts < from) return false
  if (to && ts > to) return false
  return true
}

function snippetByToken(text, token, radius = 80) {
  const plain = normalizeString(text)
  if (!plain) return ''
  const lower = plain.toLowerCase()
  const idx = lower.indexOf(token.toLowerCase())
  if (idx < 0) return ''
  const start = Math.max(0, idx - radius)
  const end = Math.min(plain.length, idx + token.length + radius)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < plain.length ? '...' : ''
  return `${prefix}${plain.slice(start, end)}${suffix}`.trim()
}

function pickSnippets(session, tokens, maxSnippets = 3) {
  const snippets = []
  const messages = Array.isArray(session?.messages) ? session.messages : []
  const tokenList = tokens.length ? tokens : tokenize(session?.title).slice(0, 2)

  for (const msg of messages) {
    if (!msg?.content) continue
    for (const token of tokenList) {
      const snippet = snippetByToken(msg.content, token)
      if (!snippet) continue
      if (!snippets.includes(snippet)) snippets.push(snippet)
      if (snippets.length >= maxSnippets) return snippets
    }
  }

  if (!snippets.length && messages[0]?.content) {
    const fallback = normalizeString(messages[0].content).slice(0, 180)
    if (fallback) snippets.push(fallback)
  }

  return snippets
}

function pickChunkSnippets(chunks, tokens, maxSnippets = 3) {
  const snippets = []
  const list = Array.isArray(chunks) ? chunks : []

  for (const chunk of list) {
    const tokenList = tokens.length ? tokens : tokenize(chunk?.summary || chunk?.title).slice(0, 2)
    const assistantSummary = normalizeString(chunk?.meta?.assistantSummary || '')
    const userIntent = normalizeString(chunk?.meta?.userIntent || '')
    const assistantContent = extractChunkRoleText(chunk, 'assistant')
    const userContent = extractChunkRoleText(chunk, 'user')
    const haystacks = [assistantSummary, assistantContent, chunk?.summary, userIntent, chunk?.contentText, userContent]
    for (const haystack of haystacks) {
      if (!haystack) continue
      for (const token of tokenList) {
        const snippet = snippetByToken(haystack, token)
        if (!snippet) continue
        if (!snippets.includes(snippet)) snippets.push(snippet)
        if (snippets.length >= maxSnippets) return snippets
      }
    }
  }

  const first = list[0] || null
  if (!snippets.length && first) {
    const assistantSummary = normalizeString(first?.meta?.assistantSummary || '')
    const assistantContent = extractChunkRoleText(first, 'assistant')
    const userIntent = normalizeString(first?.meta?.userIntent || '')
    const fallback = assistantSummary || assistantContent || normalizeString(first?.summary) || userIntent || normalizeString(first?.contentText)
    if (fallback) snippets.push(fallback.slice(0, 180))
  }
  return snippets
}

function extractChunkRoleText(chunk, role = 'assistant') {
  const normalizedRole = normalizeString(role).toLowerCase()
  const text = String(chunk?.contentText || '')
  if (!text || !normalizedRole) return ''

  const blocks = text
    .split(/\n\n(?=(?:user|assistant|system):\s)/i)
    .map((part) => String(part || '').trim())
    .filter(Boolean)

  const matched = blocks
    .filter((part) => part.toLowerCase().startsWith(`${normalizedRole}:`))
    .map((part) => normalizeString(part.replace(new RegExp(`^${normalizedRole}:\\s*`, 'i'), '')))
    .filter(Boolean)

  return matched.join('\n\n').trim()
}

function scoreChunk(chunk, query, tokens) {
  const q = normalizeString(query).toLowerCase()
  const title = normalizeString(chunk?.title).toLowerCase()
  const summary = normalizeString(chunk?.summary).toLowerCase()
  const searchable = normalizeString(chunk?.searchableText).toLowerCase()
  const content = normalizeString(chunk?.contentText).toLowerCase()
  const meta = chunk?.meta && typeof chunk.meta === 'object' ? chunk.meta : {}
  const filePaths = Array.isArray(meta.filePaths) ? meta.filePaths.join(' ').toLowerCase() : ''
  const errorKeywords = Array.isArray(meta.errorKeywords) ? meta.errorKeywords.join(' ').toLowerCase() : ''
  const codeSymbols = Array.isArray(meta.codeSymbols) ? meta.codeSymbols.join(' ').toLowerCase() : ''

  let score = 0
  if (!q) {
    score += toTimestamp(chunk?.updatedAt) / 1e12
    return score
  }

  if (summary.includes(q)) score += 10
  if (title.includes(q)) score += 7
  if (content.includes(q)) score += 6
  if (searchable.includes(q)) score += 5

  for (const token of tokens) {
    if (summary.includes(token)) score += 2.8
    if (title.includes(token)) score += 1.8
    if (content.includes(token)) score += 1.1
    if (filePaths.includes(token)) score += 1.6
    if (errorKeywords.includes(token)) score += 1.6
    if (codeSymbols.includes(token)) score += 1.3
    if (searchable.includes(token)) score += 0.9
  }

  score += toTimestamp(chunk?.updatedAt) / 1e13
  return score
}

function normalizeGbrainReadMode(mode) {
  const normalized = normalizeString(mode || 'v1').toLowerCase()
  if (normalized === 'v2') return 'v2'
  if (normalized === 'shadow') return 'shadow'
  return 'v1'
}

function getKnowledgeAtomScoreProfile(mode) {
  const readMode = normalizeGbrainReadMode(mode)
  if (readMode === 'v2') {
    return {
      exact: { summary: 8, title: 6, topics: 4, kind: 3, pageId: 2, sourceRefs: 2 },
      token: { summary: 2.4, title: 1.8, topics: 1.6, kind: 1.2, pageId: 0.8, sourceRefs: 0.6 },
      quality: { clean: 1.2, suspect: 0.4, legacy: -0.6 },
    }
  }
  if (readMode === 'shadow') {
    return {
      exact: { summary: 8, title: 6, topics: 2.8, kind: 1.8, pageId: 1.2, sourceRefs: 1.2 },
      token: { summary: 2.3, title: 1.7, topics: 1.0, kind: 0.7, pageId: 0.5, sourceRefs: 0.4 },
      quality: { clean: 0.6, suspect: 0.2, legacy: -0.2 },
    }
  }
  return {
    exact: { summary: 8, title: 6, topics: 1.2, kind: 0.8, pageId: 0.5, sourceRefs: 0.4 },
    token: { summary: 2.2, title: 1.6, topics: 0.4, kind: 0.3, pageId: 0.2, sourceRefs: 0.2 },
    quality: { clean: 0.2, suspect: 0, legacy: 0 },
  }
}

function scoreKnowledgeAtom(atom, query, tokens, mode = 'v1') {
  const readMode = normalizeGbrainReadMode(mode)
  const q = normalizeString(query).toLowerCase()
  const title = normalizeString(atom?.title).toLowerCase()
  const summary = normalizeString(atom?.summary).toLowerCase()
  const kind = normalizeString(atom?.kind).toLowerCase()
  const pageId = normalizeString(atom?.pageId).toLowerCase()
  const topics = Array.isArray(atom?.topics) ? atom.topics.map((item) => normalizeString(item).toLowerCase()).join(' ') : ''
  const sourceRefs = Array.isArray(atom?.sourceRefs)
    ? atom.sourceRefs
      .map((item) => `${normalizeString(item?.type)} ${normalizeString(item?.value)}`.toLowerCase())
      .join(' ')
    : ''
  const profile = getKnowledgeAtomScoreProfile(mode)

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

  const qualityTier = normalizeString(atom?.qualityTier).toLowerCase()
  if (qualityTier === 'clean') score += profile.quality.clean
  else if (qualityTier === 'suspect') score += profile.quality.suspect
  else score += profile.quality.legacy

  // Make mode switch observable in ranking behavior:
  // v1 leans to broad context, v2 leans to structured issue/pattern/decision/synthesis.
  if (readMode === 'v1') {
    if (kind === 'context') score += 0.6
    if (kind === 'issue' || kind === 'pattern') score -= 0.4
  } else if (readMode === 'shadow') {
    if (kind === 'context') score -= 0.1
    if (kind === 'issue' || kind === 'pattern' || kind === 'decision' || kind === 'synthesis') score += 0.2
  } else if (readMode === 'v2') {
    if (kind === 'context') score -= 0.4
    if (kind === 'issue' || kind === 'pattern' || kind === 'decision' || kind === 'synthesis') score += 0.6
  }

  score += toTimestamp(atom?.updatedAt) / 1e13
  return score
}

function pickKnowledgeAtomSnippet(atom, tokens) {
  const haystacks = [
    normalizeString(atom?.summary),
    Array.isArray(atom?.topics) ? atom.topics.map((item) => normalizeString(item)).filter(Boolean).join(' | ') : '',
    Array.isArray(atom?.sourceRefs)
      ? atom.sourceRefs
        .map((item) => normalizeString(item?.value || item?.type))
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))))
}

function isRetryableEmbeddingError(error) {
  const text = String(error || '').toLowerCase()
  if (!text) return false
  return (
    text.includes('429')
    || text.includes('rate limit')
    || text.includes('too many requests')
    || text.includes('fetch failed')
    || text.includes('timeout')
    || text.includes('abort')
  )
}

function normalizeEmbeddingModelName(model) {
  let text = String(model || '').trim().toLowerCase()
  if (!text) return ''
  text = text.replace(/^private\/openrouter\//, '')
  text = text.replace(/^openrouter\//, '')
  text = text.replace(/:free$/, '')
  return text
}

function buildChunkEmbeddingMap(records) {
  const map = new Map()
  const list = Array.isArray(records) ? records : []
  for (const row of list) {
    const chunkId = String(row?.chunkId || '').trim()
    const vector = Array.isArray(row?.vector) ? row.vector : []
    if (!chunkId || !vector.length) continue
    map.set(chunkId, {
      chunkId,
      sessionId: String(row?.sessionId || ''),
      model: String(row?.model || ''),
      dims: Number(row?.dims || vector.length || 0),
      contentHash: String(row?.contentHash || ''),
      vector,
      updatedAt: String(row?.updatedAt || ''),
    })
  }
  return map
}

function isEmbeddingCompatible(queryEmbedding, candidateEmbedding) {
  const queryDims = Number(queryEmbedding?.dims || queryEmbedding?.vector?.length || 0)
  const candidateDims = Number(candidateEmbedding?.dims || candidateEmbedding?.vector?.length || 0)
  if (!queryDims || !candidateDims || queryDims !== candidateDims) return false

  const queryModel = normalizeEmbeddingModelName(queryEmbedding?.model)
  const candidateModel = normalizeEmbeddingModelName(candidateEmbedding?.model)
  if (queryModel && candidateModel && queryModel !== candidateModel) return false
  return true
}

async function resolveEmbeddingTargetProfile(options = {}) {
  const embedMode = String(options.embedMode || '').toLowerCase()
  const effectiveMode = embedMode === 'local' || embedMode === 'remote' ? embedMode : ''
  const fallbackOnError = options.fallbackOnError !== false
  const configuredDims = Math.max(0, Number(options.embeddingConfig?.dimensions || 0))
  const hint = await embedTexts([], {
    mode: effectiveMode,
    fallbackOnError,
    config: options.embeddingConfig || {},
  })

  return {
    mode: effectiveMode || String(hint?.source || ''),
    source: String(hint?.source || ''),
    model: String(hint?.model || ''),
    dims: effectiveMode === 'local'
      ? LOCAL_EMBEDDING_DIMS
      : configuredDims,
  }
}

function getChunkRebuildReason(chunk, existingEmbedding, profile, options = {}) {
  const force = options.force === true
  if (force) return 'forced'
  if (!existingEmbedding?.vector?.length) return 'missing'

  const chunkHash = String(chunk?.contentHash || '')
  const embeddingHash = String(existingEmbedding?.contentHash || '')
  if (chunkHash && embeddingHash && chunkHash !== embeddingHash) return 'changed'

  const expectedDims = Number(profile?.dims || 0)
  if (expectedDims && Number(existingEmbedding?.dims || 0) && Number(existingEmbedding?.dims || 0) !== expectedDims) {
    return 'dims_mismatch'
  }

  const expectedModel = normalizeEmbeddingModelName(profile?.model || '')
  const actualModel = normalizeEmbeddingModelName(existingEmbedding?.model || '')
  if (expectedModel && actualModel && expectedModel !== actualModel) return 'model_mismatch'

  const chunkUpdatedAt = toTimestamp(chunk?.updatedAt)
  const embeddingUpdatedAt = toTimestamp(existingEmbedding?.updatedAt)
  if (chunkUpdatedAt && embeddingUpdatedAt && embeddingUpdatedAt < chunkUpdatedAt) return 'stale'

  return ''
}

async function ensureChunkEmbeddings(chunks, currentMap, options = {}) {
  const list = Array.isArray(chunks) ? chunks : []
  const embedMode = String(options.embedMode || '').toLowerCase()
  const effectiveMode = embedMode === 'local' || embedMode === 'remote' ? embedMode : ''
  const fallbackOnError = options.fallbackOnError !== false
  const expectedModel = normalizeEmbeddingModelName(options.expectedModel || '')
  const expectedDims = Math.max(0, Number(options.expectedDims || 0))
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 1))
  const retryBaseDelayMs = Math.max(500, Number(options.retryBaseDelayMs || EMBEDDING_RETRY_BASE_DELAY_MS))
  const onBatchProgress = typeof options.onBatchProgress === 'function' ? options.onBatchProgress : null
  const onRetry = typeof options.onRetry === 'function' ? options.onRetry : null
  const embeddingConfig = options.embeddingConfig || {}

  if (!list.length) {
    const hint = await embedTexts([], {
      mode: effectiveMode,
      fallbackOnError,
      config: embeddingConfig,
    })
    return {
      map: currentMap instanceof Map ? currentMap : new Map(),
      regenerated: 0,
      fallback: false,
      source: String(hint?.source || ''),
      model: String(hint?.model || ''),
      dims: Number(options.expectedDims || 0),
      error: null,
    }
  }

  const map = currentMap instanceof Map ? currentMap : new Map()
  const targets = list.filter((chunk) => {
    const chunkId = String(chunk?.id || '').trim()
    if (!chunkId) return false
    const existing = map.get(chunkId)
    if (!existing?.vector?.length) return true
    if (String(chunk?.contentHash || '') && String(existing?.contentHash || '') !== String(chunk?.contentHash || '')) return true
    if (expectedDims || expectedModel) {
      if (!isEmbeddingCompatible({ model: expectedModel, dims: expectedDims }, existing)) return true
    }

    const chunkTs = toTimestamp(chunk?.updatedAt)
    const embeddingTs = toTimestamp(existing?.updatedAt)
    if (!chunkTs) return false
    if (!embeddingTs) return true
    return embeddingTs < chunkTs
  })

  if (!targets.length) {
    const hint = await embedTexts([], {
      mode: effectiveMode,
      fallbackOnError,
      config: embeddingConfig,
    })
    return {
      map,
      regenerated: 0,
      fallback: false,
      source: String(hint?.source || ''),
      model: String(hint?.model || ''),
      dims: expectedDims || 0,
      error: null,
    }
  }

  const pending = []
  let source = ''
  let model = ''
  let dims = expectedDims || 0
  let fallback = false
  let error = null
  let processed = 0
  let failed = 0

  for (let i = 0; i < targets.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = targets.slice(i, i + EMBEDDING_BATCH_SIZE)
    const texts = batch.map((chunk) => buildChunkEmbeddingText(chunk))
    let result = null
    let attempt = 0
    while (attempt < maxAttempts) {
      attempt += 1
      result = await embedTexts(texts, {
        mode: effectiveMode,
        fallbackOnError,
        config: embeddingConfig,
      })

      const resultError = String(result?.error || '')
      const batchVectors = Array.isArray(result?.vectors) ? result.vectors : []
      const batchSuccess = batchVectors.filter((vector) => Array.isArray(vector) && vector.length).length
      const shouldRetry =
        effectiveMode === 'remote'
        && batchSuccess < batch.length
        && isRetryableEmbeddingError(resultError)
        && attempt < maxAttempts

      if (!shouldRetry) break

      const delayMs = Math.min(30000, retryBaseDelayMs * (2 ** (attempt - 1)))
      onRetry?.({
        attempt,
        maxAttempts,
        delayMs,
        error: resultError,
        batchSize: batch.length,
        processed,
        total: targets.length,
      })
      await sleep(delayMs)
    }

    result = result || {
      vectors: batch.map(() => []),
      source: effectiveMode,
      model: expectedModel,
      fallback: false,
      error: 'embedding 批次执行失败',
    }
    source = result.source || source
    model = result.model || model
    fallback = fallback || Boolean(result.fallback)
    if (result.error && !error) error = String(result.error)
    let batchGenerated = 0

    for (let j = 0; j < batch.length; j += 1) {
      const chunk = batch[j]
      const vector = Array.isArray(result.vectors?.[j]) ? result.vectors[j] : []
      if (!chunk?.id || !vector.length) {
        failed += 1
        continue
      }

      const chunkId = String(chunk.id)
      const sessionId = String(chunk.sessionId || '')
      const updatedAt = new Date().toISOString()
      dims = dims || vector.length
      map.set(chunkId, {
        chunkId,
        sessionId,
        model: result.model || '',
        dims: vector.length,
        contentHash: String(chunk?.contentHash || ''),
        vector,
        updatedAt,
      })
      pending.push({
        chunkId,
        sessionId,
        contentHash: String(chunk?.contentHash || ''),
        model: result.model || '',
        dims: vector.length,
        vector,
        updatedAt,
      })
      batchGenerated += 1
    }

    processed += batch.length
    onBatchProgress?.({
      processed,
      total: targets.length,
      generated: pending.length,
      failed,
      currentBatchSize: batch.length,
      source,
      model,
      fallback,
      error: result.error || null,
    })
  }

  if (pending.length) {
    await upsertChunkEmbeddings(pending)
  }

  return {
    map,
    regenerated: pending.length,
    fallback,
    source,
    model,
    dims,
    processed,
    failed,
    error,
  }
}

function hybridScore({ lexical = 0, similarity = 0 }) {
  const sim = Number(similarity || 0)
  const vectorBoost = sim > 0 ? sim * 6 : sim * 2
  return lexical + vectorBoost
}


function reciprocalRankOf(list, expectedId) {
  const rank = list.findIndex((item) => String(item?.id || '') === String(expectedId || ''))
  if (rank < 0) return 0
  return 1 / (rank + 1)
}

function extractEvalQueryFromSession(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : []
  const userMsgs = messages
    .filter((msg) => String(msg?.role || '').toLowerCase() === 'user')
    .map((msg) => normalizeString(msg?.content || ''))
    .filter((text) => text.length >= 10)

  if (!userMsgs.length) {
    const fallback = normalizeString(session?.title || '')
    return fallback.length >= 6 ? fallback : ''
  }

  userMsgs.sort((a, b) => b.length - a.length)
  return userMsgs[0].slice(0, 180)
}

async function rankSessionsWithHybrid({
  query = '',
  provider = '',
  timeRange = null,
  topK = DEFAULT_RETRIEVE_TOP_K,
  candidateLimit = 80,
  autoEmbed = true,
  embeddingConfig = {},
} = {}) {
  const normalizedQuery = normalizeString(query)
  const retrievalQuery = normalizeSearchQuery(normalizedQuery)
  const normalizedProvider = normalizeString(provider).toLowerCase()

  let candidateChunks = await retrieveChunkCandidates({
    query: retrievalQuery,
    provider: normalizedProvider,
    from: timeRange?.from || '',
    to: timeRange?.to || '',
    limit: candidateLimit * 2,
  })

  if (normalizedQuery && candidateChunks.length < candidateLimit * 2) {
    const supplement = await retrieveChunkCandidates({
      query: '',
      provider: normalizedProvider,
      from: timeRange?.from || '',
      to: timeRange?.to || '',
      limit: candidateLimit * 2,
    })

    const merged = new Map()
    for (const row of candidateChunks) {
      const chunkId = String(row?.id || '').trim()
      if (!chunkId) continue
      merged.set(chunkId, row)
      if (merged.size >= candidateLimit * 2) break
    }
    for (const row of Array.isArray(supplement) ? supplement : []) {
      const chunkId = String(row?.id || '').trim()
      if (!chunkId || merged.has(chunkId)) continue
      merged.set(chunkId, row)
      if (merged.size >= candidateLimit * 2) break
    }

    candidateChunks = Array.from(merged.values())
  }

  const filteredChunks = candidateChunks
    .filter((chunk) => chunk && typeof chunk === 'object')
    .filter((chunk) => !normalizedProvider || String(chunk.provider || '').toLowerCase() === normalizedProvider)
    .filter((chunk) => inTimeRange({ updatedAt: chunk?.updatedAt }, timeRange))

  const sessionIds = Array.from(new Set(filteredChunks.map((chunk) => String(chunk?.sessionId || '')).filter(Boolean)))
  const sessions = await loadSessionsByIds(sessionIds)
  const sessionMap = new Map(sessions.map((session) => [String(session?.id || ''), session]))
  const searchableSessionIds = new Set(
    sessions.filter((session) => isSessionSearchEnabled(session)).map((session) => String(session?.id || '')),
  )
  const searchableChunks = filteredChunks.filter((chunk) => searchableSessionIds.has(String(chunk?.sessionId || '')))
  const tokens = tokenize(retrievalQuery)

  let embeddingMap = new Map()
  let queryVector = []
  const embeddingMeta = {
    enabled: Boolean(normalizedQuery),
    source: '',
    model: '',
    fallback: false,
    regenerated: 0,
    coverage: 0,
    dims: 0,
    error: null,
  }

  if (normalizedQuery) {
    const queryEmbedding = await embedText(normalizedQuery, { config: embeddingConfig })
    queryVector = Array.isArray(queryEmbedding.vector) ? queryEmbedding.vector : []
    embeddingMeta.source = embeddingMeta.source || String(queryEmbedding.source || '')
    embeddingMeta.model = embeddingMeta.model || String(queryEmbedding.model || '')
    embeddingMeta.fallback = embeddingMeta.fallback || Boolean(queryEmbedding.fallback)
    embeddingMeta.dims = queryVector.length
    if (!embeddingMeta.error && queryEmbedding.error) embeddingMeta.error = String(queryEmbedding.error)

    if (searchableChunks.length) {
      const chunkIds = searchableChunks.map((chunk) => String(chunk?.id || '')).filter(Boolean)
      const existingEmbeddings = await loadChunkEmbeddingsByIds(chunkIds)
      embeddingMap = buildChunkEmbeddingMap(existingEmbeddings)

      if (autoEmbed) {
        const ensured = await ensureChunkEmbeddings(searchableChunks, embeddingMap, {
          embedMode: embeddingMeta.source === 'local' || embeddingMeta.source === 'remote' ? embeddingMeta.source : '',
          fallbackOnError: embeddingMeta.source !== 'remote',
          expectedModel: embeddingMeta.model,
          expectedDims: queryVector.length,
          embeddingConfig,
        })
        embeddingMap = ensured.map
        embeddingMeta.regenerated = Number(ensured.regenerated || 0)
        embeddingMeta.fallback = embeddingMeta.fallback || Boolean(ensured.fallback)
        embeddingMeta.source = ensured.source || embeddingMeta.source
        embeddingMeta.model = ensured.model || embeddingMeta.model
        embeddingMeta.dims = Number(ensured.dims || embeddingMeta.dims || queryVector.length || 0)
        if (ensured.error) embeddingMeta.error = String(ensured.error)
      }

      const embeddedCount = searchableChunks.filter((chunk) => {
        const chunkId = String(chunk?.id || '')
        return isEmbeddingCompatible(
          { model: embeddingMeta.model, dims: queryVector.length },
          embeddingMap.get(chunkId),
        )
      }).length
      embeddingMeta.coverage = searchableChunks.length ? Number((embeddedCount / searchableChunks.length).toFixed(4)) : 0
    } else {
      embeddingMeta.coverage = 0
    }
  }

  const scoredChunks = searchableChunks
    .map((chunk) => {
      const lexicalScore = scoreChunk(chunk, retrievalQuery, tokens)
      const embedding = embeddingMap.get(String(chunk?.id || ''))
      const similarity =
        normalizedQuery && queryVector.length && isEmbeddingCompatible({ model: embeddingMeta.model, dims: queryVector.length }, embedding)
          ? cosineSimilarity(queryVector, embedding?.vector || [])
          : 0
      const score = normalizedQuery ? hybridScore({ lexical: lexicalScore, similarity }) : lexicalScore

      return {
        ...chunk,
        score,
        lexicalScore,
        vectorSimilarity: similarity,
      }
    })
    .filter((chunk) => chunk.score > 0 || !normalizedQuery)

  const grouped = new Map()
  for (const chunk of scoredChunks) {
    const sessionId = String(chunk?.sessionId || '').trim()
    if (!sessionId) continue
    const baseSession = sessionMap.get(sessionId) || {
      id: sessionId,
      provider: String(chunk?.provider || ''),
      title: String(chunk?.title || ''),
      updatedAt: String(chunk?.updatedAt || ''),
      tags: [],
      messages: [],
      meta: {},
      searchableText: String(chunk?.searchableText || ''),
    }

    const existing = grouped.get(sessionId)
    if (!existing) {
      grouped.set(sessionId, {
        ...baseSession,
        score: chunk.score,
        lexicalScore: chunk.lexicalScore,
        vectorSimilarity: chunk.vectorSimilarity,
        matchedChunks: [chunk],
      })
      continue
    }

    existing.lexicalScore = Math.max(existing.lexicalScore, chunk.lexicalScore)
    existing.vectorSimilarity = Math.max(existing.vectorSimilarity, chunk.vectorSimilarity)
    existing.matchedChunks.push(chunk)
    if (chunk.score > existing.score) existing.score = chunk.score
  }

  const aggregated = Array.from(grouped.values()).map((session) => {
    const matchedChunks = Array.isArray(session.matchedChunks) ? session.matchedChunks : []
    matchedChunks.sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex)
    const best = matchedChunks[0] || null
    const extraBoost = matchedChunks.slice(1, 3).reduce((sum, chunk) => sum + Math.max(0, Number(chunk.score || 0)) * 0.12, 0)
    return {
      ...session,
      score: Number(session.score || 0) + Math.min(1.5, extraBoost),
      updatedAt: session.updatedAt || best?.updatedAt || null,
      matchedChunks: matchedChunks.slice(0, 3),
      matchedChunkCount: matchedChunks.length,
    }
  })

  const hybridRanked = [...aggregated].sort((a, b) => b.score - a.score)
  const lexicalRanked = [...aggregated].sort((a, b) => b.lexicalScore - a.lexicalScore)

  return {
    query: normalizedQuery,
    tokens,
    updatedAt: aggregated[0]?.updatedAt || null,
    hybridRanked: hybridRanked.slice(0, topK),
    lexicalRanked: lexicalRanked.slice(0, topK),
    totalCandidates: aggregated.length,
    totalChunkCandidates: searchableChunks.length,
    embedding: embeddingMeta,
  }
}

async function prepareChunkEmbeddingRebuild({
  provider = '',
  force = false,
  limit = 1200,
  embedMode = '',
  embeddingConfig = {},
} = {}) {
  const normalizedProvider = normalizeString(provider).toLowerCase()
  const scopedProvider = normalizedProvider === 'all' ? '' : normalizedProvider
  const sessions = await listSessionsForEmbedding({ provider: scopedProvider, limit })
  const sessionIds = sessions.map((session) => String(session?.id || '')).filter(Boolean)
  const chunks = await listSessionChunksForEmbedding({
    sessionIds,
    provider: scopedProvider,
    limit: Math.max(limit * 12, limit),
  })
  const chunkIds = chunks.map((chunk) => String(chunk?.id || '')).filter(Boolean)
  const existingRecords = await loadChunkEmbeddingsByIds(chunkIds)
  const existingMap = buildChunkEmbeddingMap(existingRecords)
  const profile = await resolveEmbeddingTargetProfile({
    embedMode,
    fallbackOnError: embedMode !== 'remote',
    embeddingConfig,
  })

  const reasonCounts = {
    forced: 0,
    missing: 0,
    changed: 0,
    stale: 0,
    model_mismatch: 0,
    dims_mismatch: 0,
  }

  const targets = chunks.filter((chunk) => {
    const reason = getChunkRebuildReason(
      chunk,
      existingMap.get(String(chunk?.id || '')),
      profile,
      { force },
    )
    if (!reason) return false
    if (reason in reasonCounts) reasonCounts[reason] += 1
    return true
  })

  return {
    provider: scopedProvider || 'all',
    embedMode: embedMode || 'auto',
    force: Boolean(force),
    limit,
    embeddingConfig,
    sessions,
    chunks,
    existingMap,
    targets,
    reasonCounts,
    profile,
    summary: {
      totalSessions: sessions.length,
      totalChunks: chunks.length,
      alreadyEmbedded: existingRecords.length,
      targetCount: targets.length,
    },
  }
}

function toEmbeddingJobPayload(job) {
  if (!job) return null
  const targetCount = Math.max(0, Number(job.targetCount || 0))
  const processed = Math.max(0, Number(job.processed || 0))
  return {
    id: String(job.id || ''),
    status: String(job.status || 'idle'),
    provider: String(job.provider || 'all'),
    embedMode: String(job.embedMode || 'auto'),
    force: Boolean(job.force),
    totalSessions: Number(job.totalSessions || 0),
    totalChunks: Number(job.totalChunks || 0),
    targetCount,
    processed,
    generated: Number(job.generated || 0),
    failed: Number(job.failed || 0),
    retryCount: Number(job.retryCount || 0),
    progress: targetCount ? Number((processed / targetCount).toFixed(4)) : (job.status === 'completed' ? 1 : 0),
    source: String(job.source || ''),
    model: String(job.model || ''),
    error: job.error || null,
    lastRetryError: job.lastRetryError || null,
    lastRetryDelayMs: Number(job.lastRetryDelayMs || 0),
    statusText: String(job.statusText || ''),
    createdAt: String(job.createdAt || ''),
    startedAt: String(job.startedAt || ''),
    finishedAt: String(job.finishedAt || ''),
    stats: job.stats || null,
  }
}

async function runChunkEmbeddingRebuildJob(job, plan) {
  job.status = 'running'
  job.startedAt = new Date().toISOString()
  job.statusText = plan.targets.length ? '开始构建向量...' : '没有待构建数据'

  try {
    if (!plan.targets.length) {
      const generatedAt = new Date().toISOString()
      await saveEmbeddingBuildRecord({
        provider: plan.provider,
        generated: 0,
        targetCount: 0,
        totalSessions: plan.sessions.length,
        generatedAt,
      })
      job.generated = 0
      job.finishedAt = generatedAt
      job.status = 'completed'
      job.stats = await loadEmbeddingBuildStats({ provider: plan.provider })
      job.statusText = '没有新增或变更的 chunk 需要构建'
      return toEmbeddingJobPayload(job)
    }

    const regenerated = await ensureChunkEmbeddings(plan.targets, plan.force ? new Map() : plan.existingMap, {
      embedMode: plan.embedMode,
      fallbackOnError: plan.embedMode !== 'remote',
      expectedModel: plan.profile.model,
      expectedDims: plan.profile.dims,
      embeddingConfig: plan.embeddingConfig || {},
      maxAttempts: plan.embedMode === 'remote' ? EMBEDDING_MAX_RETRY_ATTEMPTS : 1,
      retryBaseDelayMs: EMBEDDING_RETRY_BASE_DELAY_MS,
      onRetry: ({ attempt, delayMs, error }) => {
        job.retryCount = Number(job.retryCount || 0) + 1
        job.lastRetryError = error || null
        job.lastRetryDelayMs = delayMs
        job.statusText = `触发限流重试，第 ${attempt} 次，${Math.round(delayMs / 1000)}s 后继续`
      },
      onBatchProgress: ({ processed, total, generated, failed, source, model, fallback, error }) => {
        job.processed = processed
        job.targetCount = total
        job.generated = generated
        job.failed = failed
        job.source = source || job.source
        job.model = model || job.model
        job.fallback = Boolean(fallback)
        if (error) job.error = String(error)
        job.statusText = `已处理 ${processed}/${total} 条 chunk`
      },
    })

    const generatedAt = new Date().toISOString()
    await saveEmbeddingBuildRecord({
      provider: plan.provider,
      generated: Number(regenerated.regenerated || 0),
      targetCount: plan.targets.length,
      totalSessions: plan.sessions.length,
      generatedAt,
    })
    job.processed = Number(regenerated.processed || plan.targets.length || 0)
    job.generated = Number(regenerated.regenerated || 0)
    job.failed = Number(regenerated.failed || 0)
    job.source = regenerated.source || job.source
    job.model = regenerated.model || job.model
    job.error = regenerated.error || null
    job.finishedAt = generatedAt
    job.status = 'completed'
    job.stats = await loadEmbeddingBuildStats({ provider: plan.provider })
    job.statusText = job.failed
      ? `构建完成，成功 ${job.generated} 条，失败 ${job.failed} 条`
      : `构建完成，共生成 ${job.generated} 条向量`
    return toEmbeddingJobPayload(job)
  } catch (error) {
    job.finishedAt = new Date().toISOString()
    job.status = 'failed'
    job.error = String(error)
    job.statusText = '构建失败'
    return toEmbeddingJobPayload(job)
  }
}

async function resolveWikiVaultSessions({ provider = '', sessionIds = [], limit = 0 } = {}) {
  const normalizedIds = Array.isArray(sessionIds)
    ? sessionIds.map((item) => normalizeString(item)).filter(Boolean)
    : []
  const normalizedProvider = normalizeString(provider || '').toLowerCase()
  if (normalizedIds.length) {
    return loadSessionsByIds(normalizedIds)
  }
  const index = await querySessions({ provider: normalizedProvider })
  const all = Array.isArray(index?.sessions) ? index.sessions : []
  const max = Math.max(0, Number(limit || 0))
  return max > 0 ? all.slice(0, max) : all
}

function toWikiVaultSyncJobPayload(job) {
  if (!job) return null
  const totalSteps = Math.max(0, Number(job.totalSteps || 0))
  const processedSteps = Math.max(0, Number(job.processedSteps || 0))
  return {
    id: String(job.id || ''),
    status: String(job.status || 'idle'),
    provider: String(job.provider || 'all'),
    syncMode: String(job.syncMode || 'publish-only'),
    totalSessions: Math.max(0, Number(job.totalSessions || 0)),
    totalConcepts: Math.max(0, Number(job.totalConcepts || 0)),
    llmEligibleConcepts: Math.max(0, Number(job.llmEligibleConcepts || 0)),
    estimatedModelCalls: Math.max(0, Number(job.estimatedModelCalls || 0)),
    totalSteps,
    processedSteps,
    publishedCount: Math.max(0, Number(job.publishedCount || 0)),
    llmConceptCount: Math.max(0, Number(job.llmConceptCount || 0)),
    fallbackConceptCount: Math.max(0, Number(job.fallbackConceptCount || 0)),
    skippedConceptCount: Math.max(0, Number(job.skippedConceptCount || 0)),
    reusedLlmConceptCount: Math.max(0, Number(job.reusedLlmConceptCount || 0)),
    reusedFallbackConceptCount: Math.max(0, Number(job.reusedFallbackConceptCount || 0)),
    obsidianPostPublish: job.obsidianPostPublish || null,
    progress: totalSteps ? Number((processedSteps / totalSteps).toFixed(4)) : (job.status === 'completed' ? 1 : 0),
    statusText: String(job.statusText || ''),
    error: job.error || null,
    createdAt: String(job.createdAt || ''),
    startedAt: String(job.startedAt || ''),
    finishedAt: String(job.finishedAt || ''),
    lastRun: job.lastRun || null,
  }
}

function shouldPruneWikiVaultSources({ provider = '', sessionIds = [], limit = 0 } = {}) {
  return !normalizeString(provider || '').trim()
    && !(Array.isArray(sessionIds) && sessionIds.length)
    && !(Number(limit || 0) > 0)
}

async function runWikiVaultSyncJob(job, { sessions = [] } = {}) {
  job.status = 'running'
  job.startedAt = new Date().toISOString()
  job.statusText = '开始发布到 Obsidian Vault...'

  try {
    const result = await publishSessionsToVault(sessions, {
      conceptSummaryMode: job.syncMode === 'publish-with-summary' ? 'llm' : 'fallback-only',
      pruneMissingSources: job.pruneMissingSources === true,
      onSessionPublished: ({ processed, total }) => {
        job.publishedCount = processed
        job.processedSteps = processed
        job.totalSteps = total + Number(job.totalConcepts || 0)
        job.statusText = `已发布 ${processed}/${total} 条 source 页`
      },
      onConceptProgress: ({ processed, total, llmConceptCount, fallbackConceptCount, skippedConceptCount, reusedLlmConceptCount, reusedFallbackConceptCount }) => {
        job.processedSteps = Number(job.totalSessions || 0) + processed
        job.totalSteps = Number(job.totalSessions || 0) + total
        job.llmConceptCount = Number(llmConceptCount || 0)
        job.fallbackConceptCount = Number(fallbackConceptCount || 0)
        job.skippedConceptCount = Number(skippedConceptCount || 0)
        job.reusedLlmConceptCount = Number(reusedLlmConceptCount || 0)
        job.reusedFallbackConceptCount = Number(reusedFallbackConceptCount || 0)
        job.statusText = `已处理 concept ${processed}/${total}`
      },
    })

    const generatedAt = new Date().toISOString()
    const conceptStats = result?.conceptStats || {}
    const lastRun = await saveWikiVaultBuildStatsInDb({
      provider: job.provider,
      generatedAt,
      syncMode: job.syncMode,
      publishedCount: result?.published?.length || 0,
      conceptCount: Number(conceptStats.totalConcepts || job.totalConcepts || 0),
      llmConceptCount: Number(conceptStats.llmConceptCount || 0),
      fallbackConceptCount: Number(conceptStats.fallbackConceptCount || 0),
    })

    job.finishedAt = generatedAt
    job.status = 'completed'
    job.processedSteps = job.totalSteps
    job.publishedCount = result?.published?.length || 0
    job.llmConceptCount = Number(conceptStats.llmConceptCount || 0)
    job.fallbackConceptCount = Number(conceptStats.fallbackConceptCount || 0)
    job.skippedConceptCount = Number(conceptStats.skippedConceptCount || 0)
    job.reusedLlmConceptCount = Number(conceptStats.reusedLlmConceptCount || 0)
    job.reusedFallbackConceptCount = Number(conceptStats.reusedFallbackConceptCount || 0)
    job.obsidianPostPublish = result?.obsidianPostPublish || null
    job.lastRun = lastRun
    job.statusText = job.syncMode === 'publish-with-summary'
      ? `发布完成，写入 ${job.publishedCount} 条 source，LLM 汇总 ${job.llmConceptCount} 个 concept`
      : `发布完成，写入 ${job.publishedCount} 条 source，更新 ${Number(conceptStats.totalConcepts || 0)} 个 concept`
    return toWikiVaultSyncJobPayload(job)
  } catch (error) {
    job.finishedAt = new Date().toISOString()
    job.status = 'failed'
    job.error = String(error)
    job.statusText = '发布失败'
    return toWikiVaultSyncJobPayload(job)
  }
}

function collectTopTerms(sessions, limit = 20) {
  const freq = new Map()

  for (const session of sessions) {
    const messages = Array.isArray(session?.messages) ? session.messages : []
    for (const msg of messages) {
      if (String(msg?.role || '').toLowerCase() !== 'user') continue
      for (const token of tokenize(msg?.content)) {
        freq.set(token, (freq.get(token) || 0) + 1)
      }
    }
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }))
}

function collectRepeatedPrompts(sessions, limit = 12) {
  const freq = new Map()

  for (const session of sessions) {
    const messages = Array.isArray(session?.messages) ? session.messages : []
    for (const msg of messages) {
      if (String(msg?.role || '').toLowerCase() !== 'user') continue
      const normalized = normalizeString(msg?.content).toLowerCase().slice(0, 140)
      if (!normalized || normalized.length < 12) continue
      freq.set(normalized, (freq.get(normalized) || 0) + 1)
    }
  }

  return Array.from(freq.entries())
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([prompt, count]) => ({ prompt, count }))
}

const WIKI_VAULT_DEFAULT_SEARCH_TOP_K = 8
const WIKI_VAULT_MAX_SEARCH_TOP_K = 20
const WIKI_VAULT_ROOT_NOTE_PATHS = ['README.md', 'Home.md', 'index.md', 'AGENTS.md', 'log.md']
const WIKI_VAULT_SPACE_DIRS = new Map([
  ['projects', 'projectsDir'],
  ['patterns', 'patternsDir'],
  ['issues', 'issuesDir'],
  ['syntheses', 'synthesesDir'],
  ['concepts', 'conceptsDir'],
  ['sources', 'sourcesDir'],
  ['providers', 'providersDir'],
  ['entities', 'entitiesDir'],
  ['templates', 'templatesDir'],
  ['inbox', 'inboxDir'],
  ['root', null],
])
const WIKI_VAULT_DEFAULT_SEARCH_SPACES = ['projects', 'patterns', 'issues', 'syntheses', 'concepts']

function normalizeWikiSpace(input) {
  const value = normalizeString(input).toLowerCase()
  if (!value) return ''
  if (value === 'template') return 'templates'
  if (value === 'project') return 'projects'
  if (value === 'pattern') return 'patterns'
  if (value === 'issue') return 'issues'
  if (value === 'synthesis') return 'syntheses'
  if (value === 'concept') return 'concepts'
  if (value === 'provider') return 'providers'
  if (value === 'entity') return 'entities'
  if (value === 'knowledge-inbox') return 'inbox'
  return WIKI_VAULT_SPACE_DIRS.has(value) ? value : ''
}

function normalizeWikiSpaces(input) {
  const items = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[,\s]+/g) : []
  const unique = []
  const seen = new Set()
  for (const item of items) {
    const normalized = normalizeWikiSpace(item)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    unique.push(normalized)
  }
  return unique.length ? unique : [...WIKI_VAULT_DEFAULT_SEARCH_SPACES]
}

function toWikiSlug(input, fallback = '') {
  return String(input || '')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 80) || fallback
}

function isPathInside(rootDir, targetPath) {
  const relative = path.relative(rootDir, targetPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function normalizeWikiRelativePath(input) {
  return String(input || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/g, '')
    .trim()
}

function normalizeWikiLinkTarget(input) {
  return normalizeWikiRelativePath(input).replace(/\.md$/i, '')
}

function getWikiSpaceFromRelativePath(relativePath) {
  const normalized = normalizeWikiRelativePath(relativePath)
  if (!normalized) return 'root'
  if (!normalized.includes('/')) return 'root'
  const head = normalized.split('/')[0]
  return normalizeWikiSpace(head) || 'root'
}

function getWikiAudienceForPath(relativePath) {
  const space = getWikiSpaceFromRelativePath(relativePath)
  if (space === 'sources' || space === 'providers' || space === 'root') {
    if (['README.md', 'Home.md'].includes(relativePath)) return 'human'
    if (['AGENTS.md', 'log.md'].includes(relativePath)) return 'llm'
    if (relativePath === 'index.md') return 'shared'
    if (space === 'sources' || space === 'providers') return 'llm'
  }
  if (space === 'templates') return 'human'
  if (['projects', 'patterns', 'issues', 'syntheses', 'concepts', 'entities'].includes(space)) return 'shared'
  return 'shared'
}

function parseWikiFrontmatter(markdownText) {
  const raw = String(markdownText || '')
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---/)
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

function stripWikiFrontmatter(markdownText = '') {
  return String(markdownText || '').replace(/^---\n[\s\S]*?\n---\n?/, '')
}

function updateWikiFrontmatterValue(markdownText = '', key = '', value = '') {
  const raw = String(markdownText || '')
  const normalizedKey = String(key || '').trim()
  if (!normalizedKey || !raw.startsWith('---\n')) return raw
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!frontmatterMatch?.[1]) return raw
  const frontmatterBody = String(frontmatterMatch[1] || '')
  const linePattern = new RegExp(`^(${normalizedKey}:\\s*).*$`, 'm')
  const nextBody = linePattern.test(frontmatterBody)
    ? frontmatterBody.replace(linePattern, `$1"${String(value || '').replace(/"/g, '\\"')}"`)
    : `${frontmatterBody.trimEnd()}\n${normalizedKey}: "${String(value || '').replace(/"/g, '\\"')}"`
  return raw.replace(/^---\n[\s\S]*?\n---/, `---\n${nextBody}\n---`)
}

function replaceWikiLinkTarget(markdownText = '', fromTarget = '', toTarget = '') {
  const source = String(markdownText || '')
  const normalizedFrom = normalizeWikiLinkTarget(fromTarget)
  const normalizedTo = normalizeWikiLinkTarget(toTarget)
  if (!normalizedFrom || !normalizedTo || normalizedFrom === normalizedTo) {
    return {
      markdown: source,
      replacedCount: 0,
    }
  }

  let replacedCount = 0
  const markdown = source.replace(/\[\[([^\]]+)\]\]/g, (full, inner) => {
    const content = String(inner || '')
    const [targetPart, ...labelParts] = content.split('|')
    const labelSuffix = labelParts.length ? `|${labelParts.join('|')}` : ''
    const [targetOnly, ...anchorParts] = String(targetPart || '').split('#')
    if (normalizeWikiLinkTarget(targetOnly) !== normalizedFrom) return full
    replacedCount += 1
    const anchorSuffix = anchorParts.length ? `#${anchorParts.join('#')}` : ''
    return `[[${normalizedTo}${anchorSuffix}${labelSuffix}]]`
  })

  return {
    markdown,
    replacedCount,
  }
}

function buildWikiLinkRepairSamples(markdownText = '', fromTarget = '', toTarget = '', limit = 6) {
  const source = String(markdownText || '')
  const normalizedFrom = normalizeWikiLinkTarget(fromTarget)
  const normalizedTo = normalizeWikiLinkTarget(toTarget)
  if (!normalizedFrom || !normalizedTo || normalizedFrom === normalizedTo) return []

  const samples = []
  const lines = source.split(/\r?\n/g)
  for (let index = 0; index < lines.length; index += 1) {
    if (samples.length >= limit) break
    const line = String(lines[index] || '')
    const pattern = /\[\[([^\]]+)\]\]/g
    let matched = pattern.exec(line)
    while (matched) {
      if (samples.length >= limit) break
      const full = String(matched[0] || '')
      const content = String(matched[1] || '')
      const [targetPart, ...labelParts] = content.split('|')
      const [targetOnly, ...anchorParts] = String(targetPart || '').split('#')
      if (normalizeWikiLinkTarget(targetOnly) === normalizedFrom) {
        const labelSuffix = labelParts.length ? `|${labelParts.join('|')}` : ''
        const anchorSuffix = anchorParts.length ? `#${anchorParts.join('#')}` : ''
        samples.push({
          line: index + 1,
          text: line.trim().slice(0, 220),
          before: full,
          after: `[[${normalizedTo}${anchorSuffix}${labelSuffix}]]`,
        })
      }
      matched = pattern.exec(line)
    }
  }
  return samples
}

// Insert a wikilink into a candidate page's Related/My Notes section.
// Returns { markdown, insertedAt } where insertedAt is the section heading used.
function insertAnchorLinkIntoMarkdown(markdownText = '', orphanTarget = '') {
  const source = String(markdownText || '')
  const target = normalizeWikiLinkTarget(orphanTarget)
  if (!target) return { markdown: source, insertedAt: null }

  // Avoid duplicate insertion
  const alreadyLinked = new RegExp(`\\[\\[${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\|[^\\]]*)?\\]\\]`)
  if (alreadyLinked.test(source)) return { markdown: source, insertedAt: null }

  const lines = source.split(/\r?\n/)
  // Prefer ## Related* sections, fallback to ## My Notes, then append before EOF
  const sectionPatterns = [/^## Related/i, /^## My Notes/i]
  for (const pattern of sectionPatterns) {
    const idx = lines.findIndex((l) => pattern.test(l))
    if (idx === -1) continue
    // Insert after the heading (skip blank lines)
    let insertIdx = idx + 1
    while (insertIdx < lines.length && lines[insertIdx].trim() === '') insertIdx++
    lines.splice(insertIdx, 0, `- [[${target}]]`)
    return { markdown: lines.join('\n'), insertedAt: lines[idx] }
  }

  // No matching section — append a Related section before end
  const trimmed = source.trimEnd()
  return {
    markdown: `${trimmed}\n\n## Related\n\n- [[${target}]]\n`,
    insertedAt: '## Related',
  }
}

function stripMarkdownForSearch(markdownText = '') {
  return normalizeString(
    stripWikiFrontmatter(markdownText)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[\[([^\]|]+)\|?([^\]]+)?\]\]/g, '$2 $1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2')
      .replace(/^#+\s*/gm, '')
      .replace(/^>\s*/gm, '')
      .replace(/^-\s*/gm, '')
      .replace(/\|/g, ' '),
  )
}

function extractWikiNoteSummary(markdownText = '') {
  const body = stripWikiFrontmatter(markdownText)
  const summaryCallout = body.match(/>\s*\[!summary\][^\n]*\n((?:>\s?.*\n?){1,6})/i)
  if (summaryCallout?.[1]) {
    return normalizeString(summaryCallout[1].replace(/^>\s?/gm, ' '))
  }
  const firstParagraph = body
    .split(/\n\s*\n/g)
    .map((item) => normalizeString(item))
    .find((item) => item && !item.startsWith('#'))
  return firstParagraph || ''
}

function createWikiExcerpt(markdownText = '', query = '', maxChars = 220) {
  const body = stripMarkdownForSearch(markdownText)
  if (!body) return ''
  const normalizedQuery = normalizeString(query).toLowerCase()
  if (!normalizedQuery) return body.slice(0, maxChars)
  const index = body.toLowerCase().indexOf(normalizedQuery)
  if (index < 0) return body.slice(0, maxChars)
  const start = Math.max(0, index - 80)
  const end = Math.min(body.length, index + normalizedQuery.length + 120)
  const excerpt = body.slice(start, end)
  return `${start > 0 ? '...' : ''}${excerpt}${end < body.length ? '...' : ''}`
}

function normalizeObsidianSearchPath(value = '') {
  const normalized = normalizeWikiRelativePath(
    String(value || '')
      .replace(/^vault\//i, '')
      .replace(/#.*$/g, ''),
  )
  if (!normalized) return ''
  return normalized.endsWith('.md') ? normalized : `${normalized}.md`
}

function pickObsidianSearchText(input = {}, keys = []) {
  for (const key of keys) {
    const value = String(input?.[key] || '').trim()
    if (value) return value
  }
  return ''
}

function parseObsidianSearchResults(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.matches)
          ? payload.matches
          : []
  const parsed = []
  for (const [index, item] of list.entries()) {
    if (typeof item === 'string') {
      const pathValue = normalizeObsidianSearchPath(item)
      if (!pathValue) continue
      parsed.push({
        path: pathValue,
        title: '',
        summary: '',
        excerpt: '',
        score: Math.max(1, list.length - index),
        matchedTerms: [],
      })
      continue
    }
    const pathValue = normalizeObsidianSearchPath(pickObsidianSearchText(item, ['path', 'file', 'filePath', 'relativePath', 'notePath', 'note']))
    if (!pathValue) continue
    const matchedTerms = Array.isArray(item?.matchedTerms)
      ? item.matchedTerms.map((term) => String(term || '').trim()).filter(Boolean).slice(0, 8)
      : []
    parsed.push({
      path: pathValue,
      title: pickObsidianSearchText(item, ['title', 'name', 'heading']),
      summary: pickObsidianSearchText(item, ['summary', 'description']),
      excerpt: pickObsidianSearchText(item, ['excerpt', 'preview', 'snippet', 'context', 'match', 'text']),
      score: Number(item?.score || item?.rank || item?.relevance || Math.max(1, list.length - index)),
      matchedTerms,
    })
  }
  return parsed
}

function parseObsidianContextMap(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.matches)
          ? payload.matches
          : []
  const contextByPath = new Map()
  for (const item of list) {
    const pathValue = normalizeObsidianSearchPath(
      typeof item === 'string' ? item : pickObsidianSearchText(item, ['path', 'file', 'filePath', 'relativePath', 'notePath', 'note']),
    )
    if (!pathValue) continue
    if (typeof item === 'string') continue
    const excerpt = normalizeString([
      pickObsidianSearchText(item, ['context', 'excerpt', 'preview', 'snippet', 'match', 'text']),
      ...(Array.isArray(item?.lines) ? item.lines.map((line) => String(line || '').trim()) : []),
    ].filter(Boolean).join('\n'))
    if (!excerpt) continue
    contextByPath.set(pathValue, excerpt)
  }
  return contextByPath
}

async function searchWikiVaultViaObsidianCli({ query = '', spaces = [], topK = 20, includeMarkdown = false } = {}) {
  if (!isObsidianCliEnabled()) return null
  const rawSearch = await runObsidianCliJson(['search', `query=${query}`, 'format=json'], {
    ensureReady: false,
    autoLaunch: false,
    timeoutMs: 2200,
  }).catch(() => null)
  if (!rawSearch) return null

  const parsed = parseObsidianSearchResults(rawSearch)
  if (!parsed.length) {
    return {
      engine: 'obsidian-cli',
      totalNotes: Number(rawSearch?.totalNotes || rawSearch?.total || 0),
      totalMatched: 0,
      results: [],
    }
  }

  const rawContext = await runObsidianCliJson(['search:context', `query=${query}`, 'format=json'], {
    ensureReady: false,
    autoLaunch: false,
    timeoutMs: 2600,
  }).catch(() => null)
  const contextByPath = rawContext ? parseObsidianContextMap(rawContext) : new Map()
  const spaceSet = new Set(normalizeWikiSpaces(spaces))
  const candidates = []
  const seen = new Set()

  for (const item of parsed) {
    if (seen.has(item.path)) continue
    const space = getWikiSpaceFromRelativePath(item.path)
    if (spaceSet.size && !spaceSet.has(space)) continue
    seen.add(item.path)
    candidates.push(item)
  }

  candidates.sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
  const picked = candidates.slice(0, Math.max(1, topK))
  const results = []
  for (const item of picked) {
    const note = await loadWikiNoteByRelativePath(item.path)
    const title = item.title || note?.title || path.basename(item.path, '.md')
    const summary = normalizeString(item.summary || note?.summary || '')
    const excerpt = normalizeString(
      contextByPath.get(item.path)
      || item.excerpt
      || (note ? createWikiExcerpt(note.markdown, query) : ''),
    )
    results.push({
      path: item.path,
      space: getWikiSpaceFromRelativePath(item.path),
      audience: getWikiAudienceForPath(item.path),
      title,
      type: String(note?.type || ''),
      project: String(note?.project || ''),
      updatedAt: String(note?.updatedAt || ''),
      score: Number(item.score || 0),
      matchedTerms: Array.isArray(item.matchedTerms) ? item.matchedTerms : [],
      summary,
      excerpt,
      markdown: includeMarkdown ? note?.markdown : undefined,
    })
  }

  return {
    engine: 'obsidian-cli',
    totalNotes: Number(rawSearch?.totalNotes || rawSearch?.total || 0),
    totalMatched: candidates.length,
    results,
  }
}

function buildWikiSearchScore(note, query = '') {
  const normalizedQuery = normalizeString(query).toLowerCase()
  if (!normalizedQuery) return { score: 0, matchedTerms: [] }
  const queryTokens = Array.from(new Set(
    normalizedQuery
      .split(/[\s/,_\-.:：;；，。！？!?()[\]{}"'`]+/g)
      .map((item) => item.trim())
      .filter((item) => item && item.length >= 2 && !STOPWORDS.has(item)),
  ))
  const title = normalizeString(note?.title || '').toLowerCase()
  const summary = normalizeString(note?.summary || '').toLowerCase()
  const body = normalizeString(note?.searchText || '').toLowerCase()
  let score = 0
  const matchedTerms = []

  if (title.includes(normalizedQuery)) score += 9
  if (summary.includes(normalizedQuery)) score += 6
  if (body.includes(normalizedQuery)) score += 4

  for (const token of queryTokens) {
    let tokenScore = 0
    if (title.includes(token)) tokenScore += 4
    if (summary.includes(token)) tokenScore += 3
    if (body.includes(token)) tokenScore += 1.5
    if (tokenScore > 0) matchedTerms.push(token)
    score += tokenScore
  }

  return {
    score: Number(score.toFixed(2)),
    matchedTerms: matchedTerms.slice(0, 8),
  }
}

async function loadWikiNoteByRelativePath(relativePath) {
  const paths = getVaultPaths()
  const normalized = normalizeWikiRelativePath(relativePath)
  if (!normalized) return null

  const targetPath = path.resolve(paths.root, normalized)
  if (!isPathInside(paths.root, targetPath)) return null
  if (!targetPath.endsWith('.md')) return null

  const fileInfo = await stat(targetPath).catch(() => null)
  if (!fileInfo?.isFile()) return null

  const markdown = await readFile(targetPath, 'utf-8').catch(() => '')
  if (!markdown) return null
  const frontmatter = parseWikiFrontmatter(markdown)
  const title = String(frontmatter.title || normalizeString(markdown.match(/^#\s+(.+)$/m)?.[1] || '') || path.basename(normalized, '.md'))
  const summary = extractWikiNoteSummary(markdown)
  const body = stripWikiFrontmatter(markdown).trim()

  return {
    path: normalized,
    absolutePath: targetPath,
    space: getWikiSpaceFromRelativePath(normalized),
    audience: getWikiAudienceForPath(normalized),
    title,
    type: String(frontmatter.type || ''),
    project: String(frontmatter.project || ''),
    updatedAt: String(frontmatter.updatedAt || ''),
    frontmatter,
    summary,
    body,
    markdown,
    wordCount: body ? body.split(/\s+/g).filter(Boolean).length : 0,
  }
}

async function collectWikiVaultNotes(spaces = WIKI_VAULT_DEFAULT_SEARCH_SPACES) {
  const paths = getVaultPaths()
  const normalizedSpaces = normalizeWikiSpaces(spaces)
  const notes = []

  for (const space of normalizedSpaces) {
    if (space === 'root') {
      for (const relativePath of WIKI_VAULT_ROOT_NOTE_PATHS) {
        const note = await loadWikiNoteByRelativePath(relativePath)
        if (note) notes.push(note)
      }
      continue
    }

    const dirKey = WIKI_VAULT_SPACE_DIRS.get(space)
    const dirPath = dirKey ? paths[dirKey] : ''
    if (!dirPath) continue
    const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const relativePath = `${space}/${entry.name}`
      const note = await loadWikiNoteByRelativePath(relativePath)
      if (note) notes.push(note)
    }
  }

  return notes
}

async function resolveWikiProjectNote(projectInput = '') {
  const paths = getVaultPaths()
  const raw = normalizeString(projectInput)
  if (!raw) return null

  const slug = toWikiSlug(raw, '')
  if (slug) {
    const exact = await loadWikiNoteByRelativePath(`projects/${slug}.md`)
    if (exact) return exact
  }

  const entries = await readdir(paths.projectsDir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const note = await loadWikiNoteByRelativePath(`projects/${entry.name}`)
    if (!note) continue
    const candidates = [
      note.title,
      note.project,
      note.frontmatter?.repo || '',
      path.basename(note.path, '.md'),
    ].map((item) => normalizeString(item).toLowerCase()).filter(Boolean)
    if (candidates.includes(raw.toLowerCase()) || (slug && candidates.includes(slug))) return note
  }

  return null
}

function buildWikiExplainPayload() {
  const paths = getVaultPaths()
  return {
    vaultDir: paths.root,
    overview: 'Vault 是 myLocalRAG 面向 Obsidian 的知识发布层。sources 更偏证据追溯，projects/patterns/issues/syntheses/concepts 更偏人机共享知识层。',
    audiences: {
      humanPrimary: ['Home.md', 'README.md', 'projects/*.md', 'patterns/*.md', 'issues/*.md', 'syntheses/*.md', 'concepts/*.md', 'Templates/*.md'],
      llmPrimary: ['sources/*.md', 'providers/*.md', 'index.md', 'log.md', 'AGENTS.md'],
      shared: ['projects/*.md', 'patterns/*.md', 'issues/*.md', 'syntheses/*.md', 'concepts/*.md', 'index.md'],
    },
    readPriority: [
      '先看 projects/patterns/issues 获取稳定知识。',
      '需要按主题漫游时看 concepts。',
      '需要追溯原始语境时再回到 sources。',
    ],
    queryPolicy: [
      '优先搜索 reader-first 空间：projects, patterns, issues, syntheses, concepts。',
      '如果证据不足或需要原始上下文，再搜索 sources。',
      '如果要理解 vault 的规则和受众，读取 README.md 和 AGENTS.md。',
      '如果要查看待升格内容或人工审核入口，读取 inbox/promotion-queue.md。',
    ],
    writePolicy: {
      generatedMayOverwrite: ['index.md', 'log.md', 'sources/*.md', 'providers/*.md', 'projects/*.md', 'patterns/*.md', 'issues/*.md', 'concepts/*.md'],
      saferManualAreas: ['## My Notes', 'syntheses/*.md', 'Templates/*.md', 'inbox/*.md'],
      defaultMode: '当前这组 wiki-facing API 只读，不直接写库；自动生成的 promotion queue 会把待审候选写到 inbox/。',
    },
    tools: [
      { name: 'search_wiki_notes', purpose: '搜索 vault 中的 reader-first 页面或 sources 页面。' },
      { name: 'get_wiki_note', purpose: '读取某个 markdown note 的完整内容和 frontmatter。' },
      { name: 'get_project_hub', purpose: '按项目名或 key 直接拿 project hub。' },
      { name: 'search_my_history', purpose: '当 wiki 证据不足时，回到历史会话检索。' },
    ],
    docs: [
      { path: 'README.md', purpose: 'vault 总说明，解释哪些页面给谁看。' },
      { path: 'AGENTS.md', purpose: 'vault 维护规则，解释页面类型和写作规范。' },
      { path: 'inbox/promotion-queue.md', purpose: '待升格候选队列，适合人工审核 issue/pattern/synthesis 的下一步。' },
      { path: 'Templates/README.md', purpose: '手工模板说明。' },
    ],
  }
}

async function loadGbrainV2FeedStatus() {
  const status = {
    dualWriteEnabled: GBRAIN_V2_DUAL_WRITE_ENABLED,
    feedDir: GBRAIN_V2_FEED_DIR,
    manifestPath: GBRAIN_V2_FEED_MANIFEST,
    recordsPath: GBRAIN_V2_FEED_RECORDS,
    manifestExists: existsSync(GBRAIN_V2_FEED_MANIFEST),
    recordsExists: existsSync(GBRAIN_V2_FEED_RECORDS),
    manifest: null,
    files: {
      manifestSize: 0,
      recordsSize: 0,
      recordsMtime: '',
      manifestMtime: '',
    },
  }

  if (status.manifestExists) {
    const content = await readFile(GBRAIN_V2_FEED_MANIFEST, 'utf8').catch(() => '')
    if (content) {
      try {
        status.manifest = JSON.parse(content)
      } catch {
        status.manifest = null
      }
    }
    const info = await stat(GBRAIN_V2_FEED_MANIFEST).catch(() => null)
    if (info?.isFile()) {
      status.files.manifestSize = Number(info.size || 0)
      status.files.manifestMtime = info.mtime ? info.mtime.toISOString() : ''
    }
  }

  if (status.recordsExists) {
    const info = await stat(GBRAIN_V2_FEED_RECORDS).catch(() => null)
    if (info?.isFile()) {
      status.files.recordsSize = Number(info.size || 0)
      status.files.recordsMtime = info.mtime ? info.mtime.toISOString() : ''
    }
  }

  return status
}

async function runGbrainV2AtomRetrieve({
  query = '',
  topK = DEFAULT_RETRIEVE_TOP_K,
  limit = 300,
  kind = 'all',
  qualityTier = 'all',
  status = 'visible',
  mode = 'v1',
} = {}) {
  const normalizedQuery = normalizeSearchQuery(query)
  const normalizedTopK = Math.max(1, Math.min(MAX_RETRIEVE_TOP_K, Number(topK || DEFAULT_RETRIEVE_TOP_K)))
  const normalizedLimit = Math.max(normalizedTopK, Math.min(5000, Number(limit || 300)))
  const normalizedKind = normalizeString(kind || 'all') || 'all'
  const normalizedTier = normalizeString(qualityTier || 'all') || 'all'
  const normalizedStatus = normalizeString(status || 'visible') || 'visible'
  const normalizedMode = normalizeGbrainReadMode(mode)
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
      score: scoreKnowledgeAtom(atom, normalizedQuery, tokens, normalizedMode),
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
      pageType: atom.pageType,
      pageBucket: atom.pageBucket,
      kind: atom.kind,
      title: atom.title,
      summary: atom.summary,
      topics: atom.topics,
      sourceRefs: atom.sourceRefs,
      intakeStage: atom.intakeStage,
      confidence: atom.confidence,
      qualityTier: atom.qualityTier,
      qualityScore: atom.qualityScore,
      qualityIssues: atom.qualityIssues,
      status: atom.status,
      createdAt: atom.createdAt,
      updatedAt: atom.updatedAt,
      score: Number(item.score.toFixed(4)),
      snippet: pickKnowledgeAtomSnippet(atom, tokens),
    }
  })

  return {
    query: normalizedQuery,
    topK: normalizedTopK,
    tokens: tokens.slice(0, 16),
    mode: normalizedMode,
    totalScanned: atomCandidates.length,
    totalMatched: ranked.length,
    results,
  }
}

const server = http.createServer(async (req, res) => {
  if (!req.url) return send(res, 400, { error: 'Bad request' })
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true })

  const url = new URL(req.url, `http://localhost:${PORT}`)

  try {
    if (req.method === 'GET' && url.pathname === '/api-docs') {
      return sendRaw(res, 200, renderSwaggerUiHtml('/api-docs/openapi.yaml', 'Session Hub API Docs (Internal)'), 'text/html; charset=utf-8')
    }

    if (req.method === 'GET' && url.pathname === '/api-docs/public') {
      return sendRaw(res, 200, renderSwaggerUiHtml('/api-docs/openapi.public.yaml', 'Session Hub API Docs (Public)'), 'text/html; charset=utf-8')
    }

    if (req.method === 'GET' && url.pathname === '/api-docs/openapi.yaml') {
      return sendOpenApiFile(res, OPENAPI_FILE)
    }

    if (req.method === 'GET' && url.pathname === '/api-docs/openapi.public.yaml') {
      return sendOpenApiFile(res, OPENAPI_PUBLIC_FILE)
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, workspace: dataDir })
    }

    if (req.method === 'GET' && url.pathname === '/api/workspace') {
      return send(res, 200, {
        workspace: dataDir,
        files,
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/wiki-vault/stats') {
      const rawProvider = normalizeString(url.searchParams.get('provider') || '').toLowerCase()
      const provider = rawProvider === 'all' ? '' : rawProvider
      const stored = await loadWikiVaultBuildStatsInDb({ provider: provider || 'all' })
      const sessions = await resolveWikiVaultSessions({ provider })
      const preview = await buildWikiVaultSyncPreview(sessions, {
        syncMode: stored?.syncMode || 'publish-only',
      })
      return send(res, 200, {
        ...stored,
        provider: provider || 'all',
        currentSessions: Number(preview.totalSessions || 0),
        currentConcepts: Number(preview.totalConcepts || 0),
        llmEligibleConcepts: Number(preview.llmEligibleConcepts || 0),
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/wiki-vault/preview') {
      const payload = await readBody(req).catch(() => ({}))
      const rawProvider = normalizeString(payload?.provider || '').toLowerCase()
      const provider = rawProvider === 'all' ? '' : rawProvider
      const sessionIds = Array.isArray(payload?.sessionIds)
        ? payload.sessionIds.map((item) => normalizeString(item)).filter(Boolean)
        : []
      const rawLimit = Number(payload?.limit || 0) || 0
      const limit = rawLimit > 0 ? Math.max(1, Math.min(5000, rawLimit)) : 0
      const syncMode = normalizeString(payload?.syncMode || '').toLowerCase() === 'publish-with-summary'
        ? 'publish-with-summary'
        : 'publish-only'
      const sessions = await resolveWikiVaultSessions({ provider, sessionIds, limit })
      const preview = await buildWikiVaultSyncPreview(sessions, { syncMode })
      return send(res, 200, {
        provider: provider || 'all',
        ...preview,
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/wiki-vault/sync-job') {
      const payload = await readBody(req).catch(() => ({}))
      const rawProvider = normalizeString(payload?.provider || '').toLowerCase()
      const provider = rawProvider === 'all' ? '' : rawProvider
      const sessionIds = Array.isArray(payload?.sessionIds)
        ? payload.sessionIds.map((item) => normalizeString(item)).filter(Boolean)
        : []
      const rawLimit = Number(payload?.limit || 0) || 0
      const limit = rawLimit > 0 ? Math.max(1, Math.min(5000, rawLimit)) : 0
      const syncMode = normalizeString(payload?.syncMode || '').toLowerCase() === 'publish-with-summary'
        ? 'publish-with-summary'
        : 'publish-only'
      const sessions = await resolveWikiVaultSessions({ provider, sessionIds, limit })
      const preview = await buildWikiVaultSyncPreview(sessions, { syncMode })
      const job = {
        id: id('wikijob'),
        provider: provider || 'all',
        syncMode,
        totalSessions: Number(preview.totalSessions || 0),
        totalConcepts: Number(preview.totalConcepts || 0),
        llmEligibleConcepts: Number(preview.llmEligibleConcepts || 0),
        estimatedModelCalls: Number(preview.estimatedModelCalls || 0),
        totalSteps: Number(preview.estimatedSteps || 0),
        processedSteps: 0,
        publishedCount: 0,
        llmConceptCount: 0,
        fallbackConceptCount: 0,
        skippedConceptCount: 0,
        reusedLlmConceptCount: 0,
        reusedFallbackConceptCount: 0,
        createdAt: new Date().toISOString(),
        startedAt: '',
        finishedAt: '',
        status: 'queued',
        statusText: '等待开始',
        error: null,
        lastRun: null,
        pruneMissingSources: shouldPruneWikiVaultSources({ provider, sessionIds, limit }),
      }
      wikiVaultSyncJobs.set(job.id, job)
      void runWikiVaultSyncJob(job, { sessions })
      return send(res, 200, {
        job: toWikiVaultSyncJobPayload(job),
        preview: {
          provider: provider || 'all',
          ...preview,
        },
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/wiki-vault/sync-job') {
      const jobId = normalizeString(url.searchParams.get('id') || '')
      if (!jobId) return send(res, 400, { error: 'id 必填' })
      const job = wikiVaultSyncJobs.get(jobId)
      if (!job) return send(res, 404, { error: '未找到发布任务' })
      return send(res, 200, { job: toWikiVaultSyncJobPayload(job) })
    }

    if (req.method === 'POST' && url.pathname === '/api/wiki-vault/publish') {
      const payload = await readBody(req).catch(() => ({}))
      const rawProvider = normalizeString(payload?.provider || '').toLowerCase()
      const provider = rawProvider === 'all' ? '' : rawProvider
      const sessionId = normalizeString(payload?.sessionId || '')
      const sessionIds = Array.isArray(payload?.sessionIds)
        ? payload.sessionIds.map((item) => normalizeString(item)).filter(Boolean)
        : sessionId
          ? [sessionId]
          : []
      const rawLimit = Number(payload?.limit || 0) || 0
      const limit = rawLimit > 0 ? Math.max(1, Math.min(5000, rawLimit)) : 0
      const syncMode = normalizeString(payload?.syncMode || '').toLowerCase() === 'publish-with-summary'
        ? 'publish-with-summary'
        : 'publish-only'

      await ensureVaultScaffold()

      let sessions = []
      if (sessionIds.length) {
        sessions = await loadSessionsByIds(sessionIds)
      } else {
        const index = await querySessions({ provider })
        const all = Array.isArray(index?.sessions) ? index.sessions : []
        sessions = limit > 0 ? all.slice(0, limit) : all
      }

      const result = await publishSessionsToVault(sessions, {
        conceptSummaryMode: syncMode === 'publish-with-summary' ? 'llm' : 'fallback-only',
        pruneMissingSources: shouldPruneWikiVaultSources({ provider, sessionIds, limit }),
      })
      const conceptStats = result?.conceptStats || {}
      const generatedAt = new Date().toISOString()
      const lastRun = await saveWikiVaultBuildStatsInDb({
        provider: provider || 'all',
        generatedAt,
        syncMode,
        publishedCount: result.published.length,
        conceptCount: Number(conceptStats.totalConcepts || 0),
        llmConceptCount: Number(conceptStats.llmConceptCount || 0),
        fallbackConceptCount: Number(conceptStats.fallbackConceptCount || 0),
      })
      return send(res, 200, {
        ok: true,
        vaultDir: result.vaultDir,
        publishedCount: result.published.length,
        published: result.published,
        conceptStats,
        propertySync: result.propertySync || null,
        obsidianPostPublish: result.obsidianPostPublish || null,
        promotionStats: result.promotionStats || null,
        lintStats: result.lintStats || null,
        lastRun,
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/wiki-vault/explain') {
      return send(res, 200, {
        ok: true,
        ...buildWikiExplainPayload(),
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/wiki-vault/lint') {
      const writeReport = normalizeString(url.searchParams.get('writeReport') || '').toLowerCase()
      const lintStats = await lintWikiVault({
        writeReport: writeReport === '0' || writeReport === 'false' ? false : true,
      })
      return send(res, 200, {
        ok: true,
        ...lintStats,
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/wiki-vault/promotion-queue') {
      const writeReport = normalizeString(url.searchParams.get('writeReport') || '').toLowerCase()
      const queue = await buildPromotionQueue({
        writeReport: writeReport === '0' || writeReport === 'false' ? false : true,
      })
      return send(res, 200, {
        ok: true,
        ...queue,
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/wiki-vault/promotion-apply') {
      const payload = await readBody(req).catch(() => ({}))
      const result = await applyPromotionCandidate(payload)
      return send(res, 200, result)
    }

    if (req.method === 'POST' && url.pathname === '/api/wiki-vault/promotion-decision') {
      const payload = await readBody(req).catch(() => ({}))
      const result = await decidePromotionCandidate(payload)
      return send(res, 200, result)
    }

    if (req.method === 'POST' && url.pathname === '/api/wiki-vault/promotion-preview') {
      const payload = await readBody(req).catch(() => ({}))
      const result = await buildPromotionCandidatePreview(payload)
      return send(res, 200, result)
    }

    if (req.method === 'POST' && url.pathname === '/api/wiki-vault/search') {
      const payload = await readBody(req).catch(() => ({}))
      const query = normalizeString(payload?.query || '')
      if (!query) return send(res, 400, { error: 'query 必填' })

      const topK = Math.max(1, Math.min(
        WIKI_VAULT_MAX_SEARCH_TOP_K,
        Number(payload?.topK || WIKI_VAULT_DEFAULT_SEARCH_TOP_K) || WIKI_VAULT_DEFAULT_SEARCH_TOP_K,
      ))
      const spaces = normalizeWikiSpaces(payload?.spaces)
      const includeMarkdown = payload?.includeMarkdown === true
      let openClawSync = null
      if (payload?.syncOpenClaw === true) {
        openClawSync = await importOpenClawKnowledge({})
        await buildPromotionQueue({ writeReport: true })
      }
      const cliResult = await searchWikiVaultViaObsidianCli({
        query,
        spaces,
        topK,
        includeMarkdown,
      }).catch(() => null)

      if (cliResult) {
        return send(res, 200, {
          query,
          topK,
          spaces,
          engine: cliResult.engine,
          totalNotes: Number(cliResult.totalNotes || 0),
          totalMatched: Number(cliResult.totalMatched || 0),
          openClawSync: openClawSync
            ? {
                root: openClawSync.root,
                summary: openClawSync.summary,
              }
            : undefined,
          results: Array.isArray(cliResult.results) ? cliResult.results : [],
        })
      }

      const notes = await collectWikiVaultNotes(spaces)
      const results = notes
        .map((note) => {
          const searchText = [note.title, note.summary, note.body].filter(Boolean).join('\n')
          const scored = buildWikiSearchScore({ ...note, searchText }, query)
          return {
            ...note,
            score: scored.score,
            matchedTerms: scored.matchedTerms,
            excerpt: createWikiExcerpt(note.markdown, query),
          }
        })
        .filter((note) => Number(note.score || 0) > 0)
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || a.title.localeCompare(b.title))
        .slice(0, topK)
        .map((note) => ({
          path: note.path,
          space: note.space,
          audience: note.audience,
          title: note.title,
          type: note.type,
          project: note.project,
          updatedAt: note.updatedAt,
          score: note.score,
          matchedTerms: note.matchedTerms,
          summary: note.summary,
          excerpt: note.excerpt,
          markdown: includeMarkdown ? note.markdown : undefined,
        }))

      return send(res, 200, {
        query,
        topK,
        spaces,
        engine: 'legacy',
        totalNotes: notes.length,
        totalMatched: results.length,
        openClawSync: openClawSync
          ? {
              root: openClawSync.root,
              summary: openClawSync.summary,
            }
          : undefined,
        results,
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/wiki-vault/create-from-template') {
      const payload = await readBody(req).catch(() => ({}))
      const relativePath = normalizeWikiRelativePath(payload?.path || payload?.relativePath || '')
      if (!relativePath) return send(res, 400, { error: 'path 必填' })
      const template = normalizeString(payload?.template || '')
      try {
        const result = await createVaultNoteFromTemplate({
          path: relativePath,
          template,
        })
        return send(res, 200, {
          ok: true,
          ...result,
        })
      } catch (error) {
        return send(res, 400, {
          error: String(error?.message || error || 'create-from-template failed'),
        })
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/wiki-vault/note') {
      const relativePath = normalizeWikiRelativePath(url.searchParams.get('path') || '')
      if (!relativePath) return send(res, 400, { error: 'path 必填' })
      const note = await loadWikiNoteByRelativePath(relativePath)
      if (!note) return send(res, 404, { error: '未找到 note' })
      return send(res, 200, {
        ok: true,
        note: {
          path: note.path,
          space: note.space,
          audience: note.audience,
          title: note.title,
          type: note.type,
          project: note.project,
          updatedAt: note.updatedAt,
          summary: note.summary,
          wordCount: note.wordCount,
          frontmatter: note.frontmatter,
          markdown: note.markdown,
          body: note.body,
        },
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/wiki-vault/repair-link') {
      const payload = await readBody(req).catch(() => ({}))
      const relativePath = normalizeWikiRelativePath(payload?.path || '')
      const fromTarget = normalizeWikiLinkTarget(payload?.fromTarget || '')
      const toTarget = normalizeWikiLinkTarget(payload?.toTarget || '')
      if (!relativePath) return send(res, 400, { error: 'path 必填' })
      if (!fromTarget) return send(res, 400, { error: 'fromTarget 必填' })
      if (!toTarget) return send(res, 400, { error: 'toTarget 必填' })
      if (fromTarget === toTarget) return send(res, 400, { error: 'fromTarget / toTarget 不能相同' })

      const note = await loadWikiNoteByRelativePath(relativePath)
      if (!note?.absolutePath) return send(res, 404, { error: '未找到 note' })

      const repaired = replaceWikiLinkTarget(note.markdown, fromTarget, toTarget)
      if (!repaired.replacedCount) {
        return send(res, 400, { error: '当前页面里没有匹配到要替换的 wikilink' })
      }

      const timestamp = new Date().toISOString()
      const nextMarkdown = updateWikiFrontmatterValue(repaired.markdown, 'updatedAt', timestamp)
      await writeFile(note.absolutePath, nextMarkdown, 'utf-8')
      const refreshed = await loadWikiNoteByRelativePath(relativePath)

      return send(res, 200, {
        ok: true,
        path: relativePath,
        fromTarget,
        toTarget,
        replacedCount: repaired.replacedCount,
        updatedAt: timestamp,
        note: refreshed ? {
          path: refreshed.path,
          title: refreshed.title,
          summary: refreshed.summary,
          updatedAt: refreshed.updatedAt,
        } : null,
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/wiki-vault/repair-link-preview') {
      const payload = await readBody(req).catch(() => ({}))
      const relativePath = normalizeWikiRelativePath(payload?.path || '')
      const fromTarget = normalizeWikiLinkTarget(payload?.fromTarget || '')
      const toTarget = normalizeWikiLinkTarget(payload?.toTarget || '')
      if (!relativePath) return send(res, 400, { error: 'path 必填' })
      if (!fromTarget) return send(res, 400, { error: 'fromTarget 必填' })
      if (!toTarget) return send(res, 400, { error: 'toTarget 必填' })
      if (fromTarget === toTarget) return send(res, 400, { error: 'fromTarget / toTarget 不能相同' })

      const note = await loadWikiNoteByRelativePath(relativePath)
      if (!note) return send(res, 404, { error: '未找到 note' })

      const repaired = replaceWikiLinkTarget(note.markdown, fromTarget, toTarget)
      const samples = buildWikiLinkRepairSamples(note.markdown, fromTarget, toTarget, 6)
      return send(res, 200, {
        ok: true,
        path: relativePath,
        fromTarget,
        toTarget,
        replacedCount: repaired.replacedCount,
        samples,
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/wiki-vault/rebuild-index') {
      const startedAt = new Date().toISOString()
      const result = await rebuildVaultIndex({ conceptSummaryMode: 'fallback' })
      return send(res, 200, {
        ok: true,
        startedAt,
        finishedAt: new Date().toISOString(),
        totalConcepts: result?.totalConcepts ?? null,
        totalProjects: result?.totalProjects ?? null,
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/wiki-vault/clean-synthesis-evidence') {
      const payload = await readBody(req).catch(() => ({}))
      const targetPath = normalizeWikiRelativePath(payload?.path || '')
      if (!targetPath) return send(res, 400, { error: 'path 必填' })
      const result = await cleanSynthesisEvidenceItems(targetPath)
      return send(res, 200, result)
    }

    if (req.method === 'POST' && url.pathname === '/api/wiki-vault/anchor-link-preview') {
      const payload = await readBody(req).catch(() => ({}))
      const candidatePath = normalizeWikiRelativePath(payload?.candidatePath || '')
      const orphanTarget = normalizeWikiLinkTarget(payload?.orphanTarget || '')
      if (!candidatePath) return send(res, 400, { error: 'candidatePath 必填' })
      if (!orphanTarget) return send(res, 400, { error: 'orphanTarget 必填' })
      const note = await loadWikiNoteByRelativePath(candidatePath)
      if (!note) return send(res, 404, { error: '未找到候选页面' })
      const result = insertAnchorLinkIntoMarkdown(note.markdown, orphanTarget)
      return send(res, 200, {
        ok: true,
        candidatePath,
        orphanTarget,
        insertedAt: result.insertedAt,
        alreadyLinked: result.insertedAt === null,
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/wiki-vault/anchor-link') {
      const payload = await readBody(req).catch(() => ({}))
      const candidatePath = normalizeWikiRelativePath(payload?.candidatePath || '')
      const orphanTarget = normalizeWikiLinkTarget(payload?.orphanTarget || '')
      if (!candidatePath) return send(res, 400, { error: 'candidatePath 必填' })
      if (!orphanTarget) return send(res, 400, { error: 'orphanTarget 必填' })
      const note = await loadWikiNoteByRelativePath(candidatePath)
      if (!note?.absolutePath) return send(res, 404, { error: '未找到候选页面' })
      const result = insertAnchorLinkIntoMarkdown(note.markdown, orphanTarget)
      if (result.insertedAt === null) return send(res, 400, { error: '链接已存在，无需重复插入' })
      const timestamp = new Date().toISOString()
      const nextMarkdown = updateWikiFrontmatterValue(result.markdown, 'updatedAt', timestamp)
      await writeFile(note.absolutePath, nextMarkdown, 'utf-8')
      return send(res, 200, {
        ok: true,
        candidatePath,
        orphanTarget,
        insertedAt: result.insertedAt,
        updatedAt: timestamp,
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/wiki-vault/project') {
      const projectInput = normalizeString(url.searchParams.get('project') || '')
      if (!projectInput) return send(res, 400, { error: 'project 必填' })
      const note = await resolveWikiProjectNote(projectInput)
      if (!note) return send(res, 404, { error: '未找到 project hub' })
      return send(res, 200, {
        ok: true,
        project: projectInput,
        note: {
          path: note.path,
          space: note.space,
          audience: note.audience,
          title: note.title,
          type: note.type,
          project: note.project,
          updatedAt: note.updatedAt,
          summary: note.summary,
          wordCount: note.wordCount,
          frontmatter: note.frontmatter,
          markdown: note.markdown,
          body: note.body,
        },
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/prompt-rubric') {
      return send(res, 200, {
        rubric: getPromptRubric(),
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/prompt-score') {
      const payload = await readBody(req)
      const promptText = normalizeString(payload.prompt || '')
      if (!promptText) return send(res, 400, { error: 'prompt 必填' })
      const modelSettings = await loadModelSettingsInDb()
      const result = await scorePromptDetailed(promptText, {
        promptId: payload.promptId || '',
        contextMessages: Array.isArray(payload.contextMessages) ? payload.contextMessages : [],
        taskType: payload.taskType || 'general',
        assistantConfig: modelSettings.assistant,
        includeEffectAssessment: payload.includeEffectAssessment !== false,
      })
      return send(res, 200, result)
    }

    if (req.method === 'POST' && url.pathname === '/api/prompt-effect-assessment') {
      const payload = await readBody(req)
      const promptText = normalizeString(payload.prompt || '')
      if (!promptText) return send(res, 400, { error: 'prompt 必填' })
      const modelSettings = await loadModelSettingsInDb()
      const requestOptions = {
        promptId: payload.promptId || '',
        contextMessages: Array.isArray(payload.contextMessages) ? payload.contextMessages : [],
        taskType: payload.taskType || 'general',
        assistantConfig: modelSettings.assistant,
      }
      const result = payload.cacheOnly
        ? await loadPromptEffectAssessment(promptText, requestOptions)
        : await assessPromptEffectWithCache(promptText, {
            ...requestOptions,
            forceRegenerate: Boolean(payload.forceRegenerate),
          })
      return send(res, 200, result || null)
    }

    if (req.method === 'POST' && url.pathname === '/api/prompt-score-batch') {
      const payload = await readBody(req)
      const prompts = Array.isArray(payload.prompts) ? payload.prompts : []
      if (!prompts.length) return send(res, 400, { error: 'prompts 必填且不能为空数组' })
      const results = scorePrompts(prompts)
      return send(res, 200, {
        total: results.length,
        results,
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/prompt-optimize') {
      const payload = await readBody(req)
      const promptText = normalizeString(payload.prompt || '')
      if (!promptText) return send(res, 400, { error: 'prompt 必填' })
      const modelSettings = await loadModelSettingsInDb()
      const result = await optimizePrompt({
        prompt: promptText,
        promptId: payload.promptId || '',
        taskType: payload.taskType || '',
        model: payload.model || modelSettings.dspy.model || '',
        apiBase: payload.apiBase || modelSettings.dspy.apiBase || '',
        apiKey: payload.apiKey || modelSettings.dspy.apiKey || '',
        provider: payload.provider || modelSettings.dspy.provider || '',
        language: payload.language || '',
        forceRegenerate: Boolean(payload.forceRegenerate),
        timeoutMs: Number(payload.timeoutMs || modelSettings.dspy.timeoutMs || 0),
        contextMessages: Array.isArray(payload.contextMessages) ? payload.contextMessages : [],
        constraints: Array.isArray(payload.constraints) ? payload.constraints : payload.constraints || [],
      })
      return send(res, 200, result)
    }

    if (req.method === 'POST' && url.pathname === '/api/ask') {
      const payload = await readBody(req)
      const query = normalizeString(payload.query || payload.prompt || payload.input || '')
      const messages = Array.isArray(payload.messages) ? payload.messages : []
      if (!query && !messages.length) return send(res, 400, { error: 'query 或 messages 至少提供一个' })
      const modelSettings = await loadModelSettingsInDb()

      const result = await askModel({
        query,
        messages,
        systemPrompt: payload.systemPrompt || payload.system || '',
        model: payload.model || modelSettings.assistant.model || '',
        apiBase: payload.apiBase || modelSettings.assistant.apiBase || '',
        apiKey: payload.apiKey || modelSettings.assistant.apiKey || '',
        timeoutMs: payload.timeoutMs || modelSettings.assistant.timeoutMs,
        temperature: payload.temperature ?? modelSettings.assistant.temperature,
        topP: payload.topP ?? payload.top_p ?? modelSettings.assistant.topP,
        maxTokens: payload.maxTokens ?? payload.max_tokens ?? modelSettings.assistant.maxTokens,
      })
      return send(res, 200, result)
    }

    if (req.method === 'GET' && url.pathname === '/api/model-settings') {
      const settings = await loadModelSettingsInDb()
      return send(res, 200, {
        settings,
        capabilities: buildModelCapabilityList(settings),
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/model-settings') {
      const payload = await readBody(req)
      const settings = await saveModelSettingsInDb(payload?.settings || payload || {})
      return send(res, 200, {
        settings,
        capabilities: buildModelCapabilityList(settings),
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/feishu/settings') {
      const settings = await loadFeishuProjectSettingsInDb()
      return send(res, 200, {
        settings: buildFeishuProjectSettingsView(settings),
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/feishu/settings') {
      const payload = await readBody(req)
      const current = await loadFeishuProjectSettingsInDb()
      const merged = mergeFeishuProjectSettings(current, payload?.settings || payload || {})
      if (merged.mode === 'custom' && !String(merged.customToken || '').trim()) {
        return send(res, 400, { error: '自定义模式必须提供 X-Mcp-Token' })
      }
      const settings = await saveFeishuProjectSettingsInDb(merged)
      return send(res, 200, {
        settings: buildFeishuProjectSettingsView(settings),
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/model-settings/test') {
      const payload = await readBody(req)
      const settings = payload?.settings || {}
      const owners = Array.isArray(payload?.owners) ? payload.owners : []
      const normalizedOwners = [...new Set(
        owners
          .map((item) => String(item || '').trim())
          .filter((item) => item === 'assistant' || item === 'embedding' || item === 'dspy'),
      )]
      if (!normalizedOwners.length) return send(res, 400, { error: 'owners 不能为空' })

      const results = await Promise.all(normalizedOwners.map(async (owner) => {
        try {
          return await testModelOwnerConnectivity(owner, settings)
        } catch (error) {
          const effective = buildEffectiveModelSettings(settings)
          const fallbackConfig = owner === 'embedding' ? effective.embedding : owner === 'dspy' ? effective.dspy : effective.assistant
          return {
            owner,
            ok: false,
            model: String(fallbackConfig.model || ''),
            apiBase: String(fallbackConfig.apiBase || ''),
            detail: String(error?.message || error || '测试失败'),
          }
        }
      }))

      return send(res, 200, {
        testedAt: new Date().toISOString(),
        results,
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/knowledge-items') {
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 200)))
      const sourceType = normalizeString(url.searchParams.get('sourceType') || 'all') || 'all'
      const status = normalizeString(url.searchParams.get('status') || 'visible') || 'visible'
      const q = String(url.searchParams.get('q') || '').trim()
      const result = await listKnowledgeItemsInDb({
        limit,
        sourceType,
        status,
        q,
      })
      return send(res, 200, result)
    }

    if (req.method === 'GET' && url.pathname === '/api/gbrain-v2/atoms') {
      const limit = Math.min(5000, Math.max(1, Number(url.searchParams.get('limit') || 200)))
      const kind = normalizeString(url.searchParams.get('kind') || 'all') || 'all'
      const qualityTier = normalizeString(url.searchParams.get('qualityTier') || 'all') || 'all'
      const status = normalizeString(url.searchParams.get('status') || 'visible') || 'visible'
      const q = String(url.searchParams.get('q') || '').trim()
      const includeStats = String(url.searchParams.get('includeStats') || '1') !== '0'

      const items = await listKnowledgeAtomsInDb({
        limit,
        kind,
        qualityTier,
        status,
        q,
      })
      const stats = includeStats ? await getKnowledgeAtomStatsInDb() : null
      return send(res, 200, {
        items,
        stats,
        filters: { limit, kind, qualityTier, status, q },
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/gbrain-v2/lineage') {
      const limit = Math.min(5000, Math.max(1, Number(url.searchParams.get('limit') || 200)))
      const rawId = normalizeString(url.searchParams.get('rawId') || '')
      const atomId = normalizeString(url.searchParams.get('atomId') || '')
      const canonicalId = normalizeString(url.searchParams.get('canonicalId') || '')
      const pageId = normalizeString(url.searchParams.get('pageId') || '')
      if (!rawId && !atomId && !canonicalId && !pageId) {
        return send(res, 400, { error: 'rawId / atomId / canonicalId / pageId 至少提供一个' })
      }
      const includeStats = String(url.searchParams.get('includeStats') || '0') === '1'
      const items = await listKnowledgeLineageInDb({
        rawId,
        atomId,
        canonicalId,
        pageId,
        limit,
      })
      const stats = includeStats ? await getKnowledgeLineageStatsInDb() : null
      return send(res, 200, {
        items,
        stats,
        filters: { rawId, atomId, canonicalId, pageId, limit },
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/gbrain-v2/retrieve') {
      const payload = await readBody(req)
      const query = normalizeSearchQuery(payload?.query || payload?.q || '')
      if (!query) return send(res, 400, { error: 'query 必填' })
      const settings = await loadGbrainV2SettingsInDb()
      const requestedMode = normalizeString(payload?.readMode || payload?.mode || '')
      const result = await runGbrainV2AtomRetrieve({
        query,
        topK: Number(payload?.topK || payload?.top_k || DEFAULT_RETRIEVE_TOP_K),
        limit: Number(payload?.limit || 300),
        kind: payload?.kind || 'all',
        qualityTier: payload?.qualityTier || 'all',
        status: payload?.status || 'visible',
        mode: requestedMode || settings.readMode,
      })
      return send(res, 200, result)
    }

    if (req.method === 'GET' && url.pathname === '/api/gbrain-v2/feed-status') {
      const [feed, atomStats, lineageStats, settings] = await Promise.all([
        loadGbrainV2FeedStatus(),
        getKnowledgeAtomStatsInDb(),
        getKnowledgeLineageStatsInDb(),
        loadGbrainV2SettingsInDb(),
      ])
      return send(res, 200, {
        feed,
        settings,
        atoms: atomStats,
        lineage: lineageStats,
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/gbrain-v2/settings') {
      const settings = await loadGbrainV2SettingsInDb()
      return send(res, 200, { settings })
    }

    if (req.method === 'POST' && url.pathname === '/api/gbrain-v2/settings') {
      const payload = await readBody(req)
      const settings = await saveGbrainV2SettingsInDb({
        enabled: payload?.enabled,
        readMode: payload?.readMode,
        feedMode: payload?.feedMode,
        includeRawFallback: payload?.includeRawFallback,
        dualWriteEnabled: payload?.dualWriteEnabled,
      })
      return send(res, 200, { settings })
    }

    if (req.method === 'POST' && url.pathname === '/api/openclaw-knowledge/preview') {
      const payload = await readBody(req)
      try {
        const result = await previewOpenClawKnowledge({
          root: normalizeString(payload?.root || ''),
        })
        return send(res, 200, { ok: true, ...result })
      } catch (error) {
        return send(res, 400, { error: String(error?.message || error || 'OpenClaw 预览失败') })
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/openclaw-knowledge/import') {
      const payload = await readBody(req)
      try {
        const result = await importOpenClawKnowledge({
          root: normalizeString(payload?.root || ''),
        })
        const promotionQueue = await buildPromotionQueue({ writeReport: true })
        return send(res, 200, {
          ok: true,
          ...result,
          promotionQueue: {
            reportPath: promotionQueue.reportPath,
            summary: promotionQueue.summary || {},
          },
        })
      } catch (error) {
        return send(res, 400, { error: String(error?.message || error || 'OpenClaw 导入失败') })
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/knowledge-items') {
      const payload = await readBody(req)
      const content = String(payload?.content || '').trim()
      const title = String(payload?.title || '').trim()
      if (!content && !title) {
        return send(res, 400, { error: 'title 或 content 至少填写一项' })
      }

      try {
        const item = await upsertKnowledgeItemInDb({
          id: payload?.id,
          sourceType: payload?.sourceType,
          sourceSubtype: payload?.sourceSubtype,
          status: payload?.status,
          title,
          content,
          summary: payload?.summary,
          sourceUrl: payload?.sourceUrl,
          sourceFile: payload?.sourceFile,
          tags: Array.isArray(payload?.tags)
            ? payload.tags
            : String(payload?.tags || '')
              .split(/[,\n]/)
              .map((item) => String(item || '').trim())
              .filter(Boolean),
          meta: payload?.meta && typeof payload.meta === 'object' ? payload.meta : {},
        })
        return send(res, 200, { item })
      } catch (error) {
        return send(res, 400, { error: String(error?.message || error || '保存失败') })
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/knowledge-items/status') {
      const payload = await readBody(req)
      const id = normalizeString(payload?.id || '')
      const status = normalizeString(payload?.status || 'draft')
      if (!id) return send(res, 400, { error: 'id 必填' })

      try {
        const item = await updateKnowledgeItemStatusInDb({ id, status })
        if (!item) return send(res, 404, { error: '条目不存在' })
        return send(res, 200, { item })
      } catch (error) {
        return send(res, 400, { error: String(error?.message || error || '状态更新失败') })
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/knowledge-items/delete') {
      const payload = await readBody(req)
      const id = normalizeString(payload?.id || '')
      if (!id) return send(res, 400, { error: 'id 必填' })

      try {
        const result = await deleteKnowledgeItemInDb(id)
        return send(res, 200, result)
      } catch (error) {
        return send(res, 400, { error: String(error?.message || error || '删除失败') })
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/sources') {
      const sources = await loadSources()
      return send(res, 200, { sources })
    }

    if (req.method === 'GET' && url.pathname === '/api/discover-sources') {
      const sources = await loadSources()
      const suggestions = await discoverSourceSuggestions(sources)
      return send(res, 200, { suggestions })
    }

    if (req.method === 'POST' && url.pathname === '/api/sources') {
      const payload = await readBody(req)
      const err = validateSource(payload)
      if (err) return send(res, 400, { error: err })

      const sources = await loadSources()
      const next = {
        id: id(),
        name: payload.name,
        provider: payload.provider,
        path: path.resolve(payload.path),
        format: payload.format || 'auto',
        createdAt: new Date().toISOString(),
      }
      sources.push(next)
      await saveSources(sources)
      return send(res, 200, { source: next })
    }

    if (req.method === 'POST' && url.pathname === '/api/scan') {
      const sources = await loadSources()
      const current = await loadIndex()
      const scanned = await scanSources(sources, { persist: false })
      const index = {
        updatedAt: new Date().toISOString(),
        sessions: mergeSyncedSessions(current.sessions || [], scanned.sessions || [], { pruneMissing: true }),
        issues: Array.isArray(scanned.issues) ? scanned.issues : [],
      }
      await mergeIndex(index)
      return send(res, 200, index)
    }

    if (req.method === 'POST' && url.pathname === '/api/scan-provider') {
      const payload = await readBody(req)
      const provider = normalizeProviderAlias(payload.provider || '')
      if (!provider || provider === 'all') return send(res, 400, { error: 'provider 必填，且不能为 all' })

      try {
        const result = await refreshProviderSessions(provider, { requireSource: true })
        return send(res, 200, result)
      } catch (error) {
        return send(res, 400, { error: String(error?.message || error || 'provider 扫描失败') })
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/sessions/review') {
      const payload = await readBody(req)
      const id = normalizeString(payload.id || '')
      if (!id) return send(res, 400, { error: 'id 必填' })

      const result = await updateSessionReview({
        id,
        segmentId: normalizeString(payload.segmentId || ''),
        status: payload.status,
        keepInSearch: typeof payload.keepInSearch === 'boolean' ? payload.keepInSearch : undefined,
        qualityScore: payload.qualityScore,
        note: payload.note,
        reviewedBy: payload.reviewedBy,
      })
      if (!result.updated || !result.session) return send(res, 404, { error: '会话不存在' })
      return send(res, 200, { session: result.session })
    }

    if (req.method === 'POST' && url.pathname === '/api/import-folder') {
      const payload = await readBody(req)
      const err = validateImportPath(payload)
      if (err) return send(res, 400, { error: err })

      const standard = await adaptFolderToStandard(payload.path)
      const importedIndex = toIndexFromStandard(standard)
      const current = await loadIndex()
      const mergedMap = new Map()

      for (const session of Array.isArray(current.sessions) ? current.sessions : []) {
        if (!session?.id) continue
        mergedMap.set(String(session.id), session)
      }
      for (const session of importedIndex.sessions) {
        if (!session?.id) continue
        mergedMap.set(String(session.id), session)
      }

      const mergedSessions = Array.from(mergedMap.values()).sort(
        (a, b) => +new Date(b.updatedAt || 0) - +new Date(a.updatedAt || 0),
      )

      const index = {
        updatedAt: new Date().toISOString(),
        sessions: mergedSessions,
        issues: [...(current.issues || []), ...(importedIndex.issues || [])],
      }

      await mergeIndex(index)

      return send(res, 200, {
        imported: importedIndex.sessions.length,
        total: index.sessions.length,
        issues: importedIndex.issues || [],
        updatedAt: index.updatedAt,
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/import-preview') {
      const payload = await readBody(req)
      const fileEntries = sanitizeUploadedFiles(payload.files)
      if (!fileEntries.length) return send(res, 400, { error: '请先选择文件夹并读取文件' })

      const standard = await adaptTextFilesToStandard(fileEntries, {
        provider: payload.provider || 'other',
        sourceRoot: payload.sourceRoot || 'upload',
      })

      const bySourceType = {}
      for (const session of standard.sessions) {
        bySourceType[session.sourceType] = (bySourceType[session.sourceType] || 0) + 1
      }

      return send(res, 200, {
        count: standard.count,
        bySourceType,
        issues: standard.issues || [],
        sample: standard.sessions.slice(0, 12).map((s) => ({
          id: s.id,
          title: s.title,
          provider: s.provider,
          sourceType: s.sourceType,
          messageCount: Array.isArray(s.messages) ? s.messages.length : 0,
        })),
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/import-folder-files') {
      const payload = await readBody(req)
      const fileEntries = sanitizeUploadedFiles(payload.files)
      if (!fileEntries.length) return send(res, 400, { error: '请先选择文件夹并读取文件' })

      const standard = await adaptTextFilesToStandard(fileEntries, {
        provider: payload.provider || 'other',
        sourceRoot: payload.sourceRoot || 'upload',
      })
      const importedIndex = toIndexFromStandard(standard)
      const current = await loadIndex()
      const mergedMap = new Map()

      for (const session of Array.isArray(current.sessions) ? current.sessions : []) {
        if (!session?.id) continue
        mergedMap.set(String(session.id), session)
      }
      for (const session of importedIndex.sessions) {
        if (!session?.id) continue
        mergedMap.set(String(session.id), session)
      }

      const mergedSessions = Array.from(mergedMap.values()).sort(
        (a, b) => +new Date(b.updatedAt || 0) - +new Date(a.updatedAt || 0),
      )

      const index = {
        updatedAt: new Date().toISOString(),
        sessions: mergedSessions,
        issues: [...(current.issues || []), ...(importedIndex.issues || [])],
      }

      await mergeIndex(index)

      return send(res, 200, {
        imported: importedIndex.sessions.length,
        total: index.sessions.length,
        issues: importedIndex.issues || [],
        updatedAt: index.updatedAt,
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/bug-trace/settings/patch-dirs') {
      const presets = await listPatchDirPresetsInDb()
      return send(res, 200, { presets })
    }

    if (req.method === 'GET' && url.pathname === '/api/bug-trace/patch-count') {
      const patchDir = path.resolve(
        String(url.searchParams.get('patchDir') || process.env.KB_PATCH_DIR || path.join(process.cwd(), '.ai-patches')),
      )
      if (!existsSync(patchDir)) {
        return send(res, 200, { patchDir, total: 0 })
      }
      const records = await readPatchRecords(patchDir)
      return send(res, 200, { patchDir, total: records.length })
    }

    if (req.method === 'GET' && url.pathname === '/api/feishu/todolist') {
      const action = normalizeString(url.searchParams.get('action') || 'todo') || 'todo'
      const maxPages = Math.min(5, Math.max(1, Number(url.searchParams.get('pages') || 3)))
      try {
        const rows = await listFeishuTodoItems(action, maxPages)
        const items = rows.map((row) => toFeishuTodoListItem(row)).filter(Boolean)
        return send(res, 200, {
          action,
          total: items.length,
          items,
        })
      } catch (error) {
        return send(res, 400, { error: String(error) })
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/feishu/bug-candidates') {
      try {
        const { candidates, strategy } = await listFeishuBugCandidatesForBinding()
        return send(res, 200, {
          total: Array.isArray(candidates) ? candidates.length : 0,
          strategy,
          candidates,
        })
      } catch (error) {
        return send(res, 400, { error: String(error) })
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/feishu/todolist/batch-transition') {
      const payload = await readBody(req)
      const action = normalizeString(payload?.action || 'confirm').toLowerCase()
      if (!['confirm', 'rollback'].includes(action)) {
        return send(res, 400, { error: 'action 仅支持 confirm / rollback' })
      }
      const rollbackReason = normalizeString(payload?.rollbackReason || '')
      if (action === 'rollback' && !rollbackReason) {
        return send(res, 400, { error: 'rollback 操作必须提供 rollbackReason' })
      }

      const rawItems = Array.isArray(payload?.items) ? payload.items : []
      const items = rawItems
        .map((row) => ({
          id: normalizeString(row?.id || ''),
          title: normalizeString(row?.title || ''),
          projectKey: normalizeString(row?.projectKey || ''),
          nodeStateKey: normalizeString(row?.nodeStateKey || ''),
        }))
        .filter((item) => item.id && item.projectKey && item.nodeStateKey)
      if (!items.length) {
        return send(res, 400, { error: 'items 不能为空，且每项需包含 id/projectKey/nodeStateKey' })
      }

      const results = []
      for (const item of items) {
        try {
          await callFeishuProjectMcp('tools/call', {
            name: 'transition_node',
            arguments: {
              project_key: item.projectKey,
              work_item_id: item.id,
              node_id: item.nodeStateKey,
              action,
              ...(action === 'rollback' ? { rollback_reason: rollbackReason } : {}),
            },
          })
          results.push({
            id: item.id,
            title: item.title,
            ok: true,
          })
        } catch (error) {
          results.push({
            id: item.id,
            title: item.title,
            ok: false,
            error: String(error),
          })
        }
      }

      const succeeded = results.filter((item) => item.ok).length
      const failed = results.length - succeeded
      return send(res, 200, {
        action,
        total: results.length,
        succeeded,
        failed,
        results,
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/bug-inbox') {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)))
      const items = await listBugInboxInDb({ limit })
      return send(res, 200, { items })
    }

    if (req.method === 'POST' && url.pathname === '/api/bug-inbox') {
      const payload = await readBody(req)
      const bugCode = String(payload?.bugCode || '').trim()
      if (!bugCode) return send(res, 400, { error: 'bugCode 必填' })

      const trace = payload?.trace && typeof payload.trace === 'object' ? payload.trace : {}
      const matchedSnippets = Array.isArray(trace?.matchedSnippets) ? trace.matchedSnippets.slice(0, 6) : []
      const snippet = trace?.snippet && typeof trace.snippet === 'object' ? trace.snippet : null
      const question = String(trace?.question || '').trim()
      const patchFile = String(trace?.patchFile || '').trim()
      const title = normalizeString(payload?.title || question || patchFile || '手动入库 Bug')

      try {
        const item = await createBugInboxInDb({
          title,
          description: normalizeString(payload?.description || ''),
          severity: normalizeString(payload?.severity || 'medium').toLowerCase(),
          status: normalizeString(payload?.status || 'open').toLowerCase(),
          bugCode,
          patchFile,
          patchPath: String(trace?.patchPath || '').trim(),
          patchDir: normalizeString(payload?.patchDir || ''),
          cursorRoot: normalizeString(payload?.cursorRoot || ''),
          conversationId: String(trace?.conversationId || '').trim(),
          score: Number(trace?.score || 0),
          snippet,
          matchedSnippets,
          meta: {
            source: 'manual',
            turnDir: String(trace?.turnDir || '').trim(),
            assistantSummary: String(trace?.assistantSummary || '').trim(),
            createdFrom: 'bug-trace',
          },
        })
        return send(res, 200, { item })
      } catch (error) {
        return send(res, 400, { error: String(error) })
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/bug-inbox/match-feishu') {
      const payload = await readBody(req)
      const bugId = normalizeString(payload?.bugId || '')
      if (!bugId) return send(res, 400, { error: 'bugId 必填' })
      const bug = await getBugInboxByIdInDb(bugId)
      if (!bug) return send(res, 404, { error: 'bug 不存在' })

      try {
        const { candidates, strategy } = await listFeishuBugCandidatesForBinding()

        return send(res, 200, {
          bugId,
          query: buildFeishuBugQuery(bug),
          candidates,
          strategy,
        })
      } catch (error) {
        return send(res, 400, { error: String(error) })
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/bug-inbox/link-feishu') {
      const payload = await readBody(req)
      const bugId = normalizeString(payload?.bugId || '')
      const candidate = payload?.candidate && typeof payload.candidate === 'object' ? payload.candidate : null
      if (!bugId) return send(res, 400, { error: 'bugId 必填' })
      if (!candidate) return send(res, 400, { error: 'candidate 必填' })
      try {
        const updated = await updateBugInboxMetaInDb({
          id: bugId,
          metaPatch: {
            feishuLink: {
              id: normalizeString(candidate.id || ''),
              title: normalizeString(candidate.title || ''),
              url: normalizeString(candidate.url || ''),
              status: normalizeString(candidate.status || ''),
              assignee: normalizeString(candidate.assignee || ''),
              creator: normalizeString(candidate.creator || ''),
              reporter: normalizeString(candidate.reporter || ''),
              createdAt: normalizeString(candidate.createdAt || ''),
              requirement: normalizeString(candidate.requirement || ''),
              linkedAt: new Date().toISOString(),
            },
          },
        })
        return send(res, 200, { item: updated })
      } catch (error) {
        return send(res, 400, { error: String(error) })
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/bug-inbox/update') {
      const payload = await readBody(req)
      const bugId = normalizeString(payload?.id || '')
      const description = normalizeString(payload?.description || '')
      if (!bugId) return send(res, 400, { error: 'id 必填' })
      if (description.length > 100) return send(res, 400, { error: '描述不能超过 100 字' })
      try {
        const updated = await updateBugInboxDescriptionInDb({
          id: bugId,
          description,
        })
        return send(res, 200, { item: updated })
      } catch (error) {
        return send(res, 400, { error: String(error) })
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/bug-inbox/delete') {
      const payload = await readBody(req)
      const bugId = normalizeString(payload?.id || '')
      if (!bugId) return send(res, 400, { error: 'id 必填' })
      try {
        const result = await deleteBugInboxInDb(bugId)
        return send(res, 200, result)
      } catch (error) {
        return send(res, 400, { error: String(error) })
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/bug-trace/settings/patch-dirs') {
      const payload = await readBody(req)
      const alias = normalizeString(payload.alias || '')
      const patchPath = normalizeString(payload.path || '')
      if (!alias || !patchPath) return send(res, 400, { error: 'alias/path 必填' })

      try {
        const saved = await upsertPatchDirPresetInDb({
          id: normalizeString(payload.id || ''),
          alias,
          path: patchPath,
        })
        const presets = await listPatchDirPresetsInDb()
        return send(res, 200, { preset: saved, presets })
      } catch (error) {
        return send(res, 400, { error: String(error) })
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/bug-trace/settings/patch-dirs/delete') {
      const payload = await readBody(req)
      const id = normalizeString(payload.id || '')
      if (!id) return send(res, 400, { error: 'id 必填' })
      const result = await deletePatchDirPresetInDb(id)
      const presets = await listPatchDirPresetsInDb()
      return send(res, 200, { ...result, presets })
    }

    if (req.method === 'POST' && url.pathname === '/api/bug-trace') {
      const payload = await readBody(req)
      const bugCode = String(payload.bugCode || payload.code || '')
      if (!bugCode.trim()) return send(res, 400, { error: 'bugCode 必填' })

      const topK = Math.min(30, Math.max(1, Number(payload.topK || 8)))
      const patchDir = path.resolve(
        String(payload.patchDir || process.env.KB_PATCH_DIR || path.join(process.cwd(), '.ai-patches')),
      )
      const cursorRoot = path.resolve(
        String(payload.cursorRoot || process.env.KB_CURSOR_ROOT || '/Users/hm/.cursor/projects'),
      )

      if (!existsSync(patchDir)) {
        return send(res, 400, { error: `patch 目录不存在: ${patchDir}` })
      }

      const records = await readPatchRecords(patchDir)
      const scored = records
        .map((record) => {
          const matched = scorePatchAgainstBugCode(bugCode, record.patchContent)
          return {
            ...record,
            matched,
          }
        })
        .filter((record) => Number(record.matched?.score || 0) > 0)
        .sort((a, b) => Number(b.matched.score || 0) - Number(a.matched.score || 0))
        .slice(0, topK)

      const results = []
      for (const item of scored) {
        const meta = item.meta && typeof item.meta === 'object' ? item.meta : {}
        const conversationId = String(meta.conversation_id || meta.conversationId || '').trim()
        const locate = conversationId
          ? await findCursorTranscriptByConversationId(cursorRoot, conversationId)
          : null
        const summary = locate?.transcriptPath ? await readCursorConversationSummary(locate.transcriptPath) : null

        results.push({
          score: item.matched.score,
          patchFile: item.patchFile,
          patchPath: item.patchPath,
          patchContent: item.patchContent.slice(0, 300000),
          turnDir: item.turnDir || String(meta.turn_dir || '').trim() || null,
          layout: item.layout || null,
          snapshot: {
            beforeDir: item.beforeDir || null,
            afterDir: item.afterDir || null,
          },
          conversationId: conversationId || null,
          conversationTurnIndex: Number(meta.conversation_turn_index || meta.conversationTurnIndex || 0) || null,
          question: String(meta.question || '').trim() || null,
          assistantSummary: String(meta.assistant_summary || meta.assistantSummary || '').trim() || null,
          startedAt: String(meta.started_at || meta.startedAt || '').trim() || null,
          endedAt: String(meta.ended_at || meta.endedAt || '').trim() || null,
          changedFiles: Array.isArray(meta.changed_files || meta.changedFiles)
            ? (meta.changed_files || meta.changedFiles).slice(0, 12)
            : [],
          matchedLines: item.matched.matchedLines,
          tokenHitRate: item.matched.tokenHitRate,
          snippet: item.matched.snippet,
          hitKeywords: Array.isArray(item.matched.hitKeywords) ? item.matched.hitKeywords : [],
          snippetSource: item.matched.snippetSource || null,
          matchedLocations: Array.isArray(item.matched.matchedLocations) ? item.matched.matchedLocations : [],
          matchedSnippets: Array.isArray(item.matched.matchedSnippets) ? item.matched.matchedSnippets : [],
          cursorConversation: {
            found: Boolean(locate?.transcriptPath),
            transcriptPath: locate?.transcriptPath || null,
            project: locate?.project || null,
            title: summary?.title || null,
            turns: summary?.turns || null,
            messageCount: summary?.messageCount || null,
            lastMessageAt: summary?.lastMessageAt || null,
            preview: summary?.preview || null,
          },
        })
      }

      return send(res, 200, {
        bugCode,
        patchDir,
        cursorRoot,
        totalPatchRecords: records.length,
        totalMatched: results.length,
        results,
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/bug-trace/file-preview') {
      const payload = await readBody(req)
      const patchDir = path.resolve(
        String(payload.patchDir || process.env.KB_PATCH_DIR || path.join(process.cwd(), '.ai-patches')),
      )
      const turnDirInput = String(payload.turnDir || '').trim()
      const patchPathInput = String(payload.patchPath || '').trim()
      const turnDir = turnDirInput ? path.resolve(turnDirInput) : ''
      const patchPath = patchPathInput ? path.resolve(patchPathInput) : ''
      const filePath = toSafeRelativePath(payload.filePath || '')
      if (!filePath) return send(res, 400, { error: 'filePath 必填' })

      const allowedRoot = path.resolve(patchDir)
      const baseDir = turnDir || (patchPath ? path.dirname(patchPath) : '')
      if (!baseDir) return send(res, 400, { error: 'turnDir/patchPath 至少提供一个' })
      if (!baseDir.startsWith(allowedRoot)) return send(res, 400, { error: '目录不在允许范围中' })

      const beforePath = path.join(baseDir, 'before', filePath)
      const afterPath = path.join(baseDir, 'after', filePath)
      const beforeContent = await readFile(beforePath, 'utf-8').catch(() => null)
      const afterContent = await readFile(afterPath, 'utf-8').catch(() => null)

      return send(res, 200, {
        filePath,
        beforeExists: beforeContent !== null,
        afterExists: afterContent !== null,
        beforeContent: beforeContent ? beforeContent.slice(0, 400000) : '',
        afterContent: afterContent ? afterContent.slice(0, 400000) : '',
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/bug-trace/conversation-detail') {
      const payload = await readBody(req)
      const transcriptPath = path.resolve(String(payload.transcriptPath || ''))
      const cursorRoot = path.resolve(
        String(payload.cursorRoot || process.env.KB_CURSOR_ROOT || '/Users/hm/.cursor/projects'),
      )
      if (!transcriptPath) return send(res, 400, { error: 'transcriptPath 必填' })
      if (!transcriptPath.startsWith(cursorRoot)) return send(res, 400, { error: 'transcriptPath 不在允许目录中' })

      const detail = await readCursorConversationDetail(transcriptPath, Number(payload.limit || 500))
      if (!detail) return send(res, 404, { error: '未找到会话详情' })

      return send(res, 200, {
        transcriptPath,
        ...detail,
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase()
      const provider = normalizeProviderAlias(url.searchParams.get('provider') || '')
      const from = (url.searchParams.get('from') || '').trim()
      const to = (url.searchParams.get('to') || '').trim()
      const conversationId = (url.searchParams.get('conversationId') || '').trim().toLowerCase()
      const index = await querySessions({ q, provider, from, to, conversationId })
      const rawSessions = Array.isArray(index.sessions) ? index.sessions : []
      const sessions = rawSessions.map(({ searchableText, ...rest }) => rest)

      return send(res, 200, {
        updatedAt: index.updatedAt,
        issues: index.issues || [],
        sessions,
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/sessions/delete') {
      const payload = await readBody(req)
      const sessionId = normalizeString(payload.id || '')
      if (!sessionId) return send(res, 400, { error: 'id 必填' })

      const { removed } = await deleteSessionById(sessionId)
      const index = await loadIndex()

      return send(res, 200, {
        removed,
        total: Array.isArray(index.sessions) ? index.sessions.length : 0,
        updatedAt: index.updatedAt || null,
      })
    }

    if (
      req.method === 'POST' &&
      (url.pathname === '/api/messages/tags' ||
        url.pathname === '/api/messages/tags/' ||
        url.pathname === '/api/message-tags')
    ) {
      const payload = await readBody(req)
      const sessionId = normalizeString(payload.sessionId || '')
      const messageIds = Array.isArray(payload.messageIds)
        ? payload.messageIds.map((id) => normalizeString(id)).filter(Boolean)
        : []
      const tags = Array.isArray(payload.tags) ? payload.tags.map((tag) => normalizeString(tag)).filter(Boolean) : []

      if (!sessionId) return send(res, 400, { error: 'sessionId 必填' })
      if (!messageIds.length) return send(res, 400, { error: 'messageIds 必填' })

      const result = await updateMessageTags({
        sessionId,
        messageIds,
        tags,
      })

      return send(res, 200, result)
    }

    if (req.method === 'POST' && url.pathname === '/api/retrieve') {
      const payload = await readBody(req)
      const query = normalizeString(payload.query || '')
      const provider = normalizeProviderAlias(payload.provider || '')
      const topK = Math.min(
        MAX_RETRIEVE_TOP_K,
        Math.max(1, Number(payload.topK || DEFAULT_RETRIEVE_TOP_K)),
      )
      const candidateLimit = Math.max(topK * 8, 80)
      const includeMessages = Boolean(payload.includeMessages)
      const timeRange = payload.timeRange && typeof payload.timeRange === 'object' ? payload.timeRange : null
      const autoEmbed = payload.autoEmbed !== false
      const rewriteQuery = payload.rewriteQuery === true
      const generateAnswer = payload.generateAnswer === true
      const modelSettings = await loadModelSettingsInDb()
      const gbrainV2Settings = await loadGbrainV2SettingsInDb()

      let queryRewrite = {
        enabled: rewriteQuery,
        applied: false,
        originalQuery: query,
        searchQuery: query,
        retrievalQuery: query,
        keywords: [],
        alternatives: [],
        reason: '',
        model: '',
        finishReason: '',
        usage: null,
        error: null,
      }

      if (query && rewriteQuery) {
        try {
          const rewritten = await rewriteRetrieveQuery({
            query,
            provider,
            timeRange,
            assistantConfig: modelSettings.assistant,
          })
          queryRewrite = {
            ...queryRewrite,
            ...rewritten,
            enabled: true,
            error: null,
          }
        } catch (error) {
          queryRewrite.error = String(error)
        }
      }

      const retrievalQuery = normalizeString(queryRewrite.retrievalQuery || query)

      const rankedResult = await rankSessionsWithHybrid({
        query: retrievalQuery,
        provider,
        topK,
        candidateLimit,
        timeRange,
        autoEmbed,
        embeddingConfig: modelSettings.embedding,
      })

      const ranked = rankedResult.hybridRanked.map((session) => {
        const messages = Array.isArray(session.messages) ? session.messages : []
        const lastMessage = messages[messages.length - 1] || null
        const matchedChunks = Array.isArray(session.matchedChunks) ? session.matchedChunks : []
        const snippets = matchedChunks.length ? pickChunkSnippets(matchedChunks, rankedResult.tokens, 3) : pickSnippets(session, rankedResult.tokens, 3)
        return {
          sessionId: session.id,
          title: session.title,
          provider: session.provider,
          matched_at: session.updatedAt,
          relevance_score: Number(session.score.toFixed(4)),
          lexical_score: Number(session.lexicalScore.toFixed(4)),
          vector_similarity: Number((session.vectorSimilarity || 0).toFixed(4)),
          matched_chunk_count: Number(session.matchedChunkCount || matchedChunks.length || 0),
          sourceFile: session.meta?.sourceFile || null,
          sourceUrl: session.meta?.url || null,
          tags: Array.isArray(session.tags) ? session.tags : [],
          snippets,
          matched_chunks: matchedChunks.map((chunk) => ({
            chunkId: chunk.id,
            summary: chunk.summary,
            chunkIndex: chunk.chunkIndex,
            turnIndex: Number(chunk.meta?.turnIndex || 0),
            userIntent: String(chunk.meta?.userIntent || '').trim(),
            assistantSummary: String(chunk.meta?.assistantSummary || '').trim(),
            lexical_score: Number((chunk.lexicalScore || 0).toFixed(4)),
            vector_similarity: Number((chunk.vectorSimilarity || 0).toFixed(4)),
            snippet: pickChunkSnippets([chunk], rankedResult.tokens, 1)[0] || normalizeString(chunk.contentText || chunk.summary || '').slice(0, 220),
            filePaths: Array.isArray(chunk.meta?.filePaths) ? chunk.meta.filePaths : [],
            errorKeywords: Array.isArray(chunk.meta?.errorKeywords) ? chunk.meta.errorKeywords : [],
          })),
          matched_turn_indexes: [...new Set(
            matchedChunks
              .map((chunk) => Number(chunk.meta?.turnIndex || 0))
              .filter((value) => Number.isInteger(value) && value >= 0),
          )].slice(0, 6),
          lastMessage: lastMessage
            ? {
                role: lastMessage.role,
                createdAt: lastMessage.createdAt || null,
                content: normalizeString(lastMessage.content).slice(0, 260),
              }
            : null,
          messages: includeMessages
            ? messages.map((msg) => ({
                id: msg.id,
                role: msg.role,
                createdAt: msg.createdAt || null,
                content: msg.content,
              }))
            : undefined,
        }
      })

      const context_block =
        '以下是来自本地历史对话的相关记忆：\n\n' +
        ranked
          .map((r, i) =>
            '[引用 ' +
            String(i + 1) +
            '] 会话: ' +
            String(r.title || '') +
            ' (来自 ' +
            String(r.provider || '') +
            ')\n时间: ' +
            String(r.matched_at || '') +
            '\n相关片段:\n' +
            r.snippets.join('\n') +
            '\n',
          )
          .join('\n')

      let answer = {
        requested: generateAnswer,
        status: generateAnswer ? 'skipped' : 'not_requested',
        text: '',
        citations: [],
        grounded: false,
        insufficient: false,
        model: '',
        finishReason: '',
        usage: null,
        error: null,
      }

      if (generateAnswer) {
        try {
          const generated = await generateGroundedAnswer({
            query,
            retrievalQuery,
            results: ranked,
            assistantConfig: modelSettings.assistant,
          })
          answer = {
            ...answer,
            ...generated,
            requested: true,
            error: null,
          }
        } catch (error) {
          answer = {
            ...answer,
            requested: true,
            status: 'error',
            grounded: false,
            insufficient: false,
            error: String(error),
            model: String(modelSettings.assistant.model || ''),
          }
        }
      }

      let gbrainV2 = null
      if (
        query
        && (
          gbrainV2Settings.readMode === 'shadow'
          || gbrainV2Settings.readMode === 'v2'
          || gbrainV2Settings.enabled
        )
      ) {
        try {
          const retrieveResult = await runGbrainV2AtomRetrieve({
            query: retrievalQuery || query,
            topK,
            limit: Math.max(topK * 30, 300),
            kind: 'all',
            qualityTier: 'all',
            status: 'visible',
            mode: gbrainV2Settings.readMode,
          })
          gbrainV2 = {
            settings: gbrainV2Settings,
            retrieve: retrieveResult,
          }
        } catch (error) {
          gbrainV2 = {
            settings: gbrainV2Settings,
            retrieve: null,
            error: String(error),
          }
        }
      }

      return send(res, 200, {
        query,
        retrievalQuery,
        retrieveMode: 'v1',
        gbrainV2Mode: gbrainV2Settings.readMode,
        topK,
        totalCandidates: rankedResult.totalCandidates,
        totalChunkCandidates: rankedResult.totalChunkCandidates,
        totalMatched: ranked.length,
        updatedAt: rankedResult.updatedAt,
        context_block,
        embedding: rankedResult.embedding,
        queryRewrite,
        answer,
        gbrainV2,
        results: ranked,
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/embeddings/stats') {
      const provider = normalizeString(url.searchParams.get('provider') || '').toLowerCase()
      const stats = await loadEmbeddingBuildStats({ provider })
      return send(res, 200, stats)
    }

    if (req.method === 'POST' && url.pathname === '/api/embeddings/preview') {
      const payload = await readBody(req)
      const rawProvider = normalizeString(payload.provider || '').toLowerCase()
      const provider = rawProvider === 'all' ? '' : rawProvider
      const force = Boolean(payload.force)
      const limit = Math.max(1, Math.min(5000, Number(payload.limit || 1200)))
      const rawEmbedMode = normalizeString(payload.embedMode || payload.mode || '').toLowerCase()
      const embedMode = rawEmbedMode === 'local' || rawEmbedMode === 'remote' ? rawEmbedMode : ''
      const modelSettings = await loadModelSettingsInDb()

      const plan = await prepareChunkEmbeddingRebuild({
        provider,
        force,
        limit,
        embedMode,
        embeddingConfig: modelSettings.embedding,
      })

      return send(res, 200, {
        provider: plan.provider,
        embedMode: plan.embedMode,
        force: plan.force,
        limit: plan.limit,
        totalSessions: plan.summary.totalSessions,
        totalChunks: plan.summary.totalChunks,
        alreadyEmbedded: plan.summary.alreadyEmbedded,
        targetCount: plan.summary.targetCount,
        reasonCounts: plan.reasonCounts,
        embedding: {
          source: plan.profile.source,
          model: plan.profile.model,
          dims: plan.profile.dims,
        },
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/embeddings/rebuild') {
      const payload = await readBody(req)
      const rawProvider = normalizeString(payload.provider || '').toLowerCase()
      const provider = rawProvider === 'all' ? '' : rawProvider
      const force = Boolean(payload.force)
      const limit = Math.max(1, Math.min(5000, Number(payload.limit || 1200)))
      const rawEmbedMode = normalizeString(payload.embedMode || payload.mode || '').toLowerCase()
      const embedMode = rawEmbedMode === 'local' || rawEmbedMode === 'remote' ? rawEmbedMode : ''
      const modelSettings = await loadModelSettingsInDb()
      const plan = await prepareChunkEmbeddingRebuild({
        provider,
        force,
        limit,
        embedMode,
        embeddingConfig: modelSettings.embedding,
      })
      const job = {
        id: id('embedjob'),
        provider: plan.provider,
        embedMode: plan.embedMode,
        force: plan.force,
        totalSessions: plan.summary.totalSessions,
        totalChunks: plan.summary.totalChunks,
        targetCount: plan.summary.targetCount,
        processed: 0,
        generated: 0,
        failed: 0,
        retryCount: 0,
        source: plan.profile.source,
        model: plan.profile.model,
        createdAt: new Date().toISOString(),
        startedAt: '',
        finishedAt: '',
        status: 'queued',
        statusText: '等待开始',
        error: null,
        lastRetryError: null,
        lastRetryDelayMs: 0,
        stats: null,
      }
      const result = await runChunkEmbeddingRebuildJob(job, plan)

      return send(res, 200, {
        provider: plan.provider,
        embedMode: plan.embedMode,
        limit: plan.limit,
        force: plan.force,
        totalSessions: plan.summary.totalSessions,
        totalChunks: plan.summary.totalChunks,
        alreadyEmbedded: plan.summary.alreadyEmbedded,
        targetCount: plan.summary.targetCount,
        generated: Number(result?.generated || 0),
        embedding: {
          source: result?.source || plan.profile.source || '',
          model: result?.model || plan.profile.model || '',
          fallback: false,
          error: result?.error || null,
        },
        generatedAt: result?.finishedAt || new Date().toISOString(),
        stats: result?.stats || await loadEmbeddingBuildStats({ provider: plan.provider }),
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/embeddings/rebuild-job') {
      const payload = await readBody(req)
      const rawProvider = normalizeString(payload.provider || '').toLowerCase()
      const provider = rawProvider === 'all' ? '' : rawProvider
      const force = Boolean(payload.force)
      const limit = Math.max(1, Math.min(5000, Number(payload.limit || 1200)))
      const rawEmbedMode = normalizeString(payload.embedMode || payload.mode || '').toLowerCase()
      const embedMode = rawEmbedMode === 'local' || rawEmbedMode === 'remote' ? rawEmbedMode : ''
      const modelSettings = await loadModelSettingsInDb()

      const plan = await prepareChunkEmbeddingRebuild({
        provider,
        force,
        limit,
        embedMode,
        embeddingConfig: modelSettings.embedding,
      })
      const job = {
        id: id('embedjob'),
        provider: plan.provider,
        embedMode: plan.embedMode,
        force: plan.force,
        totalSessions: plan.summary.totalSessions,
        totalChunks: plan.summary.totalChunks,
        targetCount: plan.summary.targetCount,
        processed: 0,
        generated: 0,
        failed: 0,
        retryCount: 0,
        source: plan.profile.source,
        model: plan.profile.model,
        createdAt: new Date().toISOString(),
        startedAt: '',
        finishedAt: '',
        status: 'queued',
        statusText: '等待开始',
        error: null,
        lastRetryError: null,
        lastRetryDelayMs: 0,
        stats: null,
      }
      embeddingRebuildJobs.set(job.id, job)
      void runChunkEmbeddingRebuildJob(job, plan)
      return send(res, 200, {
        job: toEmbeddingJobPayload(job),
        preview: {
          provider: plan.provider,
          embedMode: plan.embedMode,
          totalSessions: plan.summary.totalSessions,
          totalChunks: plan.summary.totalChunks,
          targetCount: plan.summary.targetCount,
          reasonCounts: plan.reasonCounts,
        },
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/embeddings/rebuild-job') {
      const jobId = normalizeString(url.searchParams.get('id') || '')
      if (!jobId) return send(res, 400, { error: 'id 必填' })
      const job = embeddingRebuildJobs.get(jobId)
      if (!job) return send(res, 404, { error: '未找到构建任务' })
      return send(res, 200, { job: toEmbeddingJobPayload(job) })
    }

    if (req.method === 'POST' && url.pathname === '/api/embeddings/evaluate') {
      const payload = await readBody(req)
      const provider = normalizeString(payload.provider || '').toLowerCase()
      const topK = Math.min(MAX_RETRIEVE_TOP_K, Math.max(1, Number(payload.topK || DEFAULT_RETRIEVE_TOP_K)))
      const sampleSize = Math.max(5, Math.min(200, Number(payload.sampleSize || 40)))
      const autoEmbed = payload.autoEmbed !== false
      const modelSettings = await loadModelSettingsInDb()

      const pool = await listSessionsForEmbedding({ provider, limit: Math.max(sampleSize * 3, sampleSize) })
      const samples = pool
        .map((session) => ({
          session,
          query: extractEvalQueryFromSession(session),
        }))
        .filter((item) => item.query)
        .slice(0, sampleSize)

      if (!samples.length) {
        return send(res, 400, { error: '没有可评估样本（缺少可用 user query）' })
      }

      let lexicalHits = 0
      let hybridHits = 0
      let lexicalMrr = 0
      let hybridMrr = 0
      let embeddingFallbackCount = 0
      const improvedCases = []
      const regressedCases = []

      for (const item of samples) {
        const expectedId = String(item.session?.id || '')
        const rankedResult = await rankSessionsWithHybrid({
          query: item.query,
          provider,
          topK,
          candidateLimit: Math.max(topK * 8, 80),
          autoEmbed,
          embeddingConfig: modelSettings.embedding,
        })

        if (rankedResult.embedding.fallback) embeddingFallbackCount += 1

        const lexicalRanked = rankedResult.lexicalRanked
        const hybridRanked = rankedResult.hybridRanked

        const lexicalHit = lexicalRanked.some((row) => String(row?.id || '') === expectedId)
        const hybridHit = hybridRanked.some((row) => String(row?.id || '') === expectedId)
        if (lexicalHit) lexicalHits += 1
        if (hybridHit) hybridHits += 1

        const lexRr = reciprocalRankOf(lexicalRanked, expectedId)
        const hybRr = reciprocalRankOf(hybridRanked, expectedId)
        lexicalMrr += lexRr
        hybridMrr += hybRr

        if (hybRr > lexRr && improvedCases.length < 5) {
          improvedCases.push({
            sessionId: expectedId,
            title: item.session?.title || '',
            query: item.query,
            lexicalRR: Number(lexRr.toFixed(4)),
            hybridRR: Number(hybRr.toFixed(4)),
          })
        } else if (hybRr < lexRr && regressedCases.length < 5) {
          regressedCases.push({
            sessionId: expectedId,
            title: item.session?.title || '',
            query: item.query,
            lexicalRR: Number(lexRr.toFixed(4)),
            hybridRR: Number(hybRr.toFixed(4)),
          })
        }
      }

      const total = samples.length
      return send(res, 200, {
        provider: provider || 'all',
        topK,
        sampleSize: total,
        autoEmbed,
        metrics: {
          lexicalRecallAtK: Number((lexicalHits / total).toFixed(4)),
          hybridRecallAtK: Number((hybridHits / total).toFixed(4)),
          lexicalMRR: Number((lexicalMrr / total).toFixed(4)),
          hybridMRR: Number((hybridMrr / total).toFixed(4)),
          recallDelta: Number(((hybridHits - lexicalHits) / total).toFixed(4)),
          mrrDelta: Number(((hybridMrr - lexicalMrr) / total).toFixed(4)),
        },
        embedding: {
          fallbackRate: Number((embeddingFallbackCount / total).toFixed(4)),
        },
        improvedCases,
        regressedCases,
        generatedAt: new Date().toISOString(),
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/review') {
      const payload = await readBody(req)
      const provider = normalizeProviderAlias(payload.provider || '')
      const autoScan = payload.autoScan !== false
      const recentDays = Math.max(1, Number(payload.recentDays || 30))
      const minRepeatedPrompt = Math.max(2, Number(payload.minRepeatedPrompt || 2))
      const sinceTs = Date.now() - recentDays * 24 * 60 * 60 * 1000

      if (autoScan) {
        const providersToRefresh = provider && provider !== 'all' ? [provider] : ['codex', 'claude-code']
        for (const targetProvider of providersToRefresh) {
          try {
            await refreshProviderSessions(targetProvider, { requireSource: false })
          } catch {
            // Best-effort sync before review; keep review endpoint resilient.
          }
        }
      }

      const index = await loadIndex()
      const allSessions = Array.isArray(index.sessions) ? index.sessions : []
      const sessions = allSessions
        .filter((s) => s && typeof s === 'object')
        .filter((s) => !provider || String(s.provider || '').toLowerCase() === provider)
        .filter((s) => {
          const ts = toTimestamp(s.updatedAt)
          return !ts || ts >= sinceTs
        })

      const providerStats = {}
      const roleStats = {}
      let totalMessages = 0
      let totalUserPromptLength = 0
      let userPromptCount = 0
      let longSessionsCount = 0
      const resolutionStatus = { assistantFirstFoundButUserLast: 0, assistantLast: 0, userOnly: 0 }

      for (const session of sessions) {
        const p = String(session.provider || 'unknown').toLowerCase()
        providerStats[p] = (providerStats[p] || 0) + 1

        const messages = Array.isArray(session.messages) ? session.messages : []
        totalMessages += messages.length
        
        if (messages.length > 8) {
          longSessionsCount++
        }

        if (messages.length > 0) {
          const lastRole = String(messages[messages.length - 1].role || '').toLowerCase()
          if (lastRole === 'user') {
            const hasAssistant = messages.some(m => String(m.role || '').toLowerCase() === 'assistant')
            if (hasAssistant) {
              resolutionStatus.assistantFirstFoundButUserLast++
            } else {
              resolutionStatus.userOnly++
            }
          } else if (lastRole === 'assistant') {
            resolutionStatus.assistantLast++
          }
        }

        for (const msg of messages) {
          const role = String(msg.role || 'unknown').toLowerCase()
          roleStats[role] = (roleStats[role] || 0) + 1
          if (role === 'user') {
            totalUserPromptLength += normalizeString(msg.content).length
            userPromptCount++
          }
        }
      }

      const avgMessagesPerSession = sessions.length ? totalMessages / sessions.length : 0
      const avgPromptLength = userPromptCount ? totalUserPromptLength / userPromptCount : 0
      const repeatedPrompts = collectRepeatedPrompts(sessions)
        .filter((item) => item.count >= minRepeatedPrompt)
        .slice(0, 8)

      const skillCandidates = repeatedPrompts.map((item, indexNo) => ({
        id: `skill_candidate_${indexNo + 1}`,
        triggerHint: item.prompt.slice(0, 80),
        evidenceCount: item.count,
        recommendation: '将该重复任务沉淀为固定流程模板（输入约束 + 输出格式 + 校验步骤）。',
      }))

      return send(res, 200, {
        generatedAt: new Date().toISOString(),
        range: {
          recentDays,
          provider: provider || 'all',
        },
        summary: {
          sessionCount: sessions.length,
          messageCount: totalMessages,
          avgMessagesPerSession: Number(avgMessagesPerSession.toFixed(2)),
        },
        behaviorMetrics: {
          longSessionsCount,
          avgPromptLength: Math.round(avgPromptLength),
          resolutionStatus,
        },
        providerStats,
        roleStats,
        topTerms: collectTopTerms(sessions, 20),
        repeatedPrompts,
        skillCandidates,
      })
    }

    return send(res, 404, { error: 'Not found' })
  } catch (error) {
    return send(res, 500, { error: String(error) })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`[session-hub] API ready at http://${HOST}:${PORT}`)
})
