import { computed, ref } from 'vue'
import type { KnowledgeItemDto, KnowledgeItemsApi, WikiVaultApi } from '@/services/kbApiServices'

type PromotionQueueItem = {
  kind: 'issue-review' | 'pattern-candidate' | 'synthesis-candidate'
  segmentId?: string
  segmentLabel?: string
  title: string
  currentPath?: string
  targetPath?: string
  project?: string
  summary?: string
  evidenceItems: string[]
  sourceKind?: string
  sourceLabel?: string
  taskRef?: string
  updatedAt?: string
  /** 原始采集条目 ID，用于 approve 后回写 promotionRef 链路 */
  sourceKnowledgeItemId?: string
}

type PromotionEvidenceNote = Awaited<ReturnType<WikiVaultApi['fetchNote']>>['note']
type PromotionPreviewResult = Awaited<ReturnType<WikiVaultApi['previewPromotion']>>

export type { PromotionQueueItem, PromotionEvidenceNote, PromotionPreviewResult }

interface UsePromotionReviewDomainOptions {
  wikiService: WikiVaultApi
  service: KnowledgeItemsApi
  notify: (message: string, tone?: 'info' | 'success' | 'warning' | 'danger') => void
  loadWikiHealth: (force?: boolean) => Promise<void>
  loadKnowledgeItems: () => Promise<void>
  getKnowledgeItems: () => KnowledgeItemDto[]
}

export function usePromotionReviewDomain(options: UsePromotionReviewDomainOptions) {
  const promotionQueueLoading = ref(false)
  const promotionQueue = ref<Awaited<ReturnType<WikiVaultApi['fetchPromotionQueue']>> | null>(null)
  const promotionApplyingKey = ref('')
  const promotionPreviewOpen = ref(false)
  const promotionPreviewLoading = ref(false)
  const promotionPreviewError = ref('')
  const promotionPreviewData = ref<PromotionPreviewResult | null>(null)
  const promotionViewerOpen = ref(false)
  const promotionViewerLoading = ref(false)
  const promotionViewerError = ref('')
  const promotionViewerTitle = ref('')
  const promotionViewerPaths = ref<string[]>([])
  const promotionViewerNotes = ref<PromotionEvidenceNote[]>([])

  const promotionSummaryCards = computed(() => {
    const summary = promotionQueue.value?.summary
    return [
      {
        id: 'total',
        title: '候选总数',
        count: Number(summary?.totalItems || 0),
        description: '这些内容已经值得进人工审核队列',
      },
      {
        id: 'issue',
        title: 'Issue Review',
        count: Number(summary?.issueReviewCount || 0),
        description: '证据还薄，需要人兜底确认',
      },
      {
        id: 'pattern',
        title: 'Pattern Candidate',
        count: Number(summary?.patternCandidateCount || 0),
        description: '开始出现复用形状，但还没正式升格',
      },
      {
        id: 'synthesis',
        title: 'Synthesis Candidate',
        count: Number(summary?.synthesisCandidateCount || 0),
        description: '更像问答结论页的候选',
      },
    ]
  })

  function getPromotionItemKey(item: PromotionQueueItem) {
    return [item.kind, item.currentPath || item.targetPath || '', item.title || '']
      .map((value) => String(value || '').trim())
      .join('::')
  }

  async function loadPromotionQueue(force = false) {
    if (promotionQueueLoading.value) return
    if (!force && promotionQueue.value) return
    promotionQueueLoading.value = true
    try {
      promotionQueue.value = await options.wikiService.fetchPromotionQueue(true)
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '加载 Promotion Queue 失败'), 'danger')
    } finally {
      promotionQueueLoading.value = false
    }
  }

  async function applyPromotionCandidate(item: PromotionQueueItem) {
    await decidePromotionCandidate(item, 'approve')
  }

  async function decidePromotionCandidate(
    item: PromotionQueueItem,
    decision: 'approve' | 'dismiss' | 'revoke',
  ) {
    const itemKey = getPromotionItemKey(item)
    if (!itemKey || promotionApplyingKey.value) return
    promotionApplyingKey.value = itemKey
    try {
      await options.wikiService.decidePromotion({
        decision,
        kind: item.kind,
        title: item.title,
        currentPath: item.currentPath,
        targetPath: item.targetPath,
        segmentId: item.segmentId,
        sourceKind: item.sourceKind,
        sourceLabel: item.sourceLabel,
        taskRef: item.taskRef,
        project: item.project,
        summary: item.summary,
        evidenceItems: Array.isArray(item.evidenceItems) ? item.evidenceItems : [],
      })
      await Promise.all([
        loadPromotionQueue(true),
        options.loadWikiHealth(true),
        options.loadKnowledgeItems(),
      ])
      if (decision === 'approve' && item.sourceKnowledgeItemId && item.targetPath) {
        const sourceItem = options.getKnowledgeItems().find(i => i.id === item.sourceKnowledgeItemId)
        if (sourceItem) {
          try {
            await options.service.saveItem({ ...sourceItem, meta: { ...sourceItem.meta, promotionRef: item.targetPath } })
          } catch {
            // 非关键路径，链路写回失败不阻断主流程
          }
        }
      }
      if (decision === 'approve') {
        options.notify('已升格到 reader-first wiki', 'success')
      } else if (decision === 'dismiss') {
        options.notify('已驳回自动候选', 'success')
      } else {
        options.notify('已撤销人工确认，候选会回到自动判断态', 'success')
      }
    } catch (error) {
      const fallbackMessage = decision === 'approve'
        ? '升格失败'
        : decision === 'dismiss'
          ? '驳回失败'
          : '撤销失败'
      options.notify(String(error instanceof Error ? error.message : error || fallbackMessage), 'danger')
    } finally {
      promotionApplyingKey.value = ''
    }
  }

  async function dismissPromotionCandidate(item: PromotionQueueItem) {
    await decidePromotionCandidate(item, 'dismiss')
  }

  async function revokePromotionCandidate(item: PromotionQueueItem) {
    await decidePromotionCandidate(item, 'revoke')
  }

  async function previewPromotionCandidate(item: PromotionQueueItem) {
    if (promotionPreviewLoading.value) return
    promotionPreviewOpen.value = true
    promotionPreviewLoading.value = true
    promotionPreviewError.value = ''
    promotionPreviewData.value = null
    try {
      promotionPreviewData.value = await options.wikiService.previewPromotion({
        kind: item.kind,
        title: item.title,
        currentPath: item.currentPath,
        targetPath: item.targetPath,
        project: item.project,
        summary: item.summary,
        evidenceItems: Array.isArray(item.evidenceItems) ? item.evidenceItems : [],
      })
    } catch (error) {
      promotionPreviewError.value = String(error instanceof Error ? error.message : error || '预览失败')
    } finally {
      promotionPreviewLoading.value = false
    }
  }

  async function openPromotionNoteViewer(paths: string[] | string, title = '内容详情') {
    const relativePaths = (Array.isArray(paths) ? paths : [paths])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
    if (!relativePaths.length || promotionViewerLoading.value) return
    promotionViewerOpen.value = true
    promotionViewerLoading.value = true
    promotionViewerError.value = ''
    promotionViewerTitle.value = title
    promotionViewerPaths.value = relativePaths
    try {
      const settled = await Promise.allSettled(relativePaths.map((relativePath) => options.wikiService.fetchNote(relativePath)))
      promotionViewerNotes.value = settled
        .filter((item): item is PromiseFulfilledResult<{ ok: boolean; note: PromotionEvidenceNote }> => item.status === 'fulfilled')
        .map((item) => item.value?.note || null)
        .filter(Boolean)
      if (!promotionViewerNotes.value.length) {
        promotionViewerError.value = '未读取到详情内容'
      }
    } catch (error) {
      promotionViewerNotes.value = []
      promotionViewerError.value = String(error instanceof Error ? error.message : error || '读取详情失败')
    } finally {
      promotionViewerLoading.value = false
    }
  }

  async function openPromotionEvidence(paths: string[] | string) {
    await openPromotionNoteViewer(paths, '证据详情')
  }

  function closePromotionViewer() {
    promotionViewerOpen.value = false
    promotionViewerLoading.value = false
    promotionViewerError.value = ''
    promotionViewerTitle.value = ''
    promotionViewerPaths.value = []
    promotionViewerNotes.value = []
  }

  function closePromotionPreview() {
    promotionPreviewOpen.value = false
    promotionPreviewLoading.value = false
    promotionPreviewError.value = ''
    promotionPreviewData.value = null
  }

  return {
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
    promotionSummaryCards,
    loadPromotionQueue,
    applyPromotionCandidate,
    dismissPromotionCandidate,
    revokePromotionCandidate,
    previewPromotionCandidate,
    openPromotionNoteViewer,
    openPromotionEvidence,
    closePromotionViewer,
    closePromotionPreview,
  }
}
