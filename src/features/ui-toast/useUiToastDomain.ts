import { ref } from 'vue'

export type UiToastTone = 'info' | 'success' | 'warning' | 'danger'

export interface UiToastItem {
  id: string
  text: string
  tone: UiToastTone
}

export function useUiToastDomain() {
  const uiToastQueue = ref<UiToastItem[]>([])
  const uiToastTimerMap = new Map<string, ReturnType<typeof setTimeout>>()

  function clearUiToastTimer(id: string) {
    const timer = uiToastTimerMap.get(id)
    if (timer) clearTimeout(timer)
    uiToastTimerMap.delete(id)
  }

  function removeUiToast(id: string) {
    const key = String(id || '').trim()
    if (!key) return
    clearUiToastTimer(key)
    uiToastQueue.value = uiToastQueue.value.filter((item) => item.id !== key)
  }

  function clearUiToastQueue() {
    for (const id of uiToastTimerMap.keys()) clearUiToastTimer(id)
    uiToastQueue.value = []
  }

  function showToast(text: string, tone: UiToastTone = 'info') {
    const normalized = String(text || '').trim()
    if (!normalized) return

    const id = `ui-toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    uiToastQueue.value = [{ id, text: normalized, tone }, ...uiToastQueue.value].slice(0, 4)

    const timer = setTimeout(() => {
      removeUiToast(id)
    }, 5000)
    uiToastTimerMap.set(id, timer)
  }

  return {
    uiToastQueue,
    showToast,
    removeUiToast,
    clearUiToastQueue,
  }
}
