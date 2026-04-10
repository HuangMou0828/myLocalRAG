import type { Ref } from 'vue'

type BugTraceSubMenu = 'trace' | 'inbox'
type FeishuMasterSubMenu = 'schedule'
type FeishuScheduleDataFilter = 'schedule' | 'defect'
type ComponentSettingsSubMenu = 'list' | 'modal' | 'confirm' | 'toast' | 'form' | 'icon'
type ModelSettingsSubMenu = 'management'

interface ProviderCatalogItem {
  id: string
}

interface UseProviderNavigationDomainOptions {
  providerCatalog: ReadonlyArray<ProviderCatalogItem>
  activeProvider: Ref<string>
  bugTraceSubMenu: Ref<BugTraceSubMenu>
  feishuMasterSubMenu: Ref<FeishuMasterSubMenu>
  componentSettingsSubMenu: Ref<ComponentSettingsSubMenu>
  modelSettingsSubMenu: Ref<ModelSettingsSubMenu>
  feishuScheduleDataFilter: Ref<FeishuScheduleDataFilter>
  syncImportProviderByActive: (providerId: string) => void
  loadFeishuDefectList: () => Promise<void> | void
  loadFeishuTodoList: () => Promise<void> | void
  loadBugInbox: () => Promise<void> | void
}

export function useProviderNavigationDomain(options: UseProviderNavigationDomainOptions) {
  function selectProvider(providerId: string) {
    const normalized = String(providerId || '').trim()
    if (!options.providerCatalog.some((item) => item.id === normalized)) return

    options.activeProvider.value = normalized
    if (normalized !== 'bug-cursor') {
      options.bugTraceSubMenu.value = 'trace'
    }
    if (normalized !== 'model-settings') {
      options.modelSettingsSubMenu.value = 'management'
    }
    if (normalized === 'feishu-master') {
      options.feishuMasterSubMenu.value = 'schedule'
      if (options.feishuScheduleDataFilter.value === 'defect') void options.loadFeishuDefectList()
      else void options.loadFeishuTodoList()
    }
    options.syncImportProviderByActive(normalized)
  }

  function selectBugLocatorMenu(tab: BugTraceSubMenu) {
    options.activeProvider.value = 'bug-cursor'
    options.bugTraceSubMenu.value = tab
    if (tab === 'inbox') {
      void options.loadBugInbox()
    }
  }

  function selectFeishuMasterMenu(tab: FeishuMasterSubMenu) {
    options.activeProvider.value = 'feishu-master'
    options.feishuMasterSubMenu.value = tab
    if (tab === 'schedule') {
      if (options.feishuScheduleDataFilter.value === 'defect') void options.loadFeishuDefectList()
      else void options.loadFeishuTodoList()
    }
  }

  function selectComponentSettingsMenu(tab: ComponentSettingsSubMenu) {
    options.activeProvider.value = 'component-library'
    options.componentSettingsSubMenu.value = tab
  }

  function selectModelSettingsMenu(tab: ModelSettingsSubMenu) {
    options.activeProvider.value = 'model-settings'
    options.modelSettingsSubMenu.value = tab
  }

  return {
    selectProvider,
    selectBugLocatorMenu,
    selectFeishuMasterMenu,
    selectComponentSettingsMenu,
    selectModelSettingsMenu,
  }
}
