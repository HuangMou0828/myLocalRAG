<script setup lang="ts">
import { ref, watch } from 'vue'
import { renderMarkdownAsync, getLoadedMarkdownRuntime } from '@/services/markdownRuntime'

const props = withDefaults(defineProps<{
  content?: string | null
  tag?: string
}>(), {
  content: '',
  tag: 'div',
})

const html = ref('')

watch(
  () => props.content,
  async (raw) => {
    const value = String(raw || '')
    if (!value.trim()) {
      html.value = ''
      return
    }
    if (getLoadedMarkdownRuntime()) {
      html.value = await renderMarkdownAsync(value)
      return
    }
    html.value = ''
    const result = await renderMarkdownAsync(value)
    if (props.content === raw) {
      html.value = result
    }
  },
  { immediate: true },
)
</script>

<template>
  <component :is="tag" v-html="html" />
</template>
