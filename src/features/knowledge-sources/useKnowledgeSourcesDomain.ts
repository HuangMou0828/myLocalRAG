import { ref } from 'vue'
import type {
  KnowledgeItemDto,
  KnowledgeItemsApi,
  SessionDataApi,
  WikiVaultApi,
} from '@/services/kbApiServices'
import type { Issue, SessionItem, SessionRetrieveResponse } from '@/features/session/types'
import { useRawInboxDomain } from './useRawInboxDomain'
import { useTaskReviewDomain } from './useTaskReviewDomain'
import { usePromotionReviewDomain } from './usePromotionReviewDomain'
import { useWikiHealthDomain } from './useWikiHealthDomain'

export type { PromotionQueueItem } from './usePromotionReviewDomain'
export type { HealthFinding, HealthActionQueueItem, HealthSuggestionMode } from './useWikiHealthDomain'

type KnowledgeWorkbenchTab = 'raw' | 'task-review' | 'promotion' | 'health'

interface UseKnowledgeSourcesDomainOptions {
  service: KnowledgeItemsApi
  sessionService: SessionDataApi<SessionItem, Issue, SessionRetrieveResponse>
  wikiService: WikiVaultApi
  notify: (message: string, tone?: 'info' | 'success' | 'warning' | 'danger') => void
  onQuickCaptureSaved?: (item: KnowledgeItemDto) => void
}

const STALE_AFTER_MS = 60_000

export function useKnowledgeSourcesDomain(options: UseKnowledgeSourcesDomainOptions) {
  const workbenchTab = ref<KnowledgeWorkbenchTab>('raw')

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

  // Wire cross-domain pointers
  _loadPromotionQueue = promotionReview.loadPromotionQueue
  _loadWikiHealth = wikiHealth.loadWikiHealth
  _loadKnowledgeItems = rawInbox.loadKnowledgeItems
  _getKnowledgeItems = () => rawInbox.knowledgeItems.value
  _getPromotionQueue = () => promotionReview.promotionQueue.value as never
  _openNoteViewer = (paths, title) => promotionReview.openPromotionNoteViewer(paths, title)

  /** 切换 workbench tab 并按需加载对应数据 */
  async function setWorkbenchTab(nextTab: KnowledgeWorkbenchTab) {
    workbenchTab.value = nextTab
    if (nextTab === 'raw') {
      const isStale = !rawInbox.knowledgeItemsLoadedAt.value
        || (Date.now() - rawInbox.knowledgeItemsLoadedAt.value > STALE_AFTER_MS)
      if (isStale) await rawInbox.loadKnowledgeItems()
    }
    if (nextTab === 'task-review') await taskReview.loadTaskReviewSessions(false)
    if (nextTab === 'promotion') await promotionReview.loadPromotionQueue(false)
    if (nextTab === 'health') await wikiHealth.loadWikiHealth(false)
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
