<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'

interface ProviderSection {
  id: string
  label: string
  count: number
}

const props = defineProps<{
  menuOpen: boolean
  providerSections: ProviderSection[]
  activeProvider: string
  providerLogoMap: Record<string, string>
  onSelectProvider: (providerId: string) => void
}>()

const emit = defineEmits<{
  'update:menuOpen': [value: boolean]
}>()

function toggleMenu() {
  emit('update:menuOpen', !props.menuOpen)
}

function isSessionProvider(id: string) {
  return id !== 'bug-cursor'
    && id !== 'feishu-master'
    && id !== 'component-library'
    && id !== 'model-settings'
    && !String(id || '').startsWith('knowledge-')
}
</script>

<template>
  <div class="accordion-item">
    <button class="app-btn accordion-head app-btn-ghost" data-short-label="会话" @click="toggleMenu" type="button">
      <div class="accordion-title">
        <strong>会话来源</strong>
        <small>按来源查看历史会话</small>
      </div>
      <span class="accordion-toggle-icon" :class="{ open: menuOpen }">
        <ChevronDown :size="16" />
      </span>
    </button>

    <transition name="accordion">
      <div class="accordion-body" v-show="menuOpen">
        <div class="provider-list">
          <template v-for="item in providerSections" :key="item.id">
            <button
              v-if="isSessionProvider(item.id)"
              type="button"
              class="provider-item"
              :class="{ active: activeProvider === item.id }"
              @click="onSelectProvider(item.id)"
              :title="`${item.label}（${item.count}）`"
            >
              <div class="provider-main">
                <span class="provider-badge" :data-provider="item.id">
                  {{ providerLogoMap[item.id] || 'AI' }}
                </span>
                <strong class="provider-label">{{ item.label }}</strong>
              </div>
              <div class="provider-count">
                <span>{{ item.count }}</span>
              </div>
            </button>
          </template>
        </div>
      </div>
    </transition>
  </div>
</template>
