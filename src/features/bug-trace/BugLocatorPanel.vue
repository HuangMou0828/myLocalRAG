<script setup lang="ts">
import 'diff2html/bundles/css/diff2html.min.css'
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import { Check, ChevronLeft, ChevronRight, Copy, Eye, EyeOff } from 'lucide-vue-next'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { BugTraceCodeMirrorModel, BugTraceResultItem } from '@/features/bug-trace/useBugTraceDomain'

type BugTraceSubMenu = 'trace' | 'inbox'

interface ParsedDiffFileView {
  key: string
  label: string
  filePath?: string
  fileName?: string
  directoryPath?: string
}

interface ConversationTurnView {
  turnIndex: number
  userTurnIndex: number
  user: { content: string } | null
  replies: Array<{ role: string; content: string }>
}

const CodeMirrorDiffView = defineAsyncComponent(() => import('@/features/bug-trace/CodeMirrorDiffView.vue'))

const props = defineProps<{ ctx: Record<string, any> }>()

const {
  isBugLocatorMode,
  bugTraceSubMenu,
  bugTraceCode,
  selectedPatchDirPresetId,
  patchDirPresets,
  bugTraceCursorRoot,
  bugTraceTopK,
  runBugTrace,
  bugTraceLoading,
  resetBugTrace,
  bugTraceError,
  bugTraceResult,
  copyBugTraceConversationId,
  bugTraceCopiedConversationId,
  getBugTraceSnippetList,
  renderBugTraceSnippetHtml,
  formatBugTraceSnippetSource,
  getBugTraceMatchedLocationText,
  bugInboxDraftByPatchKey,
  getBugTraceCacheKey,
  saveBugToInbox,
  bugInboxSavingKey,
  ensureConversationDetail,
  getConversationCardKey,
  bugTraceConversationDetailLoadingKey,
  getConversationDetail,
  getVisibleConversationTurns,
  renderMarkdown,
  prepareBugTracePatch,
  getBugTraceParsedFiles,
  getSelectedBugTraceFile,
  getBugTraceCodeMirrorModel,
  selectBugTraceFile,
  getBugTraceDiffHtml,
  bugInboxError,
  bugInboxItems,
  bugInboxLoading,
  bugInboxUpdatingId,
  asBugInboxRow,
  copyBugInboxId,
  bugInboxCopiedId,
  getBugInboxFeishuLink,
  getBugBindStatus,
  getBugBindTime,
  getBugBoundTitle,
  getBugBoundOwner,
  openBugInboxDetail,
  openFeishuBindModal,
  openBugInboxDeleteConfirm,
  updateBugInboxDescription,
  formatTime,
} = props.ctx

function readMaybeRef<T>(source: any, fallback: T): T {
  if (source && typeof source === 'object' && 'value' in source) return source.value as T
  return (source as T) ?? fallback
}

function writeMaybeRef(source: any, value: unknown) {
  if (!source || typeof source !== 'object' || !('value' in source)) return
  source.value = value
}

function resolveMaybeFunction<T extends (...args: any[]) => any>(source: any): T | null {
  if (typeof source === 'function') return source as T
  const resolved = readMaybeRef<T | null>(source, null)
  return typeof resolved === 'function' ? resolved : null
}

function escapeHtml(input: string): string {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const bugTraceCodeDraft = ref(String(readMaybeRef<string>(bugTraceCode, '') || ''))
const selectedPatchDirPresetIdDraft = ref(String(readMaybeRef<string | number>(selectedPatchDirPresetId, '') || ''))
const bugTraceCursorRootDraft = ref(String(readMaybeRef<string>(bugTraceCursorRoot, '') || ''))
const bugTraceTopKDraft = ref(Number(readMaybeRef<number>(bugTraceTopK, 8) || 8))
const bugTraceResultRoot = ref<HTMLElement | null>(null)
const expandedConversationKey = ref('')
const expandedPatchKey = ref('')
const patchPreparingKey = ref('')
const collapsedDiffTreeByKey = ref<Record<string, boolean>>({})
const bugInboxComposerOpen = ref(false)
const activeBugInboxItem = ref<BugTraceResultItem | null>(null)
const fullscreenDiffItem = ref<BugTraceResultItem | null>(null)
const bugInboxDescriptionEditorOpen = ref(false)
const activeBugInboxDescriptionItem = ref<Record<string, any> | null>(null)
const bugInboxDescriptionDraft = ref('')

const isTraceMode = computed(() =>
  Boolean(readMaybeRef<boolean>(isBugLocatorMode, false))
  && readMaybeRef<BugTraceSubMenu>(bugTraceSubMenu, 'trace') === 'trace',
)

const isInboxMode = computed(() =>
  Boolean(readMaybeRef<boolean>(isBugLocatorMode, false))
  && readMaybeRef<BugTraceSubMenu>(bugTraceSubMenu, 'trace') === 'inbox',
)

const traceLoading = computed(() => Boolean(readMaybeRef<boolean>(bugTraceLoading, false)))
const traceErrorText = computed(() => String(readMaybeRef<string>(bugTraceError, '') || ''))
const traceCopiedConversationId = computed(() => String(readMaybeRef<string>(bugTraceCopiedConversationId, '') || ''))
const traceConversationLoadingKey = computed(() => String(readMaybeRef<string>(bugTraceConversationDetailLoadingKey, '') || ''))
const bugInboxSavingKeyValue = computed(() => String(readMaybeRef<string>(bugInboxSavingKey, '') || ''))
const patchDirPresetList = computed(() => readMaybeRef<any[]>(patchDirPresets, []))

const bugTraceResultView = computed(() => {
  const raw = readMaybeRef<any>(bugTraceResult, null)
  if (!raw || typeof raw !== 'object') return null

  const normalizedResults = Array.isArray(raw.results)
    ? raw.results
    : (raw.results && typeof raw.results === 'object' ? Object.values(raw.results) : [])

  return {
    ...raw,
    results: normalizedResults as BugTraceResultItem[],
  }
})

const bugInboxErrorText = computed(() => String(readMaybeRef<string>(bugInboxError, '') || ''))
const bugInboxItemsView = computed(() => readMaybeRef<any[]>(bugInboxItems, []))
const bugInboxLoadingValue = computed(() => Boolean(readMaybeRef<boolean>(bugInboxLoading, false)))
const bugInboxCopiedIdValue = computed(() => String(readMaybeRef<string>(bugInboxCopiedId, '') || ''))
const bugInboxUpdatingIdValue = computed(() => String(readMaybeRef<string>(bugInboxUpdatingId, '') || ''))
const bugInboxDescriptionCharCount = computed(() => Array.from(bugInboxDescriptionDraft.value).length)
const bugInboxDescriptionTooLong = computed(() => bugInboxDescriptionCharCount.value > 100)
const bugInboxOverview = computed(() => {
  const items = bugInboxItemsView.value.map((row) => asBugInboxRowSafe(row))
  let linked = 0
  let highPriority = 0
  let withConversation = 0

  items.forEach((item) => {
    if (getBugInboxFeishuLinkSafe(item)) linked += 1
    if (item.conversationId) withConversation += 1
    const severity = String(item.severity || '').toLowerCase()
    if (severity === 'critical' || severity === 'high') highPriority += 1
  })

  return {
    total: items.length,
    linked,
    pending: Math.max(0, items.length - linked),
    highPriority,
    withConversation,
  }
})

watch(
  () => String(readMaybeRef<string>(bugTraceCode, '') || ''),
  (next) => {
    if (next !== bugTraceCodeDraft.value) bugTraceCodeDraft.value = next
  },
)

watch(
  () => String(readMaybeRef<string | number>(selectedPatchDirPresetId, '') || ''),
  (next) => {
    if (next !== selectedPatchDirPresetIdDraft.value) selectedPatchDirPresetIdDraft.value = next
  },
)

watch(
  () => String(readMaybeRef<string>(bugTraceCursorRoot, '') || ''),
  (next) => {
    if (next !== bugTraceCursorRootDraft.value) bugTraceCursorRootDraft.value = next
  },
)

watch(
  () => Number(readMaybeRef<number>(bugTraceTopK, 8) || 8),
  (next) => {
    if (next !== bugTraceTopKDraft.value) bugTraceTopKDraft.value = next
  },
)

watch(
  () => bugTraceResultView.value,
  () => {
    expandedConversationKey.value = ''
    expandedPatchKey.value = ''
    patchPreparingKey.value = ''
    collapsedDiffTreeByKey.value = {}
    bugInboxComposerOpen.value = false
    activeBugInboxItem.value = null
    fullscreenDiffItem.value = null
    bugInboxDescriptionEditorOpen.value = false
    activeBugInboxDescriptionItem.value = null
    bugInboxDescriptionDraft.value = ''
  },
)

function scrollBugTraceResultIntoView() {
  bugTraceResultRoot.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function onPatchDirPresetChange(event: Event) {
  const target = event.target as HTMLSelectElement | null
  const value = String(target?.value || '')
  selectedPatchDirPresetIdDraft.value = value
  writeMaybeRef(selectedPatchDirPresetId, value)
}

function onBugTraceCursorRootInput(event: Event) {
  const target = event.target as HTMLInputElement | null
  const value = String(target?.value || '')
  bugTraceCursorRootDraft.value = value
  writeMaybeRef(bugTraceCursorRoot, value)
}

function onBugTraceTopKInput(event: Event) {
  const target = event.target as HTMLInputElement | null
  const parsed = Number(target?.value || 0)
  const value = Number.isFinite(parsed) && parsed > 0 ? parsed : 8
  bugTraceTopKDraft.value = value
  writeMaybeRef(bugTraceTopK, value)
}

function getTraceItemKey(item: BugTraceResultItem): string {
  const fn = resolveMaybeFunction<(row: BugTraceResultItem) => string>(getBugTraceCacheKey)
  return fn ? String(fn(item) || '') : `${item.patchPath || item.patchFile || 'patch'}::${item.conversationId || ''}::${item.score}`
}

function getConversationKey(item: BugTraceResultItem): string {
  const fn = resolveMaybeFunction<(row: BugTraceResultItem) => string>(getConversationCardKey)
  return fn ? String(fn(item) || '') : `${getTraceItemKey(item)}::conversation`
}

function getTraceSnippetRows(item: BugTraceResultItem) {
  const fn = resolveMaybeFunction<(row: BugTraceResultItem) => any[]>(getBugTraceSnippetList)
  const rows = fn ? fn(item) : []
  if (Array.isArray(rows) && rows.length) return rows
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

function renderBugTraceSnippetHtmlSafe(snippet: Record<string, any>): string {
  const fn = resolveMaybeFunction<(value: Record<string, any>) => string>(renderBugTraceSnippetHtml)
  if (fn) return String(fn(snippet) || '')
  return `<pre>${escapeHtml(String(snippet?.snippet || ''))}</pre>`
}

function formatBugTraceSnippetSourceSafe(snippet: Record<string, any>): string {
  const fn = resolveMaybeFunction<(value: Record<string, any>) => string>(formatBugTraceSnippetSource)
  return fn ? String(fn(snippet) || '-') : '-'
}

function getBugTraceMatchedLocationTextSafe(snippet: Record<string, any>): string {
  const fn = resolveMaybeFunction<(value: Record<string, any>) => string>(getBugTraceMatchedLocationText)
  return fn ? String(fn(snippet) || '') : ''
}

function getConversationDetailSafe(item: BugTraceResultItem) {
  const fn = resolveMaybeFunction<(row: BugTraceResultItem) => Record<string, any> | null>(getConversationDetail)
  return fn ? fn(item) : null
}

function getVisibleConversationTurnsSafe(item: BugTraceResultItem): ConversationTurnView[] {
  const fn = resolveMaybeFunction<(row: BugTraceResultItem) => ConversationTurnView[]>(getVisibleConversationTurns)
  const rows = fn ? fn(item) : []
  return Array.isArray(rows) ? rows : []
}

function renderMarkdownSafe(content: string): string {
  const fn = resolveMaybeFunction<(value: string) => string>(renderMarkdown)
  if (fn) return String(fn(content) || '')
  return `<pre>${escapeHtml(content)}</pre>`
}

function getParsedDiffFiles(item: BugTraceResultItem): ParsedDiffFileView[] {
  const fn = resolveMaybeFunction<(row: BugTraceResultItem) => ParsedDiffFileView[]>(getBugTraceParsedFiles)
  const files = fn ? fn(item) : []
  return Array.isArray(files) ? files : []
}

function getSelectedDiffFileKey(item: BugTraceResultItem): string {
  const fn = resolveMaybeFunction<(row: BugTraceResultItem) => ParsedDiffFileView | null>(getSelectedBugTraceFile)
  const selected = fn ? fn(item) : null
  return String(selected?.key || '')
}

function getSelectedDiffModel(item: BugTraceResultItem): BugTraceCodeMirrorModel | null {
  const fn = resolveMaybeFunction<(row: BugTraceResultItem) => BugTraceCodeMirrorModel | null>(getBugTraceCodeMirrorModel)
  return fn ? fn(item) : null
}

function getPrimaryQuestionText(item: BugTraceResultItem): string {
  return String(item.question || '').trim() || '未提取到问题描述'
}

function getAssistantSummaryText(item: BugTraceResultItem): string {
  return String(item.assistantSummary || '').trim() || '未提取到改动摘要'
}

function getConversationStatusText(item: BugTraceResultItem): string {
  if (!item.conversationId) return '未关联会话 ID'
  if (item.cursorConversation?.found) return '已定位到 Cursor 会话'
  return '已记录会话 ID，未找到 transcript'
}

function getBugInboxModalTitle(item: BugTraceResultItem | null): string {
  if (!item) return '录入 Bug Inbox'
  return `录入 Bug Inbox · ${item.patchFile || '未命名 patch'}`
}

function getRawDiffHtml(item: BugTraceResultItem): string {
  const fn = resolveMaybeFunction<(row: BugTraceResultItem) => string>(getBugTraceDiffHtml)
  return fn ? String(fn(item) || '') : '<div class="warn">Diff 暂不可用</div>'
}

function getBugInboxDraft(item: BugTraceResultItem): string {
  const draftMap = readMaybeRef<Record<string, string>>(bugInboxDraftByPatchKey, {})
  return String(draftMap[getTraceItemKey(item)] || '')
}

function setBugInboxDraft(item: BugTraceResultItem, value: string) {
  const nextMap = {
    ...readMaybeRef<Record<string, string>>(bugInboxDraftByPatchKey, {}),
    [getTraceItemKey(item)]: value,
  }
  writeMaybeRef(bugInboxDraftByPatchKey, nextMap)
}

function onBugInboxDraftInput(item: BugTraceResultItem, event: Event) {
  const target = event.target as HTMLTextAreaElement | null
  setBugInboxDraft(item, target?.value || '')
}

function isConversationExpanded(item: BugTraceResultItem): boolean {
  return expandedConversationKey.value === getConversationKey(item)
}

function isConversationLoading(item: BugTraceResultItem): boolean {
  return traceConversationLoadingKey.value === getConversationKey(item)
}

function isPatchExpanded(item: BugTraceResultItem): boolean {
  return expandedPatchKey.value === getTraceItemKey(item)
}

function isPatchPreparing(item: BugTraceResultItem): boolean {
  return patchPreparingKey.value === getTraceItemKey(item)
}

async function onRunBugTrace() {
  writeMaybeRef(bugTraceCode, bugTraceCodeDraft.value)
  const action = resolveMaybeFunction<(value?: string) => Promise<unknown>>(runBugTrace)
  if (!action) return
  await action(bugTraceCodeDraft.value)
  await nextTick()
  scrollBugTraceResultIntoView()
}

function onResetBugTrace() {
  expandedConversationKey.value = ''
  expandedPatchKey.value = ''
  patchPreparingKey.value = ''
  const action = resolveMaybeFunction<() => void>(resetBugTrace)
  action?.()
}

async function onToggleConversation(item: BugTraceResultItem) {
  const key = getConversationKey(item)
  if (expandedConversationKey.value === key) {
    expandedConversationKey.value = ''
    return
  }

  expandedConversationKey.value = key
  if (getConversationDetailSafe(item)) return

  const action = resolveMaybeFunction<(row: BugTraceResultItem) => Promise<unknown>>(ensureConversationDetail)
  if (!action) return
  await action(item)
}

async function onTogglePatch(item: BugTraceResultItem) {
  const key = getTraceItemKey(item)
  if (expandedPatchKey.value === key) {
    expandedPatchKey.value = ''
    patchPreparingKey.value = ''
    return
  }

  expandedPatchKey.value = key
  patchPreparingKey.value = key
  try {
    const action = resolveMaybeFunction<(row: BugTraceResultItem) => Promise<unknown>>(prepareBugTracePatch)
    if (action) await action(item)
  } finally {
    if (patchPreparingKey.value === key) patchPreparingKey.value = ''
  }
}

function isDiffTreeCollapsed(item: BugTraceResultItem): boolean {
  return Boolean(collapsedDiffTreeByKey.value[getTraceItemKey(item)])
}

function toggleDiffTree(item: BugTraceResultItem) {
  const key = getTraceItemKey(item)
  collapsedDiffTreeByKey.value = {
    ...collapsedDiffTreeByKey.value,
    [key]: !collapsedDiffTreeByKey.value[key],
  }
}

function onSelectDiffFile(item: BugTraceResultItem, fileKey: string) {
  const action = resolveMaybeFunction<(row: BugTraceResultItem, nextFileKey: string) => void>(selectBugTraceFile)
  action?.(item, fileKey)
}

async function onCopyConversationId(conversationId: string | null) {
  const action = resolveMaybeFunction<(value: string | null) => Promise<unknown>>(copyBugTraceConversationId)
  if (!action) return
  await action(conversationId)
}

async function onSaveBugToInbox(item: BugTraceResultItem) {
  const action = resolveMaybeFunction<(row: BugTraceResultItem) => Promise<boolean>>(saveBugToInbox)
  if (!action) return false
  return await action(item)
}

function openBugInboxComposer(item: BugTraceResultItem) {
  activeBugInboxItem.value = item
  bugInboxComposerOpen.value = true
}

function closeBugInboxComposer() {
  bugInboxComposerOpen.value = false
  activeBugInboxItem.value = null
}

function onBugInboxComposerOpenChange(open: boolean) {
  if (open) return
  closeBugInboxComposer()
}

async function onSubmitBugInboxComposer() {
  const item = activeBugInboxItem.value
  if (!item) return
  const saved = await onSaveBugToInbox(item)
  if (saved) closeBugInboxComposer()
}

function openFullscreenDiff(item: BugTraceResultItem) {
  fullscreenDiffItem.value = item
}

function closeFullscreenDiff() {
  fullscreenDiffItem.value = null
}

function onFullscreenDiffOpenChange(open: boolean) {
  if (open) return
  closeFullscreenDiff()
}

function asBugInboxRowSafe(row: unknown) {
  const action = resolveMaybeFunction<(value: unknown) => Record<string, any>>(asBugInboxRow)
  return action ? action(row) : (row as Record<string, any>)
}

async function onCopyBugInboxId(conversationId: string) {
  const action = resolveMaybeFunction<(value: string) => Promise<unknown>>(copyBugInboxId)
  if (!action) return
  await action(conversationId)
}

function onOpenBugInboxDetail(row: unknown) {
  const action = resolveMaybeFunction<(value: Record<string, any>) => void>(openBugInboxDetail)
  action?.(asBugInboxRowSafe(row))
}

function onOpenFeishuBindModal(row: unknown) {
  const action = resolveMaybeFunction<(value: Record<string, any>) => void>(openFeishuBindModal)
  action?.(asBugInboxRowSafe(row))
}

function onOpenBugInboxDeleteConfirm(row: unknown) {
  const action = resolveMaybeFunction<(value: Record<string, any>) => void>(openBugInboxDeleteConfirm)
  action?.(asBugInboxRowSafe(row))
}

function getBugInboxFeishuLinkSafe(row: Record<string, any>) {
  const action = resolveMaybeFunction<(value: Record<string, any>) => string | null>(getBugInboxFeishuLink)
  return action ? action(row) : null
}

function getBugBindStatusSafe(row: Record<string, any>) {
  const action = resolveMaybeFunction<(value: Record<string, any>) => string>(getBugBindStatus)
  return action ? action(row) : '-'
}

function getBugBindTimeSafe(row: Record<string, any>) {
  const action = resolveMaybeFunction<(value: Record<string, any>) => string>(getBugBindTime)
  return action ? action(row) : '-'
}

function getBugBoundTitleSafe(row: Record<string, any>) {
  const action = resolveMaybeFunction<(value: Record<string, any>) => string>(getBugBoundTitle)
  return action ? action(row) : '-'
}

function getBugBoundOwnerSafe(row: Record<string, any>) {
  const action = resolveMaybeFunction<(value: Record<string, any>) => string>(getBugBoundOwner)
  return action ? action(row) : '-'
}

function formatTimeSafe(value: string | null | undefined): string {
  const action = resolveMaybeFunction<(input: string | null | undefined) => string>(formatTime)
  return action ? action(value) : String(value || '-')
}

function getBugInboxAvatarTone(row: Record<string, any>): 'default' | 'success' | 'warning' | 'danger' | 'muted' {
  const bug = asBugInboxRowSafe(row)
  if (getBugInboxFeishuLinkSafe(bug)) return 'success'
  const severity = String(bug.severity || '').toLowerCase()
  if (severity === 'critical' || severity === 'high') return 'danger'
  if (severity === 'medium') return 'warning'
  if (severity === 'low') return 'default'
  return 'muted'
}

function getBugInboxAvatarText(row: Record<string, any>): string {
  const bug = asBugInboxRowSafe(row)
  const title = String(bug.title || bug.patchFile || '').trim()
  if (!title) return 'BG'
  const chars = Array.from(title).filter((char) => char.trim())
  return (chars.slice(0, 2).join('') || 'BG').toUpperCase()
}

function getBugInboxSeverityText(row: Record<string, any>): string {
  const bug = asBugInboxRowSafe(row)
  const severity = String(bug.severity || '').toLowerCase()
  if (severity === 'critical') return '严重'
  if (severity === 'high') return '高'
  if (severity === 'medium') return '中'
  if (severity === 'low') return '低'
  return '-'
}

function getBugInboxSeverityLevel(row: Record<string, any>): string {
  const bug = asBugInboxRowSafe(row)
  return String(bug.severity || 'unknown').toLowerCase() || 'unknown'
}

function getBugInboxSummaryText(row: Record<string, any>): string {
  const bug = asBugInboxRowSafe(row)
  const description = String(bug.description || '').trim()
  if (description) return description
  return String(bug.patchPath || bug.patchFile || '暂无补充描述')
}

function getBugInboxBindingSummary(row: Record<string, any>): string {
  const title = getBugBoundTitleSafe(row)
  const owner = getBugBoundOwnerSafe(row)
  const linkedAt = getBugBindTimeSafe(row)
  const parts = [title, owner, linkedAt].filter((value) => value && value !== '-')
  return parts.length ? parts.join(' · ') : '尚未绑定飞书缺陷'
}

function openBugInboxDescriptionEditor(row: unknown) {
  const bug = asBugInboxRowSafe(row)
  activeBugInboxDescriptionItem.value = bug
  bugInboxDescriptionDraft.value = String(bug.description || '').trim()
  bugInboxDescriptionEditorOpen.value = true
}

function closeBugInboxDescriptionEditor() {
  bugInboxDescriptionEditorOpen.value = false
  activeBugInboxDescriptionItem.value = null
  bugInboxDescriptionDraft.value = ''
}

function onBugInboxDescriptionEditorOpenChange(open: boolean) {
  if (open) return
  closeBugInboxDescriptionEditor()
}

function onBugInboxDescriptionDraftInput(event: Event) {
  const target = event.target as HTMLTextAreaElement | null
  bugInboxDescriptionDraft.value = String(target?.value || '').slice(0, 100)
}

async function onSubmitBugInboxDescription() {
  const bug = activeBugInboxDescriptionItem.value
  const action = resolveMaybeFunction<(item: Record<string, any>, description: string) => Promise<boolean>>(updateBugInboxDescription)
  if (!bug || !action || bugInboxDescriptionTooLong.value) return
  const saved = await action(bug, bugInboxDescriptionDraft.value)
  if (saved) closeBugInboxDescriptionEditor()
}
</script>

<template>
  <div v-if="isTraceMode" class="bug-trace-form">
    <div class="bug-trace-form-head">
      <div>
        <strong>Bug 定位</strong>
        <small>先给代码线索，再限定 patch 范围和 Cursor transcript 根目录。</small>
      </div>
    </div>
    <textarea
      v-model="bugTraceCodeDraft"
      class="app-textarea bug-trace-code"
      placeholder="粘贴可疑代码片段（支持多行）"
    />
    <div class="bug-trace-form-grid">
      <label class="bug-trace-field">
        <small>Patch 目录</small>
        <select :value="selectedPatchDirPresetIdDraft" class="app-select" @change="onPatchDirPresetChange">
          <option v-for="item in patchDirPresetList" :key="item.id" :value="item.id">
            {{ item.alias }} · {{ item.path }}
          </option>
        </select>
      </label>
      <label class="bug-trace-field">
        <small>Cursor 根目录</small>
        <input
          :value="bugTraceCursorRootDraft"
          class="app-input"
          type="text"
          placeholder="例如 /Users/xx/.cursor/projects"
          @input="onBugTraceCursorRootInput"
        />
      </label>
      <label class="bug-trace-field bug-trace-field--compact">
        <small>Top K</small>
        <input
          :value="bugTraceTopKDraft"
          class="app-input"
          type="number"
          min="1"
          max="30"
          placeholder="TopK"
          @input="onBugTraceTopKInput"
        />
      </label>
    </div>
    <div class="bug-trace-actions">
      <button class="app-btn" type="button" @click="onRunBugTrace" :disabled="traceLoading">
        {{ traceLoading ? '定位中...' : '开始定位' }}
      </button>
      <button type="button" class="app-btn-ghost" @click="onResetBugTrace" :disabled="traceLoading">清空结果</button>
    </div>
  </div>

  <p v-if="isTraceMode && traceErrorText" class="error">{{ traceErrorText }}</p>

  <div v-if="isTraceMode && bugTraceResultView" ref="bugTraceResultRoot" class="bug-trace-result">
    <div class="bug-trace-summary-bar">
      <div class="bug-trace-summary-chip">
        <strong>{{ Number(bugTraceResultView.totalPatchRecords || 0) }}</strong>
        <span>扫描 patch</span>
      </div>
      <div class="bug-trace-summary-chip is-accent">
        <strong>{{ Number(bugTraceResultView.totalMatched || 0) }}</strong>
        <span>命中结果</span>
      </div>
      <p class="bug-trace-summary-note">结果按匹配相关度排序，详情和 Diff 可按需展开。</p>
    </div>

    <TransitionGroup v-if="bugTraceResultView.results.length" name="list" tag="div" class="bug-trace-list">
      <article
        v-for="(item, idx) in bugTraceResultView.results"
        :key="getTraceItemKey(item)"
        class="bug-trace-card"
      >
        <div class="bug-trace-card-head">
          <div class="bug-trace-card-title-block">
            <div class="bug-trace-card-title-row">
              <span class="bug-trace-rank-chip">候选 {{ idx + 1 }}</span>
              <strong>{{ item.patchFile || '未命名 patch' }}</strong>
            </div>
            <p class="bug-trace-card-path">{{ item.patchPath }}</p>
          </div>
          <span v-if="Number.isFinite(Number(item.score))" class="bug-trace-score-chip">相关度 {{ Number(item.score).toFixed(2) }}</span>
        </div>

        <div class="bug-trace-meta-grid">
          <div v-if="item.turnDir" class="bug-trace-meta-item">
            <span class="bug-trace-meta-label">Turn</span>
            <span class="bug-trace-path">{{ item.turnDir }}</span>
          </div>
          <div class="bug-trace-meta-item">
            <span class="bug-trace-meta-label">会话状态</span>
            <span class="bug-trace-meta-value">{{ getConversationStatusText(item) }}</span>
          </div>
        </div>

        <div class="bug-trace-overview-grid">
          <article class="bug-trace-info-card">
            <p class="bug-trace-info-label">问题线索</p>
            <p class="bug-trace-info-value">{{ getPrimaryQuestionText(item) }}</p>
          </article>
          <article class="bug-trace-info-card">
            <p class="bug-trace-info-label">改动摘要</p>
            <p class="bug-trace-info-value">{{ getAssistantSummaryText(item) }}</p>
          </article>
        </div>

        <div class="bug-trace-identity-row">
          <div class="bug-trace-identity-card">
            <p class="bug-trace-info-label">会话追踪</p>
            <div class="bug-trace-identity-main">
              <strong>{{ item.conversationId || '未关联会话 ID' }}</strong>
              <button
                v-if="item.conversationId"
                type="button"
                class="app-btn-ghost bug-trace-copy-btn"
                @click="onCopyConversationId(item.conversationId)"
              >
                <Check v-if="traceCopiedConversationId === item.conversationId" :size="14" />
                <Copy v-else :size="14" />
              </button>
            </div>
            <p class="bug-trace-identity-sub">{{ getConversationStatusText(item) }}</p>
          </div>
        </div>

        <section class="bug-trace-snippet-section">
          <div class="bug-trace-section-head">
            <strong>命中片段</strong>
            <small>按命中顺序展示最相关代码上下文</small>
          </div>
          <div class="bug-trace-snippet-list">
            <article
              v-for="(snippet, sIdx) in getTraceSnippetRows(item)"
              :key="`${getTraceItemKey(item)}-snippet-${sIdx}`"
              class="bug-trace-snippet-item"
            >
              <div class="bug-trace-snippet-head">
                <strong>片段 #{{ sIdx + 1 }}</strong>
                <span class="bug-trace-snippet-source">{{ formatBugTraceSnippetSourceSafe(snippet) }}</span>
              </div>
              <div class="bug-trace-snippet-wrap" v-html="renderBugTraceSnippetHtmlSafe(snippet)" />
              <p v-if="getBugTraceMatchedLocationTextSafe(snippet)" class="bug-trace-snippet-location">
                <strong>命中定位：</strong>{{ getBugTraceMatchedLocationTextSafe(snippet) }}
              </p>
            </article>
          </div>
        </section>

        <div class="bug-trace-conv" v-if="item.cursorConversation">
          <div v-if="item.cursorConversation.found" class="bug-trace-conv-card">
            <div class="bug-trace-conv-head">
              <strong>{{ item.cursorConversation.title || '未命名会话' }}</strong>
              <button
                type="button"
                class="app-btn-ghost bug-trace-conv-toggle"
                @click="onToggleConversation(item)"
                :title="isConversationExpanded(item) ? '收起会话' : '查看会话'"
                :aria-label="isConversationExpanded(item) ? '收起会话' : '查看会话'"
              >
                <EyeOff v-if="isConversationExpanded(item)" :size="14" />
                <Eye v-else :size="14" />
                <span>{{ isConversationExpanded(item) ? '收起会话' : '查看会话' }}</span>
              </button>
            </div>

            <div v-if="isConversationExpanded(item)" class="bug-trace-conv-detail">
              <p v-if="isConversationLoading(item)" class="warn">会话加载中...</p>
              <div v-else-if="getConversationDetailSafe(item)" class="bug-trace-conv-msg-list">
                <article
                  v-for="turn in getVisibleConversationTurnsSafe(item)"
                  :key="`${getConversationKey(item)}-turn-${turn.turnIndex}`"
                  class="bug-trace-conv-msg"
                  :class="{ target: turn.userTurnIndex === item.conversationTurnIndex }"
                >
                  <div class="bug-trace-conv-msg-head">
                    <strong>{{ turn.userTurnIndex > 0 ? `第 ${turn.userTurnIndex} 轮` : '预备消息' }}</strong>
                    <small v-if="turn.userTurnIndex === item.conversationTurnIndex">命中轮次</small>
                  </div>
                  <div v-if="turn.user" class="bug-trace-conv-msg-body">
                    <h5 class="role-user">user</h5>
                    <pre class="role-user-content">{{ turn.user.content }}</pre>
                  </div>
                  <div
                    v-for="(reply, ridx) in turn.replies"
                    :key="`${getConversationKey(item)}-turn-${turn.turnIndex}-reply-${ridx}`"
                    class="bug-trace-conv-msg-body"
                  >
                    <h5 :class="reply.role === 'assistant' ? 'role-assistant' : ''">{{ reply.role }}</h5>
                    <div
                      v-if="reply.role === 'assistant'"
                      class="md-content role-assistant-content"
                      v-html="renderMarkdownSafe(reply.content)"
                    />
                    <pre v-else>{{ reply.content }}</pre>
                  </div>
                </article>
              </div>
              <p v-else class="warn">未读取到会话内容。</p>
            </div>
          </div>
          <div v-else class="md-content" v-html="renderMarkdownSafe('**会话定位：** 未在 Cursor 目录找到对应 transcript')" />
        </div>

        <div class="bug-trace-action-row">
          <button
            type="button"
            class="app-btn bug-inbox-compose-trigger"
            @click="openBugInboxComposer(item)"
            :disabled="bugInboxSavingKeyValue === getTraceItemKey(item)"
          >
            {{ bugInboxSavingKeyValue === getTraceItemKey(item) ? '录入中...' : '录入 Bug Inbox' }}
          </button>

          <div class="bug-trace-patch-actions">
            <button
              v-if="isPatchExpanded(item)"
              type="button"
              class="app-btn-ghost"
              @click="openFullscreenDiff(item)"
            >
              全屏预览
            </button>
            <button type="button" class="app-btn-ghost" @click="onTogglePatch(item)">
              {{ isPatchExpanded(item) ? '收起 Diff' : '查看 Diff' }}
            </button>
          </div>
        </div>

        <div v-if="isPatchExpanded(item)" class="bug-trace-diff-view">
          <p v-if="isPatchPreparing(item)" class="warn">Diff 渲染中...</p>
          <template v-else>
            <div
              v-if="getParsedDiffFiles(item).length"
              class="bug-trace-diff-layout"
              :class="{ 'tree-collapsed': getParsedDiffFiles(item).length <= 1 || isDiffTreeCollapsed(item) }"
            >
              <aside v-if="getParsedDiffFiles(item).length > 1 && !isDiffTreeCollapsed(item)" class="bug-trace-file-tree">
                <div class="bug-trace-file-tree-head">
                  <div>
                    <strong>变更文件</strong>
                    <small>{{ getParsedDiffFiles(item).length }} 个文件</small>
                  </div>
                  <button
                    type="button"
                    class="app-btn-ghost bug-trace-tree-toggle"
                    title="收起文件索引"
                    aria-label="收起文件索引"
                    @click="toggleDiffTree(item)"
                  >
                    <ChevronLeft :size="15" />
                  </button>
                </div>
                <button
                  v-for="file in getParsedDiffFiles(item)"
                  :key="file.key"
                  type="button"
                  class="bug-trace-file-node"
                  :class="{ active: getSelectedDiffFileKey(item) === file.key }"
                  @click="onSelectDiffFile(item, file.key)"
                >
                  <strong>{{ file.fileName || file.label }}</strong>
                  <small>{{ file.directoryPath || file.filePath || file.label }}</small>
                </button>
              </aside>
              <section class="bug-trace-diff-main">
                <div v-if="getParsedDiffFiles(item).length > 1" class="bug-trace-diff-main-toolbar">
                  <button
                    v-if="isDiffTreeCollapsed(item)"
                    type="button"
                    class="app-btn-ghost bug-trace-tree-toggle bug-trace-tree-toggle-inline"
                    title="展开文件索引"
                    aria-label="展开文件索引"
                    @click="toggleDiffTree(item)"
                  >
                    <ChevronRight :size="15" />
                    <span>文件索引</span>
                  </button>
                </div>
                <CodeMirrorDiffView
                  v-if="getSelectedDiffModel(item)"
                  :file-path="getSelectedDiffModel(item)?.filePath || ''"
                  :file-name="getSelectedDiffModel(item)?.fileName || ''"
                  :directory-path="getSelectedDiffModel(item)?.directoryPath || ''"
                  :original-text="getSelectedDiffModel(item)?.originalText || ''"
                  :modified-text="getSelectedDiffModel(item)?.modifiedText || ''"
                  :source="getSelectedDiffModel(item)?.source || 'patch'"
                />
                <p v-else class="warn">当前文件还没有可用的 Diff 数据。</p>
              </section>
            </div>
            <div v-else v-html="getRawDiffHtml(item)" />
          </template>
        </div>
      </article>
    </TransitionGroup>

    <p v-else class="warn">没有匹配到 patch，请尝试扩大代码片段或检查目录路径。</p>
  </div>

  <div v-if="isInboxMode" class="bug-inbox-panel">
    <p v-if="bugInboxErrorText" class="error">{{ bugInboxErrorText }}</p>
    <section class="bug-inbox-overview">
      <div class="bug-inbox-overview-copy">
        <strong>Bug Inbox</strong>
        <p>集中整理待处理缺陷，先确认摘要和上下文，再决定是否绑定到飞书缺陷。</p>
      </div>
      <div class="bug-inbox-overview-metrics">
        <span class="bug-inbox-metric-chip">
          <em>总数</em>
          <strong>{{ bugInboxOverview.total }}</strong>
        </span>
        <span class="bug-inbox-metric-chip">
          <em>待绑定</em>
          <strong>{{ bugInboxOverview.pending }}</strong>
        </span>
        <span class="bug-inbox-metric-chip" data-tone="success">
          <em>已绑定</em>
          <strong>{{ bugInboxOverview.linked }}</strong>
        </span>
        <span class="bug-inbox-metric-chip" data-tone="danger">
          <em>高优先级</em>
          <strong>{{ bugInboxOverview.highPriority }}</strong>
        </span>
      </div>
    </section>
    <div class="bug-inbox-card-list-wrap">
      <div v-if="bugInboxLoadingValue" class="feishu-defect-skeleton-list">
        <div class="component-list-skeleton" v-for="i in 4" :key="`bug-inbox-skeleton-${i}`">
          <div class="component-list-skeleton-avatar" />
          <div class="component-list-skeleton-lines">
            <span />
            <span />
          </div>
        </div>
      </div>
      <div
        v-else-if="!bugInboxItemsView.length"
        class="component-list-empty bug-inbox-card-empty"
      >
        还没有录入记录，请先在 Bug Trace 结果里点击“录入 Bug Inbox”。
      </div>
      <ul
        v-else
        class="component-list-preview component-list-preview--cards component-list-preview--bordered component-list-preview--rounded component-list-preview--tone-soft component-list-preview--hoverable bug-inbox-card-list"
      >
        <li
          v-for="row in bugInboxItemsView"
          :key="asBugInboxRowSafe(row).id || `${asBugInboxRowSafe(row).patchPath || ''}-${asBugInboxRowSafe(row).conversationId || ''}`"
          class="component-list-item bug-inbox-card-item"
        >
          <div class="component-list-leading">
            <span class="component-list-avatar bug-inbox-card-avatar" :data-tone="getBugInboxAvatarTone(asBugInboxRowSafe(row))">
              {{ getBugInboxAvatarText(asBugInboxRowSafe(row)) }}
            </span>
          </div>
          <div class="component-list-main bug-inbox-card-main">
            <div class="component-list-top bug-inbox-card-head">
              <div class="bug-inbox-card-title-block">
                <strong>{{ asBugInboxRowSafe(row).title || asBugInboxRowSafe(row).patchFile || '未命名 Bug' }}</strong>
                <p class="bug-inbox-card-kicker">
                  <span v-if="asBugInboxRowSafe(row).createdAt">录入于 {{ formatTimeSafe(asBugInboxRowSafe(row).createdAt) }}</span>
                  <span v-if="asBugInboxRowSafe(row).patchFile">{{ asBugInboxRowSafe(row).patchFile }}</span>
                </p>
              </div>
              <div class="component-list-flags bug-inbox-card-flags">
                <span
                  v-if="getBugInboxSeverityText(asBugInboxRowSafe(row)) !== '-'"
                  class="feishu-severity-chip"
                  :data-level="getBugInboxSeverityLevel(asBugInboxRowSafe(row))"
                >
                  {{ getBugInboxSeverityText(asBugInboxRowSafe(row)) }}
                </span>
                <span class="bug-inbox-bind-chip" :data-linked="Boolean(getBugInboxFeishuLinkSafe(asBugInboxRowSafe(row)))">
                  {{ getBugBindStatusSafe(asBugInboxRowSafe(row)) }}
                </span>
                <span v-if="asBugInboxRowSafe(row).status" class="bug-inbox-status-chip">
                  {{ asBugInboxRowSafe(row).status }}
                </span>
              </div>
            </div>
            <button
              type="button"
              class="component-list-desc bug-inbox-card-desc bug-inbox-card-desc-trigger"
              title="点击编辑描述"
              @click="openBugInboxDescriptionEditor(row)"
            >
              <span class="bug-inbox-card-desc-label">
                {{ String(asBugInboxRowSafe(row).description || '').trim() ? '摘要' : '待补充摘要' }}
              </span>
              {{ getBugInboxSummaryText(asBugInboxRowSafe(row)) }}
            </button>
            <div class="component-list-meta bug-inbox-card-meta bug-inbox-card-context">
              <small v-if="asBugInboxRowSafe(row).patchPath" class="bug-inbox-context-line">
                <span>Patch</span>
                <strong>{{ asBugInboxRowSafe(row).patchPath }}</strong>
              </small>
              <small class="bug-inbox-context-line" :data-linked="Boolean(getBugInboxFeishuLinkSafe(asBugInboxRowSafe(row)))">
                <span>绑定</span>
                <strong>{{ getBugInboxBindingSummary(asBugInboxRowSafe(row)) }}</strong>
              </small>
            </div>
            <div class="component-list-actions bug-inbox-card-actions">
              <div class="component-list-tags bug-inbox-card-tags">
                <span v-if="asBugInboxRowSafe(row).bugCode" class="bug-inbox-inline-chip">定位片段已录入</span>
                <button
                  v-if="asBugInboxRowSafe(row).conversationId"
                  class="bug-inbox-card-conv"
                  type="button"
                  :data-copied="bugInboxCopiedIdValue === asBugInboxRowSafe(row).conversationId"
                  :title="bugInboxCopiedIdValue === asBugInboxRowSafe(row).conversationId ? '已复制会话 ID' : '点击复制会话 ID'"
                  :aria-label="bugInboxCopiedIdValue === asBugInboxRowSafe(row).conversationId ? '已复制会话 ID' : '点击复制会话 ID'"
                  @click.stop="onCopyBugInboxId(asBugInboxRowSafe(row).conversationId)"
                >
                  <code>{{ asBugInboxRowSafe(row).conversationId }}</code>
                </button>
              </div>
              <div class="bug-inbox-card-action-group">
                <button type="button" class="app-btn-ghost bug-inbox-detail-btn" @click="onOpenBugInboxDetail(row)">
                  详情
                </button>
                <button
                  type="button"
                  :class="getBugInboxFeishuLinkSafe(asBugInboxRowSafe(row)) ? 'app-btn-secondary bug-inbox-match-btn' : 'app-btn bug-inbox-match-btn'"
                  @click="onOpenFeishuBindModal(row)"
                >
                  {{ getBugInboxFeishuLinkSafe(asBugInboxRowSafe(row)) ? '换绑飞书 Bug' : '绑定飞书 Bug' }}
                </button>
                <button type="button" class="app-btn-ghost bug-inbox-delete-btn" @click="onOpenBugInboxDeleteConfirm(row)">
                  删除
                </button>
              </div>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </div>

  <Dialog :open="bugInboxComposerOpen" @update:open="onBugInboxComposerOpenChange">
    <DialogContent class="component-modal-dialog component-modal-dialog--md component-modal-dialog--tone-info bug-trace-inbox-dialog" :show-close="false">
      <DialogHeader class="component-modal-dialog-header bug-trace-inbox-dialog-header">
        <div class="component-modal-dialog-title-row">
          <div>
            <DialogTitle class="bug-trace-inbox-dialog-title">{{ getBugInboxModalTitle(activeBugInboxItem) }}</DialogTitle>
            <DialogDescription class="bug-trace-inbox-dialog-desc">
              补充现象、影响范围和复现条件后，再把当前定位结果登记到 Bug Inbox。
            </DialogDescription>
          </div>
          <DialogClose as-child>
            <button type="button" class="app-btn-ghost modal-close-btn" aria-label="关闭录入弹窗">×</button>
          </DialogClose>
        </div>
      </DialogHeader>
      <div v-if="activeBugInboxItem" class="component-modal-dialog-body bug-trace-inbox-dialog-body">
        <div class="bug-trace-inbox-context">
          <p><strong>Patch：</strong>{{ activeBugInboxItem.patchFile || '未命名 patch' }}</p>
          <p><strong>路径：</strong>{{ activeBugInboxItem.patchPath }}</p>
          <p v-if="activeBugInboxItem.conversationId"><strong>会话 ID：</strong>{{ activeBugInboxItem.conversationId }}</p>
        </div>
        <label class="bug-trace-inbox-field">
          <span>补充说明</span>
          <textarea
            class="app-textarea bug-trace-inbox-textarea"
            :value="getBugInboxDraft(activeBugInboxItem)"
            placeholder="补充 Bug 描述：现象、影响范围、复现条件、预期行为..."
            @input="onBugInboxDraftInput(activeBugInboxItem, $event)"
          />
        </label>
        <p v-if="bugInboxErrorText" class="error">{{ bugInboxErrorText }}</p>
      </div>
      <footer class="component-modal-actions bug-trace-inbox-dialog-actions">
        <button type="button" class="app-btn-ghost" @click="closeBugInboxComposer">取消</button>
        <button
          type="button"
          class="app-btn"
          @click="onSubmitBugInboxComposer"
          :disabled="!activeBugInboxItem || bugInboxSavingKeyValue === (activeBugInboxItem ? getTraceItemKey(activeBugInboxItem) : '')"
        >
          {{
            activeBugInboxItem && bugInboxSavingKeyValue === getTraceItemKey(activeBugInboxItem)
              ? '录入中...'
              : '确认录入'
          }}
        </button>
      </footer>
    </DialogContent>
  </Dialog>

  <Dialog :open="bugInboxDescriptionEditorOpen" @update:open="onBugInboxDescriptionEditorOpenChange">
    <DialogContent class="component-modal-dialog component-modal-dialog--md component-modal-dialog--tone-info bug-trace-inbox-dialog" :show-close="false">
      <DialogHeader class="component-modal-dialog-header bug-trace-inbox-dialog-header">
        <div class="component-modal-dialog-title-row">
          <div>
            <DialogTitle class="bug-trace-inbox-dialog-title">编辑描述</DialogTitle>
            <DialogDescription class="bug-trace-inbox-dialog-desc">
              描述会展示在列表卡片里，建议保留现象、影响范围和复现线索，最多 100 字。
            </DialogDescription>
          </div>
          <DialogClose as-child>
            <button type="button" class="app-btn-ghost modal-close-btn" aria-label="关闭描述编辑弹窗">×</button>
          </DialogClose>
        </div>
      </DialogHeader>
      <div v-if="activeBugInboxDescriptionItem" class="component-modal-dialog-body bug-trace-inbox-dialog-body">
        <div class="bug-trace-inbox-context">
          <p><strong>标题：</strong>{{ activeBugInboxDescriptionItem.title || activeBugInboxDescriptionItem.patchFile || '未命名 Bug' }}</p>
          <p v-if="activeBugInboxDescriptionItem.patchPath"><strong>路径：</strong>{{ activeBugInboxDescriptionItem.patchPath }}</p>
        </div>
        <label class="bug-trace-inbox-field">
          <span>描述</span>
          <textarea
            class="app-textarea bug-trace-inbox-textarea"
            :value="bugInboxDescriptionDraft"
            maxlength="100"
            placeholder="补充当前 Bug 的现象、影响范围或复现线索..."
            @input="onBugInboxDescriptionDraftInput"
          />
        </label>
        <p class="bug-inbox-desc-count" :data-over="bugInboxDescriptionTooLong">
          {{ bugInboxDescriptionCharCount }}/100
        </p>
        <p v-if="bugInboxErrorText" class="error">{{ bugInboxErrorText }}</p>
      </div>
      <footer class="component-modal-actions bug-trace-inbox-dialog-actions">
        <button type="button" class="app-btn-ghost" @click="closeBugInboxDescriptionEditor">取消</button>
        <button
          type="button"
          class="app-btn"
          @click="onSubmitBugInboxDescription"
          :disabled="!activeBugInboxDescriptionItem || bugInboxDescriptionTooLong || bugInboxUpdatingIdValue === (activeBugInboxDescriptionItem?.id || '')"
        >
          {{
            activeBugInboxDescriptionItem && bugInboxUpdatingIdValue === (activeBugInboxDescriptionItem.id || '')
              ? '保存中...'
              : '保存描述'
          }}
        </button>
      </footer>
    </DialogContent>
  </Dialog>

  <Dialog :open="Boolean(fullscreenDiffItem)" @update:open="onFullscreenDiffOpenChange">
    <DialogContent class="component-modal-dialog component-modal-dialog--tone-info bug-trace-fullscreen-dialog" :show-close="false">
      <DialogHeader class="component-modal-dialog-header bug-trace-fullscreen-dialog-header">
        <div class="component-modal-dialog-title-row">
          <div>
            <DialogTitle class="bug-trace-fullscreen-dialog-title">
              {{ fullscreenDiffItem?.patchFile || 'Diff 全屏预览' }}
            </DialogTitle>
            <DialogDescription class="bug-trace-fullscreen-dialog-desc">
              按 `Esc` 可退出全屏预览。
            </DialogDescription>
          </div>
          <DialogClose as-child>
            <button type="button" class="app-btn-ghost modal-close-btn" aria-label="关闭全屏预览">×</button>
          </DialogClose>
        </div>
      </DialogHeader>
      <div v-if="fullscreenDiffItem" class="component-modal-dialog-body bug-trace-fullscreen-dialog-body">
        <div
          v-if="getParsedDiffFiles(fullscreenDiffItem).length"
          class="bug-trace-diff-layout bug-trace-diff-layout-fullscreen"
          :class="{ 'tree-collapsed': getParsedDiffFiles(fullscreenDiffItem).length <= 1 || isDiffTreeCollapsed(fullscreenDiffItem) }"
        >
          <aside
            v-if="getParsedDiffFiles(fullscreenDiffItem).length > 1 && !isDiffTreeCollapsed(fullscreenDiffItem)"
            class="bug-trace-file-tree"
          >
            <div class="bug-trace-file-tree-head">
              <div>
                <strong>变更文件</strong>
                <small>{{ getParsedDiffFiles(fullscreenDiffItem).length }} 个文件</small>
              </div>
              <button
                type="button"
                class="app-btn-ghost bug-trace-tree-toggle"
                title="收起文件索引"
                aria-label="收起文件索引"
                @click="toggleDiffTree(fullscreenDiffItem)"
              >
                <ChevronLeft :size="15" />
              </button>
            </div>
            <button
              v-for="file in getParsedDiffFiles(fullscreenDiffItem)"
              :key="file.key"
              type="button"
              class="bug-trace-file-node"
              :class="{ active: getSelectedDiffFileKey(fullscreenDiffItem) === file.key }"
              @click="onSelectDiffFile(fullscreenDiffItem, file.key)"
            >
              <strong>{{ file.fileName || file.label }}</strong>
              <small>{{ file.directoryPath || file.filePath || file.label }}</small>
            </button>
          </aside>
          <section class="bug-trace-diff-main">
            <div v-if="getParsedDiffFiles(fullscreenDiffItem).length > 1" class="bug-trace-diff-main-toolbar">
              <button
                v-if="isDiffTreeCollapsed(fullscreenDiffItem)"
                type="button"
                class="app-btn-ghost bug-trace-tree-toggle bug-trace-tree-toggle-inline"
                title="展开文件索引"
                aria-label="展开文件索引"
                @click="toggleDiffTree(fullscreenDiffItem)"
              >
                <ChevronRight :size="15" />
                <span>文件索引</span>
              </button>
            </div>
            <CodeMirrorDiffView
              v-if="getSelectedDiffModel(fullscreenDiffItem)"
              :file-path="getSelectedDiffModel(fullscreenDiffItem)?.filePath || ''"
              :file-name="getSelectedDiffModel(fullscreenDiffItem)?.fileName || ''"
              :directory-path="getSelectedDiffModel(fullscreenDiffItem)?.directoryPath || ''"
              :original-text="getSelectedDiffModel(fullscreenDiffItem)?.originalText || ''"
              :modified-text="getSelectedDiffModel(fullscreenDiffItem)?.modifiedText || ''"
              :source="getSelectedDiffModel(fullscreenDiffItem)?.source || 'patch'"
            />
            <p v-else class="warn">当前文件还没有可用的 Diff 数据。</p>
          </section>
        </div>
        <div v-else class="bug-trace-fullscreen-raw" v-html="getRawDiffHtml(fullscreenDiffItem)" />
      </div>
    </DialogContent>
  </Dialog>
</template>
