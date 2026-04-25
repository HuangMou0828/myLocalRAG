import { computed, ref } from 'vue'
import type {
  GbrainV2Api,
  KnowledgeItemDto,
  KnowledgeItemsApi,
  SessionDataApi,
  WikiVaultApi,
} from '@/services/kbApiServices'
import type { Issue, SessionItem, SessionRetrieveResponse } from '@/services/sessionContracts'
import { useRawInboxDomain } from './useRawInboxDomain'
import { useTaskReviewDomain } from './useTaskReviewDomain'
import { usePromotionReviewDomain } from './usePromotionReviewDomain'
import { useWikiHealthDomain } from './useWikiHealthDomain'
import { useGbrainV2Domain } from './useGbrainV2Domain'

export type { PromotionQueueItem } from './usePromotionReviewDomain'
export type { HealthFinding, HealthActionQueueItem, HealthSuggestionMode } from './useWikiHealthDomain'

type KnowledgeWorkbenchTab = 'raw' | 'task-review' | 'promotion' | 'health'

type WorkbenchHeroCard = {
  id: string
  title: string
  count: number
  description: string
}

type WorkbenchHero = {
  eyebrow: string
  title: string
  description: string
  cards: WorkbenchHeroCard[]
}

type WorkbenchTabMeta = {
  id: KnowledgeWorkbenchTab
  label: string
  badge: string
  description: string
}

interface UseKnowledgeSourcesDomainOptions {
  service: KnowledgeItemsApi
  gbrainV2Service?: GbrainV2Api | null
  sessionService: SessionDataApi<SessionItem, Issue, SessionRetrieveResponse>
  wikiService: WikiVaultApi
  notify: (message: string, tone?: 'info' | 'success' | 'warning' | 'danger') => void
  onQuickCaptureSaved?: (item: KnowledgeItemDto) => void
}

const STALE_AFTER_MS = 60_000

export function useKnowledgeSourcesDomain(options: UseKnowledgeSourcesDomainOptions) {
  const workbenchTab = ref<KnowledgeWorkbenchTab>('raw')

  const workbenchTabs = computed<WorkbenchTabMeta[]>(() => ([
    {
      id: 'raw',
      label: '知识采集',
      badge: '原料',
      description: '管理 capture / note / document 原始素材',
    },
    {
      id: 'task-review',
      label: '任务筛选',
      badge: '筛选',
      description: '先按任务视角筛掉噪声和上下文碎片',
    },
    {
      id: 'promotion',
      label: '升格审核',
      badge: '候选',
      description: '集中查看待升格 issue / pattern / synthesis 候选',
    },
    {
      id: 'health',
      label: '健康巡检',
      badge: '巡检',
      description: '查看 lint、知识空洞和长期积压提醒',
    },
  ]))

  // Deferred cross-domain pointers — wired after all sub-domains are created
  let _loadPromotionQueue: (force?: boolean) => Promise<void> = async () => {}
  let _loadWikiHealth: (force?: boolean) => Promise<void> = async () => {}
  let _loadKnowledgeItems: () => Promise<void> = async () => {}
  let _getKnowledgeItems: () => KnowledgeItemDto[] = () => []
  let _getPromotionQueue: () => ReturnType<WikiVaultApi['fetchPromotionQueue']> extends Promise<infer R> ? R | null : never = null as never
  let _openNoteViewer: (paths: string[], title: string) => Promise<void> = async () => {}

  const rawInbox = useRawInboxDomain({
    service: options.service,
    notify: options.notify,
    onQuickCaptureSaved: options.onQuickCaptureSaved,
    loadPromotionQueue: (force) => _loadPromotionQueue(force),
  })

  const taskReview = useTaskReviewDomain({
    sessionService: options.sessionService,
    notify: options.notify,
    loadPromotionQueue: (force) => _loadPromotionQueue(force),
  })

  const promotionReview = usePromotionReviewDomain({
    wikiService: options.wikiService,
    service: options.service,
    notify: options.notify,
    loadWikiHealth: (force) => _loadWikiHealth(force),
    loadKnowledgeItems: () => _loadKnowledgeItems(),
    getKnowledgeItems: () => _getKnowledgeItems(),
  })

  const wikiHealth = useWikiHealthDomain({
    wikiService: options.wikiService,
    notify: options.notify,
    loadPromotionQueue: (force) => _loadPromotionQueue(force),
    getPromotionQueue: () => _getPromotionQueue(),
    openNoteViewer: (paths, title) => _openNoteViewer(paths, title),
  })

  const gbrainV2 = useGbrainV2Domain({
    service: options.gbrainV2Service,
    notify: options.notify,
  })

  // Wire cross-domain pointers
  _loadPromotionQueue = promotionReview.loadPromotionQueue
  _loadWikiHealth = wikiHealth.loadWikiHealth
  _loadKnowledgeItems = rawInbox.loadKnowledgeItems
  _getKnowledgeItems = () => rawInbox.knowledgeItems.value
  _getPromotionQueue = () => promotionReview.promotionQueue.value as never
  _openNoteViewer = (paths, title) => promotionReview.openPromotionNoteViewer(paths, title)

  function normalizeWorkbenchHeroCards(value: unknown): WorkbenchHeroCard[] {
    if (!Array.isArray(value)) return []
    return value
      .map((card, index) => ({
        id: String(card?.id || `summary-${index + 1}`),
        title: String(card?.title || ''),
        count: Number(card?.count || 0),
        description: String(card?.description || ''),
      }))
      .filter((card) => card.title || card.description || card.count > 0)
  }

  const workbenchHero = computed<WorkbenchHero>(() => {
    if (workbenchTab.value === 'task-review') {
      return {
        eyebrow: 'Task Review',
        title: '先筛掉噪声，再决定哪些任务段保留到主检索',
        description: '从连续会话里切出任务段，判断检索价值、升格价值和回答沉淀价值。',
        cards: normalizeWorkbenchHeroCards(taskReview.taskReviewSummaryCards.value),
      }
    }

    if (workbenchTab.value === 'promotion') {
      return {
        eyebrow: 'Promotion Review',
        title: '把接近稳定的候选集中审核，避免直接写乱 wiki',
        description: '对 issue / pattern / synthesis 候选做 approve、dismiss 或 revoke，保持知识层级干净。',
        cards: normalizeWorkbenchHeroCards(promotionReview.promotionSummaryCards.value),
      }
    }

    if (workbenchTab.value === 'health') {
      return {
        eyebrow: 'Wiki Health',
        title: '持续巡检结构风险和知识空洞，让内容长期可维护',
        description: '优先处理断链、孤儿页、弱摘要与长期积压，再决定是否回流到升格审核。',
        cards: normalizeWorkbenchHeroCards(wikiHealth.healthSummaryCards.value),
      }
    }

    return {
      eyebrow: 'Raw Inbox',
      title: '先接住原始片段，再决定后续筛选与升格路径',
      description: '集中管理 capture / note / document 原料，补齐上下文后再送入任务筛选或升格审核。',
      cards: normalizeWorkbenchHeroCards(rawInbox.rawSummaryCards.value),
    }
  })

  /** 切换 workbench tab 并按需加载对应数据 */
  async function setWorkbenchTab(nextTab: KnowledgeWorkbenchTab) {
    workbenchTab.value = nextTab
    if (nextTab === 'raw') {
      const isStale = !rawInbox.knowledgeItemsLoadedAt.value
        || (Date.now() - rawInbox.knowledgeItemsLoadedAt.value > STALE_AFTER_MS)
      if (isStale) await rawInbox.loadKnowledgeItems()
    }
    if (nextTab === 'task-review') await taskReview.loadTaskReviewSessions(false)
    if (nextTab === 'promotion') {
      await promotionReview.loadPromotionQueue(false)
      await gbrainV2.loadGbrainV2PromotionView(false)
    }
    if (nextTab === 'health') {
      await wikiHealth.loadWikiHealth(false)
      await gbrainV2.loadGbrainV2FeedStatus(false)
    }
  }

  /** 保存并送审：保存后若 intakeStage 为 wiki-candidate，主动推送 Promotion 队列并跳转 tab */
  async function saveAndSubmitKnowledgeItem() {
    const saved = await rawInbox.saveKnowledgeItem()
    if (!saved || rawInbox.editorIntakeStage.value !== 'wiki-candidate') return saved
    await promotionReview.loadPromotionQueue(true)
    await setWorkbenchTab('promotion')
    return true
  }

  return {
    workbenchTab,
    workbenchTabs,
    workbenchHero,
    setWorkbenchTab,
    saveAndSubmitKnowledgeItem,

    // Raw Inbox
    knowledgeItems: rawInbox.knowledgeItems,
    knowledgeStats: rawInbox.knowledgeStats,
    knowledgeLoading: rawInbox.knowledgeLoading,
    knowledgeSaving: rawInbox.knowledgeSaving,
    selectedKnowledgeItemId: rawInbox.selectedKnowledgeItemId,
    selectedKnowledgeItem: rawInbox.selectedKnowledgeItem,
    filteredKnowledgeItems: rawInbox.filteredKnowledgeItems,
    knowledgeSourceTypeFilter: rawInbox.knowledgeSourceTypeFilter,
    knowledgeStatusFilter: rawInbox.knowledgeStatusFilter,
    knowledgeIntakeStageFilter: rawInbox.knowledgeIntakeStageFilter,
    knowledgeConfidenceFilter: rawInbox.knowledgeConfidenceFilter,
    knowledgeKeyword: rawInbox.knowledgeKeyword,
    summaryCards: rawInbox.rawSummaryCards,
    sourceTypeOptions: rawInbox.sourceTypeOptions,
    statusOptions: rawInbox.statusOptions,
    intakeStageOptions: rawInbox.intakeStageOptions,
    confidenceOptions: rawInbox.confidenceOptions,
    subtypeSuggestions: rawInbox.subtypeSuggestions,
    editorIntakeStageOption: rawInbox.editorIntakeStageOption,
    editorConfidenceOption: rawInbox.editorConfidenceOption,
    editorIntakeSummary: rawInbox.editorIntakeSummary,
    editorId: rawInbox.editorId,
    editorSourceType: rawInbox.editorSourceType,
    editorSourceSubtype: rawInbox.editorSourceSubtype,
    editorStatus: rawInbox.editorStatus,
    editorTitle: rawInbox.editorTitle,
    editorContent: rawInbox.editorContent,
    editorSourceUrl: rawInbox.editorSourceUrl,
    editorSourceFile: rawInbox.editorSourceFile,
    editorTagsInput: rawInbox.editorTagsInput,
    editorProject: rawInbox.editorProject,
    editorTopic: rawInbox.editorTopic,
    editorIntakeStage: rawInbox.editorIntakeStage,
    editorConfidence: rawInbox.editorConfidence,
    editorKeyQuestion: rawInbox.editorKeyQuestion,
    editorDecisionNote: rawInbox.editorDecisionNote,
    editorPreview: rawInbox.editorPreview,
    editorDuplicateCandidates: rawInbox.editorDuplicateCandidates,
    quickCaptureOpen: rawInbox.quickCaptureOpen,
    quickCaptureSaving: rawInbox.quickCaptureSaving,
    quickCaptureMode: rawInbox.quickCaptureMode,
    quickCaptureSourceType: rawInbox.quickCaptureSourceType,
    quickCaptureTitle: rawInbox.quickCaptureTitle,
    quickCaptureContent: rawInbox.quickCaptureContent,
    quickCaptureSourceUrl: rawInbox.quickCaptureSourceUrl,
    quickCaptureTagsInput: rawInbox.quickCaptureTagsInput,
    quickCaptureMarkActive: rawInbox.quickCaptureMarkActive,
    quickCaptureProject: rawInbox.quickCaptureProject,
    quickCaptureTopic: rawInbox.quickCaptureTopic,
    quickCaptureIntakeStage: rawInbox.quickCaptureIntakeStage,
    quickCaptureConfidence: rawInbox.quickCaptureConfidence,
    quickCaptureDecisionNote: rawInbox.quickCaptureDecisionNote,
    quickCapturePreview: rawInbox.quickCapturePreview,
    quickCaptureBatchEntries: rawInbox.quickCaptureBatchEntries,
    quickCaptureCanSave: rawInbox.quickCaptureCanSave,
    quickCaptureSummary: rawInbox.quickCaptureSummary,
    batchImportOpen: rawInbox.batchImportOpen,
    batchImportText: rawInbox.batchImportText,
    batchImportDuplicateMode: rawInbox.batchImportDuplicateMode,
    batchImportSaving: rawInbox.batchImportSaving,
    batchImportRows: rawInbox.batchImportRows,
    batchImportReadyCount: rawInbox.batchImportReadyCount,
    batchImportDuplicateCount: rawInbox.batchImportDuplicateCount,
    batchImportMergeCount: rawInbox.batchImportMergeCount,
    batchImportError: rawInbox.batchImportError,
    openClawSyncOpen: rawInbox.openClawSyncOpen,
    openClawSyncLoading: rawInbox.openClawSyncLoading,
    openClawSyncImporting: rawInbox.openClawSyncImporting,
    openClawSyncPreview: rawInbox.openClawSyncPreview,
    openClawSyncRows: rawInbox.openClawSyncRows,
    openClawSyncSummary: rawInbox.openClawSyncSummary,
    openClawSyncError: rawInbox.openClawSyncError,
    openClawSyncCanImport: rawInbox.openClawSyncCanImport,
    loadKnowledgeItems: rawInbox.loadKnowledgeItems,
    selectKnowledgeItem: rawInbox.selectKnowledgeItem,
    startNewKnowledgeItem: rawInbox.startNewKnowledgeItem,
    saveKnowledgeItem: rawInbox.saveKnowledgeItem,
    updateKnowledgeItemStatus: rawInbox.updateKnowledgeItemStatus,
    deleteKnowledgeItem: rawInbox.deleteKnowledgeItem,
    openQuickCapture: rawInbox.openQuickCapture,
    closeQuickCapture: rawInbox.closeQuickCapture,
    saveQuickCapture: rawInbox.saveQuickCapture,
    openBatchImport: rawInbox.openBatchImport,
    closeBatchImport: rawInbox.closeBatchImport,
    saveBatchImport: rawInbox.saveBatchImport,
    openOpenClawSync: rawInbox.openOpenClawSync,
    closeOpenClawSync: rawInbox.closeOpenClawSync,
    previewOpenClawSync: rawInbox.previewOpenClawSync,
    importOpenClawSync: rawInbox.importOpenClawSync,
    resetEditor: rawInbox.resetEditor,

    // Task Review
    taskReviewLoading: taskReview.taskReviewLoading,
    taskReviewUpdatingId: taskReview.taskReviewUpdatingId,
    taskReviewKeyword: taskReview.taskReviewKeyword,
    taskReviewProviderFilter: taskReview.taskReviewProviderFilter,
    taskReviewStatusFilter: taskReview.taskReviewStatusFilter,
    taskReviewTypeFilter: taskReview.taskReviewTypeFilter,
    taskReviewActionFilter: taskReview.taskReviewActionFilter,
    taskReviewAnswerFilter: taskReview.taskReviewAnswerFilter,
    taskReviewPromotionTargetFilter: taskReview.taskReviewPromotionTargetFilter,
    taskReviewProviderOptions: taskReview.taskReviewProviderOptions,
    taskReviewStatusOptions: taskReview.taskReviewStatusOptions,
    taskReviewTypeOptions: taskReview.taskReviewTypeOptions,
    taskReviewActionFilterOptions: taskReview.taskReviewActionFilterOptions,
    taskReviewAnswerFilterOptions: taskReview.taskReviewAnswerFilterOptions,
    taskReviewPromotionTargetOptions: taskReview.taskReviewPromotionTargetOptions,
    taskReviewSessions: taskReview.taskReviewSessions,
    taskReviewSummaryCards: taskReview.taskReviewSummaryCards,
    selectedTaskReviewSessionId: taskReview.selectedTaskReviewSessionId,
    selectedTaskReviewSegmentId: taskReview.selectedTaskReviewSegmentId,
    selectedTaskReviewSession: taskReview.selectedTaskReviewSession,
    selectedTaskReviewItem: taskReview.selectedTaskReviewItem,
    loadTaskReviewSessions: taskReview.loadTaskReviewSessions,
    selectTaskReviewSession: taskReview.selectTaskReviewSession,
    selectTaskReviewSegment: taskReview.selectTaskReviewSegment,
    applyTaskReviewAction: taskReview.applyTaskReviewAction,

    // Promotion Review
    promotionQueueLoading: promotionReview.promotionQueueLoading,
    promotionQueue: promotionReview.promotionQueue,
    promotionApplyingKey: promotionReview.promotionApplyingKey,
    promotionPreviewOpen: promotionReview.promotionPreviewOpen,
    promotionPreviewLoading: promotionReview.promotionPreviewLoading,
    promotionPreviewError: promotionReview.promotionPreviewError,
    promotionPreviewData: promotionReview.promotionPreviewData,
    promotionViewerOpen: promotionReview.promotionViewerOpen,
    promotionViewerLoading: promotionReview.promotionViewerLoading,
    promotionViewerError: promotionReview.promotionViewerError,
    promotionViewerTitle: promotionReview.promotionViewerTitle,
    promotionViewerPaths: promotionReview.promotionViewerPaths,
    promotionViewerNotes: promotionReview.promotionViewerNotes,
    promotionSummaryCards: promotionReview.promotionSummaryCards,
    loadPromotionQueue: promotionReview.loadPromotionQueue,
    applyPromotionCandidate: promotionReview.applyPromotionCandidate,
    dismissPromotionCandidate: promotionReview.dismissPromotionCandidate,
    revokePromotionCandidate: promotionReview.revokePromotionCandidate,
    previewPromotionCandidate: promotionReview.previewPromotionCandidate,
    openPromotionEvidence: promotionReview.openPromotionEvidence,
    closePromotionPreview: promotionReview.closePromotionPreview,
    closePromotionViewer: promotionReview.closePromotionViewer,

    // Wiki Health
    healthLoading: wikiHealth.healthLoading,
    wikiHealth: wikiHealth.wikiHealth,
    healthSummaryCards: wikiHealth.healthSummaryCards,
    healthSeverityFilter: wikiHealth.healthSeverityFilter,
    healthCodeFilter: wikiHealth.healthCodeFilter,
    healthKeyword: wikiHealth.healthKeyword,
    healthCodeOptions: wikiHealth.healthCodeOptions,
    filteredHealthFindings: wikiHealth.filteredHealthFindings,
    healthFindingGroups: wikiHealth.healthFindingGroups,
    healthActionQueues: wikiHealth.healthActionQueues,
    selectedHealthFinding: wikiHealth.selectedHealthFinding,
    healthSuggestionState: wikiHealth.healthSuggestionState,
    healthBatchActionLoading: wikiHealth.healthBatchActionLoading,
    healthBatchActionLabel: wikiHealth.healthBatchActionLabel,
    healthRepairApplyingTarget: wikiHealth.healthRepairApplyingTarget,
    vaultRebuildLoading: wikiHealth.vaultRebuildLoading,
    hasGbrainV2Service: gbrainV2.hasGbrainV2Service,
    gbrainV2Loading: gbrainV2.gbrainV2Loading,
    gbrainV2Saving: gbrainV2.gbrainV2Saving,
    gbrainV2Error: gbrainV2.gbrainV2Error,
    gbrainV2LoadedAt: gbrainV2.gbrainV2LoadedAt,
    gbrainV2FeedStatus: gbrainV2.gbrainV2FeedStatus,
    gbrainV2FeedRefreshing: gbrainV2.gbrainV2FeedRefreshing,
    gbrainV2Settings: gbrainV2.gbrainV2Settings,
    gbrainRetrieveQuery: gbrainV2.gbrainRetrieveQuery,
    gbrainRetrieveLoading: gbrainV2.gbrainRetrieveLoading,
    gbrainRetrieveResult: gbrainV2.gbrainRetrieveResult,
    gbrainPromotionLoading: gbrainV2.gbrainPromotionLoading,
    gbrainPromotionError: gbrainV2.gbrainPromotionError,
    gbrainPromotionLoadedAt: gbrainV2.gbrainPromotionLoadedAt,
    gbrainPromotionView: gbrainV2.gbrainPromotionView,
    loadGbrainV2FeedStatus: gbrainV2.loadGbrainV2FeedStatus,
    refreshGbrainV2Feed: gbrainV2.refreshGbrainV2Feed,
    loadGbrainV2PromotionView: gbrainV2.loadGbrainV2PromotionView,
    saveGbrainV2Settings: gbrainV2.saveGbrainV2Settings,
    runGbrainV2Retrieve: gbrainV2.runGbrainV2Retrieve,
    loadWikiHealth: wikiHealth.loadWikiHealth,
    selectHealthFinding: wikiHealth.selectHealthFinding,
    loadHealthRepairSuggestions: wikiHealth.loadHealthRepairSuggestions,
    loadHealthAnchorSuggestions: wikiHealth.loadHealthAnchorSuggestions,
    previewHealthRepairSuggestion: wikiHealth.previewHealthRepairSuggestion,
    previewHealthAnchorSuggestion: wikiHealth.previewHealthAnchorSuggestion,
    applyHealthRepairSuggestion: wikiHealth.applyHealthRepairSuggestion,
    applyHealthRepairPlan: wikiHealth.applyHealthRepairPlan,
    applyHealthAnchorPlan: wikiHealth.applyHealthAnchorPlan,
    batchDecideHealthStaleDraftIssues: wikiHealth.batchDecideHealthStaleDraftIssues,
    openHealthFindingNote: wikiHealth.openHealthFindingNote,
    openHealthFindingEvidence: wikiHealth.openHealthFindingEvidence,
    openHealthQueueNotes: wikiHealth.openHealthQueueNotes,
    openHealthQueueEvidence: wikiHealth.openHealthQueueEvidence,
    triggerVaultRebuild: wikiHealth.triggerVaultRebuild,
    cleanHealthBrokenEvidence: wikiHealth.cleanHealthBrokenEvidence,
  }
}
