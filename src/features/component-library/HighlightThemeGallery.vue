<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import draculaCss from 'highlight.js/styles/base16/dracula.css?raw'
import githubDarkCss from 'highlight.js/styles/github-dark.css?raw'
import githubDarkDimmedCss from 'highlight.js/styles/github-dark-dimmed.css?raw'
import atomOneDarkCss from 'highlight.js/styles/atom-one-dark.css?raw'
import monokaiCss from 'highlight.js/styles/monokai.css?raw'
import nordCss from 'highlight.js/styles/nord.css?raw'
import nightOwlCss from 'highlight.js/styles/night-owl.css?raw'
import tokyoNightDarkCss from 'highlight.js/styles/tokyo-night-dark.css?raw'
import vs2015Css from 'highlight.js/styles/vs2015.css?raw'
import irBlackCss from 'highlight.js/styles/ir-black.css?raw'
import { ensureHighlightJs, getLoadedHighlightJs } from '@/services/highlightRuntime'

interface ThemeItem {
  id: string
  name: string
  css: string
}

const props = withDefaults(defineProps<{
  currentThemeId?: string
}>(), {
  currentThemeId: 'dracula',
})
const highlightReady = ref(Boolean(getLoadedHighlightJs()))

onMounted(() => {
  if (!highlightReady.value) {
    void ensureHighlightJs().then(() => {
      highlightReady.value = true
    })
  }
})

const sampleSnippets = [
  {
    label: 'TypeScript',
    language: 'typescript',
    code:
`interface BugTraceResult {
  conversationId: string
  score: number
}

export function pickTop(items: BugTraceResult[], topK = 3) {
  return [...items]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}`,
  },
  {
    label: 'JSON',
    language: 'json',
    code:
`{
  "theme": "dracula",
  "dark": true,
  "features": ["syntax-highlight", "code-preview"]
}`,
  },
  {
    label: 'Bash',
    language: 'bash',
    code:
`npm run build
git add src/
git commit -m "feat: add syntax theme gallery"`,
  },
]

const themeItems: ThemeItem[] = [
  { id: 'dracula', name: 'Dracula', css: draculaCss },
  { id: 'github-dark', name: 'GitHub Dark', css: githubDarkCss },
  { id: 'github-dark-dimmed', name: 'GitHub Dark Dimmed', css: githubDarkDimmedCss },
  { id: 'atom-one-dark', name: 'Atom One Dark', css: atomOneDarkCss },
  { id: 'monokai', name: 'Monokai', css: monokaiCss },
  { id: 'nord', name: 'Nord', css: nordCss },
  { id: 'night-owl', name: 'Night Owl', css: nightOwlCss },
  { id: 'tokyo-night-dark', name: 'Tokyo Night Dark', css: tokyoNightDarkCss },
  { id: 'vs2015', name: 'VS2015', css: vs2015Css },
  { id: 'ir-black', name: 'IR Black', css: irBlackCss },
]

function renderSnippet(language: string, code: string): string {
  const hljs = getLoadedHighlightJs()
  if (!highlightReady.value || !hljs) {
    return code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value
  } catch {
    return code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }
}

function buildThemeDemoDoc(cssText: string): string {
  const blocks = sampleSnippets.map((item) => {
    const html = renderSnippet(item.language, item.code)
    return `
      <section class="demo-block">
        <div class="demo-lang">${item.label}</div>
        <pre><code class="hljs language-${item.language}">${html}</code></pre>
      </section>
    `
  }).join('\n')

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 10px;
        background: #0b1220;
        font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
      }
      .demo-grid {
        display: grid;
        gap: 10px;
      }
      .demo-lang {
        margin: 0 0 4px;
        font-size: 11px;
        line-height: 1;
        color: #9fb3cb;
      }
      pre {
        margin: 0;
        border-radius: 8px;
        overflow: auto;
        border: 1px solid rgba(148, 163, 184, 0.25);
      }
      code {
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        line-height: 1.5;
      }
    </style>
    <style>${cssText}</style>
  </head>
  <body>
    <div class="demo-grid">
      ${blocks}
    </div>
  </body>
</html>`
}

const themeCards = computed(() => {
  return themeItems.map((item) => ({
    ...item,
    srcdoc: buildThemeDemoDoc(item.css),
  }))
})
</script>

<template>
  <section class="hljs-theme-gallery">
    <header class="hljs-theme-gallery-head">
      <h4>语法高亮深色主题 Demo</h4>
      <small>全部为 highlight.js 原生主题背景（未强制覆盖 #181818）</small>
    </header>

    <div class="hljs-theme-grid">
      <article
        v-for="theme in themeCards"
        :key="theme.id"
        class="hljs-theme-card"
      >
        <div class="hljs-theme-card-head">
          <div class="hljs-theme-name-wrap">
            <strong>{{ theme.name }}</strong>
            <small>{{ theme.id }}</small>
          </div>
          <span v-if="theme.id === currentThemeId" class="hljs-theme-current">当前</span>
        </div>
        <iframe
          class="hljs-theme-frame"
          :title="`hljs theme demo ${theme.name}`"
          :srcdoc="theme.srcdoc"
          loading="lazy"
        />
      </article>
    </div>
  </section>
</template>
