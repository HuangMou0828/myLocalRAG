<script setup lang="ts">
export interface FormSelectOption {
  label: string
  value: string
  disabled?: boolean
}

interface FormSelectFieldProps {
  modelValue: string
  label?: string
  options: FormSelectOption[]
  disabled?: boolean
  hint?: string
}

const props = withDefaults(defineProps<FormSelectFieldProps>(), {
  label: '',
  disabled: false,
  hint: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

function onChange(event: Event) {
  const target = event.target as HTMLSelectElement | null
  emit('update:modelValue', String(target?.value || ''))
}
</script>

<template>
  <label class="form-field">
    <small v-if="props.label" class="form-field-label">{{ props.label }}</small>
    <select class="app-select form-field-select" :value="props.modelValue" :disabled="props.disabled" @change="onChange">
      <option v-for="item in props.options" :key="`${item.value}-${item.label}`" :value="item.value" :disabled="item.disabled">
        {{ item.label }}
      </option>
    </select>
    <small v-if="props.hint" class="form-field-hint">{{ props.hint }}</small>
  </label>
</template>

<style scoped>
.form-field {
  display: grid;
  gap: 0.28rem;
}

.form-field-label {
  color: var(--text-muted);
  font-size: 0.7rem;
}

.form-field-hint {
  color: var(--text-muted);
  font-size: 0.68rem;
}
</style>
