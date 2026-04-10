export type BugTraceSubMenu = 'trace' | 'inbox'
export type FeishuMasterSubMenu = 'schedule'
export type FeishuScheduleDataFilter = 'schedule' | 'defect'
export type ComponentSettingsSubMenu = 'list' | 'modal' | 'confirm' | 'toast' | 'form' | 'icon'
export type ModelSettingsSubMenu = 'management'

export interface ProviderSection {
  id: string
  label: string
  count: number
}

export type AppSidebarMenuKey =
  | 'model'
  | 'bug'
  | 'feishu'
  | 'component'
  | 'modelSettings'
  | 'knowledge'

export type AppSidebarMenuState = Record<AppSidebarMenuKey, boolean>

export interface AppSidebarConfig {
  collapsed: boolean
  menus: AppSidebarMenuState
  navigation: {
    providerSections: ProviderSection[]
    activeProvider: string
    providerLogoMap: Record<string, string>
    bugTraceSubMenu: BugTraceSubMenu
    feishuMasterSubMenu: FeishuMasterSubMenu
    componentSettingsSubMenu: ComponentSettingsSubMenu
    modelSettingsSubMenu: ModelSettingsSubMenu
  }
  actions: {
    setCollapsed: (value: boolean) => void
    setMenuOpen: (menu: AppSidebarMenuKey, value: boolean) => void
    selectProvider: (providerId: string) => void
    selectBugLocatorMenu: (menu: BugTraceSubMenu) => void
    selectFeishuMasterMenu: (menu: FeishuMasterSubMenu) => void
    selectComponentSettingsMenu: (menu: ComponentSettingsSubMenu) => void
    selectModelSettingsMenu: (menu: ModelSettingsSubMenu) => void
  }
}

export interface AppToolbarConfig {
  modes: {
    isSpecial: boolean
    isBugLocator: boolean
    isFeishuSchedule: boolean
    isModelSettings: boolean
    isKnowledgeSources: boolean
    isComponentLibrary: boolean
  }
  navigation: {
    activeMainTitle: string
    bugTraceSubMenu: BugTraceSubMenu
  }
  provider: {
    active: string
    refreshing: boolean
  }
  wikiVault: {
    syncing: boolean
  }
  feishuSchedule: {
    isTodoView: boolean
    selectedTodosCount: number
    todoLoading: boolean
    defectLoading: boolean
    dataFilter: FeishuScheduleDataFilter
  }
  actions: {
    openFeishuBatchModal: () => void
    openFeishuProjectSettings: () => void
    openPatchDirSettings: () => void
    refreshCurrentProvider: () => Promise<void> | void
    refreshFeishuSchedule: () => void
    openImportModal: () => void
    openEmbeddingBuildModal: () => void
    openQuickCapture: () => void
    syncWikiVault: () => void
  }
}
