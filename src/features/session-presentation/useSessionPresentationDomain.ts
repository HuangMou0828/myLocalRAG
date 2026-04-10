interface SessionMessageLike {
  role: string
  content: string
  tags?: string[]
}

interface SessionLike {
  title: string
  messages: SessionMessageLike[]
}

interface UseSessionPresentationDomainOptions {
  normalizeRole: (role: string) => string
}

const FILE_REF_REGEX = /@[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8}/g

export function useSessionPresentationDomain<
  TSession extends SessionLike = SessionLike,
  TMessage extends SessionMessageLike = SessionMessageLike,
>(options: UseSessionPresentationDomainOptions) {
  function extractRefTokens(input: string): string[] {
    const matches = String(input || '').match(FILE_REF_REGEX) || []
    const unique = new Set<string>()
    for (const token of matches) {
      const cleaned = token.replace(/[.,;:!?，。；：、]+$/g, '').trim()
      if (cleaned.length >= 3) unique.add(cleaned)
      if (unique.size >= 5) break
    }
    return Array.from(unique)
  }

  function cleanTitleText(input: string): string {
    return String(input || '')
      .replace(/<\s*user_query\s*>/gi, '')
      .replace(/<\s*\/\s*user_query\s*>/gi, '')
      .replace(FILE_REF_REGEX, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s，。；：,:、\-]+/, '')
      .trim()
  }

  function looksLikeRefTitle(title: string): boolean {
    const text = String(title || '').trim()
    if (!text) return true
    if (text.startsWith('@')) return true
    if (text.includes('/')) return true
    if (/@[A-Za-z0-9_./-]+/.test(text)) return true
    return false
  }

  function getTurnCount(messages: TMessage[]): number {
    const list = Array.isArray(messages) ? messages : []
    const userCount = list.filter((msg) => options.normalizeRole(msg.role) === 'user').length
    if (userCount > 0) return userCount

    // Fallback: if no user role exists, estimate by assistant chunks.
    const assistantCount = list.filter((msg) => options.normalizeRole(msg.role) === 'assistant').length
    return assistantCount > 0 ? assistantCount : list.length
  }

  function getSessionMessageTags(session: TSession): string[] {
    const set = new Set<string>()
    for (const msg of session.messages || []) {
      for (const tag of Array.isArray(msg.tags) ? msg.tags : []) {
        const value = String(tag || '').trim()
        if (!value) continue
        set.add(value)
        if (set.size >= 6) return Array.from(set)
      }
    }
    return Array.from(set)
  }

  function getSessionDisplayTitle(item: TSession): string {
    const original = String(item?.title || '').trim()
    if (original && !looksLikeRefTitle(original)) return original

    const userMsg = (item.messages || []).find((msg) => String(msg.role || '').toLowerCase() === 'user')
    const userText = cleanTitleText(userMsg?.content || '')
    if (userText) return userText.slice(0, 56)

    if (original) return cleanTitleText(original).slice(0, 56) || '未命名会话'
    return '未命名会话'
  }

  function getSessionRefs(item: TSession): string[] {
    const sourceTexts = [
      item.title,
      ...(item.messages || [])
        .filter((msg) => String(msg.role || '').toLowerCase() === 'user')
        .slice(0, 2)
        .map((msg) => msg.content),
    ]

    const refs = new Set<string>()
    for (const text of sourceTexts) {
      for (const token of extractRefTokens(text || '')) {
        refs.add(token)
        if (refs.size >= 5) return Array.from(refs)
      }
    }
    return Array.from(refs)
  }

  return {
    getTurnCount,
    getSessionMessageTags,
    getSessionDisplayTitle,
    getSessionRefs,
  }
}
