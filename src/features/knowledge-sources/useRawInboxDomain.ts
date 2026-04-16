import { computed, ref } from 'vue'
import type {
  KnowledgeItemDto,
  KnowledgeItemsApi,
  KnowledgeStatsDto,
  OpenClawKnowledgeSyncResultDto,
} from '@/services/kbApiServices'

type KnowledgeSourceType = 'capture' | 'note' | 'document'
type KnowledgeStatus = 'draft' | 'active' | 'archived'
type KnowledgeSourceTypeFilter = 'all' | KnowledgeSourceType
type KnowledgeStatusFilter = 'all' | 'visible' | KnowledgeStatus
type KnowledgeIntakeStage = 'inbox' | 'needs-context' | 'search-candidate' | 'wiki-candidate' | 'reference-only'
type KnowledgeConfidence = 'low' | 'medium' | 'high'
type KnowledgeIntakeStageFilter = 'all' | KnowledgeIntakeStage
type KnowledgeConfidenceFilter = 'all' | KnowledgeConfidence
type QuickCaptureMode = 'single' | 'batch'
type KnowledgeBatchImportDuplicateMode = 'merge' | 'skip' | 'keep'
type KnowledgeBatchImportAction = 'create' | 'merge' | 'skip'
type KnowledgeItemSavePayload = Partial<KnowledgeItemDto> & { tags?: string[] | string }
type KnowledgeBatchImportDuplicate = {
  id: string
  title: string
  score: number
  reason: string
  source: 'existing' | 'batch'
}
type KnowledgeBatchImportDraft = {
  importId: string
  id?: string
  sourceType: KnowledgeSourceType
  sourceSubtype: string
  status: KnowledgeStatus
  title: string
  content: string
  summary: string
  sourceUrl: string
  sourceFile: string
  tags: string[]
  meta: Record<string, unknown>
  project: string
  topic: string
  intakeStage: KnowledgeIntakeStage
  confidence: KnowledgeConfidence
  keyQuestion: string
  decisionNote: string
}
type KnowledgeBatchImportRow = KnowledgeBatchImportDraft & {
  duplicates: KnowledgeBatchImportDuplicate[]
  duplicateScore: number
  duplicateAction: KnowledgeBatchImportAction
  duplicateTargetId: string
  skipped: boolean
}

export type {
  KnowledgeSourceType,
  KnowledgeStatus,
  KnowledgeSourceTypeFilter,
  KnowledgeStatusFilter,
  KnowledgeIntakeStage,
  KnowledgeConfidence,
  KnowledgeIntakeStageFilter,
  KnowledgeConfidenceFilter,
  QuickCaptureMode,
  KnowledgeBatchImportDuplicateMode,
  KnowledgeBatchImportAction,
  KnowledgeItemSavePayload,
  KnowledgeBatchImportDuplicate,
  KnowledgeBatchImportDraft,
  KnowledgeBatchImportRow,
}

interface UseRawInboxDomainOptions {
  service: KnowledgeItemsApi
  notify: (message: string, tone?: 'info' | 'success' | 'warning' | 'danger') => void
  onQuickCaptureSaved?: (item: KnowledgeItemDto) => void
  loadPromotionQueue: (force?: boolean) => Promise<void>
}

const EMPTY_STATS: KnowledgeStatsDto = {
  total: 0,
  draft: 0,
  active: 0,
  archived: 0,
  byType: {
    capture: 0,
    note: 0,
    document: 0,
  },
}

const SUBTYPE_SUGGESTIONS: Record<KnowledgeSourceType, string[]> = {
  capture: ['manual', 'web-clip', 'chat-snippet', 'terminal', 'meeting'],
  note: ['daily-note', 'reflection', 'decision', 'todo', 'hypothesis'],
  document: ['article', 'pdf', 'readme', 'spec', 'meeting-notes'],
}

const INTAKE_STAGE_OPTIONS: Array<{ value: KnowledgeIntakeStage; label: string; description: string }> = [
  { value: 'inbox', label: 'Inbox', description: '刚收进来，还没有判断后续用途。' },
  { value: 'needs-context', label: '补上下文', description: '缺项目、来源、问题背景或证据范围。' },
  { value: 'search-candidate', label: '进主检索', description: '适合作为问答检索材料，但还不急着写 wiki。' },
  { value: 'wiki-candidate', label: '进 Wiki 编译', description: '已经接近 issue / pattern / synthesis 的原料。' },
  { value: 'reference-only', label: '仅参考', description: '保留出处，默认不进入主流程。' },
]

const CONFIDENCE_OPTIONS: Array<{ value: KnowledgeConfidence; label: string; description: string }> = [
  { value: 'low', label: '低', description: '只是一条线索，需要回源确认。' },
  { value: 'medium', label: '中', description: '基本可用，但还缺少独立补证。' },
  { value: 'high', label: '高', description: '来源清楚，内容稳定，可以进入后续流程。' },
]

export { INTAKE_STAGE_OPTIONS, CONFIDENCE_OPTIONS }

function toTagsInput(tags: string[]) {
  return (Array.isArray(tags) ? tags : []).join(', ')
}

function parseTagsInput(value: string) {
  return [...new Set(
    String(value || '')
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
  )]
}

function inferDefaultSubtype(sourceType: KnowledgeSourceType) {
  return SUBTYPE_SUGGESTIONS[sourceType]?.[0] || 'manual'
}

function normalizeKnowledgeSourceType(value: unknown): KnowledgeSourceType {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'note' || normalized === 'document') return normalized
  return 'capture'
}

function normalizeKnowledgeStatus(value: unknown): KnowledgeStatus {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'active' || normalized === 'archived') return normalized
  return 'draft'
}

function normalizeIntakeStage(value: unknown): KnowledgeIntakeStage {
  const normalized = String(value || '').trim()
  return INTAKE_STAGE_OPTIONS.some((item) => item.value === normalized) ? normalized as KnowledgeIntakeStage : 'inbox'
}

function normalizeConfidence(value: unknown): KnowledgeConfidence {
  const normalized = String(value || '').trim()
  return CONFIDENCE_OPTIONS.some((item) => item.value === normalized) ? normalized as KnowledgeConfidence : 'medium'
}

function getKnowledgeMetaString(item: KnowledgeItemDto | null | undefined, key: string) {
  const value = item?.meta?.[key]
  return String(value || '').trim()
}

function buildKnowledgeItemMeta(base: unknown, payload: {
  project: string
  topic: string
  intakeStage: KnowledgeIntakeStage
  confidence: KnowledgeConfidence
  keyQuestion: string
  decisionNote: string
}) {
  const previous = base && typeof base === 'object' && !Array.isArray(base) ? base as Record<string, unknown> : {}
  return {
    ...previous,
    project: payload.project,
    topic: payload.topic,
    intakeStage: payload.intakeStage,
    confidence: payload.confidence,
    keyQuestion: payload.keyQuestion,
    decisionNote: payload.decisionNote,
  }
}

function normalizeFingerprintText(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[，。！？；：""''、,.!?;:"'()[\]{}<>]/g, '')
    .trim()
}

function buildKnowledgeFingerprint(value: unknown) {
  return normalizeFingerprintText(value).slice(0, 360)
}

function buildKnowledgeContentTitle(content: string, fallback = '未命名片段') {
  const firstLine = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  if (!firstLine) return fallback
  return firstLine.slice(0, 60)
}

function normalizeImportTags(value: unknown) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
  }
  return parseTagsInput(String(value || ''))
}

function buildDuplicateMatches(
  input: { id?: string, title?: string, content?: string, sourceUrl?: string },
  candidates: Array<{ id?: string, title?: string, content?: string, sourceUrl?: string, source: 'existing' | 'batch' }>,
): KnowledgeBatchImportDuplicate[] {
  const currentId = String(input.id || '').trim()
  const sourceUrl = String(input.sourceUrl || '').trim().toLowerCase()
  const titleFingerprint = buildKnowledgeFingerprint(input.title)
  const contentFingerprint = buildKnowledgeFingerprint(input.content)
  if (!sourceUrl && !titleFingerprint && !contentFingerprint) return []

  return candidates
    .filter((item) => !currentId || String(item.id || '').trim() !== currentId)
    .map((item) => {
      const itemUrl = String(item.sourceUrl || '').trim().toLowerCase()
      const itemTitleFingerprint = buildKnowledgeFingerprint(item.title)
      const itemContentFingerprint = buildKnowledgeFingerprint(item.content)
      let score = 0
      const reasons: string[] = []
      if (sourceUrl && itemUrl && sourceUrl === itemUrl) {
        score += 90
        reasons.push('来源链接一致')
      }
      if (titleFingerprint && itemTitleFingerprint && titleFingerprint === itemTitleFingerprint) {
        score += 55
        reasons.push('标题一致')
      }
      if (contentFingerprint && itemContentFingerprint) {
        if (contentFingerprint === itemContentFingerprint) {
          score += 80
          reasons.push('内容一致')
        } else if (
          contentFingerprint.length >= 48
          && itemContentFingerprint.length >= 48
          && (contentFingerprint.includes(itemContentFingerprint.slice(0, 80)) || itemContentFingerprint.includes(contentFingerprint.slice(0, 80)))
        ) {
          score += 42
          reasons.push('内容开头相近')
        }
      }
      return {
        id: String(item.id || ''),
        title: String(item.title || '未命名条目'),
        score,
        reason: reasons.join('、'),
        source: item.source,
      }
    })
    .filter((candidate) => candidate.score >= 42)
    .sort((a, b) => b.score - a.score)
}

function normalizeBatchImportItem(value: unknown, index: number): KnowledgeBatchImportDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const meta = raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta) ? raw.meta as Record<string, unknown> : {}
  const sourceType = normalizeKnowledgeSourceType(raw.sourceType || raw.source_type)
  const content = String(raw.content || raw.body || raw.text || '').trim()
  const title = String(raw.title || '').trim() || buildKnowledgeContentTitle(content, `导入条目 ${index + 1}`)
  if (!title && !content) return null
  const intakeStage = normalizeIntakeStage(meta.intakeStage || raw.intakeStage)
  const confidence = normalizeConfidence(meta.confidence || raw.confidence)
  const project = String(meta.project || raw.project || '').trim()
  const topic = String(meta.topic || raw.topic || '').trim()
  const keyQuestion = String(meta.keyQuestion || raw.keyQuestion || '').trim()
  const decisionNote = String(meta.decisionNote || raw.decisionNote || '').trim()

  return {
    importId: `import-${index}`,
    id: String(raw.id || '').trim() || undefined,
    sourceType,
    sourceSubtype: String(raw.sourceSubtype || raw.source_subtype || '').trim().toLowerCase() || inferDefaultSubtype(sourceType),
    status: normalizeKnowledgeStatus(raw.status),
    title,
    content,
    summary: String(raw.summary || '').trim(),
    sourceUrl: String(raw.sourceUrl || raw.source_url || '').trim(),
    sourceFile: String(raw.sourceFile || raw.source_file || '').trim(),
    tags: normalizeImportTags(raw.tags),
    meta,
    project,
    topic,
    intakeStage,
    confidence,
    keyQuestion,
    decisionNote,
  }
}

function parseKnowledgeBatchImportText(value: unknown): { drafts: KnowledgeBatchImportDraft[], error: string } {
  const normalized = String(value || '').trim()
  if (!normalized) return { drafts: [], error: '' }
  try {
    const parsed = JSON.parse(normalized)
    const items: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.items)
        ? parsed.items
        : []
    if (!items.length) {
      return { drafts: [], error: 'JSON 需要是数组，或包含 items 数组。' }
    }
    return {
      drafts: items
        .map((item, index) => normalizeBatchImportItem(item, index))
        .filter((item): item is KnowledgeBatchImportDraft => Boolean(item)),
      error: '',
    }
  } catch (error) {
    return { drafts: [], error: String(error instanceof Error ? error.message : error || 'JSON 解析失败') }
  }
}

function mergeKnowledgeText(base: unknown, extra: unknown, heading: string) {
  const baseText = String(base || '').trim()
  const extraText = String(extra || '').trim()
  if (!extraText) return baseText
  if (!baseText) return extraText
  const baseFingerprint = buildKnowledgeFingerprint(baseText)
  const extraFingerprint = buildKnowledgeFingerprint(extraText)
  if (
    baseFingerprint === extraFingerprint
    || (baseFingerprint.length >= 48 && extraFingerprint.length >= 48 && baseFingerprint.includes(extraFingerprint.slice(0, 80)))
  ) {
    return baseText
  }
  return `${baseText}\n\n${heading}\n\n${extraText}`
}

function mergeKnowledgeInlineText(base: unknown, extra: unknown) {
  const baseText = String(base || '').trim()
  const extraText = String(extra || '').trim()
  if (!extraText) return baseText
  if (!baseText) return extraText
  if (baseText === extraText || baseText.includes(extraText)) return baseText
  return `${baseText}；${extraText}`
}

function buildBatchImportSavePayload(row: KnowledgeBatchImportRow): KnowledgeItemSavePayload {
  return {
    id: row.id,
    sourceType: row.sourceType,
    sourceSubtype: row.sourceSubtype,
    status: row.status,
    title: row.title,
    content: row.content,
    summary: row.summary,
    sourceUrl: row.sourceUrl,
    sourceFile: row.sourceFile,
    tags: row.tags,
    meta: buildKnowledgeItemMeta(row.meta, {
      project: row.project,
      topic: row.topic,
      intakeStage: row.intakeStage,
      confidence: row.confidence,
      keyQuestion: row.keyQuestion,
      decisionNote: row.decisionNote,
    }),
  }
}

function buildBatchImportMergePayload(existing: KnowledgeItemDto, row: KnowledgeBatchImportRow): KnowledgeItemSavePayload {
  const existingProject = getKnowledgeMetaString(existing, 'project')
  const existingTopic = getKnowledgeMetaString(existing, 'topic')
  const existingKeyQuestion = getKnowledgeMetaString(existing, 'keyQuestion')
  const existingDecisionNote = getKnowledgeMetaString(existing, 'decisionNote')
  const title = String(existing.title || '').trim() || row.title
  const contentHeading = row.title && row.title !== title ? `补充采集：${row.title}` : '补充采集'
  return {
    id: existing.id,
    sourceType: existing.sourceType,
    sourceSubtype: existing.sourceSubtype || row.sourceSubtype,
    status: existing.status,
    title,
    content: mergeKnowledgeText(existing.content, row.content, contentHeading),
    summary: mergeKnowledgeText(existing.summary, row.summary, '补充摘要'),
    sourceUrl: existing.sourceUrl || row.sourceUrl,
    sourceFile: existing.sourceFile || row.sourceFile,
    tags: [...new Set([...(existing.tags || []), ...row.tags].map((item) => String(item || '').trim()).filter(Boolean))],
    meta: buildKnowledgeItemMeta(existing.meta, {
      project: existingProject || row.project,
      topic: existingTopic || row.topic,
      intakeStage: normalizeIntakeStage(existing.meta?.intakeStage || row.intakeStage),
      confidence: normalizeConfidence(existing.meta?.confidence || row.confidence),
      keyQuestion: mergeKnowledgeInlineText(existingKeyQuestion, row.keyQuestion),
      decisionNote: mergeKnowledgeInlineText(existingDecisionNote, row.decisionNote),
    }),
  }
}

function parseQuickCaptureBatchEntries(value: unknown) {
  const normalized = String(value || '').replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  const chunks = normalized
    .split(/\n{2,}/u)
    .map((chunk) => chunk.trim())
    .filter(Boolean)

  return chunks.map((content, index) => ({
    id: `batch-${index}`,
    title: buildKnowledgeContentTitle(content, `批量片段 ${index + 1}`),
    content,
  }))
}

function extractContentPreview(text: string) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return '还没有内容，适合先把零散片段粘进来。'
  return normalized.slice(0, 140)
}

function clipText(value: string, limit = 160) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

export function useRawInboxDomain(options: UseRawInboxDomainOptions) {
  const knowledgeItems = ref<KnowledgeItemDto[]>([])
  const knowledgeStats = ref<KnowledgeStatsDto>({ ...EMPTY_STATS, byType: { ...EMPTY_STATS.byType } })
  const knowledgeLoading = ref(false)
  const knowledgeSaving = ref(false)
  const knowledgeItemsLoadedAt = ref(0)
  const selectedKnowledgeItemId = ref('')
  const knowledgeSourceTypeFilter = ref<KnowledgeSourceTypeFilter>('all')
  const knowledgeStatusFilter = ref<KnowledgeStatusFilter>('visible')
  const knowledgeIntakeStageFilter = ref<KnowledgeIntakeStageFilter>('all')
  const knowledgeConfidenceFilter = ref<KnowledgeConfidenceFilter>('all')
  const knowledgeKeyword = ref('')

  const editorId = ref('')
  const editorSourceType = ref<KnowledgeSourceType>('capture')
  const editorSourceSubtype = ref(inferDefaultSubtype('capture'))
  const editorStatus = ref<KnowledgeStatus>('draft')
  const editorTitle = ref('')
  const editorContent = ref('')
  const editorSourceUrl = ref('')
  const editorSourceFile = ref('')
  const editorTagsInput = ref('')
  const editorProject = ref('')
  const editorTopic = ref('')
  const editorIntakeStage = ref<KnowledgeIntakeStage>('inbox')
  const editorConfidence = ref<KnowledgeConfidence>('medium')
  const editorKeyQuestion = ref('')
  const editorDecisionNote = ref('')
  const quickCaptureOpen = ref(false)
  const quickCaptureSaving = ref(false)
  const quickCaptureMode = ref<QuickCaptureMode>('single')
  const quickCaptureSourceType = ref<KnowledgeSourceType>('capture')
  const quickCaptureTitle = ref('')
  const quickCaptureContent = ref('')
  const quickCaptureSourceUrl = ref('')
  const quickCaptureTagsInput = ref('')
  const quickCaptureMarkActive = ref(false)
  const quickCaptureProject = ref('')
  const quickCaptureTopic = ref('')
  const quickCaptureIntakeStage = ref<KnowledgeIntakeStage>('inbox')
  const quickCaptureConfidence = ref<KnowledgeConfidence>('medium')
  const quickCaptureDecisionNote = ref('')
  const batchImportOpen = ref(false)
  const batchImportText = ref('')
  const batchImportDuplicateMode = ref<KnowledgeBatchImportDuplicateMode>('merge')
  const batchImportSaving = ref(false)
  const openClawSyncOpen = ref(false)
  const openClawSyncLoading = ref(false)
  const openClawSyncImporting = ref(false)
  const openClawSyncPreview = ref<OpenClawKnowledgeSyncResultDto | null>(null)
  const openClawSyncError = ref('')

  const sourceTypeOptions = [
    { value: 'capture' as const, label: 'Capture', description: '零散片段、网页摘录、聊天摘录、命令输出' },
    { value: 'note' as const, label: 'Note', description: '你自己的判断、灵感、结论、待验证猜想' },
    { value: 'document' as const, label: 'Document', description: '更完整的文档、方案、README、会议纪要' },
  ]

  const statusOptions = [
    { value: 'draft' as const, label: 'Draft' },
    { value: 'active' as const, label: 'Active' },
    { value: 'archived' as const, label: 'Archived' },
  ]
  const intakeStageOptions = INTAKE_STAGE_OPTIONS
  const confidenceOptions = CONFIDENCE_OPTIONS

  const subtypeSuggestions = computed(() => SUBTYPE_SUGGESTIONS[editorSourceType.value] || [])
  const selectedKnowledgeItem = computed(() =>
    knowledgeItems.value.find((item) => item.id === selectedKnowledgeItemId.value) || null,
  )
  const filteredKnowledgeItems = computed(() =>
    knowledgeItems.value.filter((item) => {
      if (knowledgeIntakeStageFilter.value !== 'all' && normalizeIntakeStage(item?.meta?.intakeStage) !== knowledgeIntakeStageFilter.value) {
        return false
      }
      if (knowledgeConfidenceFilter.value !== 'all' && normalizeConfidence(item?.meta?.confidence) !== knowledgeConfidenceFilter.value) {
        return false
      }
      return true
    }),
  )
  const editorIntakeStageOption = computed(() =>
    intakeStageOptions.find((item) => item.value === editorIntakeStage.value) || intakeStageOptions[0],
  )
  const editorConfidenceOption = computed(() =>
    confidenceOptions.find((item) => item.value === editorConfidence.value) || confidenceOptions[1],
  )
  const editorIntakeSummary = computed(() => {
    const project = String(editorProject.value || '').trim()
    const topic = String(editorTopic.value || '').trim()
    const question = String(editorKeyQuestion.value || '').trim()
    const parts = [
      editorIntakeStageOption.value?.label ? `去向：${editorIntakeStageOption.value.label}` : '',
      editorConfidenceOption.value?.label ? `可信度：${editorConfidenceOption.value.label}` : '',
      project ? `项目：${project}` : '项目待确认',
      topic ? `主题：${topic}` : '',
      question ? `问题：${clipText(question, 72)}` : '',
    ].filter(Boolean)
    return parts.join(' · ')
  })

  const rawSummaryCards = computed(() => ([
    {
      id: 'capture',
      title: '零散片段',
      count: knowledgeStats.value.byType.capture,
      description: '先接住一段话、一段日志或一个链接',
    },
    {
      id: 'note',
      title: '主观笔记',
      count: knowledgeStats.value.byType.note,
      description: '把你的判断和假设与原始事实分层保存',
    },
    {
      id: 'document',
      title: '完整文档',
      count: knowledgeStats.value.byType.document,
      description: '面向长期沉淀的正式材料入口',
    },
    {
      id: 'active',
      title: '活跃条目',
      count: knowledgeStats.value.active,
      description: '后续最适合被编译进 wiki 的候选',
    },
    {
      id: 'needs-context',
      title: '待补上下文',
      count: knowledgeItems.value.filter((item) => normalizeIntakeStage(item?.meta?.intakeStage) === 'needs-context').length,
      description: '先补项目、来源和核心问题',
    },
    {
      id: 'wiki-candidate',
      title: 'Wiki 原料',
      count: knowledgeItems.value.filter((item) => normalizeIntakeStage(item?.meta?.intakeStage) === 'wiki-candidate').length,
      description: '下一步可进入编译和升格',
    },
  ]))

  const editorPreview = computed(() => extractContentPreview(editorContent.value))
  const quickCapturePreview = computed(() => extractContentPreview(quickCaptureContent.value))
  const quickCaptureBatchEntries = computed(() => parseQuickCaptureBatchEntries(quickCaptureContent.value))
  const quickCaptureCanSave = computed(() =>
    quickCaptureMode.value === 'batch'
      ? quickCaptureBatchEntries.value.length > 0
      : Boolean(String(quickCaptureTitle.value || '').trim() || String(quickCaptureContent.value || '').trim()),
  )
  const quickCaptureSummary = computed(() => {
    if (quickCaptureMode.value === 'batch') {
      const count = quickCaptureBatchEntries.value.length
      return count ? `将拆成 ${count} 条采集项` : '用空行分隔多条片段'
    }
    return quickCapturePreview.value
  })
  const batchImportParsed = computed(() => parseKnowledgeBatchImportText(batchImportText.value))
  const batchImportRows = computed<KnowledgeBatchImportRow[]>(() => {
    const drafts = batchImportParsed.value.drafts
    return drafts.map((draft, index) => {
      const candidates = [
        ...knowledgeItems.value.map((item) => ({
          id: item.id,
          title: item.title,
          content: item.content,
          sourceUrl: item.sourceUrl,
          source: 'existing' as const,
        })),
        ...drafts.slice(0, index).map((item) => ({
          id: item.id || item.importId,
          title: item.title,
          content: item.content,
          sourceUrl: item.sourceUrl,
          source: 'batch' as const,
        })),
      ]
      const duplicates = buildDuplicateMatches(draft, candidates).slice(0, 3)
      const topDuplicate = duplicates[0] || null
      const duplicateScore = topDuplicate?.score || 0
      const duplicateTargetId = topDuplicate?.source === 'existing' ? topDuplicate.id : ''
      const duplicateAction: KnowledgeBatchImportAction = duplicateScore < 42
        ? 'create'
        : batchImportDuplicateMode.value === 'skip'
          ? 'skip'
          : batchImportDuplicateMode.value === 'merge'
            ? duplicateTargetId
              ? 'merge'
              : 'skip'
            : 'create'
      return {
        ...draft,
        duplicates,
        duplicateScore,
        duplicateAction,
        duplicateTargetId,
        skipped: duplicateAction === 'skip',
      }
    })
  })
  const batchImportReadyCount = computed(() => batchImportRows.value.filter((item) => !item.skipped).length)
  const batchImportDuplicateCount = computed(() => batchImportRows.value.filter((item) => item.duplicateScore >= 42).length)
  const batchImportMergeCount = computed(() => batchImportRows.value.filter((item) => item.duplicateAction === 'merge').length)
  const openClawSyncRows = computed(() => Array.isArray(openClawSyncPreview.value?.rows) ? openClawSyncPreview.value.rows : [])
  const openClawSyncSummary = computed(() => openClawSyncPreview.value?.summary || {
    total: 0,
    new: 0,
    changed: 0,
    unchanged: 0,
    missing: 0,
    imported: 0,
    archived: 0,
    skipped: 0,
    failed: 0,
    issues: 0,
  })
  const openClawSyncCanImport = computed(() => {
    return Boolean(openClawSyncPreview.value && !openClawSyncError.value)
  })
  const editorDuplicateCandidates = computed(() => {
    const currentId = String(editorId.value || selectedKnowledgeItemId.value || '').trim()
    const sourceUrl = String(editorSourceUrl.value || '').trim().toLowerCase()
    const titleFingerprint = buildKnowledgeFingerprint(editorTitle.value)
    const contentFingerprint = buildKnowledgeFingerprint(editorContent.value)
    if (!sourceUrl && !titleFingerprint && !contentFingerprint) return []

    return buildDuplicateMatches(
      { id: currentId, title: editorTitle.value, content: editorContent.value, sourceUrl: editorSourceUrl.value },
      knowledgeItems.value.map((item) => ({
        id: item.id,
        title: item.title,
        content: item.content,
        sourceUrl: item.sourceUrl,
        source: 'existing' as const,
      })),
    )
      .map((candidate) => ({
        item: knowledgeItems.value.find((item) => item.id === candidate.id),
        score: candidate.score,
        reason: candidate.reason,
      }))
      .filter((candidate) => candidate.item)
      .slice(0, 3)
  })

  function resetEditor(sourceType: KnowledgeSourceType = 'capture') {
    editorId.value = ''
    editorSourceType.value = sourceType
    editorSourceSubtype.value = inferDefaultSubtype(sourceType)
    editorStatus.value = 'draft'
    editorTitle.value = ''
    editorContent.value = ''
    editorSourceUrl.value = ''
    editorSourceFile.value = ''
    editorTagsInput.value = ''
    editorProject.value = ''
    editorTopic.value = ''
    editorIntakeStage.value = 'inbox'
    editorConfidence.value = 'medium'
    editorKeyQuestion.value = ''
    editorDecisionNote.value = ''
    selectedKnowledgeItemId.value = ''
  }

  function resetQuickCapture() {
    quickCaptureMode.value = 'single'
    quickCaptureSourceType.value = 'capture'
    quickCaptureTitle.value = ''
    quickCaptureContent.value = ''
    quickCaptureSourceUrl.value = ''
    quickCaptureTagsInput.value = ''
    quickCaptureMarkActive.value = false
    quickCaptureProject.value = ''
    quickCaptureTopic.value = ''
    quickCaptureIntakeStage.value = 'inbox'
    quickCaptureConfidence.value = 'medium'
    quickCaptureDecisionNote.value = ''
  }

  function resetBatchImport() {
    batchImportText.value = ''
    batchImportDuplicateMode.value = 'merge'
  }

  function resetOpenClawSync() {
    openClawSyncPreview.value = null
    openClawSyncError.value = ''
  }

  function openQuickCapture(sourceType: KnowledgeSourceType = 'capture') {
    quickCaptureSourceType.value = sourceType
    quickCaptureOpen.value = true
  }

  function openBatchImport() {
    batchImportOpen.value = true
  }

  async function openOpenClawSync() {
    openClawSyncOpen.value = true
    await previewOpenClawSync()
  }

  function closeQuickCapture(force = false) {
    if (quickCaptureSaving.value && !force) return
    quickCaptureOpen.value = false
    resetQuickCapture()
  }

  function closeBatchImport(force = false) {
    if (batchImportSaving.value && !force) return
    batchImportOpen.value = false
    resetBatchImport()
  }

  function closeOpenClawSync(force = false) {
    if ((openClawSyncLoading.value || openClawSyncImporting.value) && !force) return
    openClawSyncOpen.value = false
    resetOpenClawSync()
  }

  function applyItemToEditor(item: KnowledgeItemDto | null) {
    if (!item) {
      resetEditor('capture')
      return
    }
    selectedKnowledgeItemId.value = item.id
    editorId.value = item.id
    editorSourceType.value = item.sourceType
    editorSourceSubtype.value = String(item.sourceSubtype || inferDefaultSubtype(item.sourceType))
    editorStatus.value = item.status
    editorTitle.value = item.title
    editorContent.value = item.content
    editorSourceUrl.value = String(item.sourceUrl || '')
    editorSourceFile.value = String(item.sourceFile || '')
    editorTagsInput.value = toTagsInput(item.tags || [])
    editorProject.value = getKnowledgeMetaString(item, 'project')
    editorTopic.value = getKnowledgeMetaString(item, 'topic')
    editorIntakeStage.value = normalizeIntakeStage(item.meta?.intakeStage)
    editorConfidence.value = normalizeConfidence(item.meta?.confidence)
    editorKeyQuestion.value = getKnowledgeMetaString(item, 'keyQuestion')
    editorDecisionNote.value = getKnowledgeMetaString(item, 'decisionNote')
  }

  async function loadKnowledgeItems() {
    knowledgeLoading.value = true
    try {
      const result = await options.service.fetchItems({
        limit: 300,
        q: knowledgeKeyword.value,
        sourceType: knowledgeSourceTypeFilter.value,
        status: knowledgeStatusFilter.value,
      })
      knowledgeItems.value = Array.isArray(result?.items) ? result.items : []
      knowledgeStats.value = result?.stats || { ...EMPTY_STATS, byType: { ...EMPTY_STATS.byType } }

      if (editorId.value) {
        const matched = knowledgeItems.value.find((item) => item.id === editorId.value) || null
        if (matched) {
          applyItemToEditor(matched)
          return
        }
      }

      if (selectedKnowledgeItemId.value) {
        const selected = knowledgeItems.value.find((item) => item.id === selectedKnowledgeItemId.value) || null
        if (selected) {
          applyItemToEditor(selected)
          return
        }
      }

      if (!editorTitle.value && !editorContent.value && knowledgeItems.value[0]) {
        applyItemToEditor(knowledgeItems.value[0])
      }
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '加载失败'), 'danger')
    } finally {
      knowledgeItemsLoadedAt.value = Date.now()
      knowledgeLoading.value = false
    }
  }

  async function previewOpenClawSync() {
    if (openClawSyncLoading.value || openClawSyncImporting.value) return
    openClawSyncLoading.value = true
    openClawSyncError.value = ''
    try {
      openClawSyncPreview.value = await options.service.previewOpenClaw()
    } catch (error) {
      openClawSyncPreview.value = null
      openClawSyncError.value = String(error instanceof Error ? error.message : error || 'OpenClaw 预览失败')
      options.notify(openClawSyncError.value, 'danger')
    } finally {
      openClawSyncLoading.value = false
    }
  }

  async function importOpenClawSync() {
    if (openClawSyncImporting.value || openClawSyncLoading.value) return
    openClawSyncImporting.value = true
    openClawSyncError.value = ''
    try {
      const result = await options.service.importOpenClaw()
      openClawSyncPreview.value = result
      await Promise.all([
        loadKnowledgeItems(),
        options.loadPromotionQueue(true),
      ])
      const summary = result.summary || {}
      const promotionTotal = Number(result.promotionQueue?.summary?.totalItems || 0)
      options.notify(
        `OpenClaw 同步完成：导入 ${Number(summary.imported || 0)} 条，归档 ${Number(summary.archived || 0)} 条，跳过 ${Number(summary.skipped || 0)} 条，失败 ${Number(summary.failed || 0)} 条，升格候选 ${promotionTotal} 条`,
        Number(summary.failed || 0) > 0 ? 'warning' : 'success',
      )
    } catch (error) {
      openClawSyncError.value = String(error instanceof Error ? error.message : error || 'OpenClaw 同步失败')
      options.notify(openClawSyncError.value, 'danger')
    } finally {
      openClawSyncImporting.value = false
    }
  }

  function selectKnowledgeItem(item: KnowledgeItemDto) {
    applyItemToEditor(item)
  }

  function startNewKnowledgeItem(sourceType: KnowledgeSourceType = 'capture') {
    resetEditor(sourceType)
  }

  async function saveKnowledgeItem() {
    if (knowledgeSaving.value) return false
    knowledgeSaving.value = true
    try {
      const payload = {
        id: editorId.value || undefined,
        sourceType: editorSourceType.value,
        sourceSubtype: editorSourceSubtype.value,
        status: editorStatus.value,
        title: editorTitle.value,
        content: editorContent.value,
        sourceUrl: editorSourceUrl.value,
        sourceFile: editorSourceFile.value,
        tags: parseTagsInput(editorTagsInput.value),
        meta: buildKnowledgeItemMeta(selectedKnowledgeItem.value?.meta, {
          project: editorProject.value.trim(),
          topic: editorTopic.value.trim(),
          intakeStage: editorIntakeStage.value,
          confidence: editorConfidence.value,
          keyQuestion: editorKeyQuestion.value.trim(),
          decisionNote: editorDecisionNote.value.trim(),
        }),
      }
      const result = await options.service.saveItem(payload)
      const item = result?.item || null
      if (item) {
        applyItemToEditor(item)
      }
      options.notify(item?.id ? '知识条目已保存' : '知识条目已创建', 'success')
      await loadKnowledgeItems()
      return true
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '保存失败'), 'danger')
      return false
    } finally {
      knowledgeSaving.value = false
    }
  }

  async function updateKnowledgeItemStatus(status: KnowledgeStatus) {
    const targetId = editorId.value || selectedKnowledgeItemId.value
    if (!targetId || knowledgeSaving.value) return
    knowledgeSaving.value = true
    try {
      const result = await options.service.updateStatus({ id: targetId, status })
      if (result?.item) {
        applyItemToEditor(result.item)
      }
      options.notify(
        status === 'archived' ? '条目已归档' : status === 'active' ? '条目已激活' : '条目已改回草稿',
        'success',
      )
      await loadKnowledgeItems()
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '状态更新失败'), 'danger')
    } finally {
      knowledgeSaving.value = false
    }
  }

  async function deleteKnowledgeItem() {
    const targetId = editorId.value || selectedKnowledgeItemId.value
    if (!targetId || knowledgeSaving.value) return false
    knowledgeSaving.value = true
    try {
      await options.service.deleteItem(targetId)
      options.notify('条目已删除', 'success')
      resetEditor(editorSourceType.value)
      await loadKnowledgeItems()
      return true
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '删除失败'), 'danger')
      return false
    } finally {
      knowledgeSaving.value = false
    }
  }

  async function saveQuickCapture() {
    if (quickCaptureSaving.value || !quickCaptureCanSave.value) return
    quickCaptureSaving.value = true
    try {
      const tags = parseTagsInput(quickCaptureTagsInput.value)
      const sharedMeta = buildKnowledgeItemMeta({}, {
        project: quickCaptureProject.value.trim(),
        topic: quickCaptureTopic.value.trim(),
        intakeStage: quickCaptureIntakeStage.value,
        confidence: quickCaptureConfidence.value,
        keyQuestion: '',
        decisionNote: quickCaptureDecisionNote.value.trim(),
      })
      const entries = quickCaptureMode.value === 'batch'
        ? quickCaptureBatchEntries.value
        : [{
            id: 'single',
            title: String(quickCaptureTitle.value || '').trim(),
            content: String(quickCaptureContent.value || '').trim(),
          }]
      let lastItem: KnowledgeItemDto | null = null
      for (const [index, entry] of entries.entries()) {
        const entryTitle = String(quickCaptureTitle.value || '').trim()
          ? entries.length > 1
            ? `${quickCaptureTitle.value.trim()} ${index + 1}`
            : quickCaptureTitle.value.trim()
          : entry.title
        const result = await options.service.saveItem({
          sourceType: quickCaptureSourceType.value,
          sourceSubtype: inferDefaultSubtype(quickCaptureSourceType.value),
          status: quickCaptureMarkActive.value ? 'active' : 'draft',
          title: entryTitle,
          content: entry.content,
          sourceUrl: quickCaptureSourceUrl.value,
          tags,
          meta: sharedMeta,
        })
        const item = result?.item || null
        if (item) {
          lastItem = item
          options.onQuickCaptureSaved?.(item)
        }
      }
      if (lastItem) {
        applyItemToEditor(lastItem)
      }
      closeQuickCapture(true)
      await loadKnowledgeItems()
      options.notify(entries.length > 1 ? `已批量保存 ${entries.length} 条采集项` : '快速采集已保存', 'success')
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '快速采集失败'), 'danger')
    } finally {
      quickCaptureSaving.value = false
    }
  }

  async function saveBatchImport() {
    if (batchImportSaving.value) return
    const error = batchImportParsed.value.error
    if (error) {
      options.notify(`批量导入解析失败：${error}`, 'danger')
      return
    }
    const rows = batchImportRows.value.filter((item) => !item.skipped)
    if (!rows.length) {
      options.notify(batchImportRows.value.length ? '当前条目都被判定为重复，未导入。' : '没有可导入的条目。', 'warning')
      return
    }

    batchImportSaving.value = true
    let succeeded = 0
    let merged = 0
    let failed = 0
    let lastItem: KnowledgeItemDto | null = null
    try {
      for (const row of rows) {
        try {
          const existing = row.duplicateAction === 'merge'
            ? knowledgeItems.value.find((item) => item.id === row.duplicateTargetId) || null
            : null
          const result = await options.service.saveItem(
            existing ? buildBatchImportMergePayload(existing, row) : buildBatchImportSavePayload(row),
          )
          if (result?.item) {
            lastItem = result.item
            succeeded += 1
            if (existing) merged += 1
          }
        } catch {
          failed += 1
        }
      }

      const skipped = batchImportRows.value.length - rows.length
      if (lastItem) applyItemToEditor(lastItem)
      await loadKnowledgeItems()
      closeBatchImport(true)
      options.notify(
        failed
          ? `批量导入完成：处理 ${succeeded} 条，合并 ${merged} 条，失败 ${failed} 条，跳过 ${skipped} 条`
          : `已处理 ${succeeded} 条知识采集${merged ? `，合并 ${merged} 条` : ''}${skipped ? `，跳过 ${skipped} 条疑似重复` : ''}`,
        failed ? 'warning' : 'success',
      )
    } finally {
      batchImportSaving.value = false
    }
  }

  return {
    knowledgeItems,
    knowledgeStats,
    knowledgeLoading,
    knowledgeSaving,
    knowledgeItemsLoadedAt,
    selectedKnowledgeItemId,
    knowledgeSourceTypeFilter,
    knowledgeStatusFilter,
    knowledgeIntakeStageFilter,
    knowledgeConfidenceFilter,
    knowledgeKeyword,
    sourceTypeOptions,
    statusOptions,
    intakeStageOptions,
    confidenceOptions,
    subtypeSuggestions,
    selectedKnowledgeItem,
    filteredKnowledgeItems,
    editorIntakeStageOption,
    editorConfidenceOption,
    editorIntakeSummary,
    rawSummaryCards,
    editorId,
    editorSourceType,
    editorSourceSubtype,
    editorStatus,
    editorTitle,
    editorContent,
    editorSourceUrl,
    editorSourceFile,
    editorTagsInput,
    editorProject,
    editorTopic,
    editorIntakeStage,
    editorConfidence,
    editorKeyQuestion,
    editorDecisionNote,
    editorPreview,
    editorDuplicateCandidates,
    quickCaptureOpen,
    quickCaptureSaving,
    quickCaptureMode,
    quickCaptureSourceType,
    quickCaptureTitle,
    quickCaptureContent,
    quickCaptureSourceUrl,
    quickCaptureTagsInput,
    quickCaptureMarkActive,
    quickCaptureProject,
    quickCaptureTopic,
    quickCaptureIntakeStage,
    quickCaptureConfidence,
    quickCaptureDecisionNote,
    quickCapturePreview,
    quickCaptureBatchEntries,
    quickCaptureCanSave,
    quickCaptureSummary,
    batchImportOpen,
    batchImportText,
    batchImportDuplicateMode,
    batchImportSaving,
    batchImportRows,
    batchImportReadyCount,
    batchImportDuplicateCount,
    batchImportMergeCount,
    batchImportError: computed(() => batchImportParsed.value.error),
    openClawSyncOpen,
    openClawSyncLoading,
    openClawSyncImporting,
    openClawSyncPreview,
    openClawSyncRows,
    openClawSyncSummary,
    openClawSyncError,
    openClawSyncCanImport,
    loadKnowledgeItems,
    selectKnowledgeItem,
    startNewKnowledgeItem,
    saveKnowledgeItem,
    updateKnowledgeItemStatus,
    deleteKnowledgeItem,
    openQuickCapture,
    closeQuickCapture,
    saveQuickCapture,
    openBatchImport,
    closeBatchImport,
    saveBatchImport,
    openOpenClawSync,
    closeOpenClawSync,
    previewOpenClawSync,
    importOpenClawSync,
    resetEditor,
  }
}
