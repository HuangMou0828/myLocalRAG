import { watch, type Ref } from 'vue'

type BugTraceSubMenu = 'trace' | 'inbox'
type FeishuMasterSubMenu = 'schedule'
type FeishuScheduleDataFilter = 'schedule' | 'defect'
type ComponentSettingsSubMenu = 'list' | 'modal' | 'confirm' | 'toast' | 'form' | 'icon'
type ModelSettingsSubMenu = 'management'

interface ProviderCatalogItem {
  id: string
}

interface UiSelectionCache {
  activeProvider?: string
  selectedSessionId?: string
  useVectorSearch?: boolean
  modelMenuOpen?: boolean
  bugMenuOpen?: boolean
  feishuMenuOpen?: boolean
  componentMenuOpen?: boolean
  modelSettingsMenuOpen?: boolean
  knowledgeMenuOpen?: boolean
  bugTraceSubMenu?: BugTraceSubMenu
  feishuMasterSubMenu?: FeishuMasterSubMenu
  feishuScheduleDataFilter?: FeishuScheduleDataFilter
  componentSettingsSubMenu?: ComponentSettingsSubMenu
  modelSettingsSubMenu?: ModelSettingsSubMenu
}

interface UseUiSelectionCacheDomainOptions {
  providerCatalog: ReadonlyArray<ProviderCatalogItem>
  activeProvider: Ref<string>
  selectedSessionId: Ref<string>
  useVectorSearch: Ref<boolean>
  modelMenuOpen: Ref<boolean>
  bugMenuOpen: Ref<boolean>
  feishuMenuOpen: Ref<boolean>
  componentMenuOpen: Ref<boolean>
  modelSettingsMenuOpen: Ref<boolean>
  knowledgeMenuOpen: Ref<boolean>
  bugTraceSubMenu: Ref<BugTraceSubMenu>
  feishuMasterSubMenu: Ref<FeishuMasterSubMenu>
  feishuScheduleDataFilter: Ref<FeishuScheduleDataFilter>
  componentSettingsSubMenu: Ref<ComponentSettingsSubMenu>
  modelSettingsSubMenu: Ref<ModelSettingsSubMenu>
  storageKey?: string
}

export function useUiSelectionCacheDomain(options: UseUiSelectionCacheDomainOptions) {
  const storageKey = options.storageKey || 'kb.ui.selection.v1'
  let hydrating = false

  function loadUiSelectionCache() {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return

      hydrating = true
      const parsed = JSON.parse(raw) as UiSelectionCache
      const provider = String(parsed?.activeProvider || '').trim()
      if (provider && options.providerCatalog.some((item) => item.id === provider)) {
        options.activeProvider.value = provider
      }

      const sessionId = String(parsed?.selectedSessionId || '').trim()
      if (sessionId) options.selectedSessionId.value = sessionId
      if (typeof parsed?.useVectorSearch === 'boolean') options.useVectorSearch.value = parsed.useVectorSearch
      if (typeof parsed?.modelMenuOpen === 'boolean') options.modelMenuOpen.value = parsed.modelMenuOpen
      if (typeof parsed?.bugMenuOpen === 'boolean') options.bugMenuOpen.value = parsed.bugMenuOpen
      if (typeof parsed?.feishuMenuOpen === 'boolean') options.feishuMenuOpen.value = parsed.feishuMenuOpen
      if (typeof parsed?.componentMenuOpen === 'boolean') options.componentMenuOpen.value = parsed.componentMenuOpen
      if (typeof parsed?.modelSettingsMenuOpen === 'boolean') options.modelSettingsMenuOpen.value = parsed.modelSettingsMenuOpen
      if (typeof parsed?.knowledgeMenuOpen === 'boolean') options.knowledgeMenuOpen.value = parsed.knowledgeMenuOpen
      if (parsed?.bugTraceSubMenu === 'trace' || parsed?.bugTraceSubMenu === 'inbox') {
        options.bugTraceSubMenu.value = parsed.bugTraceSubMenu
      }
      if (parsed?.feishuMasterSubMenu === 'schedule') {
        options.feishuMasterSubMenu.value = parsed.feishuMasterSubMenu
      }
      if (parsed?.feishuScheduleDataFilter === 'schedule' || parsed?.feishuScheduleDataFilter === 'defect') {
        options.feishuScheduleDataFilter.value = parsed.feishuScheduleDataFilter
      }
      if (
        parsed?.componentSettingsSubMenu === 'list' ||
        parsed?.componentSettingsSubMenu === 'modal' ||
        parsed?.componentSettingsSubMenu === 'confirm' ||
        parsed?.componentSettingsSubMenu === 'toast' ||
        parsed?.componentSettingsSubMenu === 'form' ||
        parsed?.componentSettingsSubMenu === 'icon'
      ) {
        options.componentSettingsSubMenu.value = parsed.componentSettingsSubMenu
      }
      if (parsed?.modelSettingsSubMenu === 'management') {
        options.modelSettingsSubMenu.value = parsed.modelSettingsSubMenu
      }
    } catch {
      // ignore cache parse failure
    } finally {
      hydrating = false
    }
  }

  function saveUiSelectionCache() {
    if (typeof window === 'undefined' || hydrating) return
    const payload: UiSelectionCache = {
      activeProvider: String(options.activeProvider.value || ''),
      selectedSessionId: String(options.selectedSessionId.value || ''),
      useVectorSearch: Boolean(options.useVectorSearch.value),
      modelMenuOpen: Boolean(options.modelMenuOpen.value),
      bugMenuOpen: Boolean(options.bugMenuOpen.value),
      feishuMenuOpen: Boolean(options.feishuMenuOpen.value),
      componentMenuOpen: Boolean(options.componentMenuOpen.value),
      modelSettingsMenuOpen: Boolean(options.modelSettingsMenuOpen.value),
      knowledgeMenuOpen: Boolean(options.knowledgeMenuOpen.value),
      bugTraceSubMenu: options.bugTraceSubMenu.value,
      feishuMasterSubMenu: options.feishuMasterSubMenu.value,
      feishuScheduleDataFilter: options.feishuScheduleDataFilter.value,
      componentSettingsSubMenu: options.componentSettingsSubMenu.value,
      modelSettingsSubMenu: options.modelSettingsSubMenu.value,
    }
    localStorage.setItem(storageKey, JSON.stringify(payload))
  }

  watch([options.activeProvider, options.selectedSessionId, options.useVectorSearch], () => {
    saveUiSelectionCache()
  })

  watch([options.modelMenuOpen, options.bugMenuOpen, options.feishuMenuOpen, options.componentMenuOpen, options.modelSettingsMenuOpen, options.knowledgeMenuOpen], () => {
    saveUiSelectionCache()
  })

  watch([options.bugTraceSubMenu, options.feishuMasterSubMenu, options.feishuScheduleDataFilter, options.componentSettingsSubMenu, options.modelSettingsSubMenu], () => {
    saveUiSelectionCache()
  })

  return {
    loadUiSelectionCache,
    saveUiSelectionCache,
  }
}
