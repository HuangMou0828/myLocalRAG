import { computed } from 'vue'
import type { ProviderCatalogItem, ProviderId } from '@/features/navigation/providerCatalog'

type ValueRef<T> = { value: T }

interface UseAppViewModesOptions {
  activeProvider: ValueRef<ProviderId>
  componentSettingsSubMenu: ValueRef<'list' | 'modal' | 'confirm' | 'toast' | 'form' | 'icon'>
  modelSettingsSubMenu: ValueRef<'management'>
  bugTraceSubMenu: ValueRef<'trace' | 'inbox'>
  isBugLocatorMode: ValueRef<boolean>
  isFeishuMasterMode: ValueRef<boolean>
  providerCatalog: readonly ProviderCatalogItem[]
}

export function useAppViewModes(options: UseAppViewModesOptions) {
  const isKnowledgeProvider = computed(() => String(options.activeProvider.value || '').startsWith('knowledge-'))
  const isComponentLibraryMode = computed(() => options.activeProvider.value === 'component-library')
  const isComponentLibraryListMode = computed(
    () => isComponentLibraryMode.value && options.componentSettingsSubMenu.value === 'list',
  )
  const isComponentLibraryModalMode = computed(
    () => isComponentLibraryMode.value && options.componentSettingsSubMenu.value === 'modal',
  )
  const isComponentLibraryConfirmMode = computed(
    () => isComponentLibraryMode.value && options.componentSettingsSubMenu.value === 'confirm',
  )
  const isComponentLibraryToastMode = computed(
    () => isComponentLibraryMode.value && options.componentSettingsSubMenu.value === 'toast',
  )
  const isComponentLibraryFormMode = computed(
    () => isComponentLibraryMode.value && options.componentSettingsSubMenu.value === 'form',
  )
  const isComponentLibraryIconMode = computed(
    () => isComponentLibraryMode.value && options.componentSettingsSubMenu.value === 'icon',
  )
  const isModelSettingsMode = computed(() => options.activeProvider.value === 'model-settings')
  const isKnowledgeSourcesMode = computed(() => isKnowledgeProvider.value)

  const isSpecialMode = computed(
    () =>
      options.isBugLocatorMode.value
      || options.isFeishuMasterMode.value
      || isComponentLibraryMode.value
      || isModelSettingsMode.value
      || isKnowledgeSourcesMode.value,
  )

  const activeMainTitle = computed(() => {
    if (options.activeProvider.value === 'component-library') {
      if (options.componentSettingsSubMenu.value === 'modal') return '组件设置 / Modal'
      if (options.componentSettingsSubMenu.value === 'confirm') return '组件设置 / Confirm'
      if (options.componentSettingsSubMenu.value === 'toast') return '组件设置 / Toast'
      if (options.componentSettingsSubMenu.value === 'form') return '组件设置 / Form'
      if (options.componentSettingsSubMenu.value === 'icon') return '组件设置 / Icon'
      return '组件设置 / List'
    }

    if (options.activeProvider.value === 'model-settings') {
      return options.modelSettingsSubMenu.value === 'management' ? '模型配置 / 模型管理' : '模型配置'
    }

    if (options.activeProvider.value === 'knowledge-sources') {
      return '知识采集 / Raw Inbox'
    }

    if (options.activeProvider.value === 'knowledge-task-review') return '知识工作台 / 任务复盘'

    if (options.activeProvider.value === 'knowledge-promotion-review') {
      return '知识工作台 / 升格审核'
    }

    if (options.activeProvider.value === 'knowledge-health') {
      return '知识工作台 / 健康巡检'
    }

    if (options.activeProvider.value !== 'bug-cursor' && options.activeProvider.value !== 'feishu-master') {
      return options.providerCatalog.find((p) => p.id === options.activeProvider.value)?.label || '全部'
    }
    if (options.activeProvider.value === 'feishu-master') return '排期大师'
    return options.bugTraceSubMenu.value === 'inbox' ? 'Bug Inbox' : 'Bug Trace'
  })

  return {
    isComponentLibraryMode,
    isComponentLibraryListMode,
    isComponentLibraryModalMode,
    isComponentLibraryConfirmMode,
    isComponentLibraryToastMode,
    isComponentLibraryFormMode,
    isComponentLibraryIconMode,
    isModelSettingsMode,
    isKnowledgeSourcesMode,
    isSpecialMode,
    activeMainTitle,
  }
}
