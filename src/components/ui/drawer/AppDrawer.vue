<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description?: string
  size?: 'md' | 'lg' | 'xl'
  closeOnBackdrop?: boolean
}>(), {
  description: '',
  size: 'lg',
  closeOnBackdrop: true,
})

const emit = defineEmits<{
  close: []
}>()

const drawerClass = computed(() => [
  'app-drawer-panel',
  `app-drawer-panel--${props.size}`,
])

function requestClose() {
  emit('close')
}

function handleBackdropClick() {
  if (props.closeOnBackdrop) {
    requestClose()
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) {
    requestClose()
  }
}

watch(
  () => props.open,
  (open) => {
    if (typeof window === 'undefined') return
    if (open) {
      window.addEventListener('keydown', handleKeydown)
      return
    }
    window.removeEventListener('keydown', handleKeydown)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (typeof window === 'undefined') return
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="app-drawer-fade">
      <div v-if="open" class="app-drawer-root" role="presentation">
        <div class="app-drawer-backdrop" aria-hidden="true" @click="handleBackdropClick" />
        <Transition name="app-drawer-slide" appear>
          <section :class="drawerClass" role="dialog" aria-modal="true" :aria-label="title">
            <header class="app-drawer-header">
              <div class="app-drawer-title-copy">
                <p v-if="$slots.eyebrow" class="app-drawer-eyebrow">
                  <slot name="eyebrow" />
                </p>
                <h2>{{ title }}</h2>
                <p v-if="description">{{ description }}</p>
              </div>
              <button type="button" class="app-drawer-close" aria-label="关闭抽屉" @click="requestClose">×</button>
            </header>

            <div class="app-drawer-body">
              <slot />
            </div>

            <footer v-if="$slots.footer" class="app-drawer-footer">
              <slot name="footer" />
            </footer>
          </section>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.app-drawer-root {
  position: fixed;
  inset: 0;
  z-index: 120;
  pointer-events: auto;
}

.app-drawer-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(2, 6, 23, 0.68);
}

.app-drawer-panel {
  position: absolute;
  inset-block: 24px;
  right: 24px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  width: min(980px, calc(100vw - 48px));
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  background: #121821;
  box-shadow: 0 24px 72px rgba(0, 0, 0, 0.36);
  overflow: hidden;
}

.app-drawer-panel--md {
  width: min(760px, calc(100vw - 48px));
}

.app-drawer-panel--lg {
  width: min(980px, calc(100vw - 48px));
}

.app-drawer-panel--xl {
  width: min(1180px, calc(100vw - 48px));
}

.app-drawer-header,
.app-drawer-footer {
  min-width: 0;
  border-color: rgba(255, 255, 255, 0.08);
  background: #171f2a;
}

.app-drawer-header {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18px 20px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.app-drawer-title-copy {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.app-drawer-eyebrow,
.app-drawer-title-copy h2,
.app-drawer-title-copy p {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.app-drawer-eyebrow {
  color: #8693a3;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.app-drawer-title-copy h2 {
  color: #f3f6fb;
  font-size: 20px;
  line-height: 1.25;
  font-weight: 650;
}

.app-drawer-title-copy p {
  color: #c3ccd8;
  font-size: 13px;
  line-height: 1.5;
}

.app-drawer-close {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  background: #10161e;
  color: #c3ccd8;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.app-drawer-close:hover {
  border-color: rgba(111, 134, 255, 0.28);
  color: #f3f6fb;
}

.app-drawer-close:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(10, 13, 18, 0.96), 0 0 0 4px rgba(111, 134, 255, 0.35);
}

.app-drawer-body {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 18px 20px 20px;
  background: #121821;
}

.app-drawer-footer {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
  min-height: 44px;
  padding: 7px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.app-drawer-fade-enter-active,
.app-drawer-fade-leave-active,
.app-drawer-slide-enter-active,
.app-drawer-slide-leave-active {
  transition: opacity 180ms ease, transform 200ms ease;
}

.app-drawer-fade-enter-from,
.app-drawer-fade-leave-to {
  opacity: 0;
}

.app-drawer-slide-enter-from,
.app-drawer-slide-leave-to {
  transform: translateX(20px);
  opacity: 0;
}

@media (max-width: 720px) {
  .app-drawer-panel,
  .app-drawer-panel--md,
  .app-drawer-panel--lg,
  .app-drawer-panel--xl {
    inset: 12px;
    width: auto;
    border-radius: 12px;
  }

  .app-drawer-header,
  .app-drawer-body,
  .app-drawer-footer {
    padding-inline: 14px;
  }

  .app-drawer-footer {
    overflow-x: auto;
  }
}
</style>
