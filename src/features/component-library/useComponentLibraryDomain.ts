import { computed, ref } from 'vue'
import { appIconCatalog, appIconUsageMap, type AppIconCatalogItem } from '@/components/icons/app-icons'

export type ComponentListDensity = 'compact' | 'default' | 'comfortable'
export type ComponentListTone = 'default' | 'soft' | 'strong'
export type ComponentListStatusTone = 'default' | 'success' | 'warning' | 'danger' | 'muted'
export type ComponentModalSize = 'sm' | 'md' | 'lg'
export type ComponentModalTone = 'default' | 'info' | 'warning' | 'danger'
export type ComponentModalFieldKind = 'text' | 'multiline' | 'tags' | 'datetime' | 'link' | 'code' | 'json' | 'path' | 'boolean'
export type ComponentConfirmTone = 'default' | 'warning' | 'danger' | 'success'
export type ComponentToastTone = 'default' | 'info' | 'success' | 'warning' | 'danger' | 'loading'
export type ComponentToastPosition = 'top-right' | 'top-center' | 'bottom-right'
export type ComponentFormLayout = 'stack' | 'inline'
export type ComponentFormRadioDirection = 'row' | 'column'

export interface ComponentListPreviewItem {
  id: string
  title: string
  subtitle: string
  description: string
  tags: string[]
  owner: string
  updatedAt: string
  progress: number
  avatarText: string
  tone: ComponentListStatusTone
  disabled?: boolean
  pinned?: boolean
  soonDue?: boolean
}

export interface ComponentModalPreviewField {
  id: string
  label: string
  kind: ComponentModalFieldKind
  value?: string
  href?: string
  tags?: string[]
  boolValue?: boolean
}

export interface ComponentConfirmMockCase {
  id: string
  tone: ComponentConfirmTone
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  requiresInput?: boolean
  inputHint?: string
  loading?: boolean
}

export interface ComponentToastPreviewItem {
  id: string
  tone: ComponentToastTone
  title: string
  message: string
  actionLabel?: string
  sticky?: boolean
}

export interface ComponentToastRuntimeItem extends ComponentToastPreviewItem {
  createdAt: number
}

export interface ComponentIconPreviewItem {
  id: string
  label: string
  component: AppIconCatalogItem['component']
  usedBy: string[]
  usageCount: number
}

export interface ComponentFormOption {
  label: string
  value: string
  disabled?: boolean
}

const DEFAULT_COMPONENT_FORM_SELECT_OPTIONS: ComponentFormOption[] = [
  { label: 'Bug 修复', value: 'bugfix' },
  { label: '体验优化', value: 'ux' },
  { label: '技术重构', value: 'refactor' },
  { label: '实验功能', value: 'experiment' },
]

const DEFAULT_COMPONENT_FORM_RADIO_OPTIONS: ComponentFormOption[] = [
  { label: 'P0（阻塞）', value: 'p0' },
  { label: 'P1（高）', value: 'p1' },
  { label: 'P2（中）', value: 'p2' },
  { label: 'P3（低）', value: 'p3' },
]

type NotifyTone = 'info' | 'success' | 'warning' | 'danger'

interface UseComponentLibraryDomainOptions {
  notify?: (text: string, tone?: NotifyTone) => void
}

export function useComponentLibraryDomain(options: UseComponentLibraryDomainOptions = {}) {
  const notify = options.notify || (() => undefined)

  const componentListDensity = ref<ComponentListDensity>('default')
  const componentListTone = ref<ComponentListTone>('default')
  const componentListPreviewCount = ref(8)
  const componentListStriped = ref(false)
  const componentListBordered = ref(true)
  const componentListRounded = ref(true)
  const componentListHoverable = ref(true)
  const componentListAsCards = ref(false)
  const componentListShowDividers = ref(true)
  const componentListShowAvatar = ref(true)
  const componentListShowDescription = ref(true)
  const componentListShowMeta = ref(true)
  const componentListShowTags = ref(true)
  const componentListShowProgress = ref(true)
  const componentListShowActions = ref(true)
  const componentListActiveId = ref('list-analytics')

  const componentModalPreviewOpen = ref(false)
  const componentModalSize = ref<ComponentModalSize>('md')
  const componentModalTone = ref<ComponentModalTone>('default')
  const componentModalShowFooter = ref(true)
  const componentModalShowDivider = ref(true)
  const componentModalCompact = ref(false)
  const componentModalCopiedFieldId = ref('')

  const componentConfirmPreviewOpen = ref(false)
  const componentConfirmTone = ref<ComponentConfirmTone>('default')
  const componentConfirmShowDescription = ref(true)
  const componentConfirmRequireInput = ref(false)
  const componentConfirmKeyword = ref('DELETE')
  const componentConfirmInput = ref('')
  const componentConfirmLoading = ref(false)

  const componentToastShowIcon = ref(true)
  const componentToastDense = ref(false)
  const componentToastPosition = ref<ComponentToastPosition>('top-right')
  const componentToastDurationMs = ref(2600)
  const componentToastSticky = ref(false)
  const componentToastQueue = ref<ComponentToastRuntimeItem[]>([])
  const componentIconKeyword = ref('')
  const componentFormLayout = ref<ComponentFormLayout>('stack')
  const componentFormRadioDirection = ref<ComponentFormRadioDirection>('row')
  const componentFormDisabled = ref(false)
  const componentFormReadonly = ref(false)
  const componentFormShowHint = ref(true)
  const componentFormSimulateError = ref(false)
  const componentFormInputValue = ref('订单详情页白屏修复')
  const componentFormSelectValue = ref('bugfix')
  const componentFormRadioValue = ref('p1')
  const componentListMockItems = ref<ComponentListPreviewItem[]>([])
  const componentModalMockFields = ref<ComponentModalPreviewField[]>([])
  const componentConfirmMockCases = ref<ComponentConfirmMockCase[]>([])
  const componentToastMockItems = ref<ComponentToastPreviewItem[]>([])
  const componentFormSelectOptions = ref<ComponentFormOption[]>(DEFAULT_COMPONENT_FORM_SELECT_OPTIONS)
  const componentFormRadioOptions = ref<ComponentFormOption[]>(DEFAULT_COMPONENT_FORM_RADIO_OPTIONS)
  const componentFormSelectResolvedOptions = computed<ComponentFormOption[]>(() => {
    const source = Array.isArray(componentFormSelectOptions.value) ? componentFormSelectOptions.value : []
    return source.length ? source : DEFAULT_COMPONENT_FORM_SELECT_OPTIONS
  })
  const componentFormRadioResolvedOptions = computed<ComponentFormOption[]>(() => {
    const source = Array.isArray(componentFormRadioOptions.value) ? componentFormRadioOptions.value : []
    return source.length ? source : DEFAULT_COMPONENT_FORM_RADIO_OPTIONS
  })

  const componentToastTimerMap = new Map<string, ReturnType<typeof setTimeout>>()
  let componentLibraryMocksLoaded = false
  let componentLibraryMocksPromise: Promise<void> | null = null

  function ensureComponentFormSelectedValues() {
    if (!componentFormSelectResolvedOptions.value.some((item) => item.value === componentFormSelectValue.value)) {
      componentFormSelectValue.value = componentFormSelectResolvedOptions.value[0]?.value || ''
    }
    if (!componentFormRadioResolvedOptions.value.some((item) => item.value === componentFormRadioValue.value)) {
      componentFormRadioValue.value = componentFormRadioResolvedOptions.value[0]?.value || ''
    }
  }

  async function ensureComponentLibraryMockData() {
    if (componentLibraryMocksLoaded) return
    if (!componentLibraryMocksPromise) {
      componentLibraryMocksPromise = import('@/features/component-library/componentLibraryMocks')
        .then((module) => {
          componentListMockItems.value = module.componentListMockItems
          componentModalMockFields.value = module.componentModalMockFields
          componentConfirmMockCases.value = module.componentConfirmMockCases
          componentToastMockItems.value = module.componentToastMockItems
          componentFormSelectOptions.value = Array.isArray(module.componentFormSelectOptions) && module.componentFormSelectOptions.length
            ? module.componentFormSelectOptions
            : DEFAULT_COMPONENT_FORM_SELECT_OPTIONS
          componentFormRadioOptions.value = Array.isArray(module.componentFormRadioOptions) && module.componentFormRadioOptions.length
            ? module.componentFormRadioOptions
            : DEFAULT_COMPONENT_FORM_RADIO_OPTIONS
          ensureComponentFormSelectedValues()
          componentLibraryMocksLoaded = true
        })
        .catch(() => {
          componentFormSelectOptions.value = DEFAULT_COMPONENT_FORM_SELECT_OPTIONS
          componentFormRadioOptions.value = DEFAULT_COMPONENT_FORM_RADIO_OPTIONS
          ensureComponentFormSelectedValues()
          componentLibraryMocksLoaded = true
        })
    }
    await componentLibraryMocksPromise
  }

  const componentListPreviewItems = computed(() => {
    const source = componentListMockItems.value
    const safeCount = Math.max(1, Math.min(source.length, Number(componentListPreviewCount.value) || 1))
    return source.slice(0, safeCount)
  })

  const componentListPreviewClass = computed(() => ({
    'component-list-preview--compact': componentListDensity.value === 'compact',
    'component-list-preview--comfortable': componentListDensity.value === 'comfortable',
    'component-list-preview--tone-soft': componentListTone.value === 'soft',
    'component-list-preview--tone-strong': componentListTone.value === 'strong',
    'component-list-preview--striped': componentListStriped.value,
    'component-list-preview--bordered': componentListBordered.value,
    'component-list-preview--rounded': componentListRounded.value,
    'component-list-preview--hoverable': componentListHoverable.value,
    'component-list-preview--cards': componentListAsCards.value,
    'component-list-preview--no-divider': !componentListShowDividers.value,
  }))

  const componentModalDialogClass = computed(() => [
    'component-modal-dialog',
    `component-modal-dialog--${componentModalSize.value}`,
    `component-modal-dialog--tone-${componentModalTone.value}`,
    componentModalCompact.value ? 'component-modal-dialog--compact' : '',
  ])

  const componentModalSurfaceClass = computed(() => [
    'component-modal-surface',
    `component-modal-surface--${componentModalSize.value}`,
    `component-modal-surface--tone-${componentModalTone.value}`,
    componentModalCompact.value ? 'component-modal-surface--compact' : '',
  ])

  const componentConfirmSurfaceClass = computed(() => [
    'component-confirm-surface',
    `component-confirm-surface--tone-${componentConfirmTone.value}`,
  ])

  const componentToastStackClass = computed(() => [
    'component-toast-stack',
    `component-toast-stack--${componentToastPosition.value}`,
    componentToastDense.value ? 'component-toast-stack--dense' : '',
  ])

  const componentToastPreviewRuntimeItems = computed<ComponentToastRuntimeItem[]>(() => {
    if (componentToastQueue.value.length) return componentToastQueue.value
    return componentToastMockItems.value.slice(0, 3).map((item, index) => ({
      ...item,
      id: `toast-sample-${index}-${item.id}`,
      createdAt: 0,
      sticky: true,
    }))
  })

  const componentFormSurfaceClass = computed(() => [
    'component-form-surface',
    componentFormLayout.value === 'inline' ? 'component-form-surface--inline' : '',
  ])

  const componentFormInputHint = computed(() => {
    if (!componentFormShowHint.value) return ''
    return componentFormSimulateError.value ? '请输入 4 个字以上的标题' : '标题将用于列表与检索展示'
  })

  const componentFormSelectHint = computed(() => {
    if (!componentFormShowHint.value) return ''
    return '用于区分提交单的业务分类'
  })

  const componentFormRadioHint = computed(() => {
    if (!componentFormShowHint.value) return ''
    return '优先级将影响排期和提醒频率'
  })

  const componentIconItems = computed<ComponentIconPreviewItem[]>(() =>
    appIconCatalog
      .map((item) => {
        const usedBy = Array.from(new Set(appIconUsageMap[item.id] || []))
        return {
          id: item.id,
          label: item.label,
          component: item.component,
          usedBy,
          usageCount: usedBy.length,
        }
      })
      .sort((a, b) => b.usageCount - a.usageCount || a.id.localeCompare(b.id)),
  )

  const componentIconFilteredItems = computed<ComponentIconPreviewItem[]>(() => {
    const keyword = String(componentIconKeyword.value || '').trim().toLowerCase()
    if (!keyword) return componentIconItems.value
    return componentIconItems.value.filter((item) => {
      if (item.id.toLowerCase().includes(keyword)) return true
      if (item.label.toLowerCase().includes(keyword)) return true
      return item.usedBy.some((path) => path.toLowerCase().includes(keyword))
    })
  })

  const componentIconUsedItems = computed<ComponentIconPreviewItem[]>(() =>
    componentIconFilteredItems.value.filter((item) => item.usageCount > 0),
  )

  const componentIconUnusedItems = computed<ComponentIconPreviewItem[]>(() =>
    componentIconFilteredItems.value.filter((item) => item.usageCount === 0),
  )

  function getComponentListStatusLabel(tone: ComponentListStatusTone): string {
    if (tone === 'success') return '完成'
    if (tone === 'warning') return '推进中'
    if (tone === 'danger') return '风险'
    if (tone === 'muted') return '低优先级'
    return '进行中'
  }

  function isComponentModalFieldCopyable(field: ComponentModalPreviewField): boolean {
    const kind = String(field?.kind || '')
    if (!['text', 'multiline', 'datetime', 'code', 'json', 'path'].includes(kind)) return false
    return Boolean(String(field?.value || '').trim())
  }

  function getComponentModalFieldCopyValue(field: ComponentModalPreviewField): string {
    if (!isComponentModalFieldCopyable(field)) return ''
    return String(field?.value || '').trim()
  }

  async function copyComponentModalFieldValue(field: ComponentModalPreviewField) {
    const value = getComponentModalFieldCopyValue(field)
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      componentModalCopiedFieldId.value = String(field.id || '')
      notify('字段值已复制')
      setTimeout(() => {
        if (componentModalCopiedFieldId.value === String(field.id || '')) componentModalCopiedFieldId.value = ''
      }, 1500)
    } catch {
      notify('复制失败，请检查浏览器权限', 'warning')
    }
  }

  function isComponentConfirmSubmitDisabled(): boolean {
    if (componentConfirmLoading.value) return true
    if (!componentConfirmRequireInput.value) return false
    return String(componentConfirmInput.value || '').trim() !== String(componentConfirmKeyword.value || '').trim()
  }

  async function runComponentConfirmSubmit() {
    if (isComponentConfirmSubmitDisabled()) return
    componentConfirmLoading.value = true
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 900))
      componentConfirmPreviewOpen.value = false
      componentConfirmInput.value = ''
      notify('确认动作已执行')
    } finally {
      componentConfirmLoading.value = false
    }
  }

  function getComponentToastDurationMs(): number {
    const raw = Number(componentToastDurationMs.value || 0)
    if (!Number.isFinite(raw)) return 2600
    return Math.max(800, Math.min(10000, Math.round(raw)))
  }

  function clearComponentToastTimer(id: string) {
    const timer = componentToastTimerMap.get(id)
    if (timer) clearTimeout(timer)
    componentToastTimerMap.delete(id)
  }

  function removeComponentToast(id: string) {
    const key = String(id || '').trim()
    if (!key) return
    clearComponentToastTimer(key)
    componentToastQueue.value = componentToastQueue.value.filter((item) => item.id !== key)
  }

  function pushComponentToast(item: ComponentToastPreviewItem) {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const payload: ComponentToastRuntimeItem = {
      ...item,
      id,
      createdAt: Date.now(),
      sticky: Boolean(item.sticky || componentToastSticky.value),
    }
    componentToastQueue.value = [payload, ...componentToastQueue.value].slice(0, 6)
    if (!payload.sticky) {
      const timer = setTimeout(() => {
        removeComponentToast(id)
      }, getComponentToastDurationMs())
      componentToastTimerMap.set(id, timer)
    }
  }

  async function triggerComponentToast(tone: ComponentToastTone) {
    await ensureComponentLibraryMockData()
    const sample =
      componentToastMockItems.value.find((item) => item.tone === tone) ||
      componentToastMockItems.value.find((item) => item.tone === 'default') ||
      componentToastMockItems.value[0]
    if (!sample) return
    pushComponentToast(sample)
  }

  function clearComponentToastQueue() {
    for (const id of componentToastTimerMap.keys()) clearComponentToastTimer(id)
    componentToastQueue.value = []
  }

  function isRuntimeComponentToast(item: ComponentToastRuntimeItem): boolean {
    return String(item.id || '').startsWith('toast-') && !String(item.id || '').startsWith('toast-sample-')
  }

  async function seedComponentLibraryToastSamples() {
    await ensureComponentLibraryMockData()
    if (componentToastQueue.value.length) return
    const defaultSamples = ['success', 'warning'] as const
    for (const tone of defaultSamples) {
      const item = componentToastMockItems.value.find((sample) => sample.tone === tone)
      if (!item) continue
      pushComponentToast({ ...item, sticky: true })
    }
  }

  function resetComponentFormPreview() {
    componentFormInputValue.value = '订单详情页白屏修复'
    componentFormSelectValue.value = 'bugfix'
    componentFormRadioValue.value = 'p1'
    componentFormLayout.value = 'stack'
    componentFormRadioDirection.value = 'row'
    componentFormDisabled.value = false
    componentFormReadonly.value = false
    componentFormShowHint.value = true
    componentFormSimulateError.value = false
    ensureComponentFormSelectedValues()
  }

  return {
    componentListDensity,
    componentListTone,
    componentListPreviewCount,
    componentListStriped,
    componentListBordered,
    componentListRounded,
    componentListHoverable,
    componentListAsCards,
    componentListShowDividers,
    componentListShowAvatar,
    componentListShowDescription,
    componentListShowMeta,
    componentListShowTags,
    componentListShowProgress,
    componentListShowActions,
    componentListActiveId,
    componentModalPreviewOpen,
    componentModalSize,
    componentModalTone,
    componentModalShowFooter,
    componentModalShowDivider,
    componentModalCompact,
    componentModalCopiedFieldId,
    componentConfirmPreviewOpen,
    componentConfirmTone,
    componentConfirmShowDescription,
    componentConfirmRequireInput,
    componentConfirmKeyword,
    componentConfirmInput,
    componentConfirmLoading,
    componentToastShowIcon,
    componentToastDense,
    componentToastPosition,
    componentToastDurationMs,
    componentToastSticky,
    componentToastQueue,
    componentIconKeyword,
    componentFormLayout,
    componentFormRadioDirection,
    componentFormDisabled,
    componentFormReadonly,
    componentFormShowHint,
    componentFormSimulateError,
    componentFormInputValue,
    componentFormSelectValue,
    componentFormRadioValue,
    ensureComponentLibraryMockData,
    componentListMockItems,
    componentModalMockFields,
    componentConfirmMockCases,
    componentToastMockItems,
    componentFormSelectOptions: componentFormSelectResolvedOptions,
    componentFormRadioOptions: componentFormRadioResolvedOptions,
    componentListPreviewItems,
    componentListPreviewClass,
    componentModalDialogClass,
    componentModalSurfaceClass,
    componentConfirmSurfaceClass,
    componentToastStackClass,
    componentToastPreviewRuntimeItems,
    componentFormSurfaceClass,
    componentFormInputHint,
    componentFormSelectHint,
    componentFormRadioHint,
    componentIconItems,
    componentIconFilteredItems,
    componentIconUsedItems,
    componentIconUnusedItems,
    getComponentListStatusLabel,
    isComponentModalFieldCopyable,
    copyComponentModalFieldValue,
    isComponentConfirmSubmitDisabled,
    runComponentConfirmSubmit,
    triggerComponentToast,
    removeComponentToast,
    clearComponentToastQueue,
    isRuntimeComponentToast,
    seedComponentLibraryToastSamples,
    resetComponentFormPreview,
  }
}
