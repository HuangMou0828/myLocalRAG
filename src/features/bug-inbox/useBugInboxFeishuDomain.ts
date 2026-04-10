import { computed, ref } from 'vue'
import type { BugTraceResultItem } from '@/features/bug-trace/useBugTraceDomain'

export interface BugInboxItem {
  id: string
  title: string
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  status: 'open' | 'investigating' | 'resolved' | 'ignored'
  bugCode: string
  patchFile: string
  patchPath: string
  patchDir: string
  cursorRoot: string
  conversationId: string
  score: number
  snippet?: {
    snippet?: string
    snippetSource?: {
      filePath: string
      side: 'old' | 'new'
      lineNo: number
    } | null
    hitKeywords?: string[]
    matchedLocations?: Array<{
      filePath: string
      side: 'old' | 'new'
      lineNo: number
      text: string
    }>
  } | null
  matchedSnippets?: Array<{
    snippet: string
    snippetSource?: {
      filePath: string
      side: 'old' | 'new'
      lineNo: number
    } | null
    hitKeywords?: string[]
    matchedLocations?: Array<{
      filePath: string
      side: 'old' | 'new'
      lineNo: number
      text: string
    }>
  }>
  meta?: {
    feishuLink?: {
      id?: string
      title?: string
      url?: string
      status?: string
      assignee?: string
      creator?: string
      reporter?: string
      linkedAt?: string
    }
  }
  createdAt: string
  updatedAt: string
}

export interface FeishuBugCandidate {
  id: string
  title: string
  url?: string
  status?: string
  assignee?: string
  creator?: string
  reporter?: string
  createdAt?: string
  requirement?: string
  discoveryStage?: string
  severity?: string
  category?: string
}

export interface FeishuTodoItem {
  id: string
  title: string
  workItemType: string
  projectKey: string
  projectName: string
  nodeName: string
  nodeStateKey: string
  assignee: string
  scheduleStart: string
  scheduleEnd: string
  dueAt: string
  updatedAt: string
  url: string
}

export type FeishuScheduleDataFilter = 'schedule' | 'defect'

type ComponentListStatusTone = 'default' | 'success' | 'warning' | 'danger' | 'muted'
type BugDetailDisplayKind = 'badge' | 'datetime' | 'path' | 'code' | 'link' | 'pre' | 'text'
type ToastTone = 'info' | 'success' | 'warning' | 'danger'

interface FeishuBatchTransitionResponse {
  action: 'confirm' | 'rollback'
  total: number
  succeeded: number
  failed: number
  results: Array<{ id: string; ok: boolean; error?: string }>
}

interface BugInboxFeishuService {
  fetchBugInbox(limit?: number): Promise<{ items: BugInboxItem[] }>
  fetchFeishuTodoList(force?: boolean): Promise<{ items: FeishuTodoItem[] }>
  fetchFeishuDefectList(force?: boolean): Promise<{ candidates: FeishuBugCandidate[] }>
  submitBatchTransition(payload: {
    action: 'confirm' | 'rollback'
    rollbackReason?: string
    items: Array<{
      id: string
      title: string
      projectKey: string
      workItemType: string
      nodeStateKey: string
    }>
  }): Promise<FeishuBatchTransitionResponse>
  linkBugWithFeishu(payload: { bugId: string; candidate: FeishuBugCandidate }): Promise<{ item: BugInboxItem }>
  matchFeishuCandidates(bugId: string): Promise<{ candidates: FeishuBugCandidate[]; attemptedTools?: string[] }>
  updateBugInbox(payload: { id: string; description: string }): Promise<{ item: BugInboxItem }>
  deleteBugInbox(id: string): Promise<{ removed: boolean }>
  createBugInbox(payload: Record<string, unknown>): Promise<{ item: BugInboxItem }>
}

interface BugInboxColumnDef {
  key: string
  label: string
  minWidth: number
  defaultWidth: number
  expandable?: boolean
  thClass?: string
  tdClass?: string
  value?: (row: Record<string, unknown>) => unknown
}

interface FeishuTodoColumnDef {
  key: string
  label: string
  minWidth: number
  defaultWidth: number
  expandable?: boolean
  thClass?: string
  tdClass?: string
  value?: (row: Record<string, unknown>) => unknown
}

interface BugDetailField {
  key: string
  label: string
  kind: BugDetailDisplayKind
  display: string
  raw: unknown
  copyable: boolean
  href?: string
}

interface BugTraceSnippetItem {
  snippet?: string
  snippetSource?: {
    filePath: string
    side: 'old' | 'new'
    lineNo: number
  } | null
  hitKeywords?: string[]
  matchedLocations?: Array<{
    filePath: string
    side: 'old' | 'new'
    lineNo: number
    text: string
  }>
}

interface UseBugInboxFeishuDomainOptions {
  service: BugInboxFeishuService
  formatTime: (input: string | null | undefined) => string
  notify?: (text: string, tone?: ToastTone) => void
  getPatchDir: () => string
  getBugTraceCode: () => string
  getBugTraceCursorRoot: () => string
  getBugTraceCacheKey: (item: BugTraceResultItem) => string
  getBugTraceSnippetList: (item: BugTraceResultItem) => BugTraceSnippetItem[]
  isFeishuScheduleMode: () => boolean
  initialFeishuScheduleDataFilter?: FeishuScheduleDataFilter
}

const BUG_DETAIL_FIELD_ORDER = [
  'title',
  'description',
  'status',
  'severity',
  'bugCode',
  'patchPath',
  'conversationId',
  'createdAt',
  'updatedAt',
  'meta',
] as const

const BUG_DETAIL_LABEL_MAP: Record<string, string> = {
  id: 'ID',
  title: '标题',
  description: '描述',
  severity: '严重程度',
  status: '状态',
  bugCode: 'Bug 代码',
  patchFile: 'Patch 文件',
  patchPath: 'Patch 路径',
  patchDir: 'Patch 目录',
  cursorRoot: 'Cursor 根目录',
  conversationId: '会话 ID',
  score: '评分',
  createdAt: '创建时间',
  updatedAt: '更新时间',
  meta: '元数据',
  feishuLink: '飞书关联',
  url: '链接',
  assignee: '处理人',
  creator: '创建人',
  reporter: '报告人',
  linkedAt: '绑定时间',
  assistantSummary: '场景描述',
  filePath: '文件路径',
  side: '差异侧',
  lineNo: '行号',
}

const BUG_DETAIL_HIDDEN_KEY_PATTERNS = [
  /^score$/i,
  /^patchFile$/i,
  /^patchDir$/i,
  /^cursorRoot$/i,
  /(^|\.)turnDir$/i,
  /(^|\.)source$/i,
  /(^|\.)createdFrom$/i,
  /^snippet$/i,
  /^snippet\./i,
  /^matchedSnippets$/i,
  /^matchedSnippets\./i,
  /^hitKeywords$/i,
  /^hitKeywords\./i,
  /^matchedLocations$/i,
  /^matchedLocations\./i,
] as const

export const BUG_INBOX_COLUMN_WIDTHS_STORAGE_KEY = 'kb.bug.inbox.column.widths.v1'
export const FEISHU_TODO_COLUMN_WIDTHS_STORAGE_KEY = 'kb.feishu.todo.column.widths.v1'

export function useBugInboxFeishuDomain(options: UseBugInboxFeishuDomainOptions) {
  const notify = options.notify || (() => undefined)
  const formatTime = options.formatTime

  const bugInboxItems = ref<BugInboxItem[]>([])
  const bugInboxCopiedId = ref('')
  const bugInboxError = ref('')
  const bugInboxLoading = ref(false)
  const bugInboxDeleteConfirmOpen = ref(false)
  const bugInboxDeletingId = ref('')
  const bugInboxUpdatingId = ref('')
  const bugInboxPendingDelete = ref<BugInboxItem | null>(null)
  const bugInboxSavingKey = ref('')
  const bugInboxDraftByPatchKey = ref<Record<string, string>>({})

  const feishuBindModalOpen = ref(false)
  const feishuBindTargetBug = ref<BugInboxItem | null>(null)
  const feishuBindCandidates = ref<FeishuBugCandidate[]>([])
  const feishuBindLoading = ref(false)
  const feishuBindError = ref('')
  const feishuBindLinkingKey = ref('')
  const feishuBindSelectedCandidateKey = ref('')

  const selectedBugInboxItem = ref<BugInboxItem | null>(null)
  const bugInboxDetailModalOpen = ref(false)

  const feishuScheduleDataFilter = ref<FeishuScheduleDataFilter>(options.initialFeishuScheduleDataFilter || 'defect')
  const feishuTodoItems = ref<FeishuTodoItem[]>([])
  const feishuTodoError = ref('')
  const feishuTodoLoading = ref(false)
  const feishuDefectItems = ref<FeishuBugCandidate[]>([])
  const feishuDefectError = ref('')
  const feishuDefectLoading = ref(false)
  const feishuTodoSelectedIds = ref<Set<string>>(new Set())
  const feishuBatchModalOpen = ref(false)
  const feishuBatchAction = ref<'confirm' | 'rollback'>('confirm')
  const feishuBatchRollbackReason = ref('')
  const feishuBatchLoading = ref(false)
  const feishuBatchError = ref('')
  const feishuBatchResultText = ref('')
  const feishuTodoNextStepLoadingId = ref('')

  const selectedFeishuTodos = computed(() =>
    feishuTodoItems.value.filter((item) => feishuTodoSelectedIds.value.has(String(item.id || '').trim())),
  )
  const allFeishuTodoSelected = computed(
    () => feishuTodoItems.value.length > 0 && feishuTodoItems.value.every((item) => feishuTodoSelectedIds.value.has(item.id)),
  )

  const isFeishuScheduleTodoView = computed(() => options.isFeishuScheduleMode() && feishuScheduleDataFilter.value === 'schedule')
  const isFeishuScheduleDefectView = computed(() => options.isFeishuScheduleMode() && feishuScheduleDataFilter.value === 'defect')

  function asBugInboxRow(row: Record<string, unknown>): BugInboxItem {
    return row as unknown as BugInboxItem
  }

  function asFeishuTodoRow(row: Record<string, unknown>): FeishuTodoItem {
    return row as unknown as FeishuTodoItem
  }

  function getBugInboxFeishuLink(item: BugInboxItem | null | undefined) {
    const link = item?.meta?.feishuLink
    if (!link || typeof link !== 'object') return null
    return {
      id: String(link.id || ''),
      title: String(link.title || ''),
      url: String(link.url || ''),
      status: String(link.status || ''),
      assignee: String(link.assignee || ''),
      creator: String(link.creator || ''),
      reporter: String(link.reporter || ''),
      linkedAt: String(link.linkedAt || ''),
    }
  }

  function getBugBindStatus(item: BugInboxItem): string {
    return getBugInboxFeishuLink(item) ? '已绑定' : '未绑定'
  }

  function getBugBindTime(item: BugInboxItem): string {
    const linkedAt = getBugInboxFeishuLink(item)?.linkedAt || ''
    return linkedAt ? formatTime(linkedAt) : '-'
  }

  function getBugBoundTitle(item: BugInboxItem): string {
    return getBugInboxFeishuLink(item)?.title || '-'
  }

  function getBugBoundOwner(item: BugInboxItem): string {
    const link = getBugInboxFeishuLink(item)
    if (!link) return '-'
    return String(link.reporter || link.creator || '').trim() || '-'
  }

  function formatFeishuTodoSchedule(item: FeishuTodoItem): string {
    const start = toDayKey(String(item?.scheduleStart || '').trim())
    const end = toDayKey(String(item?.scheduleEnd || '').trim())
    if (!start && !end) return '-'
    if (start && end) return `${start} ~ ${end}`
    return start || end
  }

  function toDayKey(input: string): string {
    const raw = String(input || '').trim()
    if (!raw) return ''
    const directDate = raw.match(/^(\d{4}-\d{2}-\d{2})/)
    if (directDate) return directDate[1]
    const date = new Date(raw)
    if (Number.isNaN(date.getTime())) return ''
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  function getFeishuTodoDeadlineStatus(item: FeishuTodoItem): { label: string; tone: 'today' | 'overdue' | 'normal' } {
    const endKey = toDayKey(String(item?.scheduleEnd || '').trim())
    if (!endKey) return { label: '进行中', tone: 'normal' }
    const now = new Date()
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    if (endKey === todayKey) return { label: '今天截止', tone: 'today' }
    if (endKey < todayKey) return { label: '已超期', tone: 'overdue' }
    return { label: '进行中', tone: 'normal' }
  }

  function getFeishuCandidateKey(candidate: FeishuBugCandidate): string {
    return `${String(candidate?.id || '').trim()}::${String(candidate?.title || '').trim()}`
  }

  function isFeishuCandidateSelected(candidate: FeishuBugCandidate): boolean {
    return feishuBindSelectedCandidateKey.value === getFeishuCandidateKey(candidate)
  }

  function selectFeishuCandidate(candidate: FeishuBugCandidate) {
    feishuBindSelectedCandidateKey.value = getFeishuCandidateKey(candidate)
  }

  function getFeishuCandidateReporter(candidate: FeishuBugCandidate): string {
    return String(candidate?.reporter || candidate?.creator || '').trim() || '-'
  }

  function getFeishuCandidateCreatedAt(candidate: FeishuBugCandidate): string {
    const raw = String(candidate?.createdAt || '').trim()
    if (!raw) return '-'
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
    if (/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/.test(raw)) return raw.slice(0, 10)
    return formatTime(raw)
  }

  function getFeishuCandidateRequirement(candidate: FeishuBugCandidate): string {
    return String(candidate?.requirement || '').trim() || '-'
  }

  function getFeishuCandidateDiscoveryStage(candidate: FeishuBugCandidate): string {
    return String(candidate?.discoveryStage || '').trim() || '-'
  }

  function getFeishuCandidateSeverity(candidate: FeishuBugCandidate): string {
    return String(candidate?.severity || '').trim() || '-'
  }

  function getFeishuCandidateCategory(candidate: FeishuBugCandidate): string {
    return String(candidate?.category || '').trim() || '-'
  }

  function getFeishuCandidateSeverityLevel(candidate: FeishuBugCandidate): 'critical' | 'high' | 'medium' | 'low' | 'unknown' {
    const raw = String(candidate?.severity || '').trim().toLowerCase()
    if (!raw) return 'unknown'
    if (['致命', '阻塞', 'critical', 'blocker', 'p0', 's0', '最高'].some((token) => raw.includes(token))) return 'critical'
    if (['严重', 'high', 'p1', 's1', '高优先'].some((token) => raw.includes(token))) return 'high'
    if (['中', 'medium', '一般', 'normal', 'p2', 's2'].some((token) => raw.includes(token))) return 'medium'
    if (['低', 'low', '轻微', '建议', '优化', 'p3', 's3'].some((token) => raw.includes(token))) return 'low'
    return 'unknown'
  }

  function getFeishuCandidateStatusTone(candidate: FeishuBugCandidate): ComponentListStatusTone {
    const status = String(candidate?.status || '').trim().toLowerCase()
    if (!status) return 'default'
    if (['已关闭', '已解决', 'closed', 'done', 'resolved'].some((token) => status.includes(token.toLowerCase()))) {
      return 'success'
    }
    if (['高风险', '阻塞', '严重', '进行中', '待修复', '待处理', 'todo', 'active', 'open'].some((token) => status.includes(token.toLowerCase()))) {
      return 'danger'
    }
    if (['待验证', '处理中', 'review', 'testing', 'progress', 'wip'].some((token) => status.includes(token.toLowerCase()))) {
      return 'warning'
    }
    return 'muted'
  }

  function getFeishuCandidateAvatarText(candidate: FeishuBugCandidate): string {
    const reporter = getFeishuCandidateReporter(candidate)
    const title = String(candidate?.title || '').trim()
    const source = reporter !== '-' ? reporter : (title || String(candidate?.id || '').trim())
    return source ? source.slice(0, 1) : '缺'
  }

  function openFeishuCandidateUrl(candidate: FeishuBugCandidate) {
    const target = String(candidate?.url || '').trim()
    if (!target) return
    window.open(target, '_blank', 'noopener,noreferrer')
  }

  function isFeishuCurrentBoundCandidate(candidate: FeishuBugCandidate): boolean {
    const link = getBugInboxFeishuLink(feishuBindTargetBug.value)
    if (!link) return false
    const candidateId = String(candidate?.id || '').trim()
    const candidateTitle = String(candidate?.title || '').trim()
    if (candidateId && candidateId === String(link.id || '').trim()) return true
    if (candidateTitle && candidateTitle === String(link.title || '').trim()) return true
    return false
  }

  const bugInboxColumns: BugInboxColumnDef[] = [
    {
      key: 'title',
      label: '标题',
      minWidth: 180,
      defaultWidth: 240,
      expandable: true,
      tdClass: 'bug-inbox-td-title',
      value: (row) => String(asBugInboxRow(row).title || asBugInboxRow(row).patchFile || '未命名 Bug'),
    },
    {
      key: 'patchPath',
      label: 'Patch 路径',
      minWidth: 200,
      defaultWidth: 280,
      expandable: true,
      tdClass: 'bug-inbox-td-path',
      value: (row) => String(asBugInboxRow(row).patchPath || asBugInboxRow(row).patchFile || '-'),
    },
    {
      key: 'conversationId',
      label: '会话 ID',
      minWidth: 180,
      defaultWidth: 220,
      expandable: true,
      tdClass: 'bug-inbox-td-conv',
      value: (row) => String(asBugInboxRow(row).conversationId || '-'),
    },
    {
      key: 'time',
      label: '时间',
      minWidth: 110,
      defaultWidth: 120,
      expandable: true,
      tdClass: 'bug-inbox-td-time',
      value: (row) => formatTime(asBugInboxRow(row).createdAt),
    },
    {
      key: 'bindStatus',
      label: '绑定情况',
      minWidth: 110,
      defaultWidth: 120,
      expandable: true,
      tdClass: 'bug-inbox-td-bind-status',
      value: (row) => getBugBindStatus(asBugInboxRow(row)),
    },
    {
      key: 'boundBug',
      label: '绑定Bug',
      minWidth: 220,
      defaultWidth: 280,
      expandable: true,
      value: (row) => getBugBoundTitle(asBugInboxRow(row)),
    },
    {
      key: 'owner',
      label: '提出/创建人',
      minWidth: 140,
      defaultWidth: 170,
      expandable: true,
      value: (row) => getBugBoundOwner(asBugInboxRow(row)),
    },
    {
      key: 'bindTime',
      label: '绑定时间',
      minWidth: 120,
      defaultWidth: 150,
      expandable: true,
      tdClass: 'bug-inbox-td-bind-time',
      value: (row) => getBugBindTime(asBugInboxRow(row)),
    },
    { key: 'actions', label: '操作', minWidth: 220, defaultWidth: 240, tdClass: 'bug-inbox-td-actions' },
  ]

  const feishuTodoColumns: FeishuTodoColumnDef[] = [
    { key: 'selector', label: '', minWidth: 56, defaultWidth: 56, tdClass: 'bug-inbox-td' },
    {
      key: 'title',
      label: '标题',
      minWidth: 220,
      defaultWidth: 300,
      expandable: true,
      tdClass: 'bug-inbox-td-title',
      value: (row) => String(asFeishuTodoRow(row).title || '-'),
    },
    {
      key: 'nodeName',
      label: '当前节点',
      minWidth: 140,
      defaultWidth: 180,
      expandable: true,
      value: (row) => String(asFeishuTodoRow(row).nodeName || '-'),
    },
    {
      key: 'schedule',
      label: '计划时间',
      minWidth: 220,
      defaultWidth: 240,
      expandable: true,
      tdClass: 'bug-inbox-td-schedule',
      value: (row) => formatFeishuTodoSchedule(asFeishuTodoRow(row)),
    },
    { key: 'status', label: '状态', minWidth: 110, defaultWidth: 130 },
    {
      key: 'updatedAt',
      label: '更新时间',
      minWidth: 140,
      defaultWidth: 160,
      value: (row) => formatTime(asFeishuTodoRow(row).updatedAt),
    },
    { key: 'actions', label: '操作', minWidth: 120, defaultWidth: 140, tdClass: 'bug-inbox-td-actions' },
  ]

  async function loadBugInbox() {
    bugInboxLoading.value = true
    bugInboxError.value = ''
    try {
      const data = await options.service.fetchBugInbox(80)
      bugInboxItems.value = Array.isArray(data?.items) ? data.items : []
    } catch (error) {
      bugInboxError.value = String(error)
    } finally {
      bugInboxLoading.value = false
    }
  }

  async function loadFeishuTodoList(force = false) {
    feishuTodoLoading.value = true
    feishuTodoError.value = ''
    try {
      const data = await options.service.fetchFeishuTodoList(force)
      feishuTodoItems.value = Array.isArray(data?.items) ? data.items : []
      const validIds = new Set(feishuTodoItems.value.map((item) => item.id))
      feishuTodoSelectedIds.value = new Set(
        Array.from(feishuTodoSelectedIds.value).filter((id) => validIds.has(String(id || '').trim())),
      )
    } catch (error) {
      feishuTodoError.value = String(error)
    } finally {
      feishuTodoLoading.value = false
    }
  }

  async function loadFeishuDefectList(force = false) {
    feishuDefectLoading.value = true
    feishuDefectError.value = ''
    try {
      const data = await options.service.fetchFeishuDefectList(force)
      feishuDefectItems.value = Array.isArray(data?.candidates) ? data.candidates : []
    } catch (error) {
      feishuDefectError.value = String(error)
    } finally {
      feishuDefectLoading.value = false
    }
  }

  function setFeishuScheduleDataFilter(next: FeishuScheduleDataFilter) {
    if (feishuScheduleDataFilter.value === next) return
    feishuScheduleDataFilter.value = next
    if (!options.isFeishuScheduleMode()) return
    if (next === 'defect') {
      void loadFeishuDefectList()
      return
    }
    void loadFeishuTodoList()
  }

  function toggleFeishuTodoSelection(id: string) {
    const key = String(id || '').trim()
    if (!key) return
    const next = new Set(feishuTodoSelectedIds.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    feishuTodoSelectedIds.value = next
  }

  function toggleSelectAllFeishuTodos() {
    if (allFeishuTodoSelected.value) {
      feishuTodoSelectedIds.value = new Set()
      return
    }
    feishuTodoSelectedIds.value = new Set(feishuTodoItems.value.map((item) => item.id))
  }

  function openFeishuBatchModal() {
    if (!selectedFeishuTodos.value.length) return
    feishuBatchModalOpen.value = true
    feishuBatchAction.value = 'confirm'
    feishuBatchRollbackReason.value = ''
    feishuBatchError.value = ''
    feishuBatchResultText.value = ''
  }

  function closeFeishuBatchModal() {
    if (feishuBatchLoading.value) return
    feishuBatchModalOpen.value = false
    feishuBatchError.value = ''
    feishuBatchResultText.value = ''
  }

  function sleep(ms: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, Math.max(0, Number(ms) || 0))
    })
  }

  async function submitFeishuBatchTransition() {
    const list = selectedFeishuTodos.value
    if (!list.length) {
      feishuBatchError.value = '请先选择至少一条待办'
      return
    }
    if (feishuBatchAction.value === 'rollback' && !feishuBatchRollbackReason.value.trim()) {
      feishuBatchError.value = '回滚操作需要填写回滚原因'
      return
    }
    feishuBatchLoading.value = true
    feishuBatchError.value = ''
    feishuBatchResultText.value = ''
    try {
      const payload = {
        action: feishuBatchAction.value,
        rollbackReason: feishuBatchRollbackReason.value.trim(),
        items: list.map((item) => ({
          id: item.id,
          title: item.title,
          projectKey: item.projectKey,
          workItemType: item.workItemType,
          nodeStateKey: item.nodeStateKey,
        })),
      }
      const data = await options.service.submitBatchTransition(payload)
      const failedList = Array.isArray(data?.results) ? data.results.filter((item) => !item.ok) : []
      feishuBatchResultText.value = `处理完成：成功 ${Number(data?.succeeded || 0)} / ${Number(data?.total || 0)}`
      if (failedList.length) {
        feishuBatchError.value = `失败 ${failedList.length} 条，首条原因：${String(failedList[0]?.error || '未知错误')}`
      } else {
        feishuTodoSelectedIds.value = new Set()
        feishuBatchModalOpen.value = false
      }
    } catch (error) {
      feishuBatchError.value = String(error)
    } finally {
      feishuBatchLoading.value = false
      try {
        await sleep(2000)
        await loadFeishuTodoList(true)
        feishuTodoSelectedIds.value = new Set()
      } catch {
        // keep original error text
      }
    }
  }

  async function runFeishuTodoNextStep(item: FeishuTodoItem) {
    const itemId = String(item?.id || '').trim()
    if (!itemId || feishuTodoNextStepLoadingId.value) return
    feishuTodoNextStepLoadingId.value = itemId
    feishuTodoError.value = ''
    try {
      await options.service.submitBatchTransition({
        action: 'confirm',
        items: [
          {
            id: item.id,
            title: item.title,
            projectKey: item.projectKey,
            workItemType: item.workItemType,
            nodeStateKey: item.nodeStateKey,
          },
        ],
      })
      await sleep(2000)
      await loadFeishuTodoList(true)
      feishuTodoSelectedIds.value = new Set()
    } catch (error) {
      feishuTodoError.value = String(error)
    } finally {
      feishuTodoNextStepLoadingId.value = ''
    }
  }

  async function linkBugWithFeishu(bug: BugInboxItem, candidate: FeishuBugCandidate) {
    const bugId = String(bug?.id || '').trim()
    if (!bugId) return
    feishuBindLinkingKey.value = `${bugId}::${candidate.id || candidate.title}`
    feishuBindError.value = ''
    try {
      const data = await options.service.linkBugWithFeishu({ bugId, candidate })
      const updated = data?.item
      if (updated?.id) {
        bugInboxItems.value = bugInboxItems.value.map((row) => (row.id === updated.id ? updated : row))
        if (selectedBugInboxItem.value?.id === updated.id) selectedBugInboxItem.value = updated
        if (feishuBindTargetBug.value?.id === updated.id) feishuBindTargetBug.value = updated
        feishuBindCandidates.value = []
        feishuBindModalOpen.value = false
      }
    } catch (error) {
      feishuBindError.value = String(error)
    } finally {
      feishuBindLinkingKey.value = ''
    }
  }

  async function updateBugInboxDescription(item: BugInboxItem, description: string) {
    const bugId = String(item?.id || '').trim()
    const nextDescription = String(description || '').trim()
    if (!bugId) return false
    if (nextDescription.length > 100) {
      bugInboxError.value = '描述不能超过 100 字'
      notify(bugInboxError.value, 'warning')
      return false
    }
    bugInboxUpdatingId.value = bugId
    bugInboxError.value = ''
    try {
      const data = await options.service.updateBugInbox({
        id: bugId,
        description: nextDescription,
      })
      if (data?.item) {
        bugInboxItems.value = bugInboxItems.value.map((row) => (row.id === data.item.id ? data.item : row))
        if (selectedBugInboxItem.value?.id === data.item.id) selectedBugInboxItem.value = data.item
      }
      notify('描述已更新', 'success')
      return true
    } catch (error) {
      bugInboxError.value = String(error)
      notify(bugInboxError.value, 'danger')
      return false
    } finally {
      bugInboxUpdatingId.value = ''
    }
  }

  async function openFeishuBindModal(bug: BugInboxItem) {
    feishuBindModalOpen.value = true
    feishuBindTargetBug.value = bug
    feishuBindCandidates.value = []
    feishuBindError.value = ''
    feishuBindLoading.value = true
    feishuBindSelectedCandidateKey.value = ''
    try {
      const data = await options.service.matchFeishuCandidates(bug.id)
      feishuBindCandidates.value = Array.isArray(data?.candidates) ? data.candidates : []
      const currentLink = getBugInboxFeishuLink(bug)
      const currentId = String(currentLink?.id || '').trim()
      if (currentId) {
        const matched = feishuBindCandidates.value.find((candidate) => String(candidate.id || '').trim() === currentId)
        if (matched) feishuBindSelectedCandidateKey.value = getFeishuCandidateKey(matched)
      }
      if (!feishuBindCandidates.value.length) {
        feishuBindError.value = '未找到候选，请调整 bug 标题/描述后重试'
      }
    } catch (error) {
      feishuBindError.value = String(error)
    } finally {
      feishuBindLoading.value = false
    }
  }

  function closeFeishuBindModal() {
    feishuBindModalOpen.value = false
    feishuBindTargetBug.value = null
    feishuBindCandidates.value = []
    feishuBindLoading.value = false
    feishuBindLinkingKey.value = ''
    feishuBindSelectedCandidateKey.value = ''
    feishuBindError.value = ''
  }

  async function confirmFeishuBindSelection() {
    const bug = feishuBindTargetBug.value
    if (!bug?.id) return
    const selected = feishuBindCandidates.value.find((candidate) => getFeishuCandidateKey(candidate) === feishuBindSelectedCandidateKey.value)
    if (!selected) {
      feishuBindError.value = '请先选择要绑定的飞书 Bug'
      return
    }
    await linkBugWithFeishu(bug, selected)
  }

  function openBugInboxDeleteConfirm(item: BugInboxItem) {
    if (!item?.id) return
    bugInboxPendingDelete.value = item
    bugInboxDeleteConfirmOpen.value = true
  }

  function closeBugInboxDeleteConfirm() {
    if (bugInboxDeletingId.value) return
    bugInboxDeleteConfirmOpen.value = false
    bugInboxPendingDelete.value = null
  }

  async function confirmDeleteBugInbox() {
    const pending = bugInboxPendingDelete.value
    if (!pending?.id) return
    bugInboxDeletingId.value = pending.id
    bugInboxError.value = ''
    try {
      await options.service.deleteBugInbox(pending.id)
      bugInboxItems.value = bugInboxItems.value.filter((item) => item.id !== pending.id)
      if (selectedBugInboxItem.value?.id === pending.id) selectedBugInboxItem.value = null
      closeBugInboxDeleteConfirm()
    } catch (error) {
      bugInboxError.value = String(error)
    } finally {
      bugInboxDeletingId.value = ''
    }
  }

  async function saveBugToInbox(item: BugTraceResultItem) {
    const key = options.getBugTraceCacheKey(item)
    if (bugInboxSavingKey.value) return false
    const bugCode = options.getBugTraceCode().trim()
    if (!bugCode) {
      bugInboxError.value = '请先输入或保留当前 bug 代码再入库'
      notify(bugInboxError.value, 'warning')
      return false
    }

    bugInboxSavingKey.value = key
    bugInboxError.value = ''
    try {
      const snippets = options.getBugTraceSnippetList(item).slice(0, 6).map((snippet) => ({
        snippet: String(snippet?.snippet || ''),
        snippetSource: snippet?.snippetSource || null,
        hitKeywords: Array.isArray(snippet?.hitKeywords) ? snippet.hitKeywords : [],
        matchedLocations: Array.isArray(snippet?.matchedLocations) ? snippet.matchedLocations : [],
      }))

      const payload = {
        bugCode,
        description: String(bugInboxDraftByPatchKey.value[key] || '').trim(),
        patchDir: options.getPatchDir() || '',
        cursorRoot: options.getBugTraceCursorRoot().trim(),
        trace: {
          score: Number(item.score || 0),
          patchFile: item.patchFile,
          patchPath: item.patchPath,
          conversationId: item.conversationId || '',
          turnDir: item.turnDir || '',
          question: item.question || '',
          assistantSummary: item.assistantSummary || '',
          snippet: snippets[0] || null,
          matchedSnippets: snippets,
        },
      }
      const data = await options.service.createBugInbox(payload)
      if (data?.item) {
        bugInboxItems.value = [data.item, ...bugInboxItems.value.filter((row) => row.id !== data.item.id)]
        bugInboxDraftByPatchKey.value[key] = ''
        notify('Bug 已入库到 Bug Inbox', 'success')
        return true
      }
      return false
    } catch (error) {
      bugInboxError.value = String(error)
      notify(bugInboxError.value, 'danger')
      return false
    } finally {
      bugInboxSavingKey.value = ''
    }
  }

  async function copyBugInboxId(conversationId: string) {
    const value = String(conversationId || '').trim()
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      bugInboxCopiedId.value = value
      notify('会话ID已复制')
      setTimeout(() => {
        if (bugInboxCopiedId.value === value) bugInboxCopiedId.value = ''
      }, 1500)
    } catch {
      bugInboxError.value = '复制失败，请检查浏览器权限'
    }
  }

  function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Object.prototype.toString.call(value) === '[object Object]'
  }

  function flattenBugDetailEntries(
    value: unknown,
    parentKey = '',
    depth = 0,
    bucket: Array<{ key: string; value: unknown }> = [],
  ): Array<{ key: string; value: unknown }> {
    if (Array.isArray(value)) {
      if (!parentKey) return bucket
      if (!value.length) {
        bucket.push({ key: parentKey, value: [] })
        return bucket
      }
      const primitiveArray = value.every((item) => item == null || ['string', 'number', 'boolean'].includes(typeof item))
      if (primitiveArray) {
        bucket.push({ key: parentKey, value: value.map((item) => String(item ?? '-')).join(', ') })
      } else {
        bucket.push({ key: parentKey, value })
      }
      return bucket
    }

    if (isPlainRecord(value)) {
      const entries = Object.entries(value)
      if (!entries.length) {
        if (parentKey) bucket.push({ key: parentKey, value: {} })
        return bucket
      }
      if (depth >= 2) {
        if (parentKey) bucket.push({ key: parentKey, value })
        return bucket
      }
      for (const [childKey, childValue] of entries) {
        const nextKey = parentKey ? `${parentKey}.${childKey}` : childKey
        flattenBugDetailEntries(childValue, nextKey, depth + 1, bucket)
      }
      return bucket
    }

    if (parentKey) bucket.push({ key: parentKey, value })
    return bucket
  }

  function humanizeBugDetailSegment(segment: string): string {
    const raw = String(segment || '').trim()
    if (!raw) return '-'
    if (BUG_DETAIL_LABEL_MAP[raw]) return BUG_DETAIL_LABEL_MAP[raw]
    return raw
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .trim()
  }

  function buildBugDetailLabel(path: string): string {
    if (path === 'meta.assistantSummary' || path === 'assistantSummary') return '场景描述'
    const parts = String(path || '').split('.').filter(Boolean)
    if (!parts.length) return '-'
    return parts.map(humanizeBugDetailSegment).join(' / ')
  }

  function shouldHideBugDetailField(key: string): boolean {
    const normalized = String(key || '').trim()
    if (!normalized) return true
    return BUG_DETAIL_HIDDEN_KEY_PATTERNS.some((pattern) => pattern.test(normalized))
  }

  function buildBugDetailHref(key: string, value: unknown): string | undefined {
    const text = String(value ?? '').trim()
    if (!text || text === '-') return undefined
    if (/^https?:\/\//i.test(text)) return text
    const lowerKey = String(key || '').toLowerCase()
    if (lowerKey === 'conversationid') return `#/sessions/${encodeURIComponent(text)}`
    if (lowerKey === 'id') return `#/bug-inbox/${encodeURIComponent(text)}`
    return undefined
  }

  function inferBugDetailKind(key: string, value: unknown): BugDetailDisplayKind {
    const lowerKey = String(key || '').toLowerCase()
    const isBadgeKey = /(status|severity|priority|state|type|level)$/.test(lowerKey)
    const isTimeKey = /(time|date|created|updated|linked|at)$/.test(lowerKey)
    const isPathKey = /(path|file|root|dir)/.test(lowerKey) || /(^id$|conversationid$)/.test(lowerKey)
    const isCodeKey = /(trace)/.test(lowerKey)
    const isCodeBlockKey = /(code|snippet|diff|patchcontent|content)/.test(lowerKey)

    if (typeof value === 'boolean') return 'badge'
    if (typeof value === 'number') return isTimeKey ? 'datetime' : (isBadgeKey ? 'badge' : 'text')
    if (Array.isArray(value) || isPlainRecord(value)) return 'pre'

    const text = String(value ?? '').trim()
    if (!text) return 'text'
    if (/^https?:\/\//i.test(text)) return 'link'
    if (isTimeKey && !Number.isNaN(new Date(text).getTime())) return 'datetime'
    if (isBadgeKey) return 'badge'
    if (isPathKey) return 'path'
    if (isCodeBlockKey || text.includes('\n')) {
      if (/(description|message|reason|summary)/.test(lowerKey)) return 'text'
      return 'pre'
    }
    if (isCodeKey) return 'code'
    return 'text'
  }

  function formatBugDetailValue(key: string, kind: BugDetailDisplayKind, value: unknown): string {
    const lowerKey = String(key || '').toLowerCase()
    if (value == null) return '-'
    if (kind === 'datetime') return formatTime(String(value))
    if (kind === 'pre') {
      if (typeof value === 'string') return value
      try {
        return JSON.stringify(value, null, 2)
      } catch {
        return String(value)
      }
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    if (typeof value === 'number' && /(score|rate|ratio|similarity)/.test(lowerKey)) return value.toFixed(3)
    return String(value)
  }

  function sortBugDetailKeyWeight(key: string): number {
    const rootKey = String(key || '').split('.')[0]
    const index = BUG_DETAIL_FIELD_ORDER.findIndex((name) => name === rootKey)
    return index >= 0 ? index : BUG_DETAIL_FIELD_ORDER.length + 1
  }

  const bugInboxDetailFields = computed<BugDetailField[]>(() => {
    const item = selectedBugInboxItem.value
    if (!item) return []

    const flattened = flattenBugDetailEntries(item as unknown as Record<string, unknown>)
      .filter((entry) => entry.key)
      .filter((entry) => entry.value !== undefined)
      .filter((entry) => !shouldHideBugDetailField(entry.key))

    return flattened
      .map((entry) => {
        const kind = inferBugDetailKind(entry.key, entry.value)
        const display = formatBugDetailValue(entry.key, kind, entry.value)
        return {
          key: entry.key,
          label: buildBugDetailLabel(entry.key),
          kind,
          display,
          raw: entry.value,
          copyable: display !== '-',
          href: kind === 'link' ? buildBugDetailHref(entry.key, entry.value) : undefined,
        }
      })
      .sort((a, b) => {
        const weightDiff = sortBugDetailKeyWeight(a.key) - sortBugDetailKeyWeight(b.key)
        if (weightDiff !== 0) return weightDiff
        return a.key.localeCompare(b.key, 'zh-CN')
      })
  })

  async function copyBugDetailField(value: string) {
    const text = String(value || '').trim()
    if (!text || text === '-') return
    try {
      await navigator.clipboard.writeText(text)
      notify('字段值已复制', 'success')
    } catch {
      notify('复制失败，请检查浏览器权限', 'danger')
    }
  }

  function openBugInboxDetail(bug: BugInboxItem) {
    selectedBugInboxItem.value = bug
    bugInboxDetailModalOpen.value = true
  }

  function closeBugInboxDetail() {
    bugInboxDetailModalOpen.value = false
    selectedBugInboxItem.value = null
  }

  return {
    bugInboxItems,
    bugInboxCopiedId,
    bugInboxError,
    bugInboxLoading,
    bugInboxDeleteConfirmOpen,
    bugInboxDeletingId,
    bugInboxUpdatingId,
    bugInboxPendingDelete,
    bugInboxSavingKey,
    bugInboxDraftByPatchKey,

    feishuBindModalOpen,
    feishuBindTargetBug,
    feishuBindCandidates,
    feishuBindLoading,
    feishuBindError,
    feishuBindLinkingKey,
    feishuBindSelectedCandidateKey,

    selectedBugInboxItem,
    bugInboxDetailModalOpen,

    feishuScheduleDataFilter,
    feishuTodoItems,
    feishuTodoError,
    feishuTodoLoading,
    feishuDefectItems,
    feishuDefectError,
    feishuDefectLoading,
    feishuTodoSelectedIds,
    feishuBatchModalOpen,
    feishuBatchAction,
    feishuBatchRollbackReason,
    feishuBatchLoading,
    feishuBatchError,
    feishuBatchResultText,
    feishuTodoNextStepLoadingId,

    selectedFeishuTodos,
    allFeishuTodoSelected,
    isFeishuScheduleTodoView,
    isFeishuScheduleDefectView,

    bugInboxColumns,
    feishuTodoColumns,
    BUG_INBOX_COLUMN_WIDTHS_STORAGE_KEY,
    FEISHU_TODO_COLUMN_WIDTHS_STORAGE_KEY,

    loadBugInbox,
    loadFeishuTodoList,
    loadFeishuDefectList,
    setFeishuScheduleDataFilter,
    toggleFeishuTodoSelection,
    toggleSelectAllFeishuTodos,
    openFeishuBatchModal,
    closeFeishuBatchModal,
    submitFeishuBatchTransition,
    runFeishuTodoNextStep,

    asBugInboxRow,
    asFeishuTodoRow,

    getBugInboxFeishuLink,
    getBugBindStatus,
    getBugBindTime,
    getBugBoundTitle,
    getBugBoundOwner,
    formatFeishuTodoSchedule,
    getFeishuTodoDeadlineStatus,

    getFeishuCandidateKey,
    isFeishuCandidateSelected,
    selectFeishuCandidate,
    getFeishuCandidateReporter,
    getFeishuCandidateCreatedAt,
    getFeishuCandidateRequirement,
    getFeishuCandidateDiscoveryStage,
    getFeishuCandidateSeverity,
    getFeishuCandidateCategory,
    getFeishuCandidateSeverityLevel,
    getFeishuCandidateStatusTone,
    getFeishuCandidateAvatarText,
    openFeishuCandidateUrl,
    isFeishuCurrentBoundCandidate,

    openFeishuBindModal,
    closeFeishuBindModal,
    confirmFeishuBindSelection,

    openBugInboxDeleteConfirm,
    closeBugInboxDeleteConfirm,
    confirmDeleteBugInbox,
    updateBugInboxDescription,
    saveBugToInbox,
    copyBugInboxId,

    bugInboxDetailFields,
    copyBugDetailField,
    openBugInboxDetail,
    closeBugInboxDetail,
  }
}
