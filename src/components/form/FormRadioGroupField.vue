<script setup lang="ts">
export interface FormRadioOption {
  label: string
  value: string
  disabled?: boolean
}

interface FormRadioGroupFieldProps {
  modelValue: string
  label?: string
  options: FormRadioOption[]
  disabled?: boolean
  direction?: 'row' | 'column'
  hint?: string
  name?: string
}

const props = withDefaults(defineProps<FormRadioGroupFieldProps>(), {
  label: '',
  disabled: false,
  direction: 'row',
  hint: '',
  name: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const groupName = props.name || `form-radio-${Math.random().toString(36).slice(2, 9)}`

function onChange(value: string) {
  emit('update:modelValue', value)
}
</script>

<template>
  <fieldset class="form-field">
    <legend v-if="props.label" class="form-field-label">{{ props.label }}</legend>
    <div class="form-radio-group" :class="{ column: props.direction === 'column' }">
      <label
        v-for="item in props.options"
        :key="`${item.value}-${item.label}`"
        class="form-radio-option"
        :class="{ disabled: props.disabled || item.disabled }"
      >
        <input
          class="form-radio-input"
          type="radio"
          :name="groupName"
          :checked="props.modelValue === item.value"
          :disabled="props.disabled || item.disabled"
          @change="onChange(item.value)"
        />
        <span>{{ item.label }}</span>
      </label>
    </div>
    <small v-if="props.hint" class="form-field-hint">{{ props.hint }}</small>
  </fieldset>
</template>

<style scoped>
.form-field {
  border: 0;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.32rem;
}

.form-field-label {
  color: #9fb6d5;
  font-size: 0.7rem;
  margin: 0;
}

.form-radio-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
}

.form-radio-group.column {
  flex-direction: column;
  align-items: flex-start;
}

.form-radio-option {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  color: #dbeafe;
}

.form-radio-option.disabled {
  opacity: 0.6;
}

.form-radio-input {
  width: 14px;
  height: 14px;
  margin: 0;
}

.form-field-hint {
  color: #7f9bbd;
  font-size: 0.68rem;
}
</style>
