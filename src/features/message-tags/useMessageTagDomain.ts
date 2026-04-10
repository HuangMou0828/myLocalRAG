import { ref } from 'vue'
import type { FlowNode } from '@/features/session-flow/useSessionFlowDomain'
import type { MessageTagApi } from '@/services/kbApiServices'

interface UseMessageTagDomainOptions {
  service: MessageTagApi
  getSelectedSessionId: () => string
  loadSessions: () => Promise<void>
  setErrorText: (text: string) => void
  setImportResultText: (text: string) => void
}

export function useMessageTagDomain(options: UseMessageTagDomainOptions) {
  const tagModalOpen = ref(false)
  const tagModalSaving = ref(false)
  const tagModalTarget = ref<{ sessionId: string; messageIds: string[]; title: string } | null>(null)
  const tagModalSelected = ref<string[]>([])

  function openTagModal(node: FlowNode) {
    const sessionId = options.getSelectedSessionId()
    if (!sessionId) return
    tagModalTarget.value = {
      sessionId,
      messageIds: node.messageIds,
      title: `${node.role} 消息标签`,
    }
    tagModalSelected.value = Array.from(new Set(node.tags || []))
    tagModalOpen.value = true
  }

  function closeTagModal() {
    tagModalOpen.value = false
    tagModalTarget.value = null
    tagModalSelected.value = []
    tagModalSaving.value = false
  }

  function toggleTagSelection(tag: string) {
    const value = String(tag || '').trim()
    if (!value) return
    const set = new Set(tagModalSelected.value)
    if (set.has(value)) set.delete(value)
    else set.add(value)
    tagModalSelected.value = Array.from(set)
  }

  async function saveMessageTags() {
    const target = tagModalTarget.value
    if (!target?.sessionId || !target.messageIds.length) return

    tagModalSaving.value = true
    options.setErrorText('')

    try {
      await options.service.saveMessageTags({
        sessionId: target.sessionId,
        messageIds: target.messageIds,
        tags: tagModalSelected.value,
      })
      options.setImportResultText('标签已更新')
      closeTagModal()
      await options.loadSessions()
    } catch (error) {
      options.setErrorText(String(error))
      tagModalSaving.value = false
    }
  }

  return {
    tagModalOpen,
    tagModalSaving,
    tagModalTarget,
    tagModalSelected,
    openTagModal,
    closeTagModal,
    toggleTagSelection,
    saveMessageTags,
  }
}
