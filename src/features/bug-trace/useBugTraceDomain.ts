import { ref } from 'vue'
import DOMPurify from 'dompurify'
import { diffChars } from 'diff'
import { ensureDiff2HtmlModule, getLoadedDiff2HtmlModule } from '@/services/diff2htmlRuntime'
import { ensureHighlightJs, getLoadedHighlightJs } from '@/services/highlightRuntime'

export interface ParsedDiffFileItem {
  key: string
  label: string
  raw: unknown
  filePath: string
  fileName: string
  directoryPath: string
}

export interface BugTraceFilePreview {
  filePath: string
  beforeExists: boolean
  afterExists: boolean
  beforeContent: string
  afterContent: string
}

export interface BugTraceCodeMirrorModel {
  filePath: string
  fileName: string
  directoryPath: string
  originalText: string
  modifiedText: string
  source: 'snapshot' | 'patch'
}

interface BugTraceCursorConversation {
  found: boolean
  transcriptPath: string | null
  project: string | null
  title: string | null
  turns: number | null
  messageCount: number | null
  lastMessageAt: string | null
  preview: string | null
}

interface ConversationDetailMessage {
  role: string
  content: string
  createdAt: string | null
}

export interface BugTraceConversationDetail {
  transcriptPath: string
  title: string
  turns: number
  messageCount: number
  messages: ConversationDetailMessage[]
}

interface ConversationTurnBlock {
  turnIndex: number
  userTurnIndex: number
  user: ConversationDetailMessage | null
  replies: ConversationDetailMessage[]
}

export interface BugTraceResultItem {
  score: number
  patchFile: string
  patchPath: string
  patchContent: string
  turnDir?: string | null
  conversationId: string | null
  conversationTurnIndex: number | null
  question: string | null
  assistantSummary: string | null
  startedAt: string | null
  endedAt: string | null
  changedFiles: Array<{ status?: string; file_path?: string; filePath?: string }>
  matchedLines: string[]
  tokenHitRate: number
  snippet: string
  hitKeywords: string[]
  snippetSource?: {
    filePath: string
    side: 'old' | 'new'
    lineNo: number
  } | null
  matchedLocations?: Array<{
    filePath: string
    side: 'old' | 'new'
    lineNo: number
    text: string
  }>
  matchedSnippets?: Array<{
    snippet: string
    hitKeywords: string[]
    matchedLines?: string[]
    snippetSource?: {
      filePath: string
      side: 'old' | 'new'
      lineNo: number
    } | null
    matchedLocations?: Array<{
      filePath: string
      side: 'old' | 'new'
      lineNo: number
      text: string
    }>
  }>
  cursorConversation: BugTraceCursorConversation
}

export interface BugTraceResponse {
  bugCode: string
  patchDir: string
  cursorRoot: string
  totalPatchRecords: number
  totalMatched: number
  results: BugTraceResultItem[]
}

type ToastTone = 'info' | 'success' | 'warning' | 'danger'

interface BugTraceService {
  fetchFilePreview(payload: {
    patchDir: string
    turnDir: string | null
    patchPath: string
    filePath: string
  }): Promise<BugTraceFilePreview>
  fetchConversationDetail(payload: {
    transcriptPath: string
    cursorRoot: string
    limit: number
  }): Promise<BugTraceConversationDetail>
  runBugTrace(payload: {
    bugCode: string
    patchDir: string
    cursorRoot: string
    topK: number
  }): Promise<BugTraceResponse>
}

interface UseBugTraceDomainOptions {
  service: BugTraceService
  getPatchDir: () => string
  onPatchDirResolved?: (path: string) => void
  notify?: (text: string, tone?: ToastTone) => void
}

export function useBugTraceDomain(options: UseBugTraceDomainOptions) {
  const notify = options.notify || (() => undefined)

  const bugTraceLoading = ref(false)
  const bugTraceError = ref('')
  const bugTraceResult = ref<BugTraceResponse | null>(null)
  const bugTracePatchTotal = ref<number | null>(null)
  const bugTraceCode = ref('')
  const bugTraceCursorRoot = ref('/Users/hm/.cursor/projects')
  const bugTraceTopK = ref(8)
  const bugTraceExpandedPatch = ref<string>('')
  const bugTraceDiffHtmlCache = ref<Record<string, string>>({})
  const bugTraceParsedFilesCache = ref<Record<string, ParsedDiffFileItem[]>>({})
  const bugTraceSelectedFileKeyByPatch = ref<Record<string, string>>({})
  const bugTraceFilePreviewCache = ref<Record<string, BugTraceFilePreview>>({})
  const bugTraceFullHighlightHtmlCache = ref<Record<string, string>>({})
  const bugTraceFileTreeCollapsedByPatch = ref<Record<string, boolean>>({})
  const bugTracePreviewLoadingKey = ref('')
  const bugTraceViewMode = ref<'patch' | 'full+patch'>('patch')
  const bugTraceFullViewMode = ref<'all' | 'changed'>('all')
  const bugTraceContextLines = ref(2)
  const bugTraceCopiedConversationId = ref('')
  const bugTraceConversationExpandedKey = ref('')
  const bugTraceConversationDetailLoadingKey = ref('')
  const bugTraceConversationDetailCache = ref<Record<string, BugTraceConversationDetail>>({})
  const bugTraceRenderLibVersion = ref(0)

  const bugTraceFullPreviewElMap = new Map<string, { before?: HTMLElement; after?: HTMLElement }>()
  let bugTraceSyncingScroll = false
  let diff2HtmlLoaded = Boolean(getLoadedDiff2HtmlModule())
  let highlightLoaded = Boolean(getLoadedHighlightJs())
  let loadingRenderLibPromise: Promise<void> | null = null

  function normalizeDiffPath(input: string): string {
    return String(input || '')
      .trim()
      .replace(/^(before|after|a|b)\//, '')
  }

  function splitDiffPathParts(input: string): { fileName: string; directoryPath: string } {
    const normalized = normalizeDiffPath(input)
    if (!normalized) {
      return {
        fileName: '未命名文件',
        directoryPath: '',
      }
    }

    const parts = normalized.split('/').filter(Boolean)
    return {
      fileName: parts[parts.length - 1] || normalized,
      directoryPath: parts.slice(0, -1).join('/'),
    }
  }

  async function ensureBugTraceRenderLibs() {
    if (diff2HtmlLoaded && highlightLoaded) return
    if (loadingRenderLibPromise) {
      await loadingRenderLibPromise
      return
    }

    loadingRenderLibPromise = (async () => {
      let changed = false
      if (!diff2HtmlLoaded) {
        await ensureDiff2HtmlModule()
        diff2HtmlLoaded = true
        changed = true
      }
      if (!highlightLoaded) {
        await ensureHighlightJs()
        highlightLoaded = true
        changed = true
      }
      if (changed) {
        bugTraceDiffHtmlCache.value = {}
        bugTraceParsedFilesCache.value = {}
        bugTraceFullHighlightHtmlCache.value = {}
        bugTraceRenderLibVersion.value += 1
      }
    })()

    try {
      await loadingRenderLibPromise
    } finally {
      loadingRenderLibPromise = null
    }
  }

  function ensureBugTraceRenderLibsInBackground() {
    void ensureBugTraceRenderLibs().catch(() => undefined)
  }

  function resetBugTrace() {
    bugTraceError.value = ''
    bugTraceResult.value = null
    bugTraceExpandedPatch.value = ''
    bugTraceDiffHtmlCache.value = {}
    bugTraceParsedFilesCache.value = {}
    bugTraceSelectedFileKeyByPatch.value = {}
    bugTraceFilePreviewCache.value = {}
    bugTraceFullHighlightHtmlCache.value = {}
    bugTraceFileTreeCollapsedByPatch.value = {}
    bugTracePreviewLoadingKey.value = ''
    bugTraceConversationExpandedKey.value = ''
    bugTraceConversationDetailLoadingKey.value = ''
    bugTraceConversationDetailCache.value = {}
    bugTraceFullPreviewElMap.clear()
  }

  function getBugTraceCacheKey(item: BugTraceResultItem): string {
    return `${item.patchPath}::${item.conversationId || ''}::${item.score}`
  }

  async function prepareBugTracePatch(item: BugTraceResultItem) {
    const key = getBugTraceCacheKey(item)
    await ensureBugTraceRenderLibs().catch(() => undefined)
    const files = getBugTraceParsedFiles(item)
    if (!bugTraceSelectedFileKeyByPatch.value[key] && files.length) {
      bugTraceSelectedFileKeyByPatch.value[key] = files[0].key
    }
    void ensureBugTraceFilePreview(item, getSelectedBugTraceFile(item))
  }

  async function toggleBugTracePatch(item: BugTraceResultItem) {
    const key = getBugTraceCacheKey(item)
    if (bugTraceExpandedPatch.value === key) {
      bugTraceExpandedPatch.value = ''
      return
    }
    bugTraceExpandedPatch.value = key
    await prepareBugTracePatch(item)
  }

  function getBugTraceParsedFiles(item: BugTraceResultItem): ParsedDiffFileItem[] {
    void bugTraceRenderLibVersion.value
    const key = getBugTraceCacheKey(item)
    const cached = bugTraceParsedFilesCache.value[key]
    if (cached) return cached

    const patch = String(item.patchContent || '').trim()
    if (!patch) {
      bugTraceParsedFilesCache.value[key] = []
      return []
    }

    const diff2HtmlModule = getLoadedDiff2HtmlModule()
    if (!diff2HtmlModule) {
      ensureBugTraceRenderLibsInBackground()
      return []
    }

    try {
      const files = diff2HtmlModule.parse(patch, {
        matching: 'lines',
      })
      const parsed = (Array.isArray(files) ? files : []).map((file, index) => {
        const oldName = String((file as { oldName?: string })?.oldName || '').trim()
        const newName = String((file as { newName?: string })?.newName || '').trim()
        const rawPath = normalizeDiffPath(newName || oldName || '')
        const { fileName, directoryPath } = splitDiffPathParts(rawPath)
        return {
          key: `${rawPath || fileName || `file-${index + 1}`}#${index}`,
          label: rawPath || fileName || `file-${index + 1}`,
          raw: file,
          filePath: rawPath,
          fileName,
          directoryPath,
        }
      })
      bugTraceParsedFilesCache.value[key] = parsed
    } catch {
      bugTraceParsedFilesCache.value[key] = []
    }

    return bugTraceParsedFilesCache.value[key] || []
  }

  async function ensureBugTraceFilePreview(item: BugTraceResultItem, file: ParsedDiffFileItem | null) {
    if (!file?.filePath || !item.turnDir) return null
    const patchKey = getBugTraceCacheKey(item)
    const cacheKey = `${patchKey}::${file.filePath}`
    if (bugTraceFilePreviewCache.value[cacheKey]) return bugTraceFilePreviewCache.value[cacheKey]

    bugTracePreviewLoadingKey.value = cacheKey
    try {
      const data = await options.service.fetchFilePreview({
        patchDir: options.getPatchDir(),
        turnDir: item.turnDir || null,
        patchPath: item.patchPath,
        filePath: file.filePath,
      })
      bugTraceFilePreviewCache.value[cacheKey] = data
      return data
    } catch {
      return null
    } finally {
      bugTracePreviewLoadingKey.value = ''
    }
  }

  function getBugTraceFilePreview(item: BugTraceResultItem, file: ParsedDiffFileItem | null): BugTraceFilePreview | null {
    if (!file?.filePath) return null
    const patchKey = getBugTraceCacheKey(item)
    return bugTraceFilePreviewCache.value[`${patchKey}::${file.filePath}`] || null
  }

  function selectBugTraceFile(item: BugTraceResultItem, fileKey: string) {
    const key = getBugTraceCacheKey(item)
    bugTraceSelectedFileKeyByPatch.value[key] = fileKey
    const file = getSelectedBugTraceFile(item)
    void ensureBugTraceFilePreview(item, file)
  }

  function getSelectedBugTraceFile(item: BugTraceResultItem): ParsedDiffFileItem | null {
    const key = getBugTraceCacheKey(item)
    const files = getBugTraceParsedFiles(item)
    if (!files.length) return null
    const selectedKey = bugTraceSelectedFileKeyByPatch.value[key]
    return files.find((file) => file.key === selectedKey) || files[0]
  }

  function buildPatchMergeText(fileRaw: unknown): { originalText: string; modifiedText: string } {
    const before: string[] = []
    const after: string[] = []
    const blocks = (fileRaw as { blocks?: Array<{ lines?: Array<Record<string, unknown>> }> })?.blocks || []

    blocks.forEach((block, blockIndex) => {
      if (blockIndex > 0 && (before.length || after.length)) {
        before.push('', '...')
        after.push('', '...')
      }

      const lines = Array.isArray(block?.lines) ? block.lines : []
      for (const line of lines) {
        const content = String(line?.content || '')
        if (!content || content.startsWith('\\')) continue
        const marker = content[0]
        const text = content.slice(1)
        if (marker === '-') {
          before.push(text)
          continue
        }
        if (marker === '+') {
          after.push(text)
          continue
        }
        before.push(text)
        after.push(text)
      }
    })

    return {
      originalText: before.join('\n'),
      modifiedText: after.join('\n'),
    }
  }

  function getBugTraceCodeMirrorModel(item: BugTraceResultItem): BugTraceCodeMirrorModel | null {
    const file = getSelectedBugTraceFile(item)
    if (!file) return null

    const preview = getBugTraceFilePreview(item, file)
    if (preview) {
      const normalizedPreviewPath = normalizeDiffPath(preview.filePath || file.filePath)
      const { fileName, directoryPath } = splitDiffPathParts(normalizedPreviewPath)
      return {
        filePath: normalizedPreviewPath,
        fileName,
        directoryPath,
        originalText: String(preview.beforeContent || ''),
        modifiedText: String(preview.afterContent || ''),
        source: 'snapshot',
      }
    }

    const patchModel = buildPatchMergeText(file.raw)
    return {
      filePath: file.filePath,
      fileName: file.fileName,
      directoryPath: file.directoryPath,
      originalText: patchModel.originalText,
      modifiedText: patchModel.modifiedText,
      source: 'patch',
    }
  }

  function getBugTraceSelectedFileDiffHtml(item: BugTraceResultItem): string {
    void bugTraceRenderLibVersion.value
    const key = getBugTraceCacheKey(item)
    const selectedFile = getSelectedBugTraceFile(item)
    if (!selectedFile) return getBugTraceDiffHtml(item)

    const cacheKey = `${key}::${selectedFile.key}`
    const cached = bugTraceDiffHtmlCache.value[cacheKey]
    if (cached) return cached

    const diff2HtmlModule = getLoadedDiff2HtmlModule()
    if (!diff2HtmlModule) {
      ensureBugTraceRenderLibsInBackground()
      return '<div class="warn">Diff 渲染引擎加载中...</div>'
    }

    try {
      const html = diff2HtmlModule.html([selectedFile.raw as any], {
        drawFileList: false,
        matching: 'lines',
        outputFormat: 'side-by-side',
        renderNothingWhenEmpty: false,
      })
      const safe = DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        ADD_ATTR: ['class', 'style'],
      })
      bugTraceDiffHtmlCache.value[cacheKey] = safe
    } catch {
      bugTraceDiffHtmlCache.value[cacheKey] = getBugTraceDiffHtml(item)
    }

    return bugTraceDiffHtmlCache.value[cacheKey]
  }

  function isBugTraceFileTreeCollapsed(item: BugTraceResultItem): boolean {
    return Boolean(bugTraceFileTreeCollapsedByPatch.value[getBugTraceCacheKey(item)])
  }

  function toggleBugTraceFileTree(item: BugTraceResultItem) {
    const key = getBugTraceCacheKey(item)
    bugTraceFileTreeCollapsedByPatch.value[key] = !bugTraceFileTreeCollapsedByPatch.value[key]
  }

  async function copyBugTraceConversationId(conversationId: string | null) {
    const value = String(conversationId || '').trim()
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      bugTraceCopiedConversationId.value = value
      notify('会话ID已复制')
      setTimeout(() => {
        if (bugTraceCopiedConversationId.value === value) bugTraceCopiedConversationId.value = ''
      }, 1500)
    } catch {
      bugTraceError.value = '复制失败，请检查浏览器权限'
    }
  }

  function getConversationCardKey(item: BugTraceResultItem): string {
    return `${getBugTraceCacheKey(item)}::conv`
  }

  function getConversationDetail(item: BugTraceResultItem): BugTraceConversationDetail | null {
    return bugTraceConversationDetailCache.value[getConversationCardKey(item)] || null
  }

  function buildConversationTurns(messages: ConversationDetailMessage[]): ConversationTurnBlock[] {
    const list = Array.isArray(messages) ? messages : []
    const turns: ConversationTurnBlock[] = []
    let current: ConversationTurnBlock | null = null
    let userTurnCursor = 0
    let visualTurnCursor = 0

    for (const msg of list) {
      const role = String(msg.role || '').toLowerCase()
      if (role === 'user') {
        userTurnCursor += 1
        visualTurnCursor += 1
        current = {
          turnIndex: visualTurnCursor,
          userTurnIndex: userTurnCursor,
          user: msg,
          replies: [],
        }
        turns.push(current)
        continue
      }

      if (!current) {
        visualTurnCursor += 1
        current = {
          turnIndex: visualTurnCursor,
          userTurnIndex: 0,
          user: null,
          replies: [],
        }
        turns.push(current)
      }
      current.replies.push(msg)
    }

    return turns
  }

  function getVisibleConversationTurns(item: BugTraceResultItem): ConversationTurnBlock[] {
    const detail = getConversationDetail(item)
    if (!detail) return []
    const turns = buildConversationTurns(detail.messages || [])
    const target = Number(item.conversationTurnIndex || 0)
    if (!target || !turns.length) return turns.slice(0, 8)

    const min = Math.max(1, target - 1)
    const max = target + 1
    const scoped = turns.filter((turn) => turn.userTurnIndex >= min && turn.userTurnIndex <= max)
    return scoped.length ? scoped : turns.slice(0, 8)
  }

  async function ensureConversationDetail(item: BugTraceResultItem) {
    const key = getConversationCardKey(item)
    if (bugTraceConversationDetailCache.value[key]) {
      return bugTraceConversationDetailCache.value[key]
    }
    if (!item.cursorConversation?.transcriptPath) return null

    bugTraceConversationDetailLoadingKey.value = key
    try {
      const data = await options.service.fetchConversationDetail({
        transcriptPath: item.cursorConversation.transcriptPath,
        cursorRoot: bugTraceCursorRoot.value.trim(),
        limit: 300,
      })
      bugTraceConversationDetailCache.value[key] = data
      return data
    } catch (error) {
      bugTraceError.value = String(error)
      return null
    } finally {
      if (bugTraceConversationDetailLoadingKey.value === key) {
        bugTraceConversationDetailLoadingKey.value = ''
      }
    }
  }

  async function toggleConversationDetail(item: BugTraceResultItem) {
    const key = getConversationCardKey(item)
    if (bugTraceConversationExpandedKey.value === key) {
      bugTraceConversationExpandedKey.value = ''
      return
    }
    bugTraceConversationExpandedKey.value = key
    await ensureConversationDetail(item)
  }

  function hasBugTraceFilePreview(item: BugTraceResultItem): boolean {
    return Boolean(getBugTraceFilePreview(item, getSelectedBugTraceFile(item)))
  }

  function getBugTraceFullPreviewPairKey(item: BugTraceResultItem): string {
    const selected = getSelectedBugTraceFile(item)
    return `${getBugTraceCacheKey(item)}::${selected?.key || 'none'}`
  }

  function setBugTraceFullPreviewRef(item: BugTraceResultItem, side: 'before' | 'after', el: Element | null) {
    const pairKey = getBugTraceFullPreviewPairKey(item)
    const current = bugTraceFullPreviewElMap.get(pairKey) || {}
    if (el instanceof HTMLElement) {
      current[side] = el
      bugTraceFullPreviewElMap.set(pairKey, current)
      return
    }
    delete current[side]
    if (current.before || current.after) bugTraceFullPreviewElMap.set(pairKey, current)
    else bugTraceFullPreviewElMap.delete(pairKey)
  }

  function onBugTraceFullPreviewScroll(item: BugTraceResultItem, side: 'before' | 'after') {
    if (bugTraceSyncingScroll) return
    const pairKey = getBugTraceFullPreviewPairKey(item)
    const pair = bugTraceFullPreviewElMap.get(pairKey)
    if (!pair) return
    const source = side === 'before' ? pair.before : pair.after
    const target = side === 'before' ? pair.after : pair.before
    if (!source || !target) return
    bugTraceSyncingScroll = true
    target.scrollTop = source.scrollTop
    requestAnimationFrame(() => {
      bugTraceSyncingScroll = false
    })
  }

  function escapeHtml(input: string): string {
    return String(input || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  function escapeRegExp(input: string): string {
    return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function getBugTraceSnippetList(item: BugTraceResultItem) {
    const list = Array.isArray(item.matchedSnippets) ? item.matchedSnippets : []
    if (list.length) return list
    return [
      {
        snippet: item.snippet,
        hitKeywords: item.hitKeywords || [],
        matchedLines: item.matchedLines || [],
        snippetSource: item.snippetSource || null,
        matchedLocations: item.matchedLocations || [],
      },
    ]
  }

  function formatBugTraceSnippetSource(snippet: {
    snippetSource?: { filePath: string; side: 'old' | 'new'; lineNo: number } | null
  }): string {
    const source = snippet.snippetSource
    if (!source) return '-'
    const filePath = String(source.filePath || '').trim() || '(unknown file)'
    const side = source.side === 'old' ? '旧文件' : '新文件'
    const lineNo = Number(source.lineNo || 0) > 0 ? `:${Number(source.lineNo)}` : ''
    return `${filePath}${lineNo} (${side})`
  }

  function getBugTraceMatchedLocationText(snippet: {
    matchedLocations?: Array<{ filePath: string; side: 'old' | 'new'; lineNo: number }>
  }): string {
    const rows = Array.isArray(snippet.matchedLocations) ? snippet.matchedLocations : []
    if (!rows.length) return ''
    return rows
      .slice(0, 3)
      .map((row) => {
        const filePath = String(row?.filePath || '').trim() || '(unknown file)'
        const side = String(row?.side || '').trim() === 'old' ? '旧' : '新'
        const lineNo = Number(row?.lineNo || 0) > 0 ? Number(row.lineNo) : '?'
        return `${filePath}:${lineNo}(${side})`
      })
      .join(' | ')
  }

  function renderBugTraceSnippetLine(line: string, keywords: string[]): string {
    const normalized = Array.from(
      new Set(
        (Array.isArray(keywords) ? keywords : [])
          .map((word) => String(word || '').trim())
          .filter((word) => word.length >= 2),
      ),
    )
      .sort((a, b) => b.length - a.length)
      .slice(0, 16)
    if (!normalized.length) return escapeHtml(line)

    const matcher = new RegExp(normalized.map((word) => escapeRegExp(word)).join('|'), 'gi')
    let html = ''
    let cursor = 0
    matcher.lastIndex = 0
    for (const matched of line.matchAll(matcher)) {
      const text = String(matched[0] || '')
      if (!text) continue
      const index = Number(matched.index || 0)
      if (index > cursor) html += escapeHtml(line.slice(cursor, index))
      html += `<mark class="bug-trace-keyword-hit">${escapeHtml(text)}</mark>`
      cursor = index + text.length
    }
    if (cursor < line.length) html += escapeHtml(line.slice(cursor))
    return html
  }

  function normalizeSnippetCompareText(input: string): string {
    return String(input || '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function isBugTraceMatchedSnippetLine(line: string, matchedLines: string[]): boolean {
    const current = normalizeSnippetCompareText(line)
    if (!current) return false
    return (Array.isArray(matchedLines) ? matchedLines : [])
      .map((row) => normalizeSnippetCompareText(row))
      .filter(Boolean)
      .some((row) => current.includes(row) || row.includes(current))
  }

  function renderBugTraceSnippetHtml(snippetItem: {
    snippet: string
    hitKeywords?: string[]
    matchedLines?: string[]
    snippetSource?: { lineNo: number } | null
  }): string {
    const snippet = String(snippetItem.snippet || '').trimEnd()
    if (!snippet) return '<div class="bug-trace-snippet-line"><span class="bug-trace-snippet-empty">-</span></div>'
    const startNo = Number(snippetItem.snippetSource?.lineNo || 0)
    const lines = snippet.split('\n')
    const html = lines
      .map((line, idx) => {
        const lineNo = startNo > 0 ? String(startNo + idx) : '-'
        const body = renderBugTraceSnippetLine(line, snippetItem.hitKeywords || [])
        const isHit = isBugTraceMatchedSnippetLine(line, snippetItem.matchedLines || [])
        const rowClass = isHit ? 'bug-trace-snippet-line is-hit' : 'bug-trace-snippet-line'
        return `<div class="${rowClass}"><span class="bug-trace-snippet-no">${lineNo}</span><code class="bug-trace-snippet-code">${body}</code></div>`
      })
      .join('')
    return `<div class="bug-trace-snippet">${html}</div>`
  }

  function collectChangedLineMeta(fileRaw: unknown): {
    beforeChanged: Set<number>
    afterChanged: Set<number>
    beforeCounterpart: Map<number, string>
    afterCounterpart: Map<number, string>
  } {
    const beforeChanged = new Set<number>()
    const afterChanged = new Set<number>()
    const beforeCounterpart = new Map<number, string>()
    const afterCounterpart = new Map<number, string>()
    const blocks = (fileRaw as { blocks?: Array<{ lines?: Array<Record<string, unknown>> }> })?.blocks || []

    const flush = (removed: Array<{ no: number; text: string }>, added: Array<{ no: number; text: string }>) => {
      const max = Math.max(removed.length, added.length)
      for (let i = 0; i < max; i += 1) {
        const rm = removed[i]
        const add = added[i]
        if (rm) {
          beforeChanged.add(rm.no)
          beforeCounterpart.set(rm.no, add?.text || '')
        }
        if (add) {
          afterChanged.add(add.no)
          afterCounterpart.set(add.no, rm?.text || '')
        }
      }
      removed.length = 0
      added.length = 0
    }

    for (const block of blocks) {
      const lines = Array.isArray(block?.lines) ? block.lines : []
      const removed: Array<{ no: number; text: string }> = []
      const added: Array<{ no: number; text: string }> = []

      for (const line of lines) {
        const content = String(line?.content || '')
        const oldNo = Number(line?.oldNumber || line?.old_number || 0)
        const newNo = Number(line?.newNumber || line?.new_number || 0)
        const text = content.length ? content.slice(1) : ''
        if (content.startsWith('-') && oldNo > 0) {
          removed.push({ no: oldNo, text })
          continue
        }
        if (content.startsWith('+') && newNo > 0) {
          added.push({ no: newNo, text })
          continue
        }
        flush(removed, added)
      }

      flush(removed, added)
    }

    return {
      beforeChanged,
      afterChanged,
      beforeCounterpart,
      afterCounterpart,
    }
  }

  function renderLineWithCharHighlight(line: string, counterpart: string, side: 'before' | 'after'): string {
    if (!counterpart) return escapeHtml(line)
    const parts = diffChars(line, counterpart)
    return parts
      .map((part) => {
        const text = escapeHtml(part.value)
        if (side === 'before' && part.removed) return `<span class="char-removed">${text}</span>`
        if (side === 'after' && part.added) return `<span class="char-added">${text}</span>`
        if (part.added || part.removed) return ''
        return text
      })
      .join('')
  }

  function inferLanguageByFilePath(filePath: string): string | null {
    const lower = String(filePath || '').toLowerCase()
    if (lower.endsWith('.vue')) return 'xml'
    if (lower.endsWith('.ts')) return 'typescript'
    if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript'
    if (lower.endsWith('.json')) return 'json'
    if (lower.endsWith('.css') || lower.endsWith('.less') || lower.endsWith('.scss')) return 'css'
    if (lower.endsWith('.html')) return 'xml'
    if (lower.endsWith('.md')) return 'markdown'
    if (lower.endsWith('.sh')) return 'bash'
    if (lower.endsWith('.py')) return 'python'
    if (lower.endsWith('.go')) return 'go'
    if (lower.endsWith('.java')) return 'java'
    if (lower.endsWith('.rb')) return 'ruby'
    if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml'
    return null
  }

  function renderLineWithSyntaxHighlight(line: string, filePath: string): string {
    void bugTraceRenderLibVersion.value
    const lang = inferLanguageByFilePath(filePath)
    const hljs = getLoadedHighlightJs()
    if (!hljs) {
      ensureBugTraceRenderLibsInBackground()
      return escapeHtml(line)
    }
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(line, { language: lang, ignoreIllegals: true }).value
      }
      return hljs.highlightAuto(line).value
    } catch {
      return escapeHtml(line)
    }
  }

  function renderFullFileHtml(
    content: string,
    changedLines: Set<number>,
    counterpartMap: Map<number, string>,
    side: 'before' | 'after',
    filePath: string,
  ): string {
    const lines = String(content || '').split('\n')
    const rows: string[] = []
    const onlyChanged = bugTraceFullViewMode.value === 'changed'
    const context = Math.max(0, Number(bugTraceContextLines.value || 0))
    const visibleLines = new Set<number>()
    if (onlyChanged) {
      for (const changedNo of changedLines) {
        for (let no = Math.max(1, changedNo - context); no <= Math.min(lines.length, changedNo + context); no += 1) {
          visibleLines.add(no)
        }
      }
    }

    let lastRenderedNo = 0
    for (let idx = 0; idx < lines.length; idx += 1) {
      const no = idx + 1
      const isChanged = changedLines.has(no)
      if (onlyChanged && !visibleLines.has(no)) continue
      if (onlyChanged && lastRenderedNo > 0 && no - lastRenderedNo > 1) {
        rows.push(
          `<div class="full-gap"><span class="full-no">...</span><span class="full-code">省略 ${no - lastRenderedNo - 1} 行</span></div>`,
        )
      }
      const line = lines[idx]
      const cls = isChanged ? 'full-line changed' : 'full-line'
      const counterpart = counterpartMap.get(no) || ''
      const codeHtml = isChanged
        ? renderLineWithCharHighlight(line, counterpart, side)
        : renderLineWithSyntaxHighlight(line, filePath)
      rows.push(`<div class="${cls}"><span class="full-no">${no}</span><span class="full-code">${codeHtml}</span></div>`)
      lastRenderedNo = no
    }
    return `<div class="full-file">${rows.join('')}</div>`
  }

  function getBugTraceFullHighlightHtml(item: BugTraceResultItem, side: 'before' | 'after'): string {
    const file = getSelectedBugTraceFile(item)
    const preview = getBugTraceFilePreview(item, file)
    if (!file || !preview) return ''

    const key = `${getBugTraceCacheKey(item)}::${file.key}::${side}::${bugTraceFullViewMode.value}::ctx${bugTraceContextLines.value}`
    const cached = bugTraceFullHighlightHtmlCache.value[key]
    if (cached) return cached

    const content = side === 'before' ? preview.beforeContent : preview.afterContent
    const meta = collectChangedLineMeta(file.raw)
    const changed = side === 'before' ? meta.beforeChanged : meta.afterChanged
    const counterpart = side === 'before' ? meta.beforeCounterpart : meta.afterCounterpart
    const html = renderFullFileHtml(content, changed, counterpart, side, preview.filePath)
    bugTraceFullHighlightHtmlCache.value[key] = html
    return html
  }

  function getBugTraceDiffHtml(item: BugTraceResultItem): string {
    void bugTraceRenderLibVersion.value
    const key = getBugTraceCacheKey(item)
    const cached = bugTraceDiffHtmlCache.value[key]
    if (cached) return cached

    const patch = String(item.patchContent || '').trim()
    if (!patch) {
      bugTraceDiffHtmlCache.value[key] = '<div class="bug-trace-empty">Patch 内容为空</div>'
      return bugTraceDiffHtmlCache.value[key]
    }

    const diff2HtmlModule = getLoadedDiff2HtmlModule()
    if (!diff2HtmlModule) {
      ensureBugTraceRenderLibsInBackground()
      return '<div class="warn">Diff 渲染引擎加载中...</div>'
    }

    try {
      const html = diff2HtmlModule.html(patch, {
        drawFileList: true,
        matching: 'lines',
        outputFormat: 'side-by-side',
        renderNothingWhenEmpty: false,
      })
      const safe = DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        ADD_ATTR: ['class', 'style'],
      })
      bugTraceDiffHtmlCache.value[key] = safe
    } catch {
      const escaped = patch
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      bugTraceDiffHtmlCache.value[key] = `<pre class="bug-trace-raw">${escaped}</pre>`
    }

    return bugTraceDiffHtmlCache.value[key]
  }

  async function runBugTrace(codeInput?: string) {
    if (bugTraceLoading.value) {
      notify('定位任务正在执行，请稍候', 'info')
      return
    }

    const code = String((codeInput ?? bugTraceCode.value) || '').trim()
    if (codeInput !== undefined) bugTraceCode.value = String(codeInput || '')
    const patchDir = options.getPatchDir()
    if (!code) {
      bugTraceError.value = '请先粘贴 bug 代码'
      bugTraceResult.value = null
      notify(bugTraceError.value, 'warning')
      return
    }
    if (!patchDir) {
      bugTraceError.value = '请先在设置中配置 .ai-patches 路径'
      bugTraceResult.value = null
      notify(bugTraceError.value, 'warning')
      return
    }

    bugTraceLoading.value = true
    resetBugTrace()
    notify('开始定位，请稍候...', 'info')

    try {
      const data = await options.service.runBugTrace({
        bugCode: code,
        patchDir,
        cursorRoot: bugTraceCursorRoot.value.trim(),
        topK: Number(bugTraceTopK.value || 8),
      })

      // 先展示定位结果，Diff 渲染依赖在后台加载，避免“请求成功但列表不显示”
      bugTraceResult.value = data
      bugTracePatchTotal.value = Number(data.totalPatchRecords || 0)

      void ensureBugTraceRenderLibs().catch(() => undefined)
      if (data.patchDir) options.onPatchDirResolved?.(data.patchDir)
      if (data.cursorRoot) bugTraceCursorRoot.value = data.cursorRoot
      notify(
        `定位完成：扫描 ${Number(data.totalPatchRecords || 0)} 条，命中 ${Number(data.totalMatched || 0)} 条`,
        Number(data.totalMatched || 0) > 0 ? 'success' : 'warning',
      )
    } catch (error) {
      bugTraceError.value = `定位失败：${String(error)}`
      bugTraceResult.value = null
      notify(bugTraceError.value, 'danger')
    } finally {
      bugTraceLoading.value = false
    }
  }

  return {
    bugTraceLoading,
    bugTraceError,
    bugTraceResult,
    bugTracePatchTotal,
    bugTraceCode,
    bugTraceCursorRoot,
    bugTraceTopK,
    bugTraceExpandedPatch,
    bugTraceDiffHtmlCache,
    bugTraceParsedFilesCache,
    bugTraceSelectedFileKeyByPatch,
    bugTraceFilePreviewCache,
    bugTraceFullHighlightHtmlCache,
    bugTraceFileTreeCollapsedByPatch,
    bugTracePreviewLoadingKey,
    bugTraceViewMode,
    bugTraceFullViewMode,
    bugTraceContextLines,
    bugTraceCopiedConversationId,
    bugTraceConversationExpandedKey,
    bugTraceConversationDetailLoadingKey,
    bugTraceConversationDetailCache,
    resetBugTrace,
    getBugTraceCacheKey,
    prepareBugTracePatch,
    toggleBugTracePatch,
    getBugTraceParsedFiles,
    ensureBugTraceFilePreview,
    getBugTraceFilePreview,
    selectBugTraceFile,
    getSelectedBugTraceFile,
    getBugTraceCodeMirrorModel,
    getBugTraceSelectedFileDiffHtml,
    isBugTraceFileTreeCollapsed,
    toggleBugTraceFileTree,
    copyBugTraceConversationId,
    getConversationCardKey,
    getConversationDetail,
    buildConversationTurns,
    getVisibleConversationTurns,
    ensureConversationDetail,
    toggleConversationDetail,
    hasBugTraceFilePreview,
    getBugTraceFullPreviewPairKey,
    setBugTraceFullPreviewRef,
    onBugTraceFullPreviewScroll,
    getBugTraceSnippetList,
    formatBugTraceSnippetSource,
    getBugTraceMatchedLocationText,
    renderBugTraceSnippetHtml,
    getBugTraceFullHighlightHtml,
    getBugTraceDiffHtml,
    runBugTrace,
  }
}
