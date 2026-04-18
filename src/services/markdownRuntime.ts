type MarkedModule = typeof import('marked')
type DomPurifyModule = typeof import('dompurify')

type MarkdownRuntime = {
  marked: MarkedModule['marked']
  DOMPurify: DomPurifyModule['default']
}

let runtime: MarkdownRuntime | null = null
let runtimePromise: Promise<MarkdownRuntime> | null = null

export function getLoadedMarkdownRuntime(): MarkdownRuntime | null {
  return runtime
}

export async function ensureMarkdownRuntime(): Promise<MarkdownRuntime> {
  if (runtime) {
    return runtime
  }
  if (!runtimePromise) {
    runtimePromise = Promise.all([import('marked'), import('dompurify')]).then(
      ([markedMod, domPurifyMod]) => ({
        marked: markedMod.marked,
        DOMPurify: domPurifyMod.default,
      }),
    )
  }
  runtime = await runtimePromise
  return runtime
}

export async function renderMarkdownAsync(content: string): Promise<string> {
  const raw = String(content || '').trim()
  if (!raw) return ''
  const { marked, DOMPurify } = await ensureMarkdownRuntime()
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
