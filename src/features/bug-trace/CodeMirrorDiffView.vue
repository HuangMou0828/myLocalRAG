<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorState, type Extension } from '@codemirror/state'
import { lineNumbers, EditorView } from '@codemirror/view'
import { MergeView } from '@codemirror/merge'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'

const props = defineProps<{
  filePath: string
  fileName?: string
  directoryPath?: string
  originalText: string
  modifiedText: string
  source: 'snapshot' | 'patch'
}>()

const containerRef = ref<HTMLElement | null>(null)
let mergeView: MergeView | null = null
let renderToken = 0

const resolvedFileName = computed(() => {
  if (props.fileName) return props.fileName
  const parts = String(props.filePath || '').split('/').filter(Boolean)
  return parts[parts.length - 1] || '未命名文件'
})

const resolvedDirectoryPath = computed(() => {
  if (props.directoryPath) return props.directoryPath
  const parts = String(props.filePath || '').split('/').filter(Boolean)
  return parts.slice(0, -1).join('/')
})

const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: '#f8fafc',
  },
  '&.cm-editor': {
    color: '#0f172a',
  },
  '.cm-scroller': {
    fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
    lineHeight: '1.55',
  },
  '.cm-content': {
    padding: '12px 0',
  },
  '.cm-line': {
    padding: '0 12px',
  },
  '.cm-gutters': {
    backgroundColor: '#eef2ff',
    color: '#64748b',
    borderRight: '1px solid #dbe4ff',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(148, 163, 184, 0.08)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '.cm-mergeViewEditors': {
    minHeight: '360px',
  },
  '.cm-editor': {
    height: '100%',
  },
  '.cm-mergeViewEditor': {
    backgroundColor: '#f8fafc',
  },
  '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': {
    backgroundColor: 'rgba(254, 226, 226, 0.92)',
  },
  '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': {
    backgroundColor: 'rgba(220, 252, 231, 0.96)',
  },
  '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': {
    background: 'rgba(239, 68, 68, 0.16)',
    boxShadow: 'inset 0 -2px 0 rgba(220, 38, 38, 0.34)',
  },
  '&.cm-merge-b .cm-changedText': {
    background: 'rgba(34, 197, 94, 0.18)',
    boxShadow: 'inset 0 -2px 0 rgba(22, 163, 74, 0.34)',
  },
  '&.cm-merge-b .cm-deletedText': {
    background: 'rgba(248, 113, 113, 0.16)',
    boxShadow: 'inset 0 -2px 0 rgba(220, 38, 38, 0.3)',
  },
  '.cm-insertedLine, .cm-deletedLine, .cm-deletedLine del': {
    color: 'inherit',
    textDecoration: 'none',
  },
  '.cm-changeGutter': {
    width: '4px',
    paddingLeft: '0',
  },
  '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': {
    backgroundColor: '#ef4444',
  },
  '&.cm-merge-b .cm-changedLineGutter': {
    backgroundColor: '#22c55e',
  },
  '.cm-collapsedLines': {
    color: '#475569',
    background: 'linear-gradient(to bottom, transparent 0, #e2e8f0 30%, #e2e8f0 70%, transparent 100%)',
  },
}, { dark: false })

async function loadLanguageExtension(filePath: string): Promise<Extension> {
  const lower = String(filePath || '').toLowerCase()
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) {
    const { javascript } = await import('@codemirror/lang-javascript')
    return javascript({ typescript: true, jsx: lower.endsWith('.tsx') })
  }
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    const { javascript } = await import('@codemirror/lang-javascript')
    return javascript({ jsx: lower.endsWith('.jsx') })
  }
  if (lower.endsWith('.json')) return (await import('@codemirror/lang-json')).json()
  if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.less')) return (await import('@codemirror/lang-css')).css()
  if (lower.endsWith('.html') || lower.endsWith('.vue')) return (await import('@codemirror/lang-html')).html()
  if (lower.endsWith('.xml')) return (await import('@codemirror/lang-xml')).xml()
  if (lower.endsWith('.md')) return (await import('@codemirror/lang-markdown')).markdown()
  if (lower.endsWith('.py')) return (await import('@codemirror/lang-python')).python()
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return (await import('@codemirror/lang-yaml')).yaml()
  if (lower.endsWith('.java')) return (await import('@codemirror/lang-java')).java()
  if (lower.endsWith('.go')) return (await import('@codemirror/lang-go')).go()
  return []
}

function buildEditorExtensions(languageExtension: Extension) {
  return [
    lineNumbers(),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    baseTheme,
    languageExtension,
  ]
}

function destroyMergeView() {
  mergeView?.destroy()
  mergeView = null
  if (containerRef.value) containerRef.value.innerHTML = ''
}

async function createMergeView() {
  if (!containerRef.value) return

  const token = ++renderToken
  const languageExtension = await loadLanguageExtension(props.filePath)
  if (token !== renderToken || !containerRef.value) return

  destroyMergeView()
  mergeView = new MergeView({
    parent: containerRef.value,
    orientation: 'a-b',
    gutter: true,
    highlightChanges: true,
    collapseUnchanged: {
      margin: 4,
      minSize: 6,
    },
    diffConfig: {
      scanLimit: 500,
      timeout: 100,
    },
    a: {
      doc: props.originalText,
      extensions: buildEditorExtensions(languageExtension),
    },
    b: {
      doc: props.modifiedText,
      extensions: buildEditorExtensions(languageExtension),
    },
  })
}

onMounted(() => {
  void createMergeView()
})

watch(
  () => [props.filePath, props.originalText, props.modifiedText].join('\u0000'),
  () => {
    void createMergeView()
  },
)

onBeforeUnmount(() => {
  renderToken += 1
  destroyMergeView()
})
</script>

<template>
  <div class="bug-trace-codemirror-shell">
    <div class="bug-trace-codemirror-head">
      <div class="bug-trace-codemirror-title">
        <strong>{{ resolvedFileName }}</strong>
        <small>{{ resolvedDirectoryPath || filePath || '路径信息不可用' }}</small>
      </div>
      <span class="bug-trace-codemirror-badge">{{ source === 'snapshot' ? '完整快照对比' : 'Patch 重建对比' }}</span>
    </div>
    <div ref="containerRef" class="bug-trace-codemirror-host" />
  </div>
</template>
