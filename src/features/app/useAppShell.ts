import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type ShallowRef } from 'vue'
import type { Issue, SessionItem } from '@/features/session/types'
import type { BugTraceResultItem } from '@/features/bug-trace/useBugTraceDomain'
import { createAppApiClients } from '@/features/app/createAppApiClients'
import { useAppPanelContexts } from '@/features/app/useAppPanelContexts'
import { useAppUiState } from '@/features/app/useAppUiState'
import { useAppViewModes } from '@/features/app/useAppViewModes'
import { useBugInboxFeishuDomain } from '@/features/bug-inbox/useBugInboxFeishuDomain'
import { useFeishuProjectSettingsDomain } from '@/features/feishu-master/useFeishuProjectSettingsDomain'
import { useSessionFlowDomain } from '@/features/session-flow/useSessionFlowDomain'
import { useImportDomain } from '@/features/import/useImportDomain'
import { useSessionFilterDomain } from '@/features/session-filter/useSessionFilterDomain'
import { useSessionDataDomain } from '@/features/session-data/useSessionDataDomain'
import { useUiToastDomain } from '@/features/ui-toast/useUiToastDomain'
import { usePatchDirSettingsDomain } from '@/features/patch-dir-settings/usePatchDirSettingsDomain'
import { usePromptScoreDomain } from '@/features/prompt-score/usePromptScoreDomain'
import { useModelSettingsDomain } from '@/features/model-settings/useModelSettingsDomain'
import { useKnowledgeSourcesDomain } from '@/features/knowledge-sources/useKnowledgeSourcesDomain'
import { useUiSelectionCacheDomain } from '@/features/ui-selection-cache/useUiSelectionCacheDomain'
import { useSessionPresentationDomain } from '@/features/session-presentation/useSessionPresentationDomain'
import { useMessageTagDomain } from '@/features/message-tags/useMessageTagDomain'
import { useProviderNavigationDomain } from '@/features/provider-navigation/useProviderNavigationDomain'
import { useDisplayFormatDomain } from '@/features/display-format/useDisplayFormatDomain'
import { useComponentLibraryDomain } from '@/features/component-library/useComponentLibraryDomain'
import { useWikiVaultSyncDomain } from '@/features/wiki-vault/useWikiVaultSyncDomain'
import { providerCatalog, providerLogoMap, type ProviderId } from '@/features/navigation/providerCatalog'
import type { AppSidebarConfig, AppSidebarMenuKey, AppToolbarConfig } from '@/features/app/appShellComponentConfigs'
import { requestJson } from '@/services/httpClient'

export function useAppShell() {
  const uiState = useAppUiState()

  const allSessions = ref<SessionItem[]>([])
  const issues = ref<Issue[]>([])
  const indexUpdatedAt = ref<string | null>(null)

  const uiToastDomain = useUiToastDomain()

  let patchDirPathResolver: () => string = () => ''
  function getPatchDirFromSettings(): string {
    return patchDirPathResolver()
  }

  let patchDirSyncByPathHandler: ((pathValue: string) => void) | null = null
  function syncPatchDirPresetByPath(pathValue: string) {
    patchDirSyncByPathHandler?.(pathValue)
  }

  const {
    sessionDataApi,
    patchDirSettingsApi,
    modelSettingsApi,
    promptApi,
    messageTagApi,
    importApi,
    knowledgeItemsApi,
    wikiVaultApi,
    bugTraceApi,
    bugInboxFeishuApi,
    feishuProjectSettingsApi,
  } = createAppApiClients(requestJson)

  const bugTraceDomainRef: ShallowRef<Record<string, any> | null> = shallowRef(null)
  const bugTraceDomainLoading = ref(false)
  const bugTraceCodeFallback = ref('')
  const bugTraceCursorRootFallback = ref('/Users/hm/.cursor/projects')
  const bugTraceTopKFallback = ref(8)
  const bugTracePatchTotalFallback = ref<number | null>(null)
  const bugTraceErrorFallback = ref('')
  const bugTraceResultFallback = ref<any | null>(null)
  const bugTraceExpandedPatchFallback = ref('')
  const bugTraceViewModeFallback = ref<'patch' | 'full+patch'>('patch')
  const bugTraceFullViewModeFallback = ref<'all' | 'changed'>('all')
  const bugTraceContextLinesFallback = ref(2)
  const bugTraceCopiedConversationIdFallback = ref('')
  const bugTraceConversationExpandedKeyFallback = ref('')
  const bugTraceConversationDetailLoadingKeyFallback = ref('')
  const bugTracePreviewLoadingKeyFallback = ref('')
  let bugTraceDomainPromise: Promise<void> | null = null

  function getBugTraceCacheKeyFromItem(item: Pick<BugTraceResultItem, 'patchPath' | 'conversationId' | 'score'>): string {
    return `${item.patchPath}::${item.conversationId || ''}::${item.score}`
  }

  function getBugTraceSnippetListFallback(item: BugTraceResultItem) {
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

  async function ensureBugTraceDomainLoaded() {
    if (bugTraceDomainRef.value) return
    if (bugTraceDomainPromise) {
      await bugTraceDomainPromise
      return
    }

    bugTraceDomainPromise = (async () => {
      bugTraceDomainLoading.value = true
      try {
        const { useBugTraceDomain } = await import('@/features/bug-trace/useBugTraceDomain')
        const runtimeDomain = useBugTraceDomain({
          service: bugTraceApi,
          getPatchDir: getPatchDirFromSettings,
          onPatchDirResolved: syncPatchDirPresetByPath,
          notify: uiToastDomain.showToast,
        })
        runtimeDomain.bugTraceCode.value = bugTraceCodeFallback.value
        runtimeDomain.bugTraceCursorRoot.value = bugTraceCursorRootFallback.value
        runtimeDomain.bugTraceTopK.value = bugTraceTopKFallback.value
        runtimeDomain.bugTracePatchTotal.value = bugTracePatchTotalFallback.value
        if (bugTraceErrorFallback.value) runtimeDomain.bugTraceError.value = bugTraceErrorFallback.value
        bugTraceDomainRef.value = runtimeDomain
      } catch (error) {
        bugTraceErrorFallback.value = String(error)
      } finally {
        bugTraceDomainLoading.value = false
      }
    })()

    await bugTraceDomainPromise
  }

  const bugTraceDomainStub = {
    bugTraceCode: bugTraceCodeFallback,
    bugTraceCursorRoot: bugTraceCursorRootFallback,
    bugTraceTopK: bugTraceTopKFallback,
    bugTracePatchTotal: bugTracePatchTotalFallback,
    bugTraceLoading: bugTraceDomainLoading,
    bugTraceError: bugTraceErrorFallback,
    bugTraceResult: bugTraceResultFallback,
    bugTraceCopiedConversationId: bugTraceCopiedConversationIdFallback,
    bugTraceConversationExpandedKey: bugTraceConversationExpandedKeyFallback,
    bugTraceConversationDetailLoadingKey: bugTraceConversationDetailLoadingKeyFallback,
    bugTraceExpandedPatch: bugTraceExpandedPatchFallback,
    bugTraceViewMode: bugTraceViewModeFallback,
    bugTraceFullViewMode: bugTraceFullViewModeFallback,
    bugTraceContextLines: bugTraceContextLinesFallback,
    bugTracePreviewLoadingKey: bugTracePreviewLoadingKeyFallback,
    runBugTrace: async (codeInput?: string) => {
      await ensureBugTraceDomainLoaded()
      await bugTraceDomainRef.value?.runBugTrace(codeInput)
    },
    resetBugTrace: () => {
      bugTraceErrorFallback.value = ''
      bugTraceResultFallback.value = null
      if (bugTraceDomainRef.value) {
        bugTraceDomainRef.value.resetBugTrace()
      }
    },
    copyBugTraceConversationId: async (conversationId: string | null) => {
      if (!bugTraceDomainRef.value) return
      await bugTraceDomainRef.value.copyBugTraceConversationId(conversationId)
    },
    getBugTraceSnippetList: (item: BugTraceResultItem) =>
      bugTraceDomainRef.value?.getBugTraceSnippetList(item) || getBugTraceSnippetListFallback(item),
    renderBugTraceSnippetHtml: (snippetItem: Record<string, any>) =>
      bugTraceDomainRef.value?.renderBugTraceSnippetHtml(snippetItem) || '<div class="bug-trace-snippet-line">-</div>',
    formatBugTraceSnippetSource: (snippet: Record<string, any>) =>
      bugTraceDomainRef.value?.formatBugTraceSnippetSource(snippet) || '-',
    getBugTraceMatchedLocationText: (snippet: Record<string, any>) =>
      bugTraceDomainRef.value?.getBugTraceMatchedLocationText(snippet) || '',
    getBugTraceCacheKey: (item: BugTraceResultItem) =>
      bugTraceDomainRef.value?.getBugTraceCacheKey(item) || getBugTraceCacheKeyFromItem(item),
    ensureConversationDetail: async (item: BugTraceResultItem) => {
      await ensureBugTraceDomainLoaded()
      return await bugTraceDomainRef.value?.ensureConversationDetail(item)
    },
    toggleConversationDetail: async (item: BugTraceResultItem) => {
      await ensureBugTraceDomainLoaded()
      await bugTraceDomainRef.value?.toggleConversationDetail(item)
    },
    getConversationCardKey: (item: BugTraceResultItem) =>
      bugTraceDomainRef.value?.getConversationCardKey(item) || `${getBugTraceCacheKeyFromItem(item)}::conv`,
    getConversationDetail: (item: BugTraceResultItem) =>
      bugTraceDomainRef.value?.getConversationDetail(item) || null,
    getVisibleConversationTurns: (item: BugTraceResultItem) =>
      bugTraceDomainRef.value?.getVisibleConversationTurns(item) || [],
    prepareBugTracePatch: async (item: BugTraceResultItem) => {
      await ensureBugTraceDomainLoaded()
      await bugTraceDomainRef.value?.prepareBugTracePatch(item)
    },
    toggleBugTracePatch: async (item: BugTraceResultItem) => {
      await ensureBugTraceDomainLoaded()
      await bugTraceDomainRef.value?.toggleBugTracePatch(item)
    },
    getBugTraceParsedFiles: (item: BugTraceResultItem) =>
      bugTraceDomainRef.value?.getBugTraceParsedFiles(item) || [],
    toggleBugTraceFileTree: (item: BugTraceResultItem) => {
      bugTraceDomainRef.value?.toggleBugTraceFileTree(item)
    },
    isBugTraceFileTreeCollapsed: (item: BugTraceResultItem) =>
      bugTraceDomainRef.value?.isBugTraceFileTreeCollapsed(item) || false,
    getSelectedBugTraceFile: (item: BugTraceResultItem) =>
      bugTraceDomainRef.value?.getSelectedBugTraceFile(item) || null,
    getBugTraceCodeMirrorModel: (item: BugTraceResultItem) =>
      bugTraceDomainRef.value?.getBugTraceCodeMirrorModel(item) || null,
    selectBugTraceFile: (item: BugTraceResultItem, fileKey: string) => {
      bugTraceDomainRef.value?.selectBugTraceFile(item, fileKey)
    },
    hasBugTraceFilePreview: (item: BugTraceResultItem) =>
      bugTraceDomainRef.value?.hasBugTraceFilePreview(item) || false,
    getBugTraceFilePreview: (item: BugTraceResultItem, file: Record<string, any> | null) =>
      bugTraceDomainRef.value?.getBugTraceFilePreview(item, file) || null,
    setBugTraceFullPreviewRef: (item: BugTraceResultItem, side: 'before' | 'after', el: Element | null) => {
      bugTraceDomainRef.value?.setBugTraceFullPreviewRef(item, side, el)
    },
    onBugTraceFullPreviewScroll: (item: BugTraceResultItem, side: 'before' | 'after') => {
      bugTraceDomainRef.value?.onBugTraceFullPreviewScroll(item, side)
    },
    getBugTraceFullHighlightHtml: (item: BugTraceResultItem, side: 'before' | 'after') =>
      bugTraceDomainRef.value?.getBugTraceFullHighlightHtml(item, side) || '',
    getBugTraceSelectedFileDiffHtml: (item: BugTraceResultItem) =>
      bugTraceDomainRef.value?.getBugTraceSelectedFileDiffHtml(item) || '<div class="warn">Diff 渲染引擎加载中...</div>',
    getBugTraceDiffHtml: (item: BugTraceResultItem) =>
      bugTraceDomainRef.value?.getBugTraceDiffHtml(item) || '<div class="warn">Diff 渲染引擎加载中...</div>',
  }

  const activeBugTraceDomain = computed(() => bugTraceDomainRef.value || bugTraceDomainStub)
  const isBugTraceDomainReady = computed(() => Boolean(bugTraceDomainRef.value))

  const componentLibraryDomain = useComponentLibraryDomain({ notify: uiToastDomain.showToast })

  const sessionFilterDomain = useSessionFilterDomain({
    allSessions,
    activeProvider: uiState.activeProvider,
    providerFilter: uiState.providerFilter,
    timeRangePreset: uiState.timeRangePreset,
    tagFilter: uiState.tagFilter,
    cursorConversationIdFilter: uiState.cursorConversationIdFilter,
    presetTags: uiState.presetTags,
    providerCatalog,
  })

  const sessionFlowDomain = useSessionFlowDomain({
    filteredSessions: sessionFilterDomain.filteredSessions,
    selectedSessionId: uiState.selectedSessionId,
    flowRef: uiState.flowRef,
    anchoredNodeId: uiState.anchoredNodeId,
  })

  const sessionPresentationDomain = useSessionPresentationDomain({
    normalizeRole: sessionFlowDomain.normalizeRole,
  })

  const displayFormatDomain = useDisplayFormatDomain()

  const modelSettingsDomain = useModelSettingsDomain({
    service: modelSettingsApi,
    notify: uiToastDomain.showToast,
  })

  const knowledgeSourcesDomain = useKnowledgeSourcesDomain({
    service: knowledgeItemsApi,
    sessionService: sessionDataApi,
    wikiService: wikiVaultApi,
    notify: uiToastDomain.showToast,
    onQuickCaptureSaved: () => {
      uiState.activeProvider.value = 'knowledge-sources'
      uiState.knowledgeMenuOpen.value = true
    },
  })

  function resolveKnowledgeWorkbenchTab(providerId: string): 'raw' | 'task-review' | 'promotion' | 'health' | '' {
    if (providerId === 'knowledge-task-review') return 'task-review'
    if (providerId === 'knowledge-promotion-review') return 'promotion'
    if (providerId === 'knowledge-health') return 'health'
    if (providerId === 'knowledge-sources') return 'raw'
    return ''
  }

  function resolveKnowledgeProviderFromWorkbenchTab(tab: string): ProviderId | '' {
    if (tab === 'task-review') return 'knowledge-task-review'
    if (tab === 'promotion') return 'knowledge-promotion-review'
    if (tab === 'health') return 'knowledge-health'
    if (tab === 'raw') return 'knowledge-sources'
    return ''
  }

  const wikiVaultSyncDomain = useWikiVaultSyncDomain({
    service: wikiVaultApi,
    activeProvider: uiState.activeProvider,
    availableProviders: sessionFilterDomain.providers,
    getProviderDisplayLabel: sessionFilterDomain.getProviderDisplayLabel,
    notify: uiToastDomain.showToast,
  })

  const sessionDataDomain = useSessionDataDomain({
    service: sessionDataApi,
    allSessions,
    issues,
    indexUpdatedAt,
    keyword: uiState.keyword,
    useVectorSearch: uiState.useVectorSearch,
    providerFilter: uiState.providerFilter,
    timeRangePreset: uiState.timeRangePreset,
    cursorConversationIdFilter: uiState.cursorConversationIdFilter,
    activeProvider: uiState.activeProvider,
    resolveTimeRange: sessionFilterDomain.resolveTimeRange,
    normalizeRole: sessionFlowDomain.normalizeRole,
    sanitizeContent: sessionFlowDomain.sanitizeContent,
    getProviderDisplayLabel: sessionFilterDomain.getProviderDisplayLabel,
  })

  function inferSessionNoticeTone(text: string): 'info' | 'success' | 'warning' | 'danger' {
    const normalized = String(text || '').toLowerCase()
    if (/失败|错误|error|exception|不可用|无法|超时|中断/.test(normalized)) return 'danger'
    if (/提示|warning|fallback|降级|注意/.test(normalized)) return 'warning'
    if (/完成|成功|已|新增|刷新|删除/.test(normalized)) return 'success'
    return 'info'
  }

  const messageTagDomain = useMessageTagDomain({
    service: messageTagApi,
    getSelectedSessionId: () => sessionFlowDomain.selectedSession.value?.id || '',
    loadSessions: sessionDataDomain.loadSessions,
    setErrorText: (text) => {
      sessionDataDomain.errorText.value = text
    },
    setImportResultText: (text) => {
      sessionDataDomain.importResultText.value = text
    },
  })

  const promptScoreDomain = usePromptScoreDomain({
    service: promptApi,
    selectedSessionFlow: sessionFlowDomain.selectedSessionFlow,
    joinChunkText: sessionFlowDomain.joinChunkText,
  })

  const patchDirSettingsDomain = usePatchDirSettingsDomain({
    service: patchDirSettingsApi,
    notify: uiToastDomain.showToast,
    setErrorText: (text) => {
      bugTraceErrorFallback.value = text
      if (bugTraceDomainRef.value) {
        bugTraceDomainRef.value.bugTraceError.value = text
      }
    },
    setPatchTotal: (value) => {
      bugTracePatchTotalFallback.value = value
      if (bugTraceDomainRef.value) {
        bugTraceDomainRef.value.bugTracePatchTotal.value = value
      }
    },
  })
  patchDirPathResolver = patchDirSettingsDomain.getSelectedPatchDirPath
  patchDirSyncByPathHandler = patchDirSettingsDomain.syncPatchDirPresetByPath

  const importDomain = useImportDomain({
    service: importApi,
    activeProvider: uiState.activeProvider,
    providerCatalog,
    setErrorText: (text) => {
      sessionDataDomain.errorText.value = text
    },
    setImportResultText: (text) => {
      sessionDataDomain.importResultText.value = text
    },
    onImported: sessionDataDomain.loadSessions,
  })

  const isBugLocatorMode = computed(() => uiState.activeProvider.value === 'bug-cursor')
  const isFeishuMasterMode = computed(() => uiState.activeProvider.value === 'feishu-master')
  const isFeishuScheduleMode = computed(() => isFeishuMasterMode.value && uiState.feishuMasterSubMenu.value === 'schedule')

  const bugInboxFeishuDomain = useBugInboxFeishuDomain({
    service: bugInboxFeishuApi,
    formatTime: displayFormatDomain.formatTime,
    notify: uiToastDomain.showToast,
    getPatchDir: getPatchDirFromSettings,
    getBugTraceCode: () => bugTraceDomainRef.value?.bugTraceCode.value || bugTraceCodeFallback.value,
    getBugTraceCursorRoot: () => bugTraceDomainRef.value?.bugTraceCursorRoot.value || bugTraceCursorRootFallback.value,
    getBugTraceCacheKey: (item) => bugTraceDomainRef.value?.getBugTraceCacheKey(item) || getBugTraceCacheKeyFromItem(item),
    getBugTraceSnippetList: (item) => bugTraceDomainRef.value?.getBugTraceSnippetList(item) || getBugTraceSnippetListFallback(item),
    isFeishuScheduleMode: () => uiState.activeProvider.value === 'feishu-master' && uiState.feishuMasterSubMenu.value === 'schedule',
  })

  const feishuProjectSettingsDomain = useFeishuProjectSettingsDomain({
    service: feishuProjectSettingsApi,
    notify: uiToastDomain.showToast,
    onSaved: async () => {
      if (!isFeishuScheduleMode.value) return
      if (bugInboxFeishuDomain.feishuScheduleDataFilter.value === 'defect') {
        await bugInboxFeishuDomain.loadFeishuDefectList(true)
        return
      }
      await bugInboxFeishuDomain.loadFeishuTodoList(true)
    },
  })

  const providerNavigationDomain = useProviderNavigationDomain({
    providerCatalog,
    activeProvider: uiState.activeProvider,
    bugTraceSubMenu: uiState.bugTraceSubMenu,
    feishuMasterSubMenu: uiState.feishuMasterSubMenu,
    componentSettingsSubMenu: uiState.componentSettingsSubMenu,
    modelSettingsSubMenu: uiState.modelSettingsSubMenu,
    feishuScheduleDataFilter: bugInboxFeishuDomain.feishuScheduleDataFilter,
    syncImportProviderByActive: importDomain.syncImportProviderByActive,
    loadFeishuDefectList: bugInboxFeishuDomain.loadFeishuDefectList,
    loadFeishuTodoList: bugInboxFeishuDomain.loadFeishuTodoList,
    loadBugInbox: bugInboxFeishuDomain.loadBugInbox,
  })

  const { loadUiSelectionCache } = useUiSelectionCacheDomain({
    providerCatalog,
    activeProvider: uiState.activeProvider,
    selectedSessionId: uiState.selectedSessionId,
    useVectorSearch: uiState.useVectorSearch,
    modelMenuOpen: uiState.modelMenuOpen,
    bugMenuOpen: uiState.bugMenuOpen,
    feishuMenuOpen: uiState.feishuMenuOpen,
    componentMenuOpen: uiState.componentMenuOpen,
    modelSettingsMenuOpen: uiState.modelSettingsMenuOpen,
    knowledgeMenuOpen: uiState.knowledgeMenuOpen,
    bugTraceSubMenu: uiState.bugTraceSubMenu,
    feishuMasterSubMenu: uiState.feishuMasterSubMenu,
    feishuScheduleDataFilter: bugInboxFeishuDomain.feishuScheduleDataFilter,
    componentSettingsSubMenu: uiState.componentSettingsSubMenu,
    modelSettingsSubMenu: uiState.modelSettingsSubMenu,
  })

  const viewModes = useAppViewModes({
    activeProvider: uiState.activeProvider,
    componentSettingsSubMenu: uiState.componentSettingsSubMenu,
    modelSettingsSubMenu: uiState.modelSettingsSubMenu,
    bugTraceSubMenu: uiState.bugTraceSubMenu,
    isBugLocatorMode,
    isFeishuMasterMode,
    providerCatalog,
  })

  const hasKeyword = computed(() => uiState.keyword.value.trim().length > 0)

  const panelContexts = computed(() => useAppPanelContexts({
    uiState: {
      sessionListCollapsed: uiState.sessionListCollapsed,
      keyword: uiState.keyword,
      useVectorSearch: uiState.useVectorSearch,
      advancedFiltersOpen: uiState.advancedFiltersOpen,
      activeProvider: uiState.activeProvider,
      componentSettingsSubMenu: uiState.componentSettingsSubMenu,
      modelSettingsSubMenu: uiState.modelSettingsSubMenu,
      cursorConversationIdFilter: uiState.cursorConversationIdFilter,
      providerFilter: uiState.providerFilter,
      timeRangePreset: uiState.timeRangePreset,
      tagFilter: uiState.tagFilter,
      selectedSessionId: uiState.selectedSessionId,
      flowRef: uiState.flowRef,
      anchoredNodeId: uiState.anchoredNodeId,
      presetTags: uiState.presetTags,
      bugTraceSubMenu: uiState.bugTraceSubMenu,
    },
    flags: {
      isBugLocatorMode,
      isFeishuScheduleMode,
    },
    viewModes: {
      isComponentLibraryMode: viewModes.isComponentLibraryMode,
      isComponentLibraryListMode: viewModes.isComponentLibraryListMode,
      isComponentLibraryModalMode: viewModes.isComponentLibraryModalMode,
      isComponentLibraryConfirmMode: viewModes.isComponentLibraryConfirmMode,
      isComponentLibraryToastMode: viewModes.isComponentLibraryToastMode,
      isComponentLibraryFormMode: viewModes.isComponentLibraryFormMode,
      isComponentLibraryIconMode: viewModes.isComponentLibraryIconMode,
      isModelSettingsMode: viewModes.isModelSettingsMode,
      isKnowledgeSourcesMode: viewModes.isKnowledgeSourcesMode,
    },
    uiToastDomain: {
      uiToastQueue: uiToastDomain.uiToastQueue,
      removeUiToast: uiToastDomain.removeUiToast,
    },
    bugTraceDomain: activeBugTraceDomain.value,
    componentLibraryDomain,
    knowledgeSourcesDomain,
    bugInboxFeishuDomain,
    wikiVaultSyncDomain,
    sessionFilterDomain: {
      activeAdvancedFilterCount: sessionFilterDomain.activeAdvancedFilterCount,
      showRightProviderFilter: sessionFilterDomain.showRightProviderFilter,
      providers: sessionFilterDomain.providers,
      availableTags: sessionFilterDomain.availableTags,
      filteredSessions: sessionFilterDomain.filteredSessions,
      normalizeProviderId: sessionFilterDomain.normalizeProviderId,
      getProviderDisplayLabel: sessionFilterDomain.getProviderDisplayLabel,
      hasKeyword,
    },
    sessionFlowDomain: {
      selectedSession: sessionFlowDomain.selectedSession,
      userAnchorIds: sessionFlowDomain.userAnchorIds,
      jumpToUserAnchor: sessionFlowDomain.jumpToUserAnchor,
      jumpToTurnIndex: sessionFlowDomain.jumpToTurnIndex,
      selectedSessionFlow: sessionFlowDomain.selectedSessionFlow,
      setFlowNodeRef: sessionFlowDomain.setFlowNodeRef,
      getAssistantDisplayChunks: sessionFlowDomain.getAssistantDisplayChunks,
    },
    sessionPresentationDomain: {
      getTurnCount: sessionPresentationDomain.getTurnCount,
      getSessionMessageTags: sessionPresentationDomain.getSessionMessageTags,
      getSessionDisplayTitle: sessionPresentationDomain.getSessionDisplayTitle,
      getSessionRefs: sessionPresentationDomain.getSessionRefs,
    },
    sessionDataDomain: {
      loading: sessionDataDomain.loading,
      errorText: sessionDataDomain.errorText,
      importResultText: sessionDataDomain.importResultText,
      retrieving: sessionDataDomain.retrieving,
      retrieveMeta: sessionDataDomain.retrieveMeta,
      embeddingBuildModalOpen: sessionDataDomain.embeddingBuildModalOpen,
      embeddingBuildMode: sessionDataDomain.embeddingBuildMode,
      embeddingBuildStats: sessionDataDomain.embeddingBuildStats,
      embeddingBuildStatsLoading: sessionDataDomain.embeddingBuildStatsLoading,
      embeddingBuildPreview: sessionDataDomain.embeddingBuildPreview,
      embeddingBuildPreviewLoading: sessionDataDomain.embeddingBuildPreviewLoading,
      embeddingBuildJob: sessionDataDomain.embeddingBuildJob,
      rebuildingEmbeddings: sessionDataDomain.rebuildingEmbeddings,
      rebuildSessionEmbeddings: sessionDataDomain.rebuildSessionEmbeddings,
      openEmbeddingBuildModal: sessionDataDomain.openEmbeddingBuildModal,
      closeEmbeddingBuildModal: sessionDataDomain.closeEmbeddingBuildModal,
      loadEmbeddingBuildPreview: sessionDataDomain.loadEmbeddingBuildPreview,
      updatingSessionReviewId: sessionDataDomain.updatingSessionReviewId,
      updateSessionReview: sessionDataDomain.updateSessionReview,
      deletingSessionId: sessionDataDomain.deletingSessionId,
      deleteConfirmOpen: sessionDataDomain.deleteConfirmOpen,
      pendingDeleteSession: sessionDataDomain.pendingDeleteSession,
      loadSessions: sessionDataDomain.loadSessions,
      openDeleteConfirm: sessionDataDomain.openDeleteConfirm,
      closeDeleteConfirm: sessionDataDomain.closeDeleteConfirm,
      confirmDeleteSession: sessionDataDomain.confirmDeleteSession,
    },
    messageTagDomain: {
      tagModalOpen: messageTagDomain.tagModalOpen,
      tagModalSaving: messageTagDomain.tagModalSaving,
      tagModalTarget: messageTagDomain.tagModalTarget,
      tagModalSelected: messageTagDomain.tagModalSelected,
      openTagModal: messageTagDomain.openTagModal,
      closeTagModal: messageTagDomain.closeTagModal,
      toggleTagSelection: messageTagDomain.toggleTagSelection,
      saveMessageTags: messageTagDomain.saveMessageTags,
    },
    promptScoreDomain: {
      promptScoreModalOpen: promptScoreDomain.promptScoreModalOpen,
      promptScoreLoading: promptScoreDomain.promptScoreLoading,
      promptScoreError: promptScoreDomain.promptScoreError,
      promptScoreTaskType: promptScoreDomain.promptScoreTaskType,
      promptScoreTargetText: promptScoreDomain.promptScoreTargetText,
      promptScoreResult: promptScoreDomain.promptScoreResult,
      promptEffectAssessmentLoading: promptScoreDomain.promptEffectAssessmentLoading,
      promptEffectAssessmentCacheLoading: promptScoreDomain.promptEffectAssessmentCacheLoading,
      promptEffectAssessmentError: promptScoreDomain.promptEffectAssessmentError,
      promptEffectAssessmentResult: promptScoreDomain.promptEffectAssessmentResult,
      promptOptimizeLoading: promptScoreDomain.promptOptimizeLoading,
      promptOptimizeError: promptScoreDomain.promptOptimizeError,
      promptOptimizeResult: promptScoreDomain.promptOptimizeResult,
      promptOptimizeLanguage: promptScoreDomain.promptOptimizeLanguage,
      openPromptScoreModal: promptScoreDomain.openPromptScoreModal,
      closePromptScoreModal: promptScoreDomain.closePromptScoreModal,
      runPromptEffectAssessment: promptScoreDomain.runPromptEffectAssessment,
      runPromptOptimize: promptScoreDomain.runPromptOptimize,
      severityLabel: promptScoreDomain.severityLabel,
      getPromptScoreDimensions: promptScoreDomain.getPromptScoreDimensions,
      getScoreBand: promptScoreDomain.getScoreBand,
      getPromptTaskTypeLabel: promptScoreDomain.getPromptTaskTypeLabel,
      getPromptVerdictLabel: promptScoreDomain.getPromptVerdictLabel,
      getScoreRingStyle: promptScoreDomain.getScoreRingStyle,
      collectPromptSources: promptScoreDomain.collectPromptSources,
      stripOuterCodeFence: promptScoreDomain.stripOuterCodeFence,
      getSourceLegend: promptScoreDomain.getSourceLegend,
      getSourceRadar: promptScoreDomain.getSourceRadar,
    },
    modelSettingsDomain: {
      modelSettings: modelSettingsDomain.modelSettings,
      modelSettingsOpen: modelSettingsDomain.modelSettingsOpen,
      modelSettingsLoading: modelSettingsDomain.modelSettingsLoading,
      modelSettingsSaving: modelSettingsDomain.modelSettingsSaving,
      modelSettingsDraft: modelSettingsDomain.modelSettingsDraft,
      modelCapabilities: modelSettingsDomain.modelCapabilities,
      enabledCapabilityCount: modelSettingsDomain.enabledCapabilityCount,
      selectedModelSettingsItem: modelSettingsDomain.selectedModelSettingsItem,
      modelSettingsTesting: modelSettingsDomain.modelSettingsTesting,
      modelSettingsTestResults: modelSettingsDomain.modelSettingsTestResults,
      modelManagementItems: modelSettingsDomain.modelManagementItems,
      loadModelSettings: modelSettingsDomain.loadModelSettings,
      openModelSettings: modelSettingsDomain.openModelSettings,
      closeModelSettings: modelSettingsDomain.closeModelSettings,
      saveModelSettings: modelSettingsDomain.saveModelSettings,
      resetModelSettingsDraft: modelSettingsDomain.resetModelSettingsDraft,
      testSelectedModelSettings: modelSettingsDomain.testSelectedModelSettings,
    },
    feishuProjectSettingsDomain: {
      feishuProjectSettingsOpen: feishuProjectSettingsDomain.feishuProjectSettingsOpen,
      feishuProjectSettingsLoading: feishuProjectSettingsDomain.feishuProjectSettingsLoading,
      feishuProjectSettingsSaving: feishuProjectSettingsDomain.feishuProjectSettingsSaving,
      feishuProjectSettingsError: feishuProjectSettingsDomain.feishuProjectSettingsError,
      feishuProjectSettings: feishuProjectSettingsDomain.feishuProjectSettings,
      feishuProjectSettingsDraft: feishuProjectSettingsDomain.feishuProjectSettingsDraft,
      feishuProjectSettingsModeLabel: feishuProjectSettingsDomain.feishuProjectSettingsModeLabel,
      closeFeishuProjectSettings: feishuProjectSettingsDomain.closeFeishuProjectSettings,
      resetFeishuProjectSettingsDraft: feishuProjectSettingsDomain.resetFeishuProjectSettingsDraft,
      saveFeishuProjectSettings: feishuProjectSettingsDomain.saveFeishuProjectSettings,
    },
    patchDirSettingsDomain: {
      patchDirSettingsOpen: patchDirSettingsDomain.patchDirSettingsOpen,
      patchDirPresets: patchDirSettingsDomain.patchDirPresets,
      selectedPatchDirPresetId: patchDirSettingsDomain.selectedPatchDirPresetId,
      patchDirTotal: patchDirSettingsDomain.patchDirTotal,
      patchDirDraftAlias: patchDirSettingsDomain.patchDirDraftAlias,
      patchDirDraftPath: patchDirSettingsDomain.patchDirDraftPath,
      patchDirAdding: patchDirSettingsDomain.patchDirAdding,
      patchDirEditingPresetId: patchDirSettingsDomain.patchDirEditingPresetId,
      editingPatchDirPreset: patchDirSettingsDomain.editingPatchDirPreset,
      selectedPatchDirPreset: patchDirSettingsDomain.selectedPatchDirPreset,
      closePatchDirSettings: patchDirSettingsDomain.closePatchDirSettings,
      startEditPatchDirPreset: patchDirSettingsDomain.startEditPatchDirPreset,
      cancelEditPatchDirPreset: patchDirSettingsDomain.cancelEditPatchDirPreset,
      addPatchDirPreset: patchDirSettingsDomain.addPatchDirPreset,
      removePatchDirPreset: patchDirSettingsDomain.removePatchDirPreset,
    },
    importDomain: {
      importing: importDomain.importing,
      previewing: importDomain.previewing,
      importModalOpen: importDomain.importModalOpen,
      folderInputRef: importDomain.folderInputRef,
      importForm: importDomain.importForm,
      importFiles: importDomain.importFiles,
      importPreview: importDomain.importPreview,
      activeProviderLabel: importDomain.activeProviderLabel,
      triggerFolderSelect: importDomain.triggerFolderSelect,
      onFolderPicked: importDomain.onFolderPicked,
      previewImport: importDomain.previewImport,
      importFolder: importDomain.importFolder,
      openImportModal: importDomain.openImportModal,
      closeImportModal: importDomain.closeImportModal,
      resetImportSelection: importDomain.resetImportSelection,
    },
    displayFormatDomain: {
      formatTime: displayFormatDomain.formatTime,
      formatScore: displayFormatDomain.formatScore,
    },
  }))

  const bugLocatorPanelCtx = computed(() => panelContexts.value.bugLocatorPanelCtx)
  const componentLibraryPanelCtx = computed(() => panelContexts.value.componentLibraryPanelCtx)
  const knowledgeSourcesPanelCtx = computed(() => panelContexts.value.knowledgeSourcesPanelCtx)
  const feishuSchedulePanelCtx = computed(() => panelContexts.value.feishuSchedulePanelCtx)
  const sessionWorkspaceCtx = computed(() => panelContexts.value.sessionWorkspaceCtx)
  const overlayModalsCtx = computed(() => panelContexts.value.overlayModalsCtx)

  const shouldMountOverlayModals = computed(() => {
    return (
      uiToastDomain.uiToastQueue.value.length > 0
      || importDomain.importModalOpen.value
      || knowledgeSourcesDomain.quickCaptureOpen.value
      || sessionDataDomain.embeddingBuildModalOpen.value
      || wikiVaultSyncDomain.wikiVaultSyncModalOpen.value
      || modelSettingsDomain.modelSettingsOpen.value
      || feishuProjectSettingsDomain.feishuProjectSettingsOpen.value
      || patchDirSettingsDomain.patchDirSettingsOpen.value
      || sessionDataDomain.deleteConfirmOpen.value
      || bugInboxFeishuDomain.bugInboxDeleteConfirmOpen.value
      || bugInboxFeishuDomain.feishuBatchModalOpen.value
      || messageTagDomain.tagModalOpen.value
      || promptScoreDomain.promptScoreModalOpen.value
      || bugInboxFeishuDomain.feishuBindModalOpen.value
      || bugInboxFeishuDomain.bugInboxDetailModalOpen.value
    )
  })

  function setSidebarMenuOpen(menu: AppSidebarMenuKey, value: boolean) {
    if (menu === 'model') uiState.modelMenuOpen.value = value
    else if (menu === 'bug') uiState.bugMenuOpen.value = value
    else if (menu === 'feishu') uiState.feishuMenuOpen.value = value
    else if (menu === 'component') uiState.componentMenuOpen.value = value
    else if (menu === 'modelSettings') uiState.modelSettingsMenuOpen.value = value
    else uiState.knowledgeMenuOpen.value = value
  }

  function refreshFeishuSchedule() {
    if (bugInboxFeishuDomain.feishuScheduleDataFilter.value === 'defect') {
      void bugInboxFeishuDomain.loadFeishuDefectList(true)
      return
    }
    void bugInboxFeishuDomain.loadFeishuTodoList(true)
  }

  const appSidebarConfig = computed<AppSidebarConfig>(() => ({
    collapsed: uiState.sidebarCollapsed.value,
    menus: {
      model: uiState.modelMenuOpen.value,
      bug: uiState.bugMenuOpen.value,
      feishu: uiState.feishuMenuOpen.value,
      component: uiState.componentMenuOpen.value,
      modelSettings: uiState.modelSettingsMenuOpen.value,
      knowledge: uiState.knowledgeMenuOpen.value,
    },
    navigation: {
      providerSections: sessionFilterDomain.providerSections.value,
      activeProvider: uiState.activeProvider.value,
      providerLogoMap,
      bugTraceSubMenu: uiState.bugTraceSubMenu.value,
      feishuMasterSubMenu: uiState.feishuMasterSubMenu.value,
      componentSettingsSubMenu: uiState.componentSettingsSubMenu.value,
      modelSettingsSubMenu: uiState.modelSettingsSubMenu.value,
    },
    actions: {
      setCollapsed: (value) => {
        uiState.sidebarCollapsed.value = value
      },
      setMenuOpen: setSidebarMenuOpen,
      selectProvider: providerNavigationDomain.selectProvider,
      selectBugLocatorMenu: providerNavigationDomain.selectBugLocatorMenu,
      selectFeishuMasterMenu: providerNavigationDomain.selectFeishuMasterMenu,
      selectComponentSettingsMenu: providerNavigationDomain.selectComponentSettingsMenu,
      selectModelSettingsMenu: providerNavigationDomain.selectModelSettingsMenu,
    },
  }))

  const appToolbarConfig = computed<AppToolbarConfig>(() => ({
    modes: {
      isSpecial: viewModes.isSpecialMode.value,
      isBugLocator: isBugLocatorMode.value,
      isFeishuSchedule: isFeishuScheduleMode.value,
      isModelSettings: viewModes.isModelSettingsMode.value,
      isKnowledgeSources: viewModes.isKnowledgeSourcesMode.value,
      isComponentLibrary: viewModes.isComponentLibraryMode.value,
    },
    navigation: {
      activeMainTitle: viewModes.activeMainTitle.value,
      bugTraceSubMenu: uiState.bugTraceSubMenu.value,
    },
    provider: {
      active: uiState.activeProvider.value,
      refreshing: sessionDataDomain.refreshingProvider.value,
    },
    wikiVault: {
      syncing: wikiVaultSyncDomain.syncingWikiVault.value,
    },
    feishuSchedule: {
      isTodoView: bugInboxFeishuDomain.isFeishuScheduleTodoView.value,
      selectedTodosCount: bugInboxFeishuDomain.selectedFeishuTodos.value.length,
      todoLoading: bugInboxFeishuDomain.feishuTodoLoading.value,
      defectLoading: bugInboxFeishuDomain.feishuDefectLoading.value,
      dataFilter: bugInboxFeishuDomain.feishuScheduleDataFilter.value,
    },
    actions: {
      openFeishuBatchModal: bugInboxFeishuDomain.openFeishuBatchModal,
      openFeishuProjectSettings: feishuProjectSettingsDomain.openFeishuProjectSettings,
      openPatchDirSettings: patchDirSettingsDomain.openPatchDirSettings,
      refreshCurrentProvider: sessionDataDomain.refreshCurrentProvider,
      openEmbeddingBuildModal: sessionDataDomain.openEmbeddingBuildModal,
      refreshFeishuSchedule,
      openImportModal: importDomain.openImportModal,
      openQuickCapture: knowledgeSourcesDomain.openQuickCapture,
      syncWikiVault: wikiVaultSyncDomain.openWikiVaultSyncModal,
    },
  }))

  watch(
    [
      sessionFilterDomain.filteredSessions,
      uiState.activeProvider,
      uiState.providerFilter,
      uiState.timeRangePreset,
      uiState.tagFilter,
    ],
    () => {
      if (!sessionFilterDomain.filteredSessions.value.some((item) => item.id === uiState.selectedSessionId.value)) {
        uiState.selectedSessionId.value = sessionFilterDomain.filteredSessions.value[0]?.id || ''
      }
    },
    { immediate: true },
  )

  watch(
    [uiState.selectedSessionId, sessionFlowDomain.selectedSessionFlow],
    async () => {
      sessionFlowDomain.resetSessionFlowAnchors()
      await nextTick()
    },
    { immediate: true },
  )

  watch(
    () => isBugLocatorMode.value,
    (isBugMode) => {
      if (!isBugMode) return
      void ensureBugTraceDomainLoaded()
    },
    { immediate: true },
  )

  watch(
    () => viewModes.isComponentLibraryMode.value,
    (isComponentLibraryMode) => {
      if (!isComponentLibraryMode) return
      void componentLibraryDomain.ensureComponentLibraryMockData()
    },
    { immediate: true },
  )

  watch(
    () => viewModes.isComponentLibraryToastMode.value,
    (isToastMode) => {
      if (!isToastMode) return
      void componentLibraryDomain.seedComponentLibraryToastSamples()
    },
    { immediate: true },
  )

  watch(
    () => uiState.activeProvider.value,
    (providerId) => {
      const nextTab = resolveKnowledgeWorkbenchTab(String(providerId || ''))
      if (!nextTab) return
      void knowledgeSourcesDomain.setWorkbenchTab(nextTab)
    },
    { immediate: true },
  )

  watch(
    () => knowledgeSourcesDomain.workbenchTab.value,
    (tab) => {
      const nextProvider = resolveKnowledgeProviderFromWorkbenchTab(String(tab || ''))
      if (!nextProvider || uiState.activeProvider.value === nextProvider) return
      uiState.activeProvider.value = nextProvider
      uiState.knowledgeMenuOpen.value = true
    },
  )

  watch(
    () => sessionDataDomain.errorText.value,
    (text) => {
      const message = String(text || '').trim()
      if (!message) return
      uiToastDomain.showToast(message, inferSessionNoticeTone(message))
      sessionDataDomain.errorText.value = ''
    },
  )

  watch(
    () => sessionDataDomain.importResultText.value,
    (text) => {
      const message = String(text || '').trim()
      if (!message) return
      uiToastDomain.showToast(message, inferSessionNoticeTone(message))
      sessionDataDomain.importResultText.value = ''
    },
  )

  onMounted(() => {
    loadUiSelectionCache()
    void patchDirSettingsDomain.loadPatchDirPresets()
    void modelSettingsDomain.loadModelSettings()
    void feishuProjectSettingsDomain.loadFeishuProjectSettings()
    void knowledgeSourcesDomain.loadKnowledgeItems()
    void bugInboxFeishuDomain.loadBugInbox()
    if (uiState.activeProvider.value === 'feishu-master' && uiState.feishuMasterSubMenu.value === 'schedule') {
      if (bugInboxFeishuDomain.feishuScheduleDataFilter.value === 'defect') void bugInboxFeishuDomain.loadFeishuDefectList()
      else void bugInboxFeishuDomain.loadFeishuTodoList()
    }
    void sessionDataDomain.refreshAll()
    window.addEventListener('keydown', sessionFlowDomain.onAnchorHotkey)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', sessionFlowDomain.onAnchorHotkey)
    sessionFlowDomain.disposeSessionFlowDomain()
    uiToastDomain.clearUiToastQueue()
    componentLibraryDomain.clearComponentToastQueue()
  })

  return {
    appSidebarConfig,
    appToolbarConfig,
    sidebarCollapsed: uiState.sidebarCollapsed,
    isBugLocatorMode,
    isBugTraceDomainReady,
    isKnowledgeSourcesMode: viewModes.isKnowledgeSourcesMode,
    isSpecialMode: viewModes.isSpecialMode,

    bugLocatorPanelCtx,
    componentLibraryPanelCtx,
    modelManagementPanelCtx: panelContexts.value.modelManagementPanelCtx,
    knowledgeSourcesPanelCtx,
    feishuSchedulePanelCtx,
    sessionWorkspaceCtx,
    overlayModalsCtx,
    shouldMountOverlayModals,
  }
}
