import { marked } from 'marked'
import DOMPurify from 'dompurify'

export function useDisplayFormatDomain() {
  function renderMarkdown(content: string): string {
    const raw = String(content || '').trim()
    if (!raw) return ''

    const parsed = marked.parse(raw, {
      gfm: true,
      breaks: true,
      async: false,
    })

    const html = typeof parsed === 'string' ? parsed : ''
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
    })
  }

  function formatTime(value?: string | null): string {
    if (!value) return '-'
    const raw = String(value).trim()
    if (!raw) return '-'
    const asNumber = Number(raw)
    let date: Date
    if (Number.isFinite(asNumber) && /^\d+(\.\d+)?$/.test(raw)) {
      const ms = asNumber < 1e12 ? asNumber * 1000 : asNumber
      date = new Date(ms)
    } else {
      date = new Date(raw)
    }
    if (Number.isNaN(date.getTime())) return raw
    return date.toLocaleString('zh-CN', { hour12: false })
  }

  function formatScore(value?: number | null): string {
    const num = Number(value)
    if (!Number.isFinite(num)) return '-'
    return num.toFixed(3)
  }

  return {
    renderMarkdown,
    formatTime,
    formatScore,
  }
}
