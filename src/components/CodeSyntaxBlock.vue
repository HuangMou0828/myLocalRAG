<script setup lang="ts">
import 'highlight.js/styles/github-dark-dimmed.css'
import { computed, onMounted, ref } from 'vue'
import DOMPurify from 'dompurify'
import { ensureHighlightJs, getLoadedHighlightJs } from '@/services/highlightRuntime'

type LanguageOption = {
  value: string
  label: string
}

const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: 'auto', label: '自动识别' },
  { value: 'plaintext', label: '纯文本' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'bash', label: 'Bash' },
  { value: 'yaml', label: 'YAML' },
  { value: 'xml', label: 'XML / HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'diff', label: 'Diff / Patch' },
  { value: 'python', label: 'Python' },
  { value: 'go', label: 'Go' },
  { value: 'java', label: 'Java' },
]

const props = withDefaults(defineProps<{
  code: string
  defaultLanguage?: string
  maxHeight?: string
  showLanguagePicker?: boolean
}>(), {
  defaultLanguage: 'auto',
  maxHeight: '320px',
  showLanguagePicker: true,
})

function normalizeLanguage(value: string): string {
  const next = String(value || 'auto').trim().toLowerCase()
  return LANGUAGE_OPTIONS.some((item) => item.value === next) ? next : 'auto'
}

function escapeHtml(input: string): string {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const selectedLanguage = ref(normalizeLanguage(props.defaultLanguage))
const rawCode = computed(() => String(props.code || ''))
const highlightReady = ref(Boolean(getLoadedHighlightJs()))

onMounted(() => {
  if (!highlightReady.value) {
    void ensureHighlightJs().then(() => {
      highlightReady.value = true
    })
  }
})

const highlightedHtml = computed(() => {
  const source = rawCode.value
  if (!source) return ''
  const hljs = getLoadedHighlightJs()

  try {
    if (selectedLanguage.value === 'plaintext') {
      return escapeHtml(source)
    }
    if (!highlightReady.value || !hljs) {
      return escapeHtml(source)
    }
    if (selectedLanguage.value === 'auto') {
      return DOMPurify.sanitize(hljs.highlightAuto(source).value, {
        USE_PROFILES: { html: true },
      })
    }
    if (hljs.getLanguage(selectedLanguage.value)) {
      return DOMPurify.sanitize(
        hljs.highlight(source, {
          language: selectedLanguage.value,
          ignoreIllegals: true,
        }).value,
        { USE_PROFILES: { html: true } },
      )
    }
  } catch {
    return escapeHtml(source)
  }

  return escapeHtml(source)
})
</script>

<template>
  <div class="code-syntax-block">
    <div class="code-syntax-toolbar" v-if="showLanguagePicker">
      <small>语法</small>
      <select class="app-select code-syntax-lang-select" v-model="selectedLanguage">
        <option v-for="option in LANGUAGE_OPTIONS" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </div>
    <pre class="code-syntax-pre" :style="{ maxHeight }"><code class="hljs code-syntax-code" v-html="highlightedHtml" /></pre>
  </div>
</template>
