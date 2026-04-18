/** 截断文本到指定长度，末尾加省略号 */
export function clipText(value: string, limit = 160) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

/** 数字越大 severity 越高，用于排序 */
export function severityRank(value: string) {
  if (value === 'high') return 3
  if (value === 'medium') return 2
  return 1
}

/** 小写 + trim，用于关键词过滤 */
export function normalizeKeyword(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

/** 对字符串数组去重并限制数量 */
export function dedupeStrings(values: unknown[], limit = 8) {
  const deduped = new Set<string>()
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = String(value || '').trim()
    if (!normalized) continue
    deduped.add(normalized)
    if (deduped.size >= limit) break
  }
  return Array.from(deduped)
}
