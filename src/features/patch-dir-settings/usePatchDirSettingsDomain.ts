import { computed, ref, watch } from 'vue'
import type { PatchDirSettingsApi } from '@/services/kbApiServices'

export interface PatchDirPreset {
  id: string
  alias: string
  path: string
}

interface UsePatchDirSettingsDomainOptions {
  service: PatchDirSettingsApi
  setErrorText?: (text: string) => void
  setPatchTotal?: (value: number | null) => void
  notify?: (text: string, tone?: 'info' | 'success' | 'warning' | 'danger') => void
}

export function usePatchDirSettingsDomain(options: UsePatchDirSettingsDomainOptions) {
  const patchDirSettingsOpen = ref(false)
  const patchDirPresets = ref<PatchDirPreset[]>([])
  const selectedPatchDirPresetId = ref('')
  const patchDirDraftAlias = ref('')
  const patchDirDraftPath = ref('')
  const patchDirTotal = ref<number | null>(null)
  const patchDirAdding = ref(false)
  const patchDirEditingPresetId = ref('')

  const selectedPatchDirPreset = computed(
    () => patchDirPresets.value.find((item) => item.id === selectedPatchDirPresetId.value) || null,
  )
  const editingPatchDirPreset = computed(
    () => patchDirPresets.value.find((item) => item.id === patchDirEditingPresetId.value) || null,
  )

  const setErrorText = options.setErrorText || (() => undefined)
  const notify = options.notify || (() => undefined)

  function normalizePatchPath(input: string): string {
    const raw = String(input || '').trim()
    if (!raw) return ''
    const slashNormalized = raw.replace(/\\/g, '/')
    const trimmedTrailing = slashNormalized.replace(/\/+$/, '')
    return trimmedTrailing || '/'
  }

  function normalizeAlias(input: string): string {
    return String(input || '').trim().replace(/\s+/g, ' ')
  }

  function normalizePresetList(items: Array<any>): PatchDirPreset[] {
    return (Array.isArray(items) ? items : [])
      .map((item) => ({
        id: String(item?.id || `preset_${Math.random().toString(36).slice(2, 10)}`),
        alias: normalizeAlias(String(item?.alias || '')),
        path: normalizePatchPath(String(item?.path || '')),
      }))
      .filter((item) => item.alias && item.path)
  }

  function buildDefaultPatchDirPresets(): PatchDirPreset[] {
    return [
      {
        id: 'default-srs',
        alias: 'srs-pc',
        path: '/Users/hm/work/srs-pc/.ai-patches',
      },
    ]
  }

  function ensurePatchDirPresetSelected() {
    if (patchDirPresets.value.some((item) => item.id === selectedPatchDirPresetId.value)) return
    selectedPatchDirPresetId.value = patchDirPresets.value[0]?.id || ''
  }

  function getSelectedPatchDirPath(): string {
    return selectedPatchDirPreset.value?.path?.trim() || ''
  }

  async function loadPatchDirPresets() {
    const fallback = buildDefaultPatchDirPresets()
    try {
      const data = await options.service.fetchPresets()
      const parsed = normalizePresetList(data?.presets || [])
      if (!parsed.length) {
        const seeded = await options.service.createPreset(fallback[0].alias, fallback[0].path)
        const seededPresets = normalizePresetList(seeded?.presets || [])
        patchDirPresets.value = seededPresets.length ? seededPresets : fallback
        selectedPatchDirPresetId.value = patchDirPresets.value[0].id
        await loadPatchCount()
        return
      }

      patchDirPresets.value = parsed

      if (!patchDirPresets.value.length) patchDirPresets.value = fallback
      selectedPatchDirPresetId.value = patchDirPresets.value[0].id
      await loadPatchCount()
    } catch {
      patchDirPresets.value = fallback
      selectedPatchDirPresetId.value = fallback[0].id
      await loadPatchCount()
    }
  }

  async function loadPatchCount() {
    const patchDir = getSelectedPatchDirPath()
    if (!patchDir) {
      patchDirTotal.value = null
      options.setPatchTotal?.(null)
      return
    }
    try {
      const data = await options.service.fetchPatchCount(patchDir)
      patchDirTotal.value = Number(data?.total || 0)
      options.setPatchTotal?.(patchDirTotal.value)
    } catch {
      patchDirTotal.value = null
      options.setPatchTotal?.(null)
    }
  }

  function openPatchDirSettings() {
    patchDirDraftAlias.value = ''
    patchDirDraftPath.value = ''
    patchDirEditingPresetId.value = ''
    patchDirSettingsOpen.value = true
  }

  function closePatchDirSettings() {
    patchDirEditingPresetId.value = ''
    patchDirSettingsOpen.value = false
  }

  function startEditPatchDirPreset(preset: PatchDirPreset) {
    patchDirEditingPresetId.value = preset.id
    patchDirDraftAlias.value = preset.alias
    patchDirDraftPath.value = preset.path
  }

  function cancelEditPatchDirPreset() {
    patchDirEditingPresetId.value = ''
    patchDirDraftAlias.value = ''
    patchDirDraftPath.value = ''
  }

  async function addPatchDirPreset() {
    if (patchDirAdding.value) return
    const alias = normalizeAlias(patchDirDraftAlias.value)
    const patchPath = normalizePatchPath(patchDirDraftPath.value)
    const editingId = String(patchDirEditingPresetId.value || '').trim()
    if (!alias || !patchPath) {
      notify('别名和路径都不能为空', 'warning')
      return
    }
    if (!patchPath.startsWith('/')) {
      notify('请填写绝对路径（例如 /Users/hm/work/srs-pc/.ai-patches）', 'warning')
      return
    }

    const existsPreset = patchDirPresets.value.find((item) => normalizePatchPath(item.path) === patchPath && item.id !== editingId)
    if (existsPreset) {
      selectedPatchDirPresetId.value = existsPreset.id
      notify('该路径已存在，已自动选中', 'info')
      return
    }

    try {
      patchDirAdding.value = true
      const data = await options.service.createPreset(alias, patchPath, editingId)
      const presets = normalizePresetList(data?.presets || [])
      patchDirPresets.value = presets.length ? presets : buildDefaultPatchDirPresets()
      selectedPatchDirPresetId.value = data.preset?.id || patchDirPresets.value[0].id
      await loadPatchCount()
      cancelEditPatchDirPreset()
      setErrorText('')
      notify(editingId ? 'Patch 别名已更新' : 'Patch 路径已新增', 'success')
    } catch (error) {
      const message = String(error || '')
      if (/UNIQUE constraint failed/i.test(message)) {
        await loadPatchDirPresets()
        const found = patchDirPresets.value.find((item) => normalizePatchPath(item.path) === patchPath)
        if (found) selectedPatchDirPresetId.value = found.id
        notify('该路径已存在，已自动选中', 'info')
        return
      }
      notify(message || (editingId ? '更新失败' : '新增失败'), 'danger')
    } finally {
      patchDirAdding.value = false
    }
  }

  async function removePatchDirPreset(presetId: string) {
    if (patchDirPresets.value.length <= 1) {
      notify('至少保留一个 patch 目录', 'warning')
      return
    }
    try {
      const data = await options.service.deletePreset(presetId)
      patchDirPresets.value = normalizePresetList(data?.presets || [])
      if (patchDirEditingPresetId.value === presetId) cancelEditPatchDirPreset()
      ensurePatchDirPresetSelected()
      await loadPatchCount()
      setErrorText('')
      notify('Patch 路径已删除', 'success')
    } catch (error) {
      notify(String(error || '删除失败'), 'danger')
    }
  }

  function syncPatchDirPresetByPath(pathValue: string) {
    const fullPath = String(pathValue || '').trim()
    if (!fullPath) return
    const normalizedPath = normalizePatchPath(fullPath)
    const found = patchDirPresets.value.find((item) => normalizePatchPath(item.path) === normalizedPath)
    if (found) {
      selectedPatchDirPresetId.value = found.id
      return
    }

    const alias = normalizedPath.split('/').filter(Boolean).slice(-2).join('/') || 'custom'
    void (async () => {
      try {
        const data = await options.service.createPreset(alias, normalizedPath)
        const presets = normalizePresetList(data?.presets || [])
        patchDirPresets.value = presets.length ? presets : patchDirPresets.value
        selectedPatchDirPresetId.value = data.preset?.id || selectedPatchDirPresetId.value
        await loadPatchCount()
      } catch {
        // ignore sync failure
      }
    })()
  }

  watch(selectedPatchDirPresetId, () => {
    void loadPatchCount()
  })

  return {
    patchDirSettingsOpen,
    patchDirPresets,
    selectedPatchDirPresetId,
    patchDirDraftAlias,
    patchDirDraftPath,
    patchDirTotal,
    patchDirAdding,
    patchDirEditingPresetId,
    selectedPatchDirPreset,
    editingPatchDirPreset,
    getSelectedPatchDirPath,
    loadPatchDirPresets,
    loadPatchCount,
    openPatchDirSettings,
    closePatchDirSettings,
    startEditPatchDirPreset,
    cancelEditPatchDirPreset,
    addPatchDirPreset,
    removePatchDirPreset,
    syncPatchDirPresetByPath,
  }
}
