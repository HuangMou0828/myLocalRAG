<script setup lang="ts">
import { computed, nextTick, ref, unref } from 'vue'
import CodeSyntaxBlock from '@/components/CodeSyntaxBlock.vue'
import MarkdownContent from '@/components/MarkdownContent.vue'
import KnowledgeSourcesRawTab from './KnowledgeSourcesRawTab.vue'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import {
  IconCheck,
  IconDatabase,
  IconClock3,
  IconFileText,
  IconFolderOpen,
  IconLink2,
  IconListFilter,
  IconRefreshCw,
  IconSearch,
  IconSparkles,
  IconTriangleAlert,
  IconWrench,
} from '@/components/icons/app-icons'

type HealthRepairPreviewPayload = {
  path: string
  fromTarget: string
  toTarget: string
  replacedCount: number
  samples: Array<{
    line: number
    text: string
    before: string
    after: string
  }>
}

const props = defineProps<{ ctx: Record<string, any> }>()

const {
  isKnowledgeSourcesMode,
  knowledgeOverviewCollapsed,
  workbenchTab,
  workbenchHero,
  confidenceOptions,
  taskReviewLoading,
  taskReviewUpdatingId,
  taskReviewKeyword,
  taskReviewProviderFilter,
  taskReviewStatusFilter,
  taskReviewTypeFilter,
  taskReviewActionFilter,
  taskReviewAnswerFilter,
  taskReviewPromotionTargetFilter,
  taskReviewProviderOptions,
  taskReviewStatusOptions,
  taskReviewTypeOptions,
  taskReviewActionFilterOptions,
  taskReviewAnswerFilterOptions,
  taskReviewPromotionTargetOptions,
  taskReviewSessions,
  selectedTaskReviewSessionId,
  selectedTaskReviewSegmentId,
  selectedTaskReviewSession,
  selectedTaskReviewItem,
  promotionQueueLoading,
  promotionQueue,
  promotionApplyingKey,
  promotionPreviewOpen,
  promotionPreviewLoading,
  promotionPreviewError,
  promotionPreviewData,
  promotionViewerOpen,
  promotionViewerLoading,
  promotionViewerError,
  promotionViewerTitle,
  promotionViewerPaths,
  promotionViewerNotes,
  promotionViewerUnresolved,
  promotionMvpAutoLoading,
  promotionMvpAutoLastResult,
  healthLoading,
  wikiHealth,
  healthSeverityFilter,
  healthCodeFilter,
  healthKeyword,
  healthCodeOptions,
  filteredHealthFindings,
  healthFindingGroups,
  healthActionQueues,
  selectedHealthFinding,
  healthSuggestionState,
  healthBatchActionLoading,
  healthBatchActionLabel,
  healthRepairApplyingTarget,
  hasGbrainV2Service,
  gbrainV2Loading,
  gbrainV2Error,
  gbrainV2FeedStatus,
  gbrainV2FeedRefreshing,
  gbrainV2Settings,
  gbrainRetrieveQuery,
  gbrainRetrieveLoading,
  gbrainRetrieveResult,
  gbrainPromotionLoading,
  gbrainPromotionError,
  gbrainPromotionView,
  setWorkbenchTab,
  loadTaskReviewSessions,
  loadPromotionQueue,
  loadWikiHealth,
  loadGbrainV2FeedStatus,
  refreshGbrainV2Feed,
  loadGbrainV2PromotionView,
  runGbrainV2Retrieve,
  selectTaskReviewSession,
  selectTaskReviewSegment,
  selectHealthFinding,
  applyTaskReviewAction,
  applyPromotionCandidate,
  dismissPromotionCandidate,
  revokePromotionCandidate,
  previewPromotionCandidate,
  openPromotionEvidence,
  runMvpAutoPromotion,
  openHealthFindingNote,
  openHealthFindingEvidence,
  openHealthQueueNotes,
  openHealthQueueEvidence,
  loadHealthRepairSuggestions,
  loadHealthAnchorSuggestions,
  previewHealthRepairSuggestion,
  previewHealthAnchorSuggestion,
  batchDecideHealthStaleDraftIssues,
  applyHealthRepairPlan,
  applyHealthAnchorPlan,
  vaultRebuildLoading,
  triggerVaultRebuild,
  cleanHealthBrokenEvidence,
  closePromotionPreview,
  closePromotionViewer,
} = props.ctx

const isKnowledgeSourcesModeResolved = computed(() => Boolean(unref(isKnowledgeSourcesMode)))
const workbenchTabResolved = computed(() => {
  const current = String(unref(workbenchTab) || 'raw')
  return current
})
const workbenchHeroResolved = computed(() => unref(workbenchHero) || { eyebrow: '', title: '', description: '', cards: [] })
const confidenceOptionsResolved = computed(() => {
  const list = unref(confidenceOptions)
  return Array.isArray(list) ? list : []
})
const summaryCardsResolved = computed(() => {
  const list = workbenchHeroResolved.value.cards
  return Array.isArray(list) ? list : []
})
const heroExpanded = ref(false)
const isRawWorkbenchTabResolved = computed(() => workbenchTabResolved.value === 'raw')
const heroCanExpandResolved = computed(() =>
  isRawWorkbenchTabResolved.value && summaryCardsResolved.value.length > 0,
)
const heroCompactResolved = computed(() =>
  !isRawWorkbenchTabResolved.value || !heroExpanded.value,
)
const visibleSummaryCardsResolved = computed(() => {
  if (!isRawWorkbenchTabResolved.value) return summaryCardsResolved.value
  if (!heroCanExpandResolved.value || !heroExpanded.value) return []
  return summaryCardsResolved.value
})
const taskReviewSessionsResolved = computed(() => {
  const list = unref(taskReviewSessions)
  return Array.isArray(list) ? list : []
})
const selectedTaskReviewSessionResolved = computed(() => unref(selectedTaskReviewSession) || null)
const selectedTaskReviewItemResolved = computed(() => unref(selectedTaskReviewItem) || null)
const selectedTaskReviewSessionIdResolved = computed(() =>
  String(selectedTaskReviewSessionResolved.value?.id || unref(selectedTaskReviewSessionId) || ''),
)
const selectedTaskReviewSegmentIdResolved = computed(() =>
  String(unref(selectedTaskReviewSegmentId) || selectedTaskReviewItemResolved.value?.id || ''),
)
const selectedTaskSegmentsResolved = computed(() => {
  const list = selectedTaskReviewSessionResolved.value?.segments
  return Array.isArray(list) ? list : []
})
type TaskReviewQuickAction = 'keep-search' | 'promote-candidate' | 'archive-only' | 'ignore-noise'
type TaskReviewHeadTag = {
  label: string
  tone: 'status-strong' | 'status-neutral' | 'project-known' | 'project-pending'
}

const selectedTaskReviewHeadTagsResolved = computed(() => {
  const session = selectedTaskReviewSessionResolved.value
  if (!session) return []
  const reasoningParts = String(session.reasoning || '')
    .split('·')
    .map((item) => item.trim())
    .filter(Boolean)

  const tags = reasoningParts
    .map((part) => {
      if (/^自动合并为\s*\d+\s*个连续任务段$/u.test(part)) return null
      if (part === '当前会话看起来仍是单条连续任务') return null
      if (part === '主任务段已接近升格门槛') return { label: '接近升格', tone: 'status-strong' }
      if (part === '主任务段更适合先做筛选分流') return { label: '先做筛选', tone: 'status-neutral' }
      if (part.startsWith('项目归属偏向 ')) return { label: part.replace('项目归属偏向 ', ''), tone: 'project-known' }
      if (part === '项目归属仍需人工确认') return { label: '项目待确认', tone: 'project-pending' }
      return { label: part, tone: 'status-neutral' }
    })
    .filter((item): item is TaskReviewHeadTag => Boolean(item))

  if (session.isPromoteCandidate) {
    tags.unshift({ label: '已送升格', tone: 'status-strong' })
  }
  return tags
})
const currentTaskSegmentIndexResolved = computed(() =>
  Math.max(0, selectedTaskSegmentsResolved.value.findIndex((segment) => segment.id === selectedTaskReviewSegmentIdResolved.value)),
)
const canGoToPreviousSegmentResolved = computed(() =>
  selectedTaskSegmentsResolved.value.length > 1 && currentTaskSegmentIndexResolved.value > 0,
)
const canGoToNextSegmentResolved = computed(() =>
  selectedTaskSegmentsResolved.value.length > 1 && currentTaskSegmentIndexResolved.value < selectedTaskSegmentsResolved.value.length - 1,
)
const taskReviewConfirmOpen = ref(false)
const taskReviewConfirmAction = ref<TaskReviewQuickAction | ''>('')
const selectedTaskSignalsResolved = computed(() => {
  const item = selectedTaskReviewItemResolved.value
  if (!item) return []
  return [
    {
      id: 'context',
      label: '上下文完整度',
      caption: '越高越说明材料完整，后续判断更稳。',
      value: item.contextCompleteness,
      visualScore: item.contextCompleteness,
      accent: 'context',
      direction: 'higher',
    },
    {
      id: 'retrieval',
      label: '检索价值',
      caption: '越高越值得继续保留在主检索里。',
      value: item.retrievalValue,
      visualScore: item.retrievalValue,
      accent: 'retrieval',
      direction: 'higher',
    },
    {
      id: 'promotion',
      label: '升格价值',
      caption: '越高越适合进入 issue / pattern / synthesis 审核。',
      value: item.promotionValue,
      visualScore: item.promotionValue,
      accent: 'promotion',
      direction: 'higher',
    },
    {
      id: 'answer',
      label: '回答精华',
      caption: '越高越像可以单独留下来的答案页，而不只是过程记录。',
      value: item.answerValue,
      visualScore: item.answerValue,
      accent: 'answer',
      direction: 'higher',
    },
    {
      id: 'noise',
      label: '噪声风险',
      caption: '这里按反向刻度着色，风险越低越健康。',
      value: item.noiseRisk,
      visualScore: 100 - item.noiseRisk,
      accent: 'noise',
      direction: 'lower',
    },
  ]
})
const selectedTaskSignalSummaryResolved = computed(() => {
  const signals = selectedTaskSignalsResolved.value
  if (!signals.length) {
    return {
      score: 0,
      tone: 'weak',
      label: '暂无信号',
      helper: '等待选择任务段后计算综合判断',
    }
  }

  const score = Math.round(
    signals.reduce((total, signal) => total + Math.max(0, Math.min(100, Number(signal.visualScore || 0))), 0) / signals.length,
  )
  const item = selectedTaskReviewItemResolved.value
  const action = String(item?.recommendedAction || '')
  const label =
    action === 'promote-candidate'
      ? '适合升格'
      : action === 'keep-search'
        ? '保留检索'
        : action === 'archive-only'
          ? '建议归档'
          : action === 'ignore-noise'
            ? '噪声偏高'
            : score >= 75
              ? '信号健康'
              : score >= 55
                ? '需要复核'
                : '信号偏弱'

  return {
    score,
    tone: scoreTone(score),
    label,
    helper: '由上下文、检索、升格、回答与噪声风险折算',
  }
})
const selectedTaskSignalRadarResolved = computed(() => {
  const signals = selectedTaskSignalsResolved.value
  const center = 80
  const radius = 54
  const total = signals.length
  if (!total) {
    return {
      axes: [],
      areaPoints: '',
      gridPolygons: [],
    }
  }

  const axes = signals.map((signal, index) => {
    const score = clampTaskSignalScore(signal.visualScore)
    const point = getRadarPoint(index, total, score / 100, center, radius)
    const axis = getRadarPoint(index, total, 1, center, radius)
    const label = getRadarPoint(index, total, 1.26, center, radius)
    const isNoise = signal.direction === 'lower'
    return {
      ...signal,
      score,
      shortLabel: radarSignalShortLabel(signal.id),
      x: point.x,
      y: point.y,
      axisX: axis.x,
      axisY: axis.y,
      labelX: label.x,
      labelY: label.y,
      legendValue: isNoise ? score : signal.value,
      legendMeta: isNoise ? `原噪声 ${signal.value}` : signalDirectionLabel(signal.direction),
    }
  })

  return {
    axes,
    areaPoints: axes.map((axis) => `${axis.x},${axis.y}`).join(' '),
    gridPolygons: [0.25, 0.5, 0.75, 1].map((level) => ({
      level: Math.round(level * 100),
      points: Array.from({ length: total }, (_, index) => {
        const point = getRadarPoint(index, total, level, center, radius)
        return `${point.x},${point.y}`
      }).join(' '),
    })),
  }
})
const promotionQueueResolved = computed(() => unref(promotionQueue) || {
  summary: {},
  issueReviews: [],
  patternCandidates: [],
  synthesisCandidates: [],
  approvedIssues: [],
  approvedPatterns: [],
  approvedSyntheses: [],
})
const promotionPreviewDataResolved = computed(() => unref(promotionPreviewData) || null)
const promotionMvpAutoLastResultResolved = computed(() => unref(promotionMvpAutoLastResult) || null)
const DEFAULT_MVP_AUTO_MAX_ITEMS = 30
const DEFAULT_MVP_AUTO_MIN_CONFIDENCE = 0.82
const promotionMvpAutoMaxItems = ref(DEFAULT_MVP_AUTO_MAX_ITEMS)
const promotionMvpAutoMinConfidence = ref(DEFAULT_MVP_AUTO_MIN_CONFIDENCE)

function clampPromotionMvpAutoMaxItems(value: unknown) {
  const numeric = Number(value || DEFAULT_MVP_AUTO_MAX_ITEMS)
  if (!Number.isFinite(numeric)) return DEFAULT_MVP_AUTO_MAX_ITEMS
  return Math.max(1, Math.min(500, Math.round(numeric)))
}

function clampPromotionMvpAutoMinConfidence(value: unknown) {
  const numeric = Number(value || DEFAULT_MVP_AUTO_MIN_CONFIDENCE)
  if (!Number.isFinite(numeric)) return DEFAULT_MVP_AUTO_MIN_CONFIDENCE
  return Math.max(0, Math.min(1, Number(numeric.toFixed(2))))
}

const wikiHealthResolved = computed(() => unref(wikiHealth) || { summary: {}, findings: [] })
const healthCodeOptionsResolved = computed(() => {
  const list = unref(healthCodeOptions)
  return Array.isArray(list) ? list : []
})
const filteredHealthFindingsResolved = computed(() => {
  const list = unref(filteredHealthFindings)
  return Array.isArray(list) ? list : []
})
const healthFindingGroupsResolved = computed(() => {
  const list = unref(healthFindingGroups)
  return Array.isArray(list) ? list : []
})
const healthActionQueuesResolved = computed(() => {
  const list = unref(healthActionQueues)
  return Array.isArray(list) ? list : []
})
const hasGbrainV2ServiceResolved = computed(() => Boolean(unref(hasGbrainV2Service)))
const gbrainV2FeedStatusResolved = computed(() => unref(gbrainV2FeedStatus) || null)
const gbrainFeedManifestStatsResolved = computed(() =>
  gbrainV2FeedStatusResolved.value?.feed?.manifest?.stats || {},
)
const gbrainV2SettingsResolved = computed(() => unref(gbrainV2Settings) || {
  enabled: true,
  readMode: 'v2',
  feedMode: 'atom-reader-first',
  includeRawFallback: true,
  dualWriteEnabled: true,
  updatedAt: null,
})
const gbrainRetrieveResultResolved = computed(() => unref(gbrainRetrieveResult) || null)
const gbrainRetrieveItemsResolved = computed(() => {
  const list = gbrainRetrieveResultResolved.value?.results
  return Array.isArray(list) ? list : []
})
const selectedHealthFindingResolved = computed(() => unref(selectedHealthFinding) || null)
const selectedHealthBrokenTargetResolved = computed(() => extractHealthBrokenTarget(selectedHealthFindingResolved.value?.detail))
const healthDetailRef = ref<HTMLElement | null>(null)
const healthSuggestionDialogOpen = ref(false)
const healthSuggestionStateResolved = computed(() => unref(healthSuggestionState) || {
  loading: false,
  error: '',
  mode: '',
  findingKey: '',
  title: '',
  description: '',
  query: '',
  results: [],
  isCurrentFinding: false,
})
const healthRepairPreviewOpen = ref(false)
const healthRepairPreviewLoading = ref(false)
const healthRepairPreviewError = ref('')
const healthRepairPreviewData = ref<HealthRepairPreviewPayload | null>(null)
const healthAnchorPreviewOpen = ref(false)
const healthAnchorPreviewLoading = ref(false)
const healthAnchorPreviewError = ref('')
const healthAnchorPreviewData = ref<{ candidatePath: string; orphanTarget: string; insertedAt: string | null; alreadyLinked: boolean } | null>(null)
const promotionViewerNotesResolved = computed(() => {
  const list = unref(promotionViewerNotes)
  return Array.isArray(list) ? list : []
})
const promotionViewerUnresolvedResolved = computed(() => {
  const list = unref(promotionViewerUnresolved)
  return Array.isArray(list) ? list : []
})
const activePromotionSection = ref<'issues' | 'patterns' | 'syntheses'>('issues')
const promotionDecisionConfirmOpen = ref(false)
const promotionDecisionConfirmAction = ref<'approve' | 'dismiss' | 'revoke' | ''>('')
const promotionDecisionConfirmItem = ref<Record<string, any> | null>(null)
const hiddenGbrainPromotionKeys = ref<string[]>([])
const gbrainPromotionViewResolved = computed(() => unref(gbrainPromotionView) || { items: [], stats: null })
const gbrainPromotionAtomsResolved = computed(() => {
  const list = gbrainPromotionViewResolved.value.items
  return Array.isArray(list) ? list : []
})
const gbrainPromotionQualityCountsResolved = computed(() => {
  const result = {
    clean: 0,
    suspect: 0,
    legacy: 0,
  }
  for (const item of gbrainPromotionAtomsResolved.value) {
    const tier = String(item?.qualityTier || '').trim()
    if (tier === 'clean' || tier === 'suspect' || tier === 'legacy') {
      result[tier] += 1
    }
  }
  return result
})

async function refreshPromotionWorkbench() {
  await Promise.all([
    loadPromotionQueue(true),
    loadGbrainV2PromotionView(true),
  ])
}
const gbrainPromotionSectionBucketsResolved = computed(() => {
  const buckets = {
    issues: [] as Array<Record<string, any>>,
    patterns: [] as Array<Record<string, any>>,
    syntheses: [] as Array<Record<string, any>>,
  }
  for (const atom of gbrainPromotionAtomsResolved.value) {
    const section = resolveGbrainPromotionSection(String(atom.kind || ''))
    buckets[section].push(atom)
  }
  return buckets
})
const gbrainPromotionSectionTabs = computed(() => ([
  {
    id: 'issues' as const,
    label: 'Issue',
    description: '已经整理成问题形状，适合优先审核。',
    count: gbrainPromotionSectionBucketsResolved.value.issues.length,
  },
  {
    id: 'patterns' as const,
    label: 'Pattern',
    description: '已经出现复用结构，适合继续收口。',
    count: gbrainPromotionSectionBucketsResolved.value.patterns.length,
  },
  {
    id: 'syntheses' as const,
    label: 'Synthesis',
    description: '更像结论页，适合在标题和摘要稳定后再确认。',
    count: gbrainPromotionSectionBucketsResolved.value.syntheses.length,
  },
]))
const approvedPromotionPathSetResolved = computed(() => {
  const set = new Set<string>()
  for (const item of [
    ...promotionQueueResolved.value.approvedIssues,
    ...promotionQueueResolved.value.approvedPatterns,
    ...promotionQueueResolved.value.approvedSyntheses,
  ]) {
    const path = String(item?.currentPath || item?.targetPath || '').trim()
    if (path) set.add(path)
  }
  return set
})
const hiddenGbrainPromotionKeySetResolved = computed(() => new Set(hiddenGbrainPromotionKeys.value))
const allGbrainPromotionKeySetResolved = computed(() => {
  const set = new Set<string>()
  for (const atom of gbrainPromotionAtomsResolved.value) {
    const key = promotionItemKey(buildPromotionItemFromGbrainAtom(atom))
    if (key) set.add(key)
  }
  return set
})
const activeGbrainPromotionItemsResolved = computed(() => {
  const source = activePromotionSection.value === 'issues'
    ? gbrainPromotionSectionBucketsResolved.value.issues
    : activePromotionSection.value === 'patterns'
      ? gbrainPromotionSectionBucketsResolved.value.patterns
      : gbrainPromotionSectionBucketsResolved.value.syntheses
  return source.filter((item) => {
    const key = promotionItemKey(buildPromotionItemFromGbrainAtom(item))
    if (hiddenGbrainPromotionKeySetResolved.value.has(key)) return false
    const path = String(item?.pageId || '').trim()
    if (path && approvedPromotionPathSetResolved.value.has(path)) return false
    return true
  })
})
const activeQueuePromotionItemsResolved = computed(() => {
  const source = activePromotionSection.value === 'issues'
    ? promotionQueueResolved.value.issueReviews
    : activePromotionSection.value === 'patterns'
      ? promotionQueueResolved.value.patternCandidates
      : promotionQueueResolved.value.synthesisCandidates
  if (!Array.isArray(source)) return []
  return source.filter((item) => {
    if (!item || typeof item !== 'object') return false
    const key = promotionItemKey(item as Record<string, unknown>)
    if (!key) return false
    if (allGbrainPromotionKeySetResolved.value.has(key)) return false
    const path = String((item as Record<string, unknown>)?.currentPath || (item as Record<string, unknown>)?.targetPath || '').trim()
    if (path && approvedPromotionPathSetResolved.value.has(path)) return false
    return true
  })
})
const activePromotionVisibleCountResolved = computed(() =>
  activeGbrainPromotionItemsResolved.value.length + activeQueuePromotionItemsResolved.value.length,
)

function focusPromotionCandidateBySegmentId(segmentId: string) {
  const normalized = String(segmentId || '').trim()
  if (!normalized) return false
  const sections = [
    { id: 'issues' as const, items: promotionQueueResolved.value.issueReviews },
    { id: 'patterns' as const, items: promotionQueueResolved.value.patternCandidates },
    { id: 'syntheses' as const, items: promotionQueueResolved.value.synthesisCandidates },
  ]
  const matched = sections.find((section) =>
    section.items.some((item: Record<string, unknown>) => String(item.segmentId || '').trim() === normalized),
  )
  if (!matched) return false
  activePromotionSection.value = matched.id
  return true
}

function resolveGbrainPromotionSection(kind: string): 'issues' | 'patterns' | 'syntheses' {
  const normalized = String(kind || '').trim().toLowerCase()
  if (normalized === 'issue') return 'issues'
  if (normalized === 'pattern') return 'patterns'
  return 'syntheses'
}

function promotionItemKey(item: Record<string, unknown>) {
  return [item.kind, item.currentPath || item.targetPath || '', item.title || '']
    .map((value) => String(value || '').trim())
    .join('::')
}

function buildPromotionItemFromGbrainAtom(item: Record<string, any>) {
  const kind = String(item?.kind || '').trim().toLowerCase()
  const pageId = String(item?.pageId || '').trim()
  const sourceRefs = Array.isArray(item?.sourceRefs) ? item.sourceRefs : []
  const evidenceItems = normalizePromotionEvidencePaths(
    sourceRefs.map((ref) => String(ref?.value || '').trim()),
  )
  const project = Array.isArray(item?.topics)
    ? String(item.topics[0] || '').trim()
    : ''
  const base = {
    title: String(item?.title || item?.pageId || '未命名候选').trim(),
    summary: String(item?.summary || '').trim(),
    project,
    evidenceItems,
    sourceKind: 'gbrain-v2',
    sourceLabel: '系统候选',
    segmentId: String(item?.rawId || '').trim(),
  }
  if (kind === 'issue') {
    return {
      ...base,
      kind: 'issue-review',
      currentPath: pageId,
    }
  }
  if (kind === 'pattern') {
    return {
      ...base,
      kind: 'pattern-candidate',
      targetPath: pageId,
    }
  }
  return {
    ...base,
    kind: 'synthesis-candidate',
    targetPath: pageId,
  }
}

function normalizePromotionEvidencePath(pathLike: unknown) {
  const raw = String(pathLike || '').trim()
  if (!raw) return ''
  const normalized = raw
    .replace(/^file:\/\//i, '')
    .replace(/\\/g, '/')
    .trim()

  if (normalized.startsWith('inbox/')) return normalized
  if (normalized.startsWith('vault/inbox/')) return normalized.slice('vault/'.length)
  const match = normalized.match(/(?:^|\/)vault\/(inbox\/.+)$/)
  if (match?.[1]) return match[1]
  return ''
}

function normalizePromotionEvidencePaths(paths: unknown) {
  if (!Array.isArray(paths)) return []
  const normalized = paths
    .map((item) => normalizePromotionEvidencePath(item))
    .filter(Boolean)
  return Array.from(new Set(normalized))
}

function getQueuePromotionEvidencePaths(item: Record<string, any>) {
  return normalizePromotionEvidencePaths(item?.evidenceItems)
}

function getGbrainPromotionEvidencePaths(item: Record<string, any>) {
  const sourceRefs = Array.isArray(item?.sourceRefs) ? item.sourceRefs : []
  const sourceRefPaths = sourceRefs.map((ref) => String(ref?.value || '').trim())
  const itemPaths = Array.isArray(item?.evidenceItems) ? item.evidenceItems : []
  return normalizePromotionEvidencePaths([...sourceRefPaths, ...itemPaths])
}

function formatTagList(tags: unknown) {
  if (!Array.isArray(tags) || !tags.length) return ''
  return tags.map((item) => String(item || '').trim()).filter(Boolean).join(' · ')
}

function formatConfidenceLabel(value: string) {
  return confidenceOptionsResolved.value.find((item) => item.value === value)?.label || '中'
}

function formatDateTime(value: unknown) {
  const normalized = String(value || '').trim()
  if (!normalized) return '-'
  const timestamp = new Date(normalized)
  if (Number.isNaN(timestamp.getTime())) return normalized
  return timestamp.toLocaleString()
}

function formatGbrainFeedModeLabel(value: string) {
  if (value === 'atom-only') return '仅标准化候选'
  if (value === 'reader-first-only') return '仅可读知识页'
  return '候选 + 可读知识页'
}

function formatGbrainQualityTierLabel(value: string) {
  if (value === 'clean') return 'Clean'
  if (value === 'suspect') return 'Suspect'
  return 'Legacy'
}

function formatGbrainStatusLabel(value: string) {
  if (value === 'active') return 'Active'
  if (value === 'archived') return 'Archived'
  return 'Draft'
}

function runGbrainRetrievePreview() {
  void runGbrainV2Retrieve(String(unref(gbrainRetrieveQuery) || '').trim(), 6)
}

function runGbrainFeedRefresh() {
  void refreshGbrainV2Feed(5000)
}

function runPromotionMvpAuto(dryRun = true) {
  const maxItems = clampPromotionMvpAutoMaxItems(promotionMvpAutoMaxItems.value)
  const minConfidence = clampPromotionMvpAutoMinConfidence(promotionMvpAutoMinConfidence.value)
  promotionMvpAutoMaxItems.value = maxItems
  promotionMvpAutoMinConfidence.value = minConfidence
  void runMvpAutoPromotion({
    dryRun,
    maxItems,
    minConfidence,
  })
}

function formatTaskTypeLabel(value: string) {
  if (value === 'bug-investigation') return 'Bug'
  if (value === 'coding-task') return '编码任务'
  if (value === 'architecture-discussion') return '架构讨论'
  if (value === 'prompt-design') return '提示词'
  if (value === 'general-knowledge') return '通用知识'
  if (value === 'context-fragment') return '上下文碎片'
  if (value === 'chitchat') return '闲聊噪声'
  return '任务'
}

function formatReviewStatusLabel(value: string) {
  if (value === 'kept') return '已保留'
  if (value === 'downgraded') return '已降级'
  if (value === 'hidden') return '已隐藏'
  return '待处理'
}

function formatTaskActionLabel(value: string) {
  if (value === 'keep-search') return '保留主检索'
  if (value === 'promote-candidate') return '标记升格'
  if (value === 'archive-only') return '仅归档'
  if (value === 'ignore-noise') return '忽略噪声'
  if (value === 'needs-context') return '等待补上下文'
  return value
}

function formatPromotionTargetLabel(value: string) {
  if (value === 'issue-review') return 'Issue 审核'
  if (value === 'pattern-candidate') return 'Pattern 候选'
  if (value === 'synthesis-candidate') return 'Synthesis 候选'
  return '升格审核'
}

function getPromotionTargetChipType(value: string) {
  if (value === 'issue-review') return 'note'
  if (value === 'pattern-candidate') return 'document'
  return 'capture'
}

function getPromotionSectionFromTarget(value: string): 'issues' | 'patterns' | 'syntheses' {
  if (value === 'pattern-candidate') return 'patterns'
  if (value === 'synthesis-candidate') return 'syntheses'
  return 'issues'
}

function scoreTone(value: number) {
  if (value >= 75) return 'strong'
  if (value >= 55) return 'medium'
  return 'weak'
}

function signalDirectionLabel(value: string) {
  return value === 'lower' ? '越低越好' : '越高越好'
}

function clampTaskSignalScore(value: unknown) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(100, Math.round(numeric)))
}

function getRadarPoint(index: number, total: number, scale: number, center: number, radius: number) {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(1, total)
  return {
    x: Number((center + Math.cos(angle) * radius * scale).toFixed(2)),
    y: Number((center + Math.sin(angle) * radius * scale).toFixed(2)),
  }
}

function radarSignalShortLabel(value: string) {
  if (value === 'context') return '上下文'
  if (value === 'retrieval') return '检索'
  if (value === 'promotion') return '升格'
  if (value === 'answer') return '回答'
  if (value === 'noise') return '抗噪'
  return value
}

function confidencePercent(value: unknown) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return '0%'
  return `${Math.round(numeric * 100)}%`
}

function formatPromotionPreviewMode(value: string) {
  return value === 'update' ? '更新现有页面' : '创建新页面'
}

function formatPromotionPreviewCategory(value: string) {
  if (value === 'lightweight-confirmation') return '轻量确认型'
  if (value === 'content-update') return '实质生成型'
  return '新建页面'
}

function formatPromotionKindLabel(value: string) {
  if (value === 'issue-review') return 'Issue 审核'
  if (value === 'pattern-candidate') return 'Pattern 候选'
  if (value === 'synthesis-candidate') return 'Synthesis 候选'
  return '升格候选'
}

function formatGbrainPromotionKindLabel(value: string) {
  if (value === 'issue') return 'Issue'
  if (value === 'pattern') return 'Pattern'
  if (value === 'synthesis') return 'Synthesis'
  if (value === 'decision') return 'Decision'
  if (value === 'context') return 'Context'
  return value || 'Atom'
}

function formatPromotionApproveLabel(value: string) {
  if (value === 'issue-review') return '升格为正式 Issue'
  if (value === 'pattern-candidate') return '生成 Pattern Note'
  if (value === 'synthesis-candidate') return '生成 Synthesis Note'
  return '确认升格'
}

function formatHealthSeverityLabel(value: string) {
  if (value === 'high') return 'High'
  if (value === 'medium') return 'Medium'
  if (value === 'low') return 'Low'
  return 'All'
}

function formatHealthCodeLabel(value: string) {
  const normalized = String(value || '').trim()
  if (!normalized) return '全部规则'
  const dictionary: Record<string, string> = {
    'broken-wikilink': '断链',
    'duplicate-title': '重复标题',
    'orphan-note': '孤儿页',
    'weak-summary': '弱摘要',
    'thin-issue-evidence': 'Issue 证据太薄',
    'issue-missing-project': 'Issue 缺少项目归属',
    'issue-incomplete-troubleshooting': 'Issue 排障结构不完整',
    'stale-draft-issue': 'Draft Issue 长期积压',
    'pattern-missing-project': 'Pattern 缺少项目归属',
    'pattern-incomplete-shape': 'Pattern 结构不完整',
    'project-knowledge-gap': 'Project 知识空洞',
    'project-missing-patterns': 'Project 缺少 Patterns',
    'concept-unanchored': 'Concept 未被主阅读层锚定',
  }
  return dictionary[normalized] || normalized.replace(/-/g, ' ')
}

function formatHealthGroupDescription(code: string, count: number) {
  return `${formatHealthCodeLabel(code)} · ${count} 条`
}

function resolveHealthScope(relativePath: string) {
  const normalized = String(relativePath || '').trim()
  if (!normalized) return '未定位'
  return normalized.split('/')[0] || normalized
}

function formatHealthQueueActionLabel(value: string) {
  if (value === 'evidence') return '批量看 Evidence'
  if (value === 'promotion') return '去升格审核'
  if (value === 'task-review') return '去升格审核'
  return '批量看页面'
}

function formatHealthQueueCodes(codes: unknown) {
  return (Array.isArray(codes) ? codes : [])
    .map((code) => formatHealthCodeLabel(String(code || '')))
    .filter(Boolean)
    .join(' · ')
}

function extractHealthBrokenTarget(detail: unknown) {
  const match = String(detail || '').match(/Links to missing note:\s*(.+)$/i)
  return String(match?.[1] || '').trim()
}

function isHealthRepairSuggestionAvailable(item: Record<string, any> | null) {
  return String(item?.code || '') === 'broken-wikilink'
}

function isHealthAnchorSuggestionAvailable(item: Record<string, any> | null) {
  return ['orphan-note', 'concept-unanchored'].includes(String(item?.code || ''))
}

function isHealthStaleDraftIssue(item: Record<string, any> | null) {
  return String(item?.code || '') === 'stale-draft-issue'
}

function queueHasCode(queue: Record<string, any> | null, code: string) {
  return Array.isArray(queue?.codes) && queue.codes.includes(code)
}

function healthFindingItemKey(item: Record<string, any> | null) {
  return [
    item?.relativePath || '',
    item?.code || '',
    item?.title || '',
    item?.detail || '',
  ]
    .map((value) => String(value || '').trim())
    .join('::')
}

async function handleHealthFindingSelect(item: Record<string, any> | null) {
  selectHealthFinding(item)
  await nextTick()
  if (typeof window === 'undefined') return
  if (!window.matchMedia('(max-width: 1080px)').matches) return
  healthDetailRef.value?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  })
}

function inferHealthPromotionSection(code: string): 'issues' | 'patterns' | 'syntheses' {
  const normalized = String(code || '').trim()
  if ([
    'pattern-missing-project',
    'pattern-incomplete-shape',
    'project-missing-patterns',
  ].includes(normalized)) return 'patterns'
  if ([
    'project-knowledge-gap',
    'concept-unanchored',
  ].includes(normalized)) return 'syntheses'
  return 'issues'
}

function buildHealthTaskReviewQuery(item: Record<string, any> | null) {
  if (!item) return ''
  const scope = resolveHealthScope(String(item.relativePath || ''))
  const title = String(item.title || '').trim()
  const parts = [scope, title]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
  return Array.from(new Set(parts)).join(' ')
}

async function jumpFromHealthToPromotion(item: Record<string, any> | null) {
  activePromotionSection.value = inferHealthPromotionSection(String(item?.code || ''))
  await setWorkbenchTab('promotion')
}

async function jumpFromHealthToTaskReview(item: Record<string, any> | null) {
  taskReviewKeyword.value = buildHealthTaskReviewQuery(item)
  activePromotionSection.value = inferHealthPromotionSection(String(item?.code || ''))
  await setWorkbenchTab('promotion')
}

async function runHealthQueuePrimaryAction(queue: Record<string, any> | null) {
  if (!queue) return
  if (queue.target === 'promotion') {
    activePromotionSection.value = queue.targetSection || 'issues'
    await setWorkbenchTab('promotion')
    return
  }
  if (queue.target === 'task-review') {
    taskReviewKeyword.value = buildHealthTaskReviewQuery(queue.items?.[0] || null)
    activePromotionSection.value = inferHealthPromotionSection(String(queue.items?.[0]?.code || ''))
    await setWorkbenchTab('promotion')
    return
  }
  if (queue.target === 'evidence') {
    await openHealthQueueEvidence(queue.items || [], `${queue.title} · 批量 Source Evidence`)
    return
  }
  await openHealthQueueNotes(queue.items || [], `${queue.title} · 批量关联页面`)
}

async function runHealthQueueSecondaryAction(queue: Record<string, any> | null) {
  if (!queue) return
  if (queue.target === 'promotion' || queue.target === 'task-review') {
    await openHealthQueueEvidence(queue.items || [], `${queue.title} · 批量 Source Evidence`)
    return
  }
  await openHealthQueueNotes(queue.items || [], `${queue.title} · 批量关联页面`)
}

async function openHealthSuggestionCandidate(path: string, title = '候选页面') {
  await openHealthQueueNotes([{ relativePath: path } as any], title)
}

function closeHealthRepairPreview() {
  healthRepairPreviewOpen.value = false
  healthRepairPreviewLoading.value = false
  healthRepairPreviewError.value = ''
  healthRepairPreviewData.value = null
}

async function openHealthRepairPreview(item: Record<string, any> | null, candidatePath: string) {
  if (!item || !candidatePath) return
  healthRepairPreviewOpen.value = true
  healthRepairPreviewLoading.value = true
  healthRepairPreviewError.value = ''
  healthRepairPreviewData.value = null
  try {
    const preview = await previewHealthRepairSuggestion(item, candidatePath)
    healthRepairPreviewData.value = preview as HealthRepairPreviewPayload
  } catch (error) {
    healthRepairPreviewError.value = String(error instanceof Error ? error.message : error || '生成替换预览失败')
  } finally {
    healthRepairPreviewLoading.value = false
  }
}

async function confirmHealthRepairPreview() {
  const preview = healthRepairPreviewData.value
  if (!preview || !preview.replacedCount) return
  try {
    await applyHealthRepairPlan({
      path: preview.path,
      fromTarget: preview.fromTarget,
      toTarget: preview.toTarget,
    })
    closeHealthRepairPreview()
    healthSuggestionDialogOpen.value = false
  } catch {
    // Keep preview dialog open so user can retry or switch candidate.
  }
}

async function openHealthRepairSuggestionDialog(item: Record<string, any> | null) {
  if (!item) return
  healthSuggestionDialogOpen.value = true
  await loadHealthRepairSuggestions(item)
}

async function openHealthAnchorSuggestionDialog(item: Record<string, any> | null) {
  if (!item) return
  healthSuggestionDialogOpen.value = true
  await loadHealthAnchorSuggestions(item)
}

function closeHealthAnchorPreview() {
  healthAnchorPreviewOpen.value = false
  healthAnchorPreviewLoading.value = false
  healthAnchorPreviewError.value = ''
  healthAnchorPreviewData.value = null
}

async function openHealthAnchorPreview(item: Record<string, any> | null, candidatePath: string) {
  if (!item || !candidatePath) return
  healthAnchorPreviewOpen.value = true
  healthAnchorPreviewLoading.value = true
  healthAnchorPreviewError.value = ''
  healthAnchorPreviewData.value = null
  try {
    const preview = await previewHealthAnchorSuggestion(item, candidatePath)
    healthAnchorPreviewData.value = preview as any
  } catch (error) {
    healthAnchorPreviewError.value = String(error instanceof Error ? error.message : error || '生成预览失败')
  } finally {
    healthAnchorPreviewLoading.value = false
  }
}

async function confirmHealthAnchorPreview() {
  const preview = healthAnchorPreviewData.value
  if (!preview || preview.alreadyLinked) return
  try {
    await applyHealthAnchorPlan({ candidatePath: preview.candidatePath, orphanTarget: preview.orphanTarget })
    closeHealthAnchorPreview()
    healthSuggestionDialogOpen.value = false
  } catch {
    // Keep preview dialog open so user can retry.
  }
}

function formatPromotionSourceTone(value: string) {
  if (value === 'manual-review' || value === 'manual-submit') return 'manual'
  if (value === 'knowledge-item') return 'knowledge'
  return 'auto'
}

function resolvePromotionPath(item: Record<string, unknown>) {
  return String(item.currentPath || item.targetPath || '').trim()
}

function formatPreviewFieldLabel(value: string) {
  if (value === 'title') return '标题'
  if (value === 'type') return '页面类型'
  if (value === 'schemaVersion') return '模板版本'
  if (value === 'issue') return 'Issue 标识'
  if (value === 'pattern') return 'Pattern 标识'
  if (value === 'question') return '问题'
  if (value === 'project') return '归属项目'
  if (value === 'status') return '状态'
  if (value === 'evidenceCount') return '证据数量'
  if (value === 'updatedAt') return '更新时间'
  if (value === 'promotionState') return '升格状态'
  if (value === 'approvedAt') return '确认时间'
  return value
}

function formatPreviewFieldValue(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || '空'
}

function extractEvidenceLine(body: unknown, label: string) {
  const source = String(body || '')
  const safeLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`^- ${safeLabel}:\\s*(.+)$`, 'm'))
  return String(match?.[1] || '').trim()
}

function parseEvidenceFiles(value: unknown) {
  const normalized = String(value || '').replace(/`/g, '').trim()
  if (!normalized || normalized === 'n/a') return []
  return normalized
    .split(/\s*,\s*/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

function compactEvidenceIntent(value: unknown) {
  return String(value || '').replace(/^[-–—]\s*/u, '').trim()
}

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function resolveTaskMarkdownSource(content: unknown): string {
  const source = String(content || '').trim()
  return source || '最近回答较短，建议回看原会话。'
}
const taskReviewConfirmTitleResolved = computed(() => {
  if (taskReviewConfirmAction.value === 'keep-search') return '确认保留主检索？'
  if (taskReviewConfirmAction.value === 'promote-candidate') return '确认标记升格？'
  if (taskReviewConfirmAction.value === 'archive-only') return '确认仅归档？'
  if (taskReviewConfirmAction.value === 'ignore-noise') return '确认忽略噪声？'
  return '确认执行该操作？'
})

const taskReviewConfirmDescriptionResolved = computed(() => {
  const item = selectedTaskReviewItemResolved.value
  const title = item?.title || item?.segmentLabel || '当前任务段'
  if (taskReviewConfirmAction.value === 'keep-search') return `会把“${title}”继续保留在主检索层。`
  if (taskReviewConfirmAction.value === 'promote-candidate') {
    return `会把“${title}”送入升格候选队列，预计进入「${formatPromotionTargetLabel(item?.predictedPromotionTarget || '')}」模块。`
  }
  if (taskReviewConfirmAction.value === 'archive-only') return `会把“${title}”降为仅归档，不再优先参与筛选。`
  if (taskReviewConfirmAction.value === 'ignore-noise') return `会把“${title}”标记为噪声并隐藏。`
  return `确认对“${title}”执行当前操作。`
})

function openTaskReviewConfirm(action: TaskReviewQuickAction) {
  taskReviewConfirmAction.value = action
  taskReviewConfirmOpen.value = true
}

function closeTaskReviewConfirm() {
  if (String(unref(taskReviewUpdatingId) || '') === selectedTaskReviewItemResolved.value?.id) return
  taskReviewConfirmOpen.value = false
  taskReviewConfirmAction.value = ''
}

async function confirmTaskReviewAction() {
  const item = selectedTaskReviewItemResolved.value
  const action = taskReviewConfirmAction.value
  if (!item || !action) return
  const updated = await applyTaskReviewAction(action, item.id, item.sessionId)
  closeTaskReviewConfirm()
  if (updated && action === 'promote-candidate') {
    activePromotionSection.value = getPromotionSectionFromTarget(item.predictedPromotionTarget)
    await setWorkbenchTab('promotion')
  }
}

const promotionDecisionConfirmTitleResolved = computed(() => {
  if (promotionDecisionConfirmAction.value === 'approve') return '确认升格这条候选？'
  if (promotionDecisionConfirmAction.value === 'dismiss') return '确认驳回这条自动候选？'
  if (promotionDecisionConfirmAction.value === 'revoke') return '确认撤销这条人工确认？'
  return '确认执行这条升格操作？'
})

const promotionDecisionConfirmDescriptionResolved = computed(() => {
  const item = promotionDecisionConfirmItem.value
  const title = String(item?.title || '当前候选')
  if (promotionDecisionConfirmAction.value === 'approve') return `会把“${title}”正式写入可读知识页，并从自动候选区移除。`
  if (promotionDecisionConfirmAction.value === 'dismiss') return `会把“${title}”从自动候选中驳回，后续不会继续出现在当前审核队列。`
  if (promotionDecisionConfirmAction.value === 'revoke') return `会撤销“${title}”的人工确认，让它回到自动判断态，必要时可以重新审核。`
  return `确认对“${title}”执行当前操作。`
})

function openPromotionDecisionConfirm(
  item: Record<string, any>,
  action: 'approve' | 'dismiss' | 'revoke',
) {
  promotionDecisionConfirmItem.value = item
  promotionDecisionConfirmAction.value = action
  promotionDecisionConfirmOpen.value = true
}

function closePromotionDecisionConfirm() {
  const confirmItemKey = promotionDecisionConfirmItem.value ? promotionItemKey(promotionDecisionConfirmItem.value) : ''
  if (confirmItemKey && String(unref(promotionApplyingKey) || '') === confirmItemKey) return
  promotionDecisionConfirmOpen.value = false
  promotionDecisionConfirmAction.value = ''
  promotionDecisionConfirmItem.value = null
}

async function confirmPromotionDecision() {
  const item = promotionDecisionConfirmItem.value
  const action = promotionDecisionConfirmAction.value
  if (!item || !action) return
  if (action === 'approve') await applyPromotionCandidate(item)
  if (action === 'dismiss') await dismissPromotionCandidate(item)
  if (action === 'revoke') await revokePromotionCandidate(item)
  if (item.sourceKind === 'gbrain-v2' && (action === 'approve' || action === 'dismiss')) {
    const key = promotionItemKey(item)
    if (key && !hiddenGbrainPromotionKeys.value.includes(key)) {
      hiddenGbrainPromotionKeys.value = [...hiddenGbrainPromotionKeys.value, key]
    }
  }
  await setWorkbenchTab('promotion')
  closePromotionDecisionConfirm()
}

function goToAdjacentTaskSegment(direction: -1 | 1) {
  const nextIndex = currentTaskSegmentIndexResolved.value + direction
  const nextSegment = selectedTaskSegmentsResolved.value[nextIndex]
  if (!nextSegment?.id) return
  selectTaskReviewSegment(nextSegment.id)
}

function isSummaryCardActionable(cardId: string) {
  return workbenchTabResolved.value === 'task-review'
    && ['total', 'retrieval', 'promotion', 'answer', 'noise'].includes(String(cardId || ''))
}

function focusTaskReviewBySummary(cardId: string) {
  if (!isSummaryCardActionable(cardId)) return
  taskReviewKeyword.value = ''
  taskReviewTypeFilter.value = 'all'
  taskReviewAnswerFilter.value = 'all'
  taskReviewPromotionTargetFilter.value = 'all'
  taskReviewActionFilter.value = 'all'

  if (cardId === 'total') {
    taskReviewStatusFilter.value = 'all'
    return
  }
  taskReviewStatusFilter.value = 'pending'
  if (cardId === 'retrieval') taskReviewActionFilter.value = 'keep-search'
  if (cardId === 'promotion') taskReviewActionFilter.value = 'promote-candidate'
  if (cardId === 'answer') {
    taskReviewStatusFilter.value = 'all'
    taskReviewAnswerFilter.value = 'essence'
  }
  if (cardId === 'noise') taskReviewActionFilter.value = 'ignore-noise'
}
</script>

<template>
  <div v-if="isKnowledgeSourcesModeResolved" class="knowledge-sources-panel">
    <div class="knowledge-overview-toggle-row">
      <button
        type="button"
        class="app-btn-ghost knowledge-overview-toggle-btn"
        @click="knowledgeOverviewCollapsed = !knowledgeOverviewCollapsed"
      >
        {{ knowledgeOverviewCollapsed ? '展开概览' : '收起概览' }}
      </button>
    </div>

    <section
      v-show="!knowledgeOverviewCollapsed"
      class="knowledge-sources-hero"
      :class="{ compact: heroCompactResolved, expanded: heroCanExpandResolved && heroExpanded }"
    >
      <div class="knowledge-sources-hero-head">
        <div class="knowledge-sources-hero-copy">
          <p class="knowledge-sources-eyebrow">{{ workbenchHeroResolved.eyebrow }}</p>
          <h3>{{ workbenchHeroResolved.title }}</h3>
          <p class="knowledge-sources-description">
            {{ workbenchHeroResolved.description }}
          </p>

          <button
            v-if="heroCanExpandResolved"
            type="button"
            class="app-btn-ghost knowledge-sources-hero-toggle"
            @click="heroExpanded = !heroExpanded"
          >
            {{ heroExpanded ? '收起概览' : `展开概览（${summaryCardsResolved.length}）` }}
          </button>
        </div>
      </div>

      <div v-if="visibleSummaryCardsResolved.length" class="knowledge-sources-summary-grid">
        <button
          v-for="card in visibleSummaryCardsResolved"
          :key="card.id"
          type="button"
          class="knowledge-summary-card"
          :class="{ 'knowledge-summary-card--actionable': isSummaryCardActionable(card.id) }"
          @click="focusTaskReviewBySummary(card.id)"
        >
          <small>{{ card.title }}</small>
          <strong>{{ card.count }}</strong>
          <p>{{ card.description }}</p>
        </button>
      </div>
    </section>

    <template v-if="workbenchTabResolved === 'raw'">
      <KnowledgeSourcesRawTab :ctx="props.ctx" />
    </template>
    <template v-else-if="workbenchTabResolved === 'task-review'">
      <section class="knowledge-sources-toolbar">
        <div class="knowledge-filter-group">
          <label>
            <small>Provider</small>
            <select v-model="taskReviewProviderFilter" class="app-select">
              <option value="all">全部</option>
              <option v-for="option in taskReviewProviderOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>

          <label>
            <small>审核状态</small>
            <select v-model="taskReviewStatusFilter" class="app-select">
              <option v-for="option in taskReviewStatusOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>

          <label>
            <small>任务类型</small>
            <select v-model="taskReviewTypeFilter" class="app-select">
              <option v-for="option in taskReviewTypeOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>

          <label>
            <small>推荐动作</small>
            <select v-model="taskReviewActionFilter" class="app-select">
              <option v-for="option in taskReviewActionFilterOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>

          <label>
            <small>回答精华</small>
            <select v-model="taskReviewAnswerFilter" class="app-select">
              <option v-for="option in taskReviewAnswerFilterOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>

          <label>
            <small>预计去向</small>
            <select v-model="taskReviewPromotionTargetFilter" class="app-select">
              <option v-for="option in taskReviewPromotionTargetOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>

          <label class="knowledge-filter-search">
            <small>关键词</small>
            <input
              v-model="taskReviewKeyword"
              class="app-input"
              type="text"
              placeholder="搜标题、项目、首轮意图、标签"
            />
          </label>

          <button
            type="button"
            class="icon-btn"
            :disabled="taskReviewLoading"
            @click="loadTaskReviewSessions(true)"
            :title="taskReviewLoading ? '刷新中' : '刷新任务筛选'"
            aria-label="刷新任务筛选"
          >
            <IconRefreshCw v-if="taskReviewLoading" :size="18" class="animate-spin" />
            <IconRefreshCw v-else :size="18" />
          </button>
        </div>
      </section>

      <section class="knowledge-sources-layout">
        <aside class="knowledge-sources-list">
          <header class="knowledge-list-head">
            <div>
              <strong>待筛任务</strong>
              <small>先按会话分流，再看会话里有哪些连续任务段。</small>
            </div>
            <span class="knowledge-list-badge">{{ taskReviewSessionsResolved.length }}</span>
          </header>

          <div v-if="!taskReviewSessionsResolved.length" class="knowledge-list-empty">
            <IconSparkles :size="20" />
            <p>还没有可筛会话，先刷新一次任务筛选。</p>
          </div>

          <button
            v-for="session in taskReviewSessionsResolved"
            :key="session.id"
            type="button"
            class="knowledge-list-item knowledge-task-item"
            :class="{ active: selectedTaskReviewSessionIdResolved === session.id }"
            @click="selectTaskReviewSession(session.id)"
          >
            <div class="knowledge-list-item-top">
              <span class="knowledge-chip" data-type="capture">{{ formatTaskTypeLabel(session.primaryTaskType) }}</span>
              <span class="knowledge-chip status" :data-status="session.reviewStatus">{{ formatReviewStatusLabel(session.reviewStatus) }}</span>
              <span v-if="session.isPromoteCandidate" class="knowledge-chip" data-head-tone="status-strong">已送升格</span>
              <span v-if="session.primaryIsAnswerEssence" class="knowledge-chip" data-type="answer">回答精华</span>
              <span class="knowledge-chip">{{ session.segmentCount > 1 ? `${session.segmentCount} 个任务段` : '单任务段' }}</span>
            </div>
            <strong>{{ session.title }}</strong>
            <div class="knowledge-task-score-row">
              <span class="knowledge-score-pill" :data-tone="scoreTone(session.primaryRetrievalValue)">检索 {{ session.primaryRetrievalValue }}</span>
              <span class="knowledge-score-pill" :data-tone="scoreTone(session.primaryPromotionValue)">升格 {{ session.primaryPromotionValue }}</span>
              <span class="knowledge-score-pill" :data-tone="scoreTone(session.primaryAnswerValue)">回答 {{ session.primaryAnswerValue }}</span>
              <span class="knowledge-score-pill" :data-tone="scoreTone(100 - session.primaryNoiseRisk)">噪声 {{ session.primaryNoiseRisk }}</span>
            </div>
            <div class="knowledge-list-item-meta">
              <span>{{ session.project || session.provider }}</span>
              <span>{{ formatDateTime(session.updatedAt) }}</span>
            </div>
            <small class="knowledge-list-item-note">主任务段：{{ session.primarySegmentTitle }}</small>
          </button>
        </aside>

        <section class="knowledge-sources-editor">
          <template v-if="selectedTaskReviewSessionResolved && selectedTaskReviewItemResolved">
            <header class="knowledge-editor-head knowledge-editor-head--hero">
              <div>
                <strong>{{ selectedTaskReviewSessionResolved.title }}</strong>
                <div v-if="selectedTaskReviewHeadTagsResolved.length" class="knowledge-editor-head-tags">
                  <span
                    v-for="tag in selectedTaskReviewHeadTagsResolved"
                    :key="tag.label"
                    class="knowledge-chip"
                    :data-head-tone="tag.tone"
                  >
                    {{ tag.label }}
                  </span>
                </div>
              </div>
            </header>

            <article class="knowledge-hint-card knowledge-hint-card--segment">
              <div class="knowledge-hint-head knowledge-task-segment-head">
                <IconLink2 :size="16" />
                <div class="knowledge-task-segment-title-wrap">
                  <strong>会话内任务段</strong>
                  <div class="knowledge-task-head-signal" :data-tone="selectedTaskSignalSummaryResolved.tone">
                    <span>综合 {{ selectedTaskSignalSummaryResolved.score }}</span>
                    <small>{{ selectedTaskSignalSummaryResolved.label }}</small>
                    <i aria-hidden="true">
                      <b :style="{ width: `${Math.max(0, Math.min(100, selectedTaskSignalSummaryResolved.score))}%` }" />
                    </i>
                  </div>
                </div>
                <div class="knowledge-task-segment-controls">
                  <div class="knowledge-task-segment-action-group">
                    <button
                      type="button"
                      class="app-btn-ghost knowledge-task-decision-btn"
                      data-tone="search"
                      :disabled="taskReviewUpdatingId === selectedTaskReviewItemResolved.id"
                      @click="openTaskReviewConfirm('keep-search')"
                      aria-label="保留主检索"
                      title="保留主检索"
                    >
                      <IconCheck :size="14" />
                      <span>保留主检索</span>
                    </button>
                    <button
                      type="button"
                      class="app-btn-ghost knowledge-task-decision-btn"
                      data-tone="promote"
                      :disabled="taskReviewUpdatingId === selectedTaskReviewItemResolved.id"
                      @click="openTaskReviewConfirm('promote-candidate')"
                      aria-label="标记升格"
                      title="标记升格"
                    >
                      <IconSparkles :size="14" />
                      <span>标记升格</span>
                    </button>
                    <button
                      type="button"
                      class="app-btn-ghost knowledge-task-decision-btn"
                      data-tone="archive"
                      :disabled="taskReviewUpdatingId === selectedTaskReviewItemResolved.id"
                      @click="openTaskReviewConfirm('archive-only')"
                      aria-label="仅归档"
                      title="仅归档"
                    >
                      <IconDatabase :size="14" />
                      <span>仅归档</span>
                    </button>
                    <button
                      type="button"
                      class="app-btn-ghost knowledge-task-decision-btn"
                      data-tone="danger"
                      :disabled="taskReviewUpdatingId === selectedTaskReviewItemResolved.id"
                      @click="openTaskReviewConfirm('ignore-noise')"
                      aria-label="忽略噪声"
                      title="忽略噪声"
                    >
                      <IconTriangleAlert :size="14" />
                      <span>忽略噪声</span>
                    </button>
                  </div>
                  <div class="knowledge-task-segment-nav-group" v-if="selectedTaskSegmentsResolved.length > 1">
                    <small>{{ currentTaskSegmentIndexResolved + 1 }} / {{ selectedTaskSegmentsResolved.length }}</small>
                    <button
                      type="button"
                      class="knowledge-task-segment-icon-btn"
                      :disabled="!canGoToPreviousSegmentResolved"
                      @click="goToAdjacentTaskSegment(-1)"
                      aria-label="查看上一任务段"
                      title="上一任务段"
                    >
                      <span aria-hidden="true">‹</span>
                    </button>
                    <button
                      type="button"
                      class="knowledge-task-segment-icon-btn"
                      :disabled="!canGoToNextSegmentResolved"
                      @click="goToAdjacentTaskSegment(1)"
                      aria-label="查看下一任务段"
                      title="下一任务段"
                    >
                      <span aria-hidden="true">›</span>
                    </button>
                  </div>
                </div>
              </div>
              <div class="knowledge-task-segment-pager">
                <div class="knowledge-task-segment-current">
                  <div class="knowledge-task-segment-top">
                    <span class="knowledge-chip">{{ selectedTaskReviewItemResolved.segmentLabel }}</span>
                    <span class="knowledge-chip" data-type="capture">{{ formatTaskTypeLabel(selectedTaskReviewItemResolved.taskType) }}</span>
                    <span
                      v-if="selectedTaskReviewItemResolved.isAnswerEssence"
                      class="knowledge-chip"
                      data-type="answer"
                    >
                      回答精华
                    </span>
                    <span
                      class="knowledge-chip"
                      :data-type="getPromotionTargetChipType(selectedTaskReviewItemResolved.predictedPromotionTarget)"
                    >
                      若送审 → {{ formatPromotionTargetLabel(selectedTaskReviewItemResolved.predictedPromotionTarget) }}
                    </span>
                  </div>
                  <strong>{{ selectedTaskReviewItemResolved.title }}</strong>
                  <small>{{ formatTaskActionLabel(selectedTaskReviewItemResolved.recommendedAction) }} · {{ selectedTaskReviewItemResolved.messageCount }} 条消息</small>
                </div>
              </div>
            </article>

            <section class="knowledge-task-detail-grid">
              <article class="knowledge-hint-card knowledge-hint-card--decision">
                <div class="knowledge-hint-head">
                  <IconSparkles :size="16" />
                  <strong>筛选判断</strong>
                </div>
                <div class="knowledge-task-decision-board">
                  <section class="knowledge-task-decision-primary">
                    <div class="knowledge-task-decision-primary-head">
                      <small>推荐动作</small>
                      <span class="knowledge-task-decision-signal" :data-tone="selectedTaskSignalSummaryResolved.tone">
                        综合 {{ selectedTaskSignalSummaryResolved.score }} · {{ selectedTaskSignalSummaryResolved.label }}
                      </span>
                    </div>
                    <strong>{{ formatTaskActionLabel(selectedTaskReviewItemResolved.recommendedAction) }}</strong>
                    <p>结合任务信号、噪声风险和升格价值后的当前处理建议。</p>
                  </section>
                  <section class="knowledge-task-decision-route">
                    <div>
                      <small>升格去向</small>
                      <strong>{{ formatPromotionTargetLabel(selectedTaskReviewItemResolved.predictedPromotionTarget) }}</strong>
                    </div>
                    <div :data-tone="selectedTaskReviewItemResolved.isAnswerEssence ? 'answer' : 'neutral'">
                      <small>回答精华</small>
                      <strong>{{ selectedTaskReviewItemResolved.isAnswerEssence ? '是' : '否' }}</strong>
                    </div>
                  </section>
                </div>
                <div class="knowledge-task-fact-list">
                  <div>
                    <small>来源</small>
                    <strong>{{ selectedTaskReviewSessionResolved.title }}</strong>
                  </div>
                  <div>
                    <small>类型</small>
                    <strong>{{ formatTaskTypeLabel(selectedTaskReviewItemResolved.taskType) }} · {{ selectedTaskReviewItemResolved.segmentLabel }}</strong>
                  </div>
                  <div>
                    <small>项目</small>
                    <strong>{{ selectedTaskReviewItemResolved.project || '待补充' }}</strong>
                  </div>
                  <div>
                    <small>消息</small>
                    <strong>{{ selectedTaskReviewItemResolved.messageCount }} / {{ selectedTaskReviewItemResolved.sessionMessageCount }}</strong>
                  </div>
                </div>
              </article>

              <article class="knowledge-hint-card knowledge-hint-card--signals">
                <div class="knowledge-hint-head">
                  <IconClock3 :size="16" />
                  <strong>任务信号</strong>
                </div>
                <div class="knowledge-task-radar-board">
                  <div class="knowledge-task-radar-visual" :data-tone="selectedTaskSignalSummaryResolved.tone">
                    <svg viewBox="0 0 160 160" role="img" aria-label="任务五维信号盘">
                      <polygon
                        v-for="grid in selectedTaskSignalRadarResolved.gridPolygons"
                        :key="grid.level"
                        class="knowledge-task-radar-grid"
                        :points="grid.points"
                      />
                      <line
                        v-for="axis in selectedTaskSignalRadarResolved.axes"
                        :key="`${axis.id}-axis`"
                        class="knowledge-task-radar-axis"
                        x1="80"
                        y1="80"
                        :x2="axis.axisX"
                        :y2="axis.axisY"
                      />
                      <polygon
                        class="knowledge-task-radar-area"
                        :points="selectedTaskSignalRadarResolved.areaPoints"
                      />
                      <circle
                        v-for="axis in selectedTaskSignalRadarResolved.axes"
                        :key="`${axis.id}-point`"
                        class="knowledge-task-radar-point"
                        :data-accent="axis.accent"
                        :cx="axis.x"
                        :cy="axis.y"
                        r="3.2"
                      />
                      <text
                        v-for="axis in selectedTaskSignalRadarResolved.axes"
                        :key="`${axis.id}-label`"
                        class="knowledge-task-radar-label"
                        :x="axis.labelX"
                        :y="axis.labelY"
                        text-anchor="middle"
                        dominant-baseline="middle"
                      >
                        {{ axis.shortLabel }}
                      </text>
                    </svg>
                    <div class="knowledge-task-radar-center">
                      <strong>{{ selectedTaskSignalSummaryResolved.score }}</strong>
                      <span>{{ selectedTaskSignalSummaryResolved.label }}</span>
                    </div>
                  </div>
                  <div class="knowledge-task-radar-legend">
                    <div
                      v-for="signal in selectedTaskSignalRadarResolved.axes"
                      :key="signal.id"
                      class="knowledge-task-radar-row"
                      :data-accent="signal.accent"
                      :data-tone="scoreTone(signal.score)"
                    >
                      <span>{{ signal.shortLabel }}</span>
                      <i aria-hidden="true">
                        <b :style="{ width: `${signal.score}%` }" />
                      </i>
                      <strong>{{ signal.legendValue }}</strong>
                      <small>{{ signal.legendMeta }}</small>
                    </div>
                  </div>
                </div>
              </article>

              <article class="knowledge-hint-card knowledge-hint-card--answer-route knowledge-hint-card--span-full">
                <div class="knowledge-hint-head">
                  <IconSparkles :size="16" />
                  <strong>回答精华去向</strong>
                </div>
                <div class="knowledge-answer-route-head">
                  <span
                    class="knowledge-chip"
                    :data-type="selectedTaskReviewItemResolved.isAnswerEssence ? 'answer' : 'capture'"
                  >
                    {{ selectedTaskReviewItemResolved.isAnswerEssence ? '回答精华' : '待复核回答' }}
                  </span>
                  <span
                    class="knowledge-chip"
                    :data-type="getPromotionTargetChipType(selectedTaskReviewItemResolved.predictedPromotionTarget)"
                  >
                    {{ formatPromotionTargetLabel(selectedTaskReviewItemResolved.predictedPromotionTarget) }}
                  </span>
                  <span class="knowledge-score-pill" :data-tone="scoreTone(selectedTaskReviewItemResolved.answerValue)">
                    回答 {{ selectedTaskReviewItemResolved.answerValue }}
                  </span>
                </div>
                <p>{{ selectedTaskReviewItemResolved.promotionRouteHint }}</p>
                <ul class="knowledge-answer-route-list">
                  <li
                    v-for="reason in selectedTaskReviewItemResolved.answerEssenceReasons"
                    :key="reason"
                  >
                    {{ reason }}
                  </li>
                </ul>
              </article>
            </section>

            <article class="knowledge-hint-card knowledge-hint-card--span-full">
              <div class="knowledge-hint-head">
                <IconFileText :size="16" />
                <strong>任务段起始问题</strong>
              </div>
              <p>{{ selectedTaskReviewItemResolved.firstUserIntent || '这条会话的显式意图较弱，更依赖前文。' }}</p>
            </article>

            <article class="knowledge-hint-card knowledge-hint-card--span-full knowledge-hint-card--reply">
              <div class="knowledge-hint-head">
                <IconLink2 :size="16" />
                <strong>{{ selectedTaskReviewItemResolved.isAnswerEssence ? '回答精华摘要' : '最近回答摘要' }}</strong>
              </div>
              <MarkdownContent
                class="md-content compact-md"
                :content="resolveTaskMarkdownSource(selectedTaskReviewItemResolved.bestAssistantAnswer || selectedTaskReviewItemResolved.latestAssistantReply)"
              />
              <small>
                审核状态：{{ formatReviewStatusLabel(selectedTaskReviewItemResolved.reviewStatus) }}
                <span v-if="selectedTaskReviewItemResolved.qualityScore !== null"> · 质量分 {{ selectedTaskReviewItemResolved.qualityScore }}</span>
                <span v-if="selectedTaskReviewItemResolved.isAnswerEssence"> · 已命中回答精华信号</span>
                <span> · 更新时间 {{ formatDateTime(selectedTaskReviewItemResolved.updatedAt) }}</span>
              </small>
            </article>

            <article class="knowledge-hint-card knowledge-hint-card--span-full knowledge-hint-card--compact" v-if="formatTagList(selectedTaskReviewItemResolved.tags)">
              <div class="knowledge-hint-head">
                <IconClock3 :size="16" />
                <strong>标签</strong>
              </div>
              <p>{{ formatTagList(selectedTaskReviewItemResolved.tags) }}</p>
            </article>

          </template>

          <div v-else class="knowledge-list-empty">
            <IconSparkles :size="20" />
            <p>先从左侧选一条任务来看。</p>
          </div>
        </section>
      </section>
    </template>

    <template v-else-if="workbenchTabResolved === 'promotion'">
      <section class="knowledge-sources-toolbar promotion-toolbar">
        <div class="promotion-toolbar-head">
          <div>
            <p class="knowledge-sources-eyebrow">Promotion Workbench</p>
            <strong>升格审核控制台</strong>
            <small>这里现在就是默认审核入口。直接从 Issue / Pattern / Synthesis 三类候选里挑合适的条目确认升格。</small>
          </div>
          <div class="promotion-toolbar-refresh">
            <button
              type="button"
              class="icon-btn"
              :disabled="promotionQueueLoading || gbrainPromotionLoading"
              @click="refreshPromotionWorkbench"
              :title="promotionQueueLoading || gbrainPromotionLoading ? '刷新中' : '刷新候选工作台'"
              aria-label="刷新候选工作台"
            >
              <IconRefreshCw v-if="promotionQueueLoading || gbrainPromotionLoading" :size="18" class="animate-spin" />
              <IconRefreshCw v-else :size="18" />
            </button>
          </div>
        </div>

        <div class="promotion-toolbar-summary">
          <article class="promotion-toolbar-metric" data-tone="primary">
            <small>总候选</small>
            <strong>{{ gbrainPromotionAtomsResolved.length }}</strong>
            <span>当前候选池内可审阅的 Atom 数量</span>
          </article>
          <article class="promotion-toolbar-metric" data-tone="success">
            <small>Clean</small>
            <strong>{{ gbrainPromotionQualityCountsResolved.clean }}</strong>
            <span>优先处理这批结构更完整的候选</span>
          </article>
          <article class="promotion-toolbar-metric" data-tone="warning">
            <small>Suspect</small>
            <strong>{{ gbrainPromotionQualityCountsResolved.suspect }}</strong>
            <span>需要二次判断是否值得进入正式知识层</span>
          </article>
        </div>

        <article class="promotion-toolbar-panel">
          <div class="promotion-toolbar-panel-head">
            <div>
              <strong>MVP 自动放行</strong>
              <small>先用 dry-run 看命中范围，再按阈值执行真正放行。</small>
            </div>
            <span class="knowledge-project-pill">自动门禁</span>
          </div>

          <div class="promotion-toolbar-controls">
            <label>
              <small>maxItems</small>
              <input
                v-model.number="promotionMvpAutoMaxItems"
                class="app-input"
                type="number"
                min="1"
                max="500"
                step="1"
              >
            </label>
            <label>
              <small>minConfidence</small>
              <input
                v-model.number="promotionMvpAutoMinConfidence"
                class="app-input"
                type="number"
                min="0"
                max="1"
                step="0.01"
              >
            </label>
          </div>

          <div class="knowledge-review-actions promotion-toolbar-actions">
            <button
              type="button"
              class="app-btn-ghost"
              :disabled="promotionMvpAutoLoading"
              @click="runPromotionMvpAuto(true)"
            >
              <IconSparkles :size="16" />
              {{ promotionMvpAutoLoading ? '运行中…' : 'MVP 自动放行（Dry-run）' }}
            </button>
            <button
              type="button"
              class="app-btn"
              :disabled="promotionMvpAutoLoading"
              @click="runPromotionMvpAuto(false)"
            >
              <IconCheck :size="16" />
              {{ promotionMvpAutoLoading ? '执行中…' : 'MVP 自动放行（执行）' }}
            </button>
          </div>
        </article>
        <div class="knowledge-review-meta" v-if="promotionMvpAutoLastResultResolved">
          <span>
            上次自动放行：
            scanned={{ promotionMvpAutoLastResultResolved.autoSummary?.scanned || 0 }}
            / approved={{ promotionMvpAutoLastResultResolved.autoSummary?.approved || 0 }}
            / skipped={{ promotionMvpAutoLastResultResolved.autoSummary?.skipped || 0 }}
          </span>
          <span>
            threshold(minConfidence)={{ promotionMvpAutoLastResultResolved.autoSummary?.threshold?.value ?? promotionMvpAutoLastResultResolved.minConfidence }}，
            passed={{ promotionMvpAutoLastResultResolved.autoSummary?.threshold?.passed || 0 }}，
            blocked={{ promotionMvpAutoLastResultResolved.autoSummary?.threshold?.blocked || 0 }}，
            dryRun={{ promotionMvpAutoLastResultResolved.dryRun ? 'true' : 'false' }}
          </span>
        </div>
      </section>

      <section class="knowledge-review-board knowledge-review-board--single">
        <article class="knowledge-review-section gbrain-v2-promotion-intro">
          <header class="knowledge-list-head gbrain-v2-promotion-intro-head">
            <div>
              <strong>候选审阅台</strong>
              <small>这里展示系统已经整理好的升格候选。先看质量和证据，合适的直接确认升格。</small>
              <small v-if="gbrainPromotionError">{{ gbrainPromotionError }}</small>
            </div>
            <div class="gbrain-v2-inline-chips">
              <span class="knowledge-project-pill">
                默认流程
              </span>
            </div>
          </header>

          <div class="gbrain-v2-overview-grid gbrain-v2-overview-grid--compact">
            <article class="gbrain-v2-overview-card" data-tone="primary">
              <small>总候选</small>
              <strong>{{ gbrainPromotionAtomsResolved.length }}</strong>
              <span>当前候选池内可审阅的 Atom 数量。</span>
            </article>
            <article class="gbrain-v2-overview-card" data-tone="success">
              <small>Clean</small>
              <strong>{{ gbrainPromotionQualityCountsResolved.clean }}</strong>
              <span>结构更完整，适合优先过一遍。</span>
            </article>
            <article class="gbrain-v2-overview-card" data-tone="warning">
              <small>Suspect</small>
              <strong>{{ gbrainPromotionQualityCountsResolved.suspect }}</strong>
              <span>信息可用，但更适合人工二次确认。</span>
            </article>
            <article class="gbrain-v2-overview-card" data-tone="muted">
              <small>Legacy</small>
            <strong>{{ gbrainPromotionQualityCountsResolved.legacy }}</strong>
            <span>历史债务或字段不齐，建议最后再看。</span>
            </article>
          </div>

          <div class="gbrain-v2-usage-note">
            <strong>建议操作顺序</strong>
            <p>先看 `Pattern` 和 `Issue`。这两类最接近“可以直接变成长期知识页”的状态。</p>
            <p>`Synthesis` 更像结论页候选，只有当标题和摘要已经足够完整时再推进。</p>
          </div>
        </article>

        <div class="knowledge-review-tabs" role="tablist" aria-label="升格审核分类">
          <button
            v-for="tab in gbrainPromotionSectionTabs"
            :key="tab.id"
            type="button"
            class="knowledge-review-tab"
            :class="{ active: activePromotionSection === tab.id }"
            :aria-selected="activePromotionSection === tab.id"
            @click="activePromotionSection = tab.id"
          >
            <div class="knowledge-review-tab-head">
              <strong>{{ tab.label }}</strong>
              <span class="knowledge-list-badge">{{ tab.count }}</span>
            </div>
            <small>{{ tab.description }}</small>
          </button>
        </div>

        <article class="knowledge-review-section">
          <header class="knowledge-list-head">
            <div>
              <strong>{{ gbrainPromotionSectionTabs.find((item) => item.id === activePromotionSection)?.label || '候选视图' }}</strong>
              <small>这里先帮你判断“像不像正式知识”。确认后会直接进入新的 reader-first Vault。</small>
              <small v-if="gbrainPromotionError">{{ gbrainPromotionError }}</small>
            </div>
            <span class="knowledge-list-badge">{{ activePromotionVisibleCountResolved }}</span>
          </header>

          <div v-if="!activePromotionVisibleCountResolved" class="knowledge-list-empty">
            <p>当前分组没有候选条目。</p>
          </div>

          <article
            v-for="item in activeGbrainPromotionItemsResolved"
            :key="String(item.atomId || item.canonicalId || item.pageId || '')"
            class="knowledge-review-card knowledge-review-card--approved gbrain-v2-promotion-card"
          >
            <div class="knowledge-review-card-head">
              <div class="knowledge-review-card-state">
                <span class="knowledge-chip status" data-status="active">
                  {{ formatGbrainPromotionKindLabel(String(item.kind || '')) }}
                </span>
                <span class="knowledge-source-pill" data-source="manual">
                  系统候选
                </span>
                <span class="knowledge-project-pill">
                  {{ formatGbrainStatusLabel(String(item.status || 'draft')) }}
                </span>
              </div>
              <div class="knowledge-review-card-indicator">
                <span class="knowledge-score-pill" :data-tone="scoreTone(Number(item.qualityScore || 0))">
                  质量 {{ Number(item.qualityScore || 0) }}
                </span>
                <span class="knowledge-project-pill">
                  {{ formatConfidenceLabel(String(item.confidence || 'medium')) }}
                </span>
                <span class="knowledge-project-pill">
                  {{ formatGbrainQualityTierLabel(String(item.qualityTier || 'legacy')) }}
                </span>
                <span class="knowledge-review-updated-at">
                  {{ formatDateTime(item.updatedAt) }}
                </span>
              </div>
            </div>

            <div class="knowledge-review-card-copy">
              <strong>{{ item.title || item.pageId || '未命名候选' }}</strong>
              <p>{{ item.summary || '当前候选缺少 summary。' }}</p>
            </div>

            <div class="knowledge-review-context">
              <div class="knowledge-review-context-copy">
                <small>目标页</small>
                <span class="knowledge-review-path">{{ item.pageId || '-' }}</span>
              </div>
              <div class="knowledge-review-context-meta">
                <span class="knowledge-project-pill">{{ item.intakeStage || 'inbox' }}</span>
                <span class="knowledge-project-pill">{{ item.pageType || 'page' }}</span>
                <span class="knowledge-project-pill">{{ item.pageBucket || 'bucket' }}</span>
              </div>
            </div>

            <div class="gbrain-v2-promotion-evidence">
              <div class="knowledge-review-target-row gbrain-v2-evidence-row">
                <small>Evidence / 质量</small>
                <div class="gbrain-v2-evidence-inline">
                  <button
                    v-if="getGbrainPromotionEvidencePaths(item).length"
                    type="button"
                    class="knowledge-evidence-trigger"
                    @click="openPromotionEvidence(getGbrainPromotionEvidencePaths(item))"
                  >
                    {{ getGbrainPromotionEvidencePaths(item).length }} 条详情（source refs {{ Array.isArray(item.sourceRefs) ? item.sourceRefs.length : 0 }}）
                  </button>
                  <span v-else class="knowledge-review-path">暂无可查看 Evidence（source refs {{ Array.isArray(item.sourceRefs) ? item.sourceRefs.length : 0 }}）</span>
                  <div v-if="Array.isArray(item.qualityIssues) && item.qualityIssues.length" class="gbrain-v2-inline-chips">
                    <span v-for="issue in item.qualityIssues.slice(0, 3)" :key="issue" class="knowledge-project-pill">
                      {{ issue }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div class="knowledge-review-actions knowledge-review-actions--queue">
              <button
                type="button"
                class="app-btn-ghost knowledge-review-preview-btn"
                :disabled="promotionPreviewLoading || promotionApplyingKey === promotionItemKey(buildPromotionItemFromGbrainAtom(item))"
                @click="previewPromotionCandidate(buildPromotionItemFromGbrainAtom(item))"
              >
                {{ promotionPreviewLoading ? '预览中…' : '预览变更' }}
              </button>
              <div class="knowledge-review-decision-group">
                <button
                  type="button"
                  class="app-btn-ghost knowledge-review-dismiss-btn"
                  :disabled="promotionApplyingKey === promotionItemKey(buildPromotionItemFromGbrainAtom(item))"
                  @click="openPromotionDecisionConfirm(buildPromotionItemFromGbrainAtom(item), 'dismiss')"
                >
                  {{ promotionApplyingKey === promotionItemKey(buildPromotionItemFromGbrainAtom(item)) ? '处理中…' : '驳回候选' }}
                </button>
                <button
                  type="button"
                  class="app-btn knowledge-review-approve-btn"
                  :disabled="promotionApplyingKey === promotionItemKey(buildPromotionItemFromGbrainAtom(item))"
                  @click="openPromotionDecisionConfirm(buildPromotionItemFromGbrainAtom(item), 'approve')"
                >
                  {{ promotionApplyingKey === promotionItemKey(buildPromotionItemFromGbrainAtom(item)) ? '升格中…' : formatPromotionApproveLabel(buildPromotionItemFromGbrainAtom(item).kind) }}
                </button>
              </div>
            </div>
          </article>

          <article
            v-for="item in activeQueuePromotionItemsResolved"
            :key="promotionItemKey(item)"
            class="knowledge-review-card"
          >
            <div class="knowledge-review-card-head">
              <div class="knowledge-review-card-state">
                <span class="knowledge-chip status" data-status="active">
                  {{ formatPromotionTargetLabel(String(item.kind || '')) }}
                </span>
                <span class="knowledge-source-pill" :data-source="String(item.sourceKind || 'manual')">
                  {{ item.sourceLabel || '会话候选' }}
                </span>
              </div>
              <div class="knowledge-review-card-indicator">
                <span class="knowledge-project-pill">{{ formatDateTime(item.updatedAt) }}</span>
              </div>
            </div>

            <div class="knowledge-review-card-copy">
              <strong>{{ item.title || '未命名候选' }}</strong>
              <p>{{ item.summary || '当前候选缺少 summary。' }}</p>
            </div>

            <div class="knowledge-review-context">
              <div class="knowledge-review-context-copy">
                <small>目标页</small>
                <span class="knowledge-review-path">{{ item.currentPath || item.targetPath || '-' }}</span>
              </div>
              <div class="knowledge-review-context-meta">
                <span class="knowledge-project-pill">{{ item.project || 'unknown-project' }}</span>
                <button
                  v-if="getQueuePromotionEvidencePaths(item).length"
                  type="button"
                  class="knowledge-evidence-trigger"
                  @click="openPromotionEvidence(getQueuePromotionEvidencePaths(item))"
                >
                  {{ getQueuePromotionEvidencePaths(item).length }} 条 Evidence 详情
                </button>
                <span v-else class="knowledge-project-pill">0 条 evidence</span>
              </div>
            </div>

            <div class="knowledge-review-actions knowledge-review-actions--queue">
              <button
                type="button"
                class="app-btn-ghost knowledge-review-preview-btn"
                :disabled="promotionPreviewLoading || promotionApplyingKey === promotionItemKey(item)"
                @click="previewPromotionCandidate(item)"
              >
                {{ promotionPreviewLoading ? '预览中…' : '预览变更' }}
              </button>
              <div class="knowledge-review-decision-group">
                <button
                  type="button"
                  class="app-btn-ghost knowledge-review-dismiss-btn"
                  :disabled="promotionApplyingKey === promotionItemKey(item)"
                  @click="openPromotionDecisionConfirm(item, 'dismiss')"
                >
                  {{ promotionApplyingKey === promotionItemKey(item) ? '处理中…' : '驳回候选' }}
                </button>
                <button
                  type="button"
                  class="app-btn knowledge-review-approve-btn"
                  :disabled="promotionApplyingKey === promotionItemKey(item)"
                  @click="openPromotionDecisionConfirm(item, 'approve')"
                >
                  {{ promotionApplyingKey === promotionItemKey(item) ? '升格中…' : formatPromotionApproveLabel(String(item.kind || '')) }}
                </button>
              </div>
            </div>
          </article>
        </article>
      </section>
    </template>

    <template v-else-if="workbenchTabResolved === 'health'">
      <section class="knowledge-sources-toolbar knowledge-sources-toolbar--stacked">
        <div class="knowledge-filter-group">
          <label>
            <small>报告时间</small>
            <div class="knowledge-static-field">
              <span>{{ formatDateTime(wikiHealthResolved.generatedAt) }}</span>
            </div>
          </label>
          <label>
            <small>Report Path</small>
            <div class="knowledge-static-field">
              <span>{{ wikiHealthResolved.reportPath || 'inbox/wiki-lint-report.md' }}</span>
            </div>
          </label>
          <label class="knowledge-filter-search">
            <small>可读知识页</small>
            <div class="knowledge-static-field">
              <span>{{ wikiHealthResolved.summary.readerFirstNotes || 0 }} / {{ wikiHealthResolved.summary.totalNotes || 0 }}</span>
            </div>
          </label>
          <button
            type="button"
            class="icon-btn"
            :disabled="healthLoading"
            @click="loadWikiHealth(true)"
            :title="healthLoading ? '刷新中' : '刷新健康巡检'"
            aria-label="刷新健康巡检"
          >
            <IconRefreshCw v-if="healthLoading" :size="18" class="animate-spin" />
            <IconRefreshCw v-else :size="18" />
          </button>
          <button
            type="button"
            class="icon-btn"
            :disabled="unref(vaultRebuildLoading)"
            @click="triggerVaultRebuild()"
            :title="unref(vaultRebuildLoading) ? '重建中…' : '重建 Vault 索引（修复 missing-concept / missing-project 类问题）'"
            aria-label="重建 Vault 索引"
          >
            <IconDatabase v-if="!unref(vaultRebuildLoading)" :size="18" />
            <IconRefreshCw v-else :size="18" class="animate-spin" />
          </button>
        </div>

        <div class="knowledge-filter-group">
          <label>
            <small>严重度</small>
            <select v-model="healthSeverityFilter" class="app-select">
              <option value="all">全部</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>

          <label>
            <small>规则</small>
            <select v-model="healthCodeFilter" class="app-select">
              <option value="all">全部规则</option>
              <option
                v-for="option in healthCodeOptionsResolved"
                :key="option.value"
                :value="option.value"
              >
                {{ formatHealthCodeLabel(option.value) }} ({{ option.count }})
              </option>
            </select>
          </label>

          <label class="knowledge-filter-search">
            <small>关键词</small>
            <div class="knowledge-input-with-icon">
              <IconSearch :size="16" />
              <input
                v-model="healthKeyword"
                class="app-input"
                type="text"
                placeholder="搜标题、路径、detail 或 suggestion"
              />
            </div>
          </label>
        </div>
      </section>

      <section v-if="hasGbrainV2ServiceResolved" class="knowledge-review-section knowledge-health-action-section gbrain-v2-workbench">
        <header class="knowledge-list-head gbrain-v2-workbench-head">
          <div>
            <strong>知识引擎状态与抽检</strong>
            <small>这里主要用来确认新 Vault 的候选引擎是否正常工作。日常审核一般不需要改设置，只在排查或抽检时使用。</small>
            <small v-if="gbrainV2Error">{{ gbrainV2Error }}</small>
          </div>
          <div class="gbrain-v2-head-actions">
            <div class="gbrain-v2-inline-chips">
              <span class="knowledge-chip status" data-status="active">
                默认候选引擎
              </span>
              <span class="knowledge-project-pill">
                {{ gbrainV2FeedStatusResolved?.feed?.manifestExists ? '清单就绪' : '清单缺失' }}
              </span>
              <span class="knowledge-project-pill">
                {{ gbrainV2FeedStatusResolved?.feed?.recordsExists ? '数据记录就绪' : '数据记录缺失' }}
              </span>
            </div>
            <button
              type="button"
              class="icon-btn"
              :disabled="gbrainV2Loading"
              @click="loadGbrainV2FeedStatus(true)"
              :title="gbrainV2Loading ? '刷新中' : '刷新知识引擎状态'"
              aria-label="刷新知识引擎状态"
            >
              <IconRefreshCw v-if="gbrainV2Loading" :size="18" class="animate-spin" />
              <IconRefreshCw v-else :size="18" />
            </button>
          </div>
        </header>

        <div class="gbrain-v2-usage-note">
          <strong>什么时候来这里</strong>
          <p>如果升格审核里候选数量不对，先来这里看数据包是否正常刷新、候选和 lineage 是否持续增长。</p>
          <p>如果你只是想处理待升格内容，优先去 `升格审核`，不用先操作这里的任何设置。</p>
        </div>

        <div class="gbrain-v2-overview-grid">
          <article class="gbrain-v2-overview-card" data-tone="info">
            <small>数据包范围</small>
            <strong>{{ formatGbrainFeedModeLabel(gbrainV2SettingsResolved.feedMode) }}</strong>
            <span>当前数据包包含候选与可读知识页的覆盖范围。</span>
          </article>
          <article class="gbrain-v2-overview-card" data-tone="success">
            <small>Atom 总量</small>
            <strong>{{ gbrainV2FeedStatusResolved?.atoms?.total ?? 0 }}</strong>
            <span>active {{ gbrainV2FeedStatusResolved?.atoms?.active ?? 0 }} / archived {{ gbrainV2FeedStatusResolved?.atoms?.archived ?? 0 }}</span>
          </article>
          <article class="gbrain-v2-overview-card" data-tone="warning">
            <small>Lineage 总量</small>
            <strong>{{ gbrainV2FeedStatusResolved?.lineage?.total ?? 0 }}</strong>
            <span>pageId {{ gbrainV2FeedStatusResolved?.lineage?.uniquePageIds ?? 0 }} / canonicalId {{ gbrainV2FeedStatusResolved?.lineage?.uniqueCanonicalIds ?? 0 }}</span>
          </article>
          <article class="gbrain-v2-overview-card" data-tone="muted">
            <small>数据包记录</small>
            <strong>{{ gbrainFeedManifestStatsResolved.total ?? 0 }}</strong>
            <span>候选 {{ gbrainFeedManifestStatsResolved.atoms ?? 0 }} / 可读知识页 {{ gbrainFeedManifestStatsResolved.readerFirst ?? 0 }}</span>
          </article>
          <article class="gbrain-v2-overview-card" data-tone="muted">
            <small>最后产出</small>
            <strong>{{ formatDateTime(gbrainV2FeedStatusResolved?.feed?.manifest?.generatedAt || gbrainV2FeedStatusResolved?.feed?.files?.recordsMtime) }}</strong>
            <span>{{ gbrainV2SettingsResolved.dualWriteEnabled ? 'Dual-write 开启' : 'Dual-write 关闭' }}</span>
          </article>
        </div>

        <div class="gbrain-v2-workbench-grid">
          <article class="gbrain-v2-panel">
            <div class="gbrain-v2-panel-head">
              <div>
                <strong>运行状态</strong>
                <small>新 Vault 已默认走这套引擎。这里不再提供旧链路或对照模式切换，只保留状态确认和数据包刷新。</small>
              </div>
              <span class="knowledge-project-pill">Status</span>
            </div>

            <div class="gbrain-v2-control-grid">
              <label>
                <small>数据包模式</small>
                <div class="knowledge-static-field">
                  <span>{{ formatGbrainFeedModeLabel(gbrainV2SettingsResolved.feedMode) }}</span>
                </div>
              </label>
              <label>
                <small>回源策略</small>
                <div class="knowledge-static-field">
                  <span>{{ gbrainV2SettingsResolved.includeRawFallback ? 'Raw 回源开启' : 'Raw 回源关闭' }}</span>
                </div>
              </label>
            </div>

            <div class="knowledge-review-actions gbrain-v2-action-row">
              <button
                type="button"
                class="app-btn"
                :disabled="gbrainV2FeedRefreshing"
                @click="runGbrainFeedRefresh"
              >
                <IconRefreshCw :size="16" :class="{ 'animate-spin': gbrainV2FeedRefreshing }" />
                {{ gbrainV2FeedRefreshing ? '刷新数据包中…' : '刷新候选数据包' }}
              </button>
            </div>

            <div class="gbrain-v2-inline-meta">
              <span>settings 更新：{{ formatDateTime(gbrainV2SettingsResolved.updatedAt) }}</span>
              <span>数据包目录: {{ gbrainV2FeedStatusResolved?.feed?.feedDir || '-' }}</span>
            </div>
          </article>

          <article class="gbrain-v2-panel">
            <div class="gbrain-v2-panel-head">
              <div>
                <strong>检索抽检</strong>
                <small>输入一个问题，快速确认当前候选引擎会不会把正确的证据顶上来。</small>
              </div>
              <span class="knowledge-project-pill">Retrieve</span>
            </div>

            <label class="knowledge-filter-search gbrain-v2-retrieve-query">
              <small>检索 Query</small>
              <div class="knowledge-input-with-icon">
                <IconSearch :size="16" />
                <input
                  v-model="gbrainRetrieveQuery"
                  class="app-input"
                  type="text"
                  placeholder="输入问题后点击右侧按钮跑候选检索"
                />
              </div>
            </label>

            <div class="knowledge-review-actions gbrain-v2-action-row">
              <button
                type="button"
                class="app-btn"
                :disabled="gbrainRetrieveLoading || !String(gbrainRetrieveQuery || '').trim()"
                @click="runGbrainRetrievePreview"
              >
                <IconSparkles :size="16" />
                {{ gbrainRetrieveLoading ? '检索中…' : '跑一轮检索' }}
              </button>
              <span v-if="gbrainRetrieveResultResolved" class="knowledge-review-path">
                命中 {{ gbrainRetrieveResultResolved.totalMatched }} / 扫描 {{ gbrainRetrieveResultResolved.totalScanned }} · mode={{ gbrainRetrieveResultResolved.mode }}
              </span>
            </div>

            <div v-if="gbrainRetrieveResultResolved" class="gbrain-v2-retrieve-results">
              <article
                v-for="item in gbrainRetrieveItemsResolved.slice(0, 4)"
                :key="item.atomId"
                class="gbrain-v2-retrieve-item"
              >
                <div class="gbrain-v2-retrieve-item-head">
                  <strong>{{ item.title || item.canonicalId }}</strong>
                  <span class="knowledge-score-pill" :data-tone="scoreTone(Number(item.score || 0) * 100)">
                    {{ Math.round(Number(item.score || 0) * 100) / 100 }}
                  </span>
                </div>
                <p>{{ item.snippet || item.summary || '暂无摘要。' }}</p>
                <div class="gbrain-v2-inline-chips">
                  <span class="knowledge-project-pill">{{ formatGbrainPromotionKindLabel(String(item.kind || '')) }}</span>
                  <span class="knowledge-project-pill">{{ formatConfidenceLabel(String(item.confidence || 'medium')) }}</span>
                  <span class="knowledge-project-pill">{{ item.pageId || item.canonicalId || '-' }}</span>
                </div>
              </article>
            </div>

            <div v-else class="knowledge-list-empty gbrain-v2-empty">
              <IconSparkles :size="20" />
              <p>先跑一轮检索，看看当前链路是否把正确证据顶上来。</p>
            </div>
          </article>
        </div>
      </section>

      <section v-if="healthActionQueuesResolved.length" class="knowledge-review-section knowledge-health-action-section">
        <header class="knowledge-list-head">
          <div>
            <strong>建议处理队列</strong>
            <small>先按问题簇推进，能比逐条点击更快形成健康收敛。</small>
            <small v-if="healthBatchActionLoading">{{ healthBatchActionLabel || '正在批量处理…' }}</small>
          </div>
          <span class="knowledge-list-badge">{{ healthActionQueuesResolved.length }}</span>
        </header>

        <div class="knowledge-health-action-grid">
          <article
            v-for="queue in healthActionQueuesResolved"
            :key="queue.id"
            class="knowledge-health-action-card"
          >
            <div class="knowledge-list-item-top">
              <span class="knowledge-chip status" :data-status="queue.severity">{{ formatHealthSeverityLabel(queue.severity) }}</span>
              <span class="knowledge-list-badge">{{ queue.count }}</span>
            </div>
            <strong>{{ queue.title }}</strong>
            <p>{{ queue.description }}</p>
            <small>{{ formatHealthQueueCodes(queue.codes) }}</small>
            <div class="knowledge-review-actions">
              <button
                type="button"
                class="app-btn"
                @click="runHealthQueuePrimaryAction(queue)"
              >
                <IconWrench :size="16" />
                {{ formatHealthQueueActionLabel(queue.target) }}
              </button>
              <button
                type="button"
                class="app-btn-ghost"
                @click="runHealthQueueSecondaryAction(queue)"
              >
                <IconDatabase :size="16" />
                批量看上下文
              </button>
              <button
                v-if="queueHasCode(queue, 'stale-draft-issue')"
                type="button"
                class="app-btn-ghost"
                :disabled="healthBatchActionLoading"
                @click="batchDecideHealthStaleDraftIssues('approve', queue.items || [])"
              >
                <IconCheck :size="16" />
                {{ healthBatchActionLoading ? '处理中…' : '批量升格 stale draft' }}
              </button>
              <button
                v-if="queueHasCode(queue, 'stale-draft-issue')"
                type="button"
                class="app-btn-ghost knowledge-review-dismiss-btn"
                :disabled="healthBatchActionLoading"
                @click="batchDecideHealthStaleDraftIssues('dismiss', queue.items || [])"
              >
                <IconTriangleAlert :size="16" />
                {{ healthBatchActionLoading ? '处理中…' : '批量驳回 stale draft' }}
              </button>
            </div>
          </article>
        </div>
      </section>

      <section class="knowledge-health-layout">
        <article class="knowledge-review-section knowledge-health-section">
          <header class="knowledge-list-head">
            <div>
              <strong>巡检发现</strong>
              <small>先按规则分组浏览，再选中单条问题看详情和下一步动作。</small>
            </div>
            <span class="knowledge-list-badge">{{ filteredHealthFindingsResolved.length }}</span>
          </header>

          <div v-if="!filteredHealthFindingsResolved.length" class="knowledge-list-empty">
            <IconListFilter :size="20" />
            <p>{{ wikiHealthResolved.findings.length ? '当前筛选条件下没有匹配的发现。' : '当前没有 lint findings，wiki 结构比较干净。' }}</p>
          </div>

          <section
            v-for="group in healthFindingGroupsResolved"
            :key="group.code"
            class="knowledge-health-group"
          >
            <header class="knowledge-review-subsection-head knowledge-health-group-head">
              <div>
                <strong>{{ formatHealthCodeLabel(group.code) }}</strong>
                <small>{{ formatHealthGroupDescription(group.code, group.items.length) }}</small>
              </div>
              <span class="knowledge-chip status" :data-status="group.severity">{{ formatHealthSeverityLabel(group.severity) }}</span>
            </header>

            <button
              v-for="item in group.items"
              :key="healthFindingItemKey(item)"
              type="button"
              class="knowledge-health-card knowledge-health-card--interactive"
              :class="{ active: healthFindingItemKey(selectedHealthFindingResolved) === healthFindingItemKey(item) }"
              @click="handleHealthFindingSelect(item)"
            >
              <div class="knowledge-list-item-top">
                <span class="knowledge-chip status" :data-status="item.severity">{{ formatHealthSeverityLabel(item.severity) }}</span>
                <span class="knowledge-health-code">{{ item.code }}</span>
              </div>
              <strong>{{ item.title }}</strong>
              <p>{{ item.detail }}</p>
              <div class="knowledge-review-meta">
                <span>{{ item.relativePath }}</span>
                <span>{{ resolveHealthScope(item.relativePath) }}</span>
              </div>
            </button>
          </section>
        </article>

        <article ref="healthDetailRef" class="knowledge-review-section knowledge-health-section knowledge-health-detail">
          <header class="knowledge-list-head">
            <div>
              <strong>当前详情</strong>
              <small>把问题说明、建议动作和关联页面放到同一个阅读面板里。</small>
            </div>
            <span v-if="selectedHealthFindingResolved" class="knowledge-list-badge">1</span>
          </header>

          <div v-if="!selectedHealthFindingResolved" class="knowledge-list-empty">
            <IconTriangleAlert :size="20" />
            <p>先从左侧选一条巡检发现，右侧再展开详情。</p>
          </div>

          <template v-else>
            <div class="knowledge-evidence-meta knowledge-health-detail-meta">
              <div class="knowledge-evidence-meta-card">
                <small>严重度</small>
                <strong>{{ formatHealthSeverityLabel(selectedHealthFindingResolved.severity) }}</strong>
              </div>
              <div class="knowledge-evidence-meta-card">
                <small>规则</small>
                <strong>{{ formatHealthCodeLabel(selectedHealthFindingResolved.code) }}</strong>
              </div>
              <div class="knowledge-evidence-meta-card">
                <small>定位</small>
                <strong>{{ resolveHealthScope(selectedHealthFindingResolved.relativePath) }}</strong>
              </div>
            </div>

            <div class="knowledge-evidence-section">
              <small>标题</small>
              <strong>{{ selectedHealthFindingResolved.title }}</strong>
            </div>

            <div class="knowledge-evidence-section">
              <small>问题说明</small>
              <p>{{ selectedHealthFindingResolved.detail }}</p>
            </div>

            <div class="knowledge-evidence-section">
              <small>建议动作</small>
              <p>{{ selectedHealthFindingResolved.suggestion || '当前规则还没有提供具体建议。' }}</p>
            </div>

            <div class="knowledge-evidence-section">
              <small>关联页面</small>
              <span class="knowledge-review-path">{{ selectedHealthFindingResolved.relativePath }}</span>
            </div>

            <div
              v-if="isHealthRepairSuggestionAvailable(selectedHealthFindingResolved)"
              class="knowledge-evidence-section knowledge-health-repair-guide"
            >
              <small>断链修复（推荐流程）</small>
              <p>先生成候选目标，再预览替换命中，确认后再执行写入。</p>
              <span v-if="selectedHealthBrokenTargetResolved" class="knowledge-review-path">
                缺失目标：{{ selectedHealthBrokenTargetResolved }}
              </span>
              <button
                type="button"
                class="app-btn"
                @click="openHealthRepairSuggestionDialog(selectedHealthFindingResolved)"
              >
                <IconWrench :size="16" />
                开始修复断链
              </button>
              <button
                v-if="String(selectedHealthFindingResolved?.relativePath || '').startsWith('syntheses/')"
                type="button"
                class="app-btn-ghost"
                @click="cleanHealthBrokenEvidence(selectedHealthFindingResolved)"
              >
                <IconDatabase :size="16" />
                清理失效 Evidence
              </button>
            </div>

            <div class="knowledge-review-actions">
              <button
                type="button"
                class="app-btn"
                @click="openHealthFindingNote(selectedHealthFindingResolved)"
              >
                <IconFolderOpen :size="16" />
                打开关联页面
              </button>
              <button
                type="button"
                class="app-btn-ghost"
                @click="openHealthFindingEvidence(selectedHealthFindingResolved)"
              >
                <IconDatabase :size="16" />
                查看 Source Evidence
              </button>
              <button
                type="button"
                class="app-btn-ghost"
                @click="jumpFromHealthToPromotion(selectedHealthFindingResolved)"
              >
                <IconSparkles :size="16" />
                去升格审核
              </button>
              <button
                type="button"
                class="app-btn-ghost"
                @click="jumpFromHealthToTaskReview(selectedHealthFindingResolved)"
              >
                <IconClock3 :size="16" />
                去升格审核
              </button>
              <button
                v-if="isHealthAnchorSuggestionAvailable(selectedHealthFindingResolved)"
                type="button"
                class="app-btn-ghost"
                @click="openHealthAnchorSuggestionDialog(selectedHealthFindingResolved)"
              >
                <IconLink2 :size="16" />
                生成锚点建议
              </button>
              <button
                v-if="isHealthStaleDraftIssue(selectedHealthFindingResolved)"
                type="button"
                class="app-btn-ghost"
                :disabled="healthBatchActionLoading"
                @click="batchDecideHealthStaleDraftIssues('approve', [selectedHealthFindingResolved])"
              >
                <IconCheck :size="16" />
                {{ healthBatchActionLoading ? '处理中…' : '单条升格' }}
              </button>
              <button
                v-if="isHealthStaleDraftIssue(selectedHealthFindingResolved)"
                type="button"
                class="app-btn-ghost knowledge-review-dismiss-btn"
                :disabled="healthBatchActionLoading"
                @click="batchDecideHealthStaleDraftIssues('dismiss', [selectedHealthFindingResolved])"
              >
                <IconTriangleAlert :size="16" />
                {{ healthBatchActionLoading ? '处理中…' : '单条驳回' }}
              </button>
            </div>

          </template>
        </article>
      </section>
    </template>

    <Dialog :open="healthSuggestionDialogOpen" @update:open="(open) => { healthSuggestionDialogOpen = open }">
      <DialogScrollContent
        class="component-modal-dialog component-modal-dialog--md component-modal-dialog--tone-info knowledge-evidence-dialog"
        :show-close="false"
      >
        <DialogHeader class="component-modal-dialog-header knowledge-evidence-dialog-header">
          <div class="component-modal-dialog-title-row">
            <div class="knowledge-evidence-dialog-title-wrap">
              <DialogTitle class="knowledge-evidence-dialog-title">
                {{ healthSuggestionStateResolved.title || '建议结果' }}
              </DialogTitle>
              <DialogDescription class="form-modal-desc">
                {{ healthSuggestionStateResolved.description || '基于当前 finding 生成的候选页面建议。' }}
              </DialogDescription>
            </div>
            <DialogClose as-child>
              <button type="button" class="app-btn-ghost modal-close-btn" aria-label="关闭建议结果">×</button>
            </DialogClose>
          </div>
        </DialogHeader>

        <div class="component-modal-dialog-body knowledge-evidence-dialog-body">
          <div v-if="healthSuggestionStateResolved.loading" class="knowledge-list-empty knowledge-health-suggestion-empty">
            <IconRefreshCw :size="20" class="animate-spin" />
            <p>正在生成建议…</p>
          </div>

          <div v-else-if="healthSuggestionStateResolved.error" class="knowledge-list-empty knowledge-health-suggestion-empty">
            <IconTriangleAlert :size="20" />
            <p>{{ healthSuggestionStateResolved.error }}</p>
          </div>

          <template v-else-if="healthSuggestionStateResolved.results.length">
            <small v-if="healthSuggestionStateResolved.query" class="knowledge-health-suggestion-query">
              Query: {{ healthSuggestionStateResolved.query }}
            </small>
            <article
              v-for="candidate in healthSuggestionStateResolved.results"
              :key="candidate.path"
              class="knowledge-health-suggestion-item"
            >
              <div class="knowledge-list-item-top">
                <span class="knowledge-chip">{{ candidate.space }}</span>
                <span class="knowledge-list-badge">{{ Math.round(candidate.score || 0) }}</span>
              </div>
              <strong>{{ candidate.title }}</strong>
              <p>{{ candidate.hint }}</p>
              <small>{{ candidate.summary || candidate.excerpt || '暂无摘要。' }}</small>
              <div class="knowledge-review-meta">
                <span>{{ candidate.path }}</span>
                <span>{{ candidate.project || '未标记项目' }}</span>
              </div>
              <div class="knowledge-review-actions">
                <button
                  type="button"
                  class="app-btn-ghost"
                  @click="openHealthSuggestionCandidate(candidate.path, `候选页面 · ${candidate.title}`)"
                >
                  <IconFolderOpen :size="16" />
                  打开候选
                </button>
                <button
                  v-if="healthSuggestionStateResolved.mode === 'repair'"
                  type="button"
                  class="app-btn"
                  :disabled="Boolean(healthRepairApplyingTarget) || healthRepairPreviewLoading"
                  @click="openHealthRepairPreview(selectedHealthFindingResolved, candidate.path)"
                >
                  <IconCheck :size="16" />
                  {{
                    healthRepairPreviewLoading
                      ? '生成预览中…'
                      : '预览替换'
                  }}
                </button>
                <button
                  v-if="healthSuggestionStateResolved.mode === 'anchor'"
                  type="button"
                  class="app-btn"
                  :disabled="Boolean(healthRepairApplyingTarget) || healthAnchorPreviewLoading"
                  @click="openHealthAnchorPreview(selectedHealthFindingResolved, candidate.path)"
                >
                  <IconLink2 :size="16" />
                  {{ healthAnchorPreviewLoading ? '生成预览中…' : '预览插入' }}
                </button>
              </div>
            </article>
          </template>

          <div v-else class="knowledge-list-empty knowledge-health-suggestion-empty">
            <IconListFilter :size="20" />
            <p>当前没有可展示的建议结果。</p>
          </div>
        </div>
      </DialogScrollContent>
    </Dialog>

    <Dialog :open="healthRepairPreviewOpen" @update:open="(open) => { if (!open) closeHealthRepairPreview() }">
      <DialogScrollContent
        class="component-modal-dialog component-modal-dialog--md component-modal-dialog--tone-info knowledge-evidence-dialog"
        :show-close="false"
      >
        <DialogHeader class="component-modal-dialog-header knowledge-evidence-dialog-header">
          <div class="component-modal-dialog-title-row">
            <div class="knowledge-evidence-dialog-title-wrap">
              <DialogTitle class="knowledge-evidence-dialog-title">断链替换预览</DialogTitle>
              <DialogDescription class="form-modal-desc">
                先确认会命中多少处 wikilink，再决定是否写入。
              </DialogDescription>
            </div>
            <DialogClose as-child>
              <button type="button" class="app-btn-ghost modal-close-btn" aria-label="关闭断链替换预览">×</button>
            </DialogClose>
          </div>
        </DialogHeader>

        <div class="component-modal-dialog-body knowledge-evidence-dialog-body">
          <div v-if="healthRepairPreviewLoading" class="knowledge-list-empty knowledge-health-suggestion-empty">
            <IconRefreshCw :size="20" class="animate-spin" />
            <p>正在生成替换预览…</p>
          </div>

          <div v-else-if="healthRepairPreviewError" class="knowledge-list-empty knowledge-health-suggestion-empty">
            <IconTriangleAlert :size="20" />
            <p>{{ healthRepairPreviewError }}</p>
          </div>

          <template v-else-if="healthRepairPreviewData">
            <div class="knowledge-evidence-meta">
              <div class="knowledge-evidence-meta-card">
                <small>关联页面</small>
                <strong>{{ healthRepairPreviewData.path }}</strong>
              </div>
              <div class="knowledge-evidence-meta-card">
                <small>缺失目标</small>
                <strong>{{ healthRepairPreviewData.fromTarget }}</strong>
              </div>
              <div class="knowledge-evidence-meta-card">
                <small>替换目标</small>
                <strong>{{ healthRepairPreviewData.toTarget }}</strong>
              </div>
            </div>

            <div class="knowledge-evidence-section">
              <small>命中数量</small>
              <strong>{{ healthRepairPreviewData.replacedCount }}</strong>
              <p v-if="!healthRepairPreviewData.replacedCount">当前页面没有匹配到这个断链目标，请换一个候选再试。</p>
            </div>

            <div v-if="healthRepairPreviewData.samples.length" class="knowledge-evidence-section">
              <small>替换样例（最多 6 条）</small>
              <div class="knowledge-health-repair-preview-list">
                <article
                  v-for="sample in healthRepairPreviewData.samples"
                  :key="`${sample.line}-${sample.before}-${sample.after}`"
                  class="knowledge-health-repair-preview-item"
                >
                  <span class="knowledge-list-badge">L{{ sample.line }}</span>
                  <code>{{ sample.before }}</code>
                  <span>→</span>
                  <code>{{ sample.after }}</code>
                </article>
              </div>
            </div>

            <div class="knowledge-review-actions">
              <button type="button" class="app-btn-ghost" @click="closeHealthRepairPreview" :disabled="Boolean(healthRepairApplyingTarget)">
                取消
              </button>
              <button
                type="button"
                class="app-btn"
                :disabled="Boolean(healthRepairApplyingTarget) || !healthRepairPreviewData.replacedCount"
                @click="confirmHealthRepairPreview"
              >
                <IconCheck :size="16" />
                {{ healthRepairApplyingTarget ? '替换中…' : '确认替换并写入' }}
              </button>
            </div>
          </template>
        </div>
      </DialogScrollContent>
    </Dialog>

    <Dialog :open="healthAnchorPreviewOpen" @update:open="(open) => { if (!open) closeHealthAnchorPreview() }">
      <DialogScrollContent
        class="component-modal-dialog component-modal-dialog--md component-modal-dialog--tone-info knowledge-evidence-dialog"
        :show-close="false"
      >
        <DialogHeader class="component-modal-dialog-header knowledge-evidence-dialog-header">
          <div class="component-modal-dialog-title-row">
            <div class="knowledge-evidence-dialog-title-wrap">
              <DialogTitle class="knowledge-evidence-dialog-title">回链插入预览</DialogTitle>
              <DialogDescription class="form-modal-desc">
                确认将在候选页面的 Related 段插入指向孤儿页的 wikilink。
              </DialogDescription>
            </div>
            <DialogClose as-child>
              <button type="button" class="app-btn-ghost modal-close-btn" aria-label="关闭回链插入预览">×</button>
            </DialogClose>
          </div>
        </DialogHeader>

        <div class="component-modal-dialog-body knowledge-evidence-dialog-body">
          <div v-if="healthAnchorPreviewLoading" class="knowledge-list-empty knowledge-health-suggestion-empty">
            <IconRefreshCw :size="20" class="animate-spin" />
            <p>正在生成插入预览…</p>
          </div>

          <div v-else-if="healthAnchorPreviewError" class="knowledge-list-empty knowledge-health-suggestion-empty">
            <IconTriangleAlert :size="20" />
            <p>{{ healthAnchorPreviewError }}</p>
          </div>

          <template v-else-if="healthAnchorPreviewData">
            <div class="knowledge-evidence-meta">
              <div class="knowledge-evidence-meta-card">
                <small>候选页面</small>
                <strong>{{ healthAnchorPreviewData.candidatePath }}</strong>
              </div>
              <div class="knowledge-evidence-meta-card">
                <small>孤儿页目标</small>
                <strong>{{ healthAnchorPreviewData.orphanTarget }}</strong>
              </div>
              <div class="knowledge-evidence-meta-card">
                <small>插入位置</small>
                <strong>{{ healthAnchorPreviewData.insertedAt || '—' }}</strong>
              </div>
            </div>

            <div v-if="healthAnchorPreviewData.alreadyLinked" class="knowledge-evidence-section">
              <p>该候选页面已存在指向孤儿页的链接，无需重复插入。</p>
            </div>

            <div class="knowledge-review-actions">
              <button type="button" class="app-btn-ghost" @click="closeHealthAnchorPreview" :disabled="Boolean(healthRepairApplyingTarget)">
                取消
              </button>
              <button
                type="button"
                class="app-btn"
                :disabled="Boolean(healthRepairApplyingTarget) || Boolean(healthAnchorPreviewData.alreadyLinked)"
                @click="confirmHealthAnchorPreview"
              >
                <IconCheck :size="16" />
                {{ healthRepairApplyingTarget ? '写入中…' : '确认插入并写入' }}
              </button>
            </div>
          </template>
        </div>
      </DialogScrollContent>
    </Dialog>

    <Dialog :open="promotionPreviewOpen" @update:open="(open) => { if (!open) closePromotionPreview() }">
      <DialogScrollContent
        class="component-modal-dialog component-modal-dialog--lg component-modal-dialog--tone-info knowledge-evidence-dialog"
        :show-close="false"
      >
        <DialogHeader class="component-modal-dialog-header knowledge-evidence-dialog-header">
          <div class="component-modal-dialog-title-row">
            <div class="knowledge-evidence-dialog-title-wrap">
              <DialogTitle class="knowledge-evidence-dialog-title">
                {{ promotionPreviewDataResolved?.title || 'Promotion 预览' }}
              </DialogTitle>
              <DialogDescription class="form-modal-desc">
                {{
                  promotionPreviewDataResolved
                    ? `${formatPromotionPreviewMode(promotionPreviewDataResolved.mode)} · ${promotionPreviewDataResolved.relativePath}`
                    : '先查看这次升格会写入什么，再决定是否真正落盘。'
                }}
              </DialogDescription>
            </div>
            <DialogClose as-child>
              <button type="button" class="app-btn-ghost modal-close-btn" aria-label="关闭预览">×</button>
            </DialogClose>
          </div>
        </DialogHeader>

        <div class="component-modal-dialog-body knowledge-evidence-dialog-body">
          <div v-if="promotionPreviewLoading" class="knowledge-list-empty knowledge-evidence-dialog-empty">
            <IconRefreshCw :size="20" class="animate-spin" />
            <p>正在生成预览…</p>
          </div>

          <div v-else-if="promotionPreviewError" class="knowledge-list-empty knowledge-evidence-dialog-empty">
            <IconSparkles :size="20" />
            <p>{{ promotionPreviewError }}</p>
          </div>

          <template v-else-if="promotionPreviewDataResolved">
            <div class="knowledge-preview-meta">
              <div class="knowledge-evidence-meta-card">
                <small>目标页</small>
                <strong>{{ promotionPreviewDataResolved.relativePath }}</strong>
              </div>
              <div class="knowledge-evidence-meta-card">
                <small>动作</small>
                <strong>{{ formatPromotionPreviewMode(promotionPreviewDataResolved.mode) }}</strong>
              </div>
              <div class="knowledge-evidence-meta-card">
                <small>Evidence</small>
                <strong>{{ promotionPreviewDataResolved.evidenceCount }}</strong>
              </div>
              <div class="knowledge-evidence-meta-card">
                <small>类型</small>
                <strong>{{ formatPromotionPreviewCategory(promotionPreviewDataResolved.category) }}</strong>
              </div>
            </div>

            <article
              v-if="promotionPreviewDataResolved.question || promotionPreviewDataResolved.summary"
              class="knowledge-evidence-detail-card knowledge-preview-section-card"
            >
              <div class="knowledge-hint-head">
                <IconSparkles :size="16" />
                <strong>答案提炼</strong>
              </div>
              <div class="knowledge-preview-protected-list">
                <div v-if="promotionPreviewDataResolved.question" class="knowledge-evidence-meta-card">
                  <small>原问题</small>
                  <strong>{{ promotionPreviewDataResolved.question }}</strong>
                </div>
                <div v-if="promotionPreviewDataResolved.summary" class="knowledge-evidence-meta-card">
                  <small>精华回答</small>
                  <strong>{{ promotionPreviewDataResolved.summary }}</strong>
                </div>
              </div>
            </article>

            <article
              v-if="promotionPreviewDataResolved.category === 'lightweight-confirmation'"
              class="knowledge-evidence-detail-card knowledge-preview-section-card"
            >
              <div class="knowledge-hint-head">
                <IconSparkles :size="16" />
                <strong>变更摘要</strong>
              </div>
              <p class="knowledge-preview-empty">
                这次主要是把现有草稿页转成正式可读知识页，正文基本不变，重点是状态和审批元数据更新。
              </p>
              <div class="knowledge-preview-protected-list">
                <div
                  v-for="change in promotionPreviewDataResolved.frontmatterChanges"
                  :key="change.field"
                  class="knowledge-evidence-meta-card"
                >
                  <small>{{ formatPreviewFieldLabel(change.field) }}</small>
                  <strong>{{ formatPreviewFieldValue(change.before) }} -> {{ formatPreviewFieldValue(change.after) }}</strong>
                </div>
              </div>
            </article>

            <article
              v-if="promotionPreviewDataResolved.protectedSections?.length"
              class="knowledge-evidence-detail-card knowledge-preview-section-card"
            >
              <div class="knowledge-hint-head">
                <IconFileText :size="16" />
                <strong>保留区块</strong>
              </div>
              <div class="knowledge-preview-protected-list">
                <div
                  v-for="section in promotionPreviewDataResolved.protectedSections"
                  :key="section.heading"
                  class="knowledge-evidence-meta-card"
                >
                  <small>{{ section.heading }}</small>
                  <strong>{{ section.content && section.content !== '-' ? section.content : '当前为空，会原样保留。' }}</strong>
                </div>
              </div>
            </article>

            <article class="knowledge-evidence-detail-card knowledge-preview-section-card">
              <div class="knowledge-hint-head">
                <IconLink2 :size="16" />
                <strong>{{ promotionPreviewDataResolved.category === 'lightweight-confirmation' ? '原始 Patch' : 'Diff 预览' }}</strong>
              </div>
              <p
                v-if="promotionPreviewDataResolved.category === 'lightweight-confirmation'"
                class="knowledge-preview-empty"
              >
                下面保留 raw patch 作为底层核对信息；日常审核时优先看上面的结构化摘要就够了。
              </p>
              <p v-if="!promotionPreviewDataResolved.diff" class="knowledge-preview-empty">
                当前生成结果和现有页面没有差异。
              </p>
              <CodeSyntaxBlock
                v-else
                :code="promotionPreviewDataResolved.diff"
                default-language="diff"
                max-height="420px"
              />
            </article>
          </template>
        </div>
      </DialogScrollContent>
    </Dialog>

    <Dialog :open="promotionViewerOpen" @update:open="(open) => { if (!open) closePromotionViewer() }">
      <DialogScrollContent
        class="component-modal-dialog component-modal-dialog--md component-modal-dialog--tone-info knowledge-evidence-dialog"
        :show-close="false"
      >
        <DialogHeader class="component-modal-dialog-header knowledge-evidence-dialog-header">
          <div class="component-modal-dialog-title-row">
            <div class="knowledge-evidence-dialog-title-wrap">
              <DialogTitle class="knowledge-evidence-dialog-title">{{ promotionViewerTitle || '内容详情' }}</DialogTitle>
              <DialogDescription class="form-modal-desc">
                {{
                  promotionViewerNotesResolved.length > 1
                    ? `共 ${promotionViewerNotesResolved.length} 条内容，按标题、来源、用户意图和提及文件查看。`
                    : (
                      promotionViewerNotesResolved[0]?.title
                      || promotionViewerUnresolvedResolved[0]?.path
                      || promotionViewerPaths?.[0]
                      || '查看该条内容的标题、来源和提及文件。'
                    )
                }}
              </DialogDescription>
            </div>
            <DialogClose as-child>
              <button type="button" class="app-btn-ghost modal-close-btn" aria-label="关闭证据详情">×</button>
            </DialogClose>
          </div>
        </DialogHeader>

        <div class="component-modal-dialog-body knowledge-evidence-dialog-body">
          <div v-if="promotionViewerLoading" class="knowledge-list-empty knowledge-evidence-dialog-empty">
            <IconRefreshCw :size="20" class="animate-spin" />
            <p>正在读取详情…</p>
          </div>

          <div v-else-if="promotionViewerError" class="knowledge-list-empty knowledge-evidence-dialog-empty">
            <IconSparkles :size="20" />
            <p>{{ promotionViewerError }}</p>
          </div>

          <template v-else-if="promotionViewerNotesResolved.length">
            <article
              v-for="note in promotionViewerNotesResolved"
              :key="note.path"
              class="knowledge-evidence-detail-card"
            >
              <div class="knowledge-evidence-meta">
                <div class="knowledge-evidence-meta-card">
                  <small>Provider</small>
                  <strong>{{ note.frontmatter?.provider || 'unknown' }}</strong>
                </div>
                <div class="knowledge-evidence-meta-card">
                  <small>Project</small>
                  <strong>{{ note.project || '待确认' }}</strong>
                </div>
                <div class="knowledge-evidence-meta-card">
                  <small>更新时间</small>
                  <strong>{{ formatDateTime(note.updatedAt) }}</strong>
                </div>
              </div>

              <div class="knowledge-evidence-section">
                <small>标题</small>
                <strong>{{ note.title }}</strong>
              </div>

              <div class="knowledge-evidence-section">
                <small>用户意图</small>
                <p>{{ compactEvidenceIntent(extractEvidenceLine(note.body, 'First user intent')) || '未提取到用户意图。' }}</p>
              </div>

              <div class="knowledge-evidence-section">
                <small>提及文件</small>
                <div class="knowledge-evidence-tags">
                  <span
                    v-for="filePath in parseEvidenceFiles(extractEvidenceLine(note.body, 'Mentioned files'))"
                    :key="filePath"
                    class="knowledge-evidence-tag static"
                  >
                    {{ filePath }}
                  </span>
                  <span
                    v-if="!parseEvidenceFiles(extractEvidenceLine(note.body, 'Mentioned files')).length"
                    class="knowledge-review-path"
                  >
                    暂无明确文件线索
                  </span>
                </div>
              </div>

              <div class="knowledge-evidence-section">
                <small>摘要</small>
                <p>{{ note.summary || '暂无摘要。' }}</p>
              </div>

              <div class="knowledge-evidence-section">
                <small>Source Path</small>
                <span class="knowledge-review-path">{{ note.path }}</span>
              </div>
            </article>
          </template>

          <div v-else class="knowledge-list-empty knowledge-evidence-dialog-empty">
            <IconSparkles :size="20" />
            <p>这批 Evidence 暂时没有可展示的 note 内容。</p>
            <div
              v-if="promotionViewerUnresolvedResolved.length"
              class="knowledge-evidence-unresolved-list"
            >
              <span
                v-for="item in promotionViewerUnresolvedResolved.slice(0, 6)"
                :key="`${item.path}::${item.reason}`"
                class="knowledge-review-path"
              >
                {{ item.path }} · {{ item.reason }}
              </span>
            </div>
          </div>
        </div>
      </DialogScrollContent>
    </Dialog>

    <Dialog :open="promotionDecisionConfirmOpen" @update:open="(open) => { if (!open) closePromotionDecisionConfirm() }">
      <DialogContent class="component-confirm-dialog component-confirm-dialog--compact component-confirm-dialog--tone-warning" :show-close="false">
        <div class="component-confirm-head">
          <h4>{{ promotionDecisionConfirmTitleResolved }}</h4>
          <span class="component-confirm-tone" data-tone="warning">confirm</span>
        </div>
        <p class="component-confirm-desc">{{ promotionDecisionConfirmDescriptionResolved }}</p>
        <p class="confirm-title" v-if="promotionDecisionConfirmItem">「{{ promotionDecisionConfirmItem.title || '当前候选' }}」</p>
        <footer class="component-confirm-actions">
          <button
            type="button"
            class="app-btn-ghost"
            @click="closePromotionDecisionConfirm"
            :disabled="promotionApplyingKey === (promotionDecisionConfirmItem ? promotionItemKey(promotionDecisionConfirmItem) : '')"
          >
            取消
          </button>
          <button
            class="app-btn"
            type="button"
            @click="confirmPromotionDecision"
            :disabled="promotionApplyingKey === (promotionDecisionConfirmItem ? promotionItemKey(promotionDecisionConfirmItem) : '')"
          >
            {{
              promotionApplyingKey === (promotionDecisionConfirmItem ? promotionItemKey(promotionDecisionConfirmItem) : '')
                ? '处理中...'
                : '确认执行'
            }}
          </button>
        </footer>
      </DialogContent>
    </Dialog>

    <Dialog :open="taskReviewConfirmOpen" @update:open="(open) => { if (!open) closeTaskReviewConfirm() }">
      <DialogContent class="component-confirm-dialog component-confirm-dialog--compact component-confirm-dialog--tone-warning" :show-close="false">
        <div class="component-confirm-head">
          <h4>{{ taskReviewConfirmTitleResolved }}</h4>
          <span class="component-confirm-tone" data-tone="warning">confirm</span>
        </div>
        <p class="component-confirm-desc">{{ taskReviewConfirmDescriptionResolved }}</p>
        <p class="confirm-title" v-if="selectedTaskReviewItemResolved">「{{ selectedTaskReviewItemResolved.title || selectedTaskReviewItemResolved.segmentLabel }}」</p>
        <footer class="component-confirm-actions">
          <button
            type="button"
            class="app-btn-ghost"
            @click="closeTaskReviewConfirm"
            :disabled="taskReviewUpdatingId === selectedTaskReviewItemResolved?.id"
          >
            取消
          </button>
          <button
            class="app-btn"
            type="button"
            @click="confirmTaskReviewAction"
            :disabled="taskReviewUpdatingId === selectedTaskReviewItemResolved?.id"
          >
            {{ taskReviewUpdatingId === selectedTaskReviewItemResolved?.id ? '处理中...' : '确认执行' }}
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  </div>
</template>
