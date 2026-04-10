type HighlightJsModule = typeof import('highlight.js/lib/core')
type HighlightJs = HighlightJsModule['default']

let highlightJsInstance: HighlightJs | null = null
let highlightJsPromise: Promise<HighlightJs> | null = null

export function getLoadedHighlightJs(): HighlightJs | null {
  return highlightJsInstance
}

export async function ensureHighlightJs(): Promise<HighlightJs> {
  if (highlightJsInstance) {
    return highlightJsInstance
  }
  if (!highlightJsPromise) {
    highlightJsPromise = loadHighlightJs()
  }
  highlightJsInstance = await highlightJsPromise
  return highlightJsInstance
}

async function loadHighlightJs(): Promise<HighlightJs> {
  const [
    { default: hljs },
    { default: langBash },
    { default: langCss },
    { default: langDiff },
    { default: langGo },
    { default: langJava },
    { default: langJavascript },
    { default: langJson },
    { default: langMarkdown },
    { default: langPython },
    { default: langRuby },
    { default: langTypescript },
    { default: langXml },
    { default: langYaml },
  ] = await Promise.all([
    import('highlight.js/lib/core'),
    import('highlight.js/lib/languages/bash'),
    import('highlight.js/lib/languages/css'),
    import('highlight.js/lib/languages/diff'),
    import('highlight.js/lib/languages/go'),
    import('highlight.js/lib/languages/java'),
    import('highlight.js/lib/languages/javascript'),
    import('highlight.js/lib/languages/json'),
    import('highlight.js/lib/languages/markdown'),
    import('highlight.js/lib/languages/python'),
    import('highlight.js/lib/languages/ruby'),
    import('highlight.js/lib/languages/typescript'),
    import('highlight.js/lib/languages/xml'),
    import('highlight.js/lib/languages/yaml'),
  ])

  hljs.registerLanguage('bash', langBash)
  hljs.registerLanguage('css', langCss)
  hljs.registerLanguage('diff', langDiff)
  hljs.registerLanguage('go', langGo)
  hljs.registerLanguage('java', langJava)
  hljs.registerLanguage('javascript', langJavascript)
  hljs.registerLanguage('json', langJson)
  hljs.registerLanguage('markdown', langMarkdown)
  hljs.registerLanguage('python', langPython)
  hljs.registerLanguage('ruby', langRuby)
  hljs.registerLanguage('typescript', langTypescript)
  hljs.registerLanguage('xml', langXml)
  hljs.registerLanguage('yaml', langYaml)

  return hljs
}
