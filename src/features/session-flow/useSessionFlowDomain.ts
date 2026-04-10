import { computed, type Ref } from 'vue'

export type ChunkKind = 'answer' | 'reasoning'

export interface MessageChunk {
  content: string
  kind: ChunkKind
}

export interface FlowNode {
  id: string
  role: string
  createdAt: string | null
  chunks: MessageChunk[]
  primaryChunks: MessageChunk[]
  reasoningChunks: MessageChunk[]
  messageIds: string[]
  tags: string[]
}

interface SessionMessageLike {
  id: string
  role: string
  content: string
  createdAt: string | null
  tags?: string[]
}

interface SessionLike {
  id: string
  messages: SessionMessageLike[]
}

interface UseSessionFlowDomainOptions {
  filteredSessions: Ref<SessionLike[]>
  selectedSessionId: Ref<string>
  flowRef: Ref<HTMLElement | null>
  anchoredNodeId: Ref<string>
}

export function useSessionFlowDomain<TSession extends SessionLike = SessionLike>(
  options: Omit<UseSessionFlowDomainOptions, 'filteredSessions'> & { filteredSessions: Ref<TSession[]> },
) {
  const flowNodeElMap = new Map<string, HTMLElement>()
  let anchorFlashTimer: ReturnType<typeof setTimeout> | null = null

  function sanitizeContent(input: string): string {
    return String(input || '')
      .replace(/<\s*user_query\s*>/gi, '')
      .replace(/<\s*\/\s*user_query\s*>/gi, '')
      .trim()
  }

  function normalizeRole(role: string): string {
    const lower = String(role || '').toLowerCase()
    if (lower === 'human') return 'user'
    return lower || 'assistant'
  }

  function appendChunk(node: FlowNode, chunk: MessageChunk) {
    node.chunks.push(chunk)
    if (chunk.kind === 'reasoning') node.reasoningChunks.push(chunk)
    else node.primaryChunks.push(chunk)
  }

  function looksLikeReasoning(content: string): boolean {
    const text = String(content || '').trim()
    if (!text) return false
    const lower = text.toLowerCase()
    const start = lower.slice(0, 260)
    const englishLetters = (text.match(/[A-Za-z]/g) || []).length
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
    const englishDominant = englishLetters >= 40 && englishLetters >= chineseChars * 2
    const chineseDominant = chineseChars > englishLetters

    if (/<\s*\/?\s*(?:think|thinking|analysis|reasoning)\s*>/i.test(text)) return true
    if (/^(思考过程|推理过程|分析过程|thinking|reasoning|analysis)\s*[:：]/i.test(text)) return true

    if (chineseDominant) return false
    if (!englishDominant) return false

    return /^(let me|i need to|i should|now i|the user wants|looking at|first,?\s+i|i will|i'm going to|to understand|let us|i can)\b/.test(
      start,
    )
  }

  function normalizeAssistantChunk(content: string): MessageChunk {
    const normalized = String(content || '').trim()
    const unwrapped = normalized
      .replace(/^<\s*(?:think|thinking|analysis|reasoning)\s*>/i, '')
      .replace(/<\s*\/\s*(?:think|thinking|analysis|reasoning)\s*>$/i, '')
      .trim()

    if (looksLikeReasoning(unwrapped || normalized)) {
      return {
        content: unwrapped || normalized,
        kind: 'reasoning',
      }
    }

    return {
      content: unwrapped || normalized,
      kind: 'answer',
    }
  }

  const selectedSession = computed(
    () => options.filteredSessions.value.find((item) => item.id === options.selectedSessionId.value) || null,
  )

  const selectedSessionFlow = computed<FlowNode[]>(() => {
    const current = selectedSession.value
    if (!current) return []

    const flow: FlowNode[] = []
    for (const msg of current.messages) {
      const role = normalizeRole(msg.role)
      const content = sanitizeContent(msg.content)
      if (!content) continue

      const chunk: MessageChunk = role === 'assistant' ? normalizeAssistantChunk(content) : { content, kind: 'answer' }
      const last = flow[flow.length - 1]

      if (role === 'assistant' && last && last.role === 'assistant') {
        appendChunk(last, chunk)
        if (msg.createdAt) last.createdAt = msg.createdAt
        if (!last.messageIds.includes(msg.id)) last.messageIds.push(msg.id)
        for (const tag of Array.isArray(msg.tags) ? msg.tags : []) {
          if (!last.tags.includes(tag)) last.tags.push(tag)
        }
        continue
      }

      flow.push({
        id: msg.id,
        role,
        createdAt: msg.createdAt,
        chunks: [chunk],
        primaryChunks: chunk.kind === 'answer' ? [chunk] : [],
        reasoningChunks: chunk.kind === 'reasoning' ? [chunk] : [],
        messageIds: [msg.id],
        tags: Array.isArray(msg.tags) ? Array.from(new Set(msg.tags)) : [],
      })
    }

    return flow
  })

  const userAnchorIds = computed(() =>
    selectedSessionFlow.value.filter((node) => node.role === 'user').map((node) => node.id),
  )

  function joinChunkText(chunks: MessageChunk[]): string {
    return (Array.isArray(chunks) ? chunks : [])
      .map((chunk) => String(chunk?.content || '').trim())
      .filter(Boolean)
      .join('\n\n')
      .trim()
  }

  function getAssistantDisplayChunks(node: FlowNode): MessageChunk[] {
    if (node.primaryChunks.length) return node.primaryChunks
    return node.chunks
  }

  function setFlowNodeRef(node: FlowNode, el: Element | null) {
    if (node.role !== 'user') {
      flowNodeElMap.delete(node.id)
      return
    }
    if (el instanceof HTMLElement) flowNodeElMap.set(node.id, el)
    else flowNodeElMap.delete(node.id)
  }

  function flashAnchoredNode(nodeId: string) {
    options.anchoredNodeId.value = nodeId
    if (anchorFlashTimer) clearTimeout(anchorFlashTimer)
    anchorFlashTimer = setTimeout(() => {
      if (options.anchoredNodeId.value === nodeId) options.anchoredNodeId.value = ''
    }, 1200)
  }

  function getCurrentUserAnchorIndexFromViewport(): number {
    const ids = userAnchorIds.value
    if (!ids.length || !options.flowRef.value) return -1

    const containerRect = options.flowRef.value.getBoundingClientRect()
    const threshold = containerRect.top + 18
    let candidateIndex = 0
    let seenAnyNode = false
    let seenNodeAboveThreshold = false

    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index]
      const el = flowNodeElMap.get(id)
      if (!el) continue
      seenAnyNode = true

      const top = el.getBoundingClientRect().top
      if (top <= threshold) {
        candidateIndex = index
        seenNodeAboveThreshold = true
        continue
      }

      if (!seenNodeAboveThreshold) candidateIndex = index
      break
    }

    return seenAnyNode ? candidateIndex : -1
  }

  function scrollToUserAnchor(targetIndex: number) {
    const ids = userAnchorIds.value
    if (!ids.length) return

    const safeIndex = Math.max(0, Math.min(ids.length - 1, targetIndex))
    const targetId = ids[safeIndex]
    const el = flowNodeElMap.get(targetId)
    if (!el) return

    flashAnchoredNode(targetId)
    el.scrollIntoView({ behavior: 'auto', block: 'start' })
  }

  function jumpToUserAnchor(direction: 'prev' | 'next') {
    const ids = userAnchorIds.value
    if (ids.length < 2) return

    const currentIndex = Math.max(0, getCurrentUserAnchorIndexFromViewport())
    const targetIndex = direction === 'next'
      ? Math.min(ids.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1)

    if (targetIndex === currentIndex) return
    scrollToUserAnchor(targetIndex)
  }

  function jumpToTurnIndex(turnIndex: number) {
    const targetIndex = Number(turnIndex)
    if (!Number.isInteger(targetIndex) || targetIndex < 0) return
    scrollToUserAnchor(targetIndex)
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName
    if (target.isContentEditable) return true
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
  }

  function onAnchorHotkey(event: KeyboardEvent) {
    if (!selectedSession.value) return
    if (isEditableTarget(event.target)) return
    if (!event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return

    const key = String(event.key || '').toLowerCase()
    if (key !== 'j' && key !== 'k') return

    event.preventDefault()
    jumpToUserAnchor(key === 'j' ? 'next' : 'prev')
  }

  function resetSessionFlowAnchors() {
    flowNodeElMap.clear()
    options.anchoredNodeId.value = ''
  }

  function disposeSessionFlowDomain() {
    if (anchorFlashTimer) clearTimeout(anchorFlashTimer)
    anchorFlashTimer = null
    flowNodeElMap.clear()
  }

  return {
    selectedSession,
    selectedSessionFlow,
    userAnchorIds,
    sanitizeContent,
    normalizeRole,
    joinChunkText,
    getAssistantDisplayChunks,
    setFlowNodeRef,
    jumpToUserAnchor,
    jumpToTurnIndex,
    onAnchorHotkey,
    resetSessionFlowAnchors,
    disposeSessionFlowDomain,
  }
}
