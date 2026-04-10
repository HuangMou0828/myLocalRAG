import { computed, reactive, ref } from 'vue'
import type { ImportApi } from '@/services/kbApiServices'

export interface ImportPreviewSample {
  id: string
  title: string
  provider: string
  sourceType: string
  messageCount: number
}

interface ImportFormState {
  provider: string
  sourceRoot: string
}

interface ImportFilePayload {
  path: string
  content: string
}

interface ProviderCatalogItem {
  id: string
  label: string
}

interface UseImportDomainOptions {
  service: ImportApi
  activeProvider: { value: string }
  providerCatalog: ReadonlyArray<ProviderCatalogItem>
  setErrorText: (text: string) => void
  setImportResultText: (text: string) => void
  onImported?: () => Promise<void> | void
}

export function useImportDomain(options: UseImportDomainOptions) {
  function normalizeImportProvider(providerId: string) {
    const normalized = String(providerId || '').trim()
    if (!normalized || normalized === 'all' || normalized.startsWith('knowledge-')) return ''
    return normalized
  }

  const importing = ref(false)
  const previewing = ref(false)
  const importModalOpen = ref(false)
  const folderInputRef = ref<HTMLInputElement | null>(null)
  const importForm = reactive<ImportFormState>({
    provider: '',
    sourceRoot: '',
  })
  const importFiles = ref<ImportFilePayload[]>([])
  const importPreview = ref<{ count: number; bySourceType: Record<string, number>; sample: ImportPreviewSample[] } | null>(
    null,
  )

  const activeProviderLabel = computed(() => {
    const current = options.providerCatalog.find((item) => item.id === (importForm.provider || options.activeProvider.value))
    return current?.label || 'Other'
  })

  function resetImportState() {
    importFiles.value = []
    importPreview.value = null
    importForm.sourceRoot = ''
    importForm.provider = ''
  }

  function resetImportSelection() {
    resetImportState()
    options.setImportResultText('已重置导入选择')
    options.setErrorText('')
  }

  function syncImportProviderByActive(providerId: string) {
    importForm.provider = normalizeImportProvider(providerId)
  }

  function openImportModal() {
    if (
      options.activeProvider.value === 'cursor'
      || options.activeProvider.value === 'codex'
      || String(options.activeProvider.value || '').startsWith('knowledge-')
    ) {
      options.setErrorText('当前视图不支持手动导入，请切回具体会话来源或知识采集入口')
      return
    }
    options.setErrorText('')
    options.setImportResultText('')
    importForm.provider = normalizeImportProvider(options.activeProvider.value)
    importModalOpen.value = true
  }

  function closeImportModal() {
    importModalOpen.value = false
    resetImportState()
  }

  function triggerFolderSelect() {
    folderInputRef.value?.click()
  }

  async function onFolderPicked(event: Event) {
    const target = event.target as HTMLInputElement
    const list = target.files ? Array.from(target.files) : []
    if (!list.length) {
      importFiles.value = []
      importPreview.value = null
      return
    }

    options.setErrorText('')
    options.setImportResultText('')
    importPreview.value = null
    previewing.value = true

    try {
      const allowed = list.filter((file) => {
        const lower = file.name.toLowerCase()
        return lower.endsWith('.json') || lower.endsWith('.md')
      })

      const payload = await Promise.all(
        allowed.map(async (file) => ({
          path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
          content: await file.text(),
        })),
      )

      importFiles.value = payload
      const rootCandidate = (allowed[0] as File & { webkitRelativePath?: string })?.webkitRelativePath || ''
      importForm.sourceRoot = rootCandidate ? rootCandidate.split('/')[0] : ''
      options.setImportResultText(`已选择 ${importFiles.value.length} 个可导入文件`)
    } catch (error) {
      options.setErrorText(`读取文件夹失败：${String(error)}`)
      importFiles.value = []
    } finally {
      previewing.value = false
      target.value = ''
    }
  }

  async function previewImport() {
    if (!importFiles.value.length) {
      options.setErrorText('请先选择文件夹')
      return
    }

    previewing.value = true
    options.setErrorText('')
    options.setImportResultText('')

    try {
      const provider = importForm.provider || options.activeProvider.value
      const data = await options.service.previewImport({
        files: importFiles.value,
        provider,
        sourceRoot: importForm.sourceRoot || 'upload',
      })
      importPreview.value = data
      options.setImportResultText(`预览完成：识别到 ${data.count} 条会话`)
    } catch (error) {
      options.setErrorText(String(error))
      importPreview.value = null
    } finally {
      previewing.value = false
    }
  }

  async function importFolder() {
    if (!importFiles.value.length) {
      options.setErrorText('请先选择文件夹')
      return
    }

    importing.value = true
    options.setErrorText('')
    options.setImportResultText('')

    try {
      const provider = importForm.provider || options.activeProvider.value
      const result = await options.service.importFolder({
        files: importFiles.value,
        provider,
        sourceRoot: importForm.sourceRoot || 'upload',
      })

      options.setImportResultText(`导入完成：新增 ${result.imported} 条，会话总数 ${result.total} 条`)
      if (options.onImported) await options.onImported()
      closeImportModal()
    } catch (error) {
      options.setErrorText(String(error))
    } finally {
      importing.value = false
    }
  }

  return {
    importing,
    previewing,
    importModalOpen,
    folderInputRef,
    importForm,
    importFiles,
    importPreview,
    activeProviderLabel,
    triggerFolderSelect,
    onFolderPicked,
    previewImport,
    importFolder,
    openImportModal,
    closeImportModal,
    resetImportSelection,
    syncImportProviderByActive,
  }
}
