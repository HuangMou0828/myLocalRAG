<script setup lang="ts">
interface FormInputFieldProps {
  modelValue: string
  label?: string
  placeholder?: string
  type?: 'text' | 'email' | 'password' | 'search' | 'tel' | 'url' | 'number'
  disabled?: boolean
  readonly?: boolean
  invalid?: boolean
  hint?: string
}

const props = withDefaults(defineProps<FormInputFieldProps>(), {
  label: '',
  placeholder: '',
  type: 'text',
  disabled: false,
  readonly: false,
  invalid: false,
  hint: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

function onInput(event: Event) {
  const target = event.target as HTMLInputElement | null
  emit('update:modelValue', String(target?.value || ''))
}
</script>

<template>
  <label class="form-field">
    <small v-if="props.label" class="form-field-label">{{ props.label }}</small>
    <input
      class="app-input form-field-input"
      :class="{ 'is-invalid': props.invalid }"
      :type="props.type"
      :value="props.modelValue"
      :placeholder="props.placeholder"
      :disabled="props.disabled"
      :readonly="props.readonly"
      @input="onInput"
    />
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

.form-field-input.is-invalid {
  border-color: var(--danger-border);
  box-shadow: 0 0 0 2px var(--danger-soft);
}
</style>
