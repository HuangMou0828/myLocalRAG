import { computed, ref } from 'vue'
import type { WikiVaultApi } from '@/services/kbApiServices'
import { dedupeStrings, normalizeKeyword, severityRank } from './knowledgeWorkbenchUtils'

type HealthFinding = Awaited<ReturnType<WikiVaultApi['fetchLint']>>['findings'][number]
type HealthSeverityFilter = 'all' | 'high' | 'medium' | 'low'
type HealthActionQueueTarget = 'notes' | 'evidence' | 'promotion' | 'task-review'
type WikiSearchResult = Awaited<ReturnType<WikiVaultApi['search']>>['results'][number]
type HealthSuggestionMode = '' | 'repair' | 'anchor'

interface HealthActionQueueItem {
  id: string
  title: string
  description: string
  codes: string[]
  target: HealthActionQueueTarget
  targetSection?: 'issues' | 'patterns' | 'syntheses'
  items: HealthFinding[]
  count: number
  severity: HealthFinding['severity']
}

interface HealthSuggestionResult extends WikiSearchResult {
  hint: string
}

export type {
  HealthFinding,
  HealthSeverityFilter,
  HealthActionQueueTarget,
  HealthSuggestionMode,
  HealthActionQueueItem,
  HealthSuggestionResult,
}

interface UseWikiHealthDomainOptions {
  wikiService: WikiVaultApi
  notify: (message: string, tone?: 'info' | 'success' | 'warning' | 'danger') => void
  loadPromotionQueue: (force?: boolean) => Promise<void>
  getPromotionQueue: () => Awaited<ReturnType<WikiVaultApi['fetchPromotionQueue']>> | null
  openNoteViewer: (paths: string[], title: string) => Promise<void>
}

const HEALTH_ACTION_QUEUE_DEFS: Array<{
  id: string
  title: string
  description: string
  codes: string[]
  target: HealthActionQueueTarget
  targetSection?: 'issues' | 'patterns' | 'syntheses'
}> = [
  {
    id: 'link-repair',
    title: '修链接骨架',
    description: '先处理断链、孤儿页和未锚定概念，阅读层会更稳定。',
    codes: ['broken-wikilink', 'orphan-note', 'concept-unanchored'],
    target: 'evidence',
  },
  {
    id: 'issue-backlog',
    title: '清理 Issue 积压',
    description: '把 stale draft、证据太薄和排障结构不完整的问题推进到 issue 审核流。',
    codes: ['stale-draft-issue', 'thin-issue-evidence', 'issue-incomplete-troubleshooting', 'issue-missing-project'],
    target: 'promotion',
    targetSection: 'issues',
  },
  {
    id: 'pattern-backlog',
    title: '补齐 Pattern / Project 沉淀',
    description: '优先把 pattern 缺口和 project 知识空洞推进到 reader-first 层。',
    codes: ['pattern-incomplete-shape', 'pattern-missing-project', 'project-knowledge-gap', 'project-missing-patterns'],
    target: 'promotion',
    targetSection: 'patterns',
  },
  {
    id: 'page-quality',
    title: '修页面质量',
    description: '弱摘要和重复标题更适合先回看页面，再决定如何整理。',
    codes: ['weak-summary', 'duplicate-title'],
    target: 'notes',
  },
  {
    id: 'context-recheck',
    title: '回源补上下文',
    description: '项目归属不清或证据不足的内容，先回源会话看能否补上下文。',
    codes: ['issue-missing-project', 'pattern-missing-project', 'thin-issue-evidence'],
    target: 'task-review',
  },
]

function extractMarkdownSectionText(markdownText: unknown, heading: string) {
  const raw = String(markdownText || '')
  const safeHeading = String(heading || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = raw.match(new RegExp(`## ${safeHeading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|\\s*$)`))
  return String(match?.[1] || '').trim()
}

function normalizeWikiLinkTarget(target: unknown) {
  const normalized = String(target || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/g, '')
    .replace(/#.*$/g, '')
    .trim()
  if (!normalized) return ''
  return normalized.endsWith('.md') ? normalized : `${normalized}.md`
}

function parseWikiLinkTargets(markdownText: unknown) {
  const seen = new Set<string>()
  const matches = String(markdownText || '').matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)
  for (const match of matches) {
    const target = normalizeWikiLinkTarget(match?.[1] || '')
    if (!target) continue
    seen.add(target)
  }
  return Array.from(seen)
}

function basenameWithoutMarkdown(value: unknown) {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/g, '')
    .replace(/\.md$/i, '')
    .trim()
  if (!normalized) return ''
  return normalized.split('/').filter(Boolean).pop() || normalized
}

function tokenizeForSearch(value: unknown) {
  return String(value || '')
    .replace(/\.md$/i, '')
    .split(/[/_\-.]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
}

function extractBrokenTarget(detail: unknown) {
  const match = String(detail || '').match(/Links to missing note:\s*(.+)$/i)
  return String(match?.[1] || '').trim()
}

export function useWikiHealthDomain(options: UseWikiHealthDomainOptions) {
  const healthLoading = ref(false)
  const wikiHealth = ref<Awaited<ReturnType<WikiVaultApi['fetchLint']>> | null>(null)
  const healthSeverityFilter = ref<HealthSeverityFilter>('all')
  const healthCodeFilter = ref('all')
  const healthKeyword = ref('')
  const selectedHealthFindingKey = ref('')
  const healthSuggestionLoading = ref(false)
  const healthSuggestionError = ref('')
  const healthSuggestionMode = ref<HealthSuggestionMode>('')
  const healthSuggestionKey = ref('')
  const healthSuggestionTitle = ref('')
  const healthSuggestionDescription = ref('')
  const healthSuggestionQuery = ref('')
  const healthSuggestionResults = ref<HealthSuggestionResult[]>([])
  const healthBatchActionLoading = ref(false)
  const healthBatchActionLabel = ref('')
  const healthRepairApplyingTarget = ref('')
  const vaultRebuildLoading = ref(false)

  function getHealthFindingKey(item: Partial<HealthFinding> | null | undefined) {
    return [item?.relativePath || '', item?.code || '', item?.title || '', item?.detail || '']
      .map((value) => String(value || '').trim())
      .join('::')
  }

  const healthSummaryCards = computed(() => {
    const summary = wikiHealth.value?.summary
    return [
      {
        id: 'findings',
        title: '总发现数',
        count: Number(summary?.totalFindings || 0),
        description: '当前 wiki 的结构健康问题总量',
      },
      {
        id: 'high',
        title: 'High',
        count: Number(summary?.highCount || 0),
        description: '优先处理 broken links 等高风险问题',
      },
      {
        id: 'medium',
        title: 'Medium',
        count: Number(summary?.mediumCount || 0),
        description: '结构和内容稳定性问题',
      },
      {
        id: 'low',
        title: 'Low',
        count: Number(summary?.lowCount || 0),
        description: '长期维护质量和积压提醒',
      },
    ]
  })

  const healthCodeOptions = computed(() => {
    const counts = new Map<string, number>()
    for (const item of Array.isArray(wikiHealth.value?.findings) ? wikiHealth.value?.findings : []) {
      const code = String(item?.code || '').trim()
      if (!code) continue
      counts.set(code, Number(counts.get(code) || 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => {
        const countDelta = b[1] - a[1]
        if (countDelta) return countDelta
        return a[0].localeCompare(b[0])
      })
      .map(([value, count]) => ({ value, count }))
  })

  const filteredHealthFindings = computed(() => {
    const keyword = normalizeKeyword(healthKeyword.value)
    const findings = Array.isArray(wikiHealth.value?.findings) ? wikiHealth.value?.findings : []
    return findings.filter((item) => {
      if (healthSeverityFilter.value !== 'all' && item.severity !== healthSeverityFilter.value) return false
      if (healthCodeFilter.value !== 'all' && item.code !== healthCodeFilter.value) return false
      if (!keyword) return true
      return [
        item.code,
        item.title,
        item.detail,
        item.suggestion,
        item.relativePath,
      ]
        .map((part) => normalizeKeyword(part))
        .some((part) => part.includes(keyword))
    })
  })

  const healthFindingGroups = computed(() => {
    const grouped = new Map<string, { code: string; severity: HealthFinding['severity']; items: HealthFinding[] }>()
    for (const item of filteredHealthFindings.value) {
      if (!grouped.has(item.code)) {
        grouped.set(item.code, {
          code: item.code,
          severity: item.severity,
          items: [],
        })
      }
      const group = grouped.get(item.code)
      if (!group) continue
      group.items.push(item)
      if (severityRank(item.severity) > severityRank(group.severity)) {
        group.severity = item.severity
      }
    }
    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        items: group.items.slice().sort((a, b) => {
          const severityDelta = severityRank(b.severity) - severityRank(a.severity)
          if (severityDelta) return severityDelta
          return `${a.relativePath} ${a.title}`.localeCompare(`${b.relativePath} ${b.title}`)
        }),
      }))
      .sort((a, b) => {
        const severityDelta = severityRank(b.severity) - severityRank(a.severity)
        if (severityDelta) return severityDelta
        const countDelta = b.items.length - a.items.length
        if (countDelta) return countDelta
        return a.code.localeCompare(b.code)
      })
  })

  const selectedHealthFinding = computed(() =>
    filteredHealthFindings.value.find((item) => getHealthFindingKey(item) === selectedHealthFindingKey.value)
    || filteredHealthFindings.value[0]
    || null,
  )

  const healthSuggestionState = computed(() => ({
    loading: healthSuggestionLoading.value,
    error: healthSuggestionError.value,
    mode: healthSuggestionMode.value,
    findingKey: healthSuggestionKey.value,
    title: healthSuggestionTitle.value,
    description: healthSuggestionDescription.value,
    query: healthSuggestionQuery.value,
    results: healthSuggestionResults.value,
    isCurrentFinding: Boolean(selectedHealthFinding.value) && healthSuggestionKey.value === getHealthFindingKey(selectedHealthFinding.value),
  }))

  const healthActionQueues = computed<HealthActionQueueItem[]>(() => {
    const queues: HealthActionQueueItem[] = []
    for (const definition of HEALTH_ACTION_QUEUE_DEFS) {
      const items = filteredHealthFindings.value.filter((item) => definition.codes.includes(item.code))
      if (!items.length) continue
      const severity = items.reduce<HealthFinding['severity']>((current, item) =>
        severityRank(item.severity) > severityRank(current) ? item.severity : current,
      'low')
      queues.push({
        id: definition.id,
        title: definition.title,
        description: definition.description,
        codes: definition.codes.slice(),
        target: definition.target,
        targetSection: definition.targetSection,
        items,
        count: items.length,
        severity,
      })
    }
    return queues.sort((a, b) => {
      const severityDelta = severityRank(b.severity) - severityRank(a.severity)
      if (severityDelta) return severityDelta
      const countDelta = b.count - a.count
      if (countDelta) return countDelta
      return a.title.localeCompare(b.title)
    })
  })

  async function loadWikiHealth(force = false) {
    if (healthLoading.value) return
    if (!force && wikiHealth.value) return
    healthLoading.value = true
    try {
      wikiHealth.value = await options.wikiService.fetchLint(true)
      const nextFinding = filteredHealthFindings.value[0]
      selectedHealthFindingKey.value = getHealthFindingKey(nextFinding)
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '加载 Health 失败'), 'danger')
    } finally {
      healthLoading.value = false
    }
  }

  function selectHealthFinding(item: HealthFinding | null | undefined) {
    selectedHealthFindingKey.value = getHealthFindingKey(item)
    healthSuggestionError.value = ''
    if (healthSuggestionKey.value !== selectedHealthFindingKey.value) {
      healthSuggestionMode.value = ''
      healthSuggestionTitle.value = ''
      healthSuggestionDescription.value = ''
      healthSuggestionQuery.value = ''
      healthSuggestionResults.value = []
    }
  }

  async function runHealthSuggestionSearch({
    item,
    mode,
    title,
    description,
    query,
    spaces = [],
    hintBuilder,
  }: {
    item: HealthFinding | null | undefined
    mode: HealthSuggestionMode
    title: string
    description: string
    query: string
    spaces?: string[]
    hintBuilder: (result: WikiSearchResult, index: number) => string
  }) {
    const findingKey = getHealthFindingKey(item)
    const normalizedQuery = dedupeStrings(tokenizeForSearch(query), 6).join(' ').trim() || String(query || '').trim()
    if (!findingKey || !normalizedQuery || healthSuggestionLoading.value) return
    healthSuggestionLoading.value = true
    healthSuggestionError.value = ''
    healthSuggestionMode.value = mode
    healthSuggestionKey.value = findingKey
    healthSuggestionTitle.value = title
    healthSuggestionDescription.value = description
    healthSuggestionQuery.value = normalizedQuery
    try {
      const response = await options.wikiService.search({
        query: normalizedQuery,
        topK: 6,
        spaces: Array.isArray(spaces) ? spaces : [],
      })
      healthSuggestionResults.value = (Array.isArray(response?.results) ? response.results : [])
        .filter((result) => String(result?.path || '').trim() !== String(item?.relativePath || '').trim())
        .map((result, index) => ({
          ...result,
          hint: hintBuilder(result, index),
        }))
        .slice(0, 6)
      if (!healthSuggestionResults.value.length) {
        healthSuggestionError.value = '没有找到足够接近的候选页面。'
      }
    } catch (error) {
      healthSuggestionResults.value = []
      healthSuggestionError.value = String(error instanceof Error ? error.message : error || '生成建议失败')
    } finally {
      healthSuggestionLoading.value = false
    }
  }

  async function loadHealthRepairSuggestions(item: HealthFinding | null | undefined) {
    const brokenTarget = extractBrokenTarget(item?.detail)
    const targetLabel = basenameWithoutMarkdown(brokenTarget)
    const query = dedupeStrings([
      targetLabel,
      ...tokenizeForSearch(targetLabel),
      ...tokenizeForSearch(brokenTarget),
    ], 6).join(' ')
    await runHealthSuggestionSearch({
      item,
      mode: 'repair',
      title: '断链修复建议',
      description: brokenTarget
        ? `根据缺失目标 "${brokenTarget}" 搜索最接近的现有页面，先确认最可能的替换路径。`
        : '根据当前 finding 的缺失目标搜索最接近的现有页面。',
      query,
      hintBuilder(result, index) {
        const resultBase = basenameWithoutMarkdown(result.path)
        if (targetLabel && resultBase === targetLabel) return '路径名完全接近，可优先检查'
        if (targetLabel && String(result.title || '').toLowerCase().includes(targetLabel.toLowerCase())) return '标题接近缺失目标'
        if (index === 0) return '搜索分最高，适合作为第一候选'
        return '可作为替换目标的备选页'
      },
    })
  }

  async function loadHealthAnchorSuggestions(item: HealthFinding | null | undefined) {
    const relativePath = String(item?.relativePath || '').trim()
    if (!relativePath || healthSuggestionLoading.value) return
    try {
      const response = await options.wikiService.fetchNote(relativePath)
      const note = response?.note
      const query = dedupeStrings([
        note?.project,
        note?.title,
        ...tokenizeForSearch(note?.title),
      ], 6).join(' ')
      const spaces = item?.code === 'concept-unanchored'
        ? ['projects', 'patterns', 'issues', 'syntheses']
        : ['projects', 'patterns', 'issues', 'syntheses', 'concepts']
      await runHealthSuggestionSearch({
        item,
        mode: 'anchor',
        title: item?.code === 'concept-unanchored' ? '概念锚点建议' : '回链锚点建议',
        description: note?.project
          ? `优先找和项目 "${note.project}" 同域的 reader-first 页面，把它补进主阅读层。`
          : '优先找和当前页面标题最接近的 reader-first 页面，作为回链入口。',
        query,
        spaces,
        hintBuilder(result, index) {
          if (note?.project && result.project === note.project) return '同项目页面，适合作为首个锚点'
          if (index === 0) return '搜索分最高，适合先检查是否应该互链'
          return '可作为补链或 Related 段的候选页'
        },
      })
    } catch (error) {
      healthSuggestionMode.value = 'anchor'
      healthSuggestionKey.value = getHealthFindingKey(item)
      healthSuggestionTitle.value = item?.code === 'concept-unanchored' ? '概念锚点建议' : '回链锚点建议'
      healthSuggestionDescription.value = ''
      healthSuggestionQuery.value = ''
      healthSuggestionResults.value = []
      healthSuggestionError.value = String(error instanceof Error ? error.message : error || '读取当前页面失败')
    }
  }

  function collectHealthFindingPaths(items: Array<HealthFinding | null | undefined>, limit = 8) {
    const deduped = new Set<string>()
    for (const item of Array.isArray(items) ? items : []) {
      const relativePath = String(item?.relativePath || '').trim()
      if (!relativePath) continue
      deduped.add(relativePath)
      if (deduped.size >= limit) break
    }
    return Array.from(deduped)
  }

  async function openHealthFindingNotes(items: Array<HealthFinding | null | undefined>, title = '巡检关联页面') {
    const relativePaths = collectHealthFindingPaths(items)
    if (!relativePaths.length) {
      options.notify('当前没有可打开的关联页面', 'warning')
      return
    }
    await options.openNoteViewer(relativePaths, title)
  }

  async function resolveHealthEvidencePaths(items: Array<HealthFinding | null | undefined>, limit = 12) {
    const relativePaths = collectHealthFindingPaths(items, 10)
    if (!relativePaths.length) return []
    const settled = await Promise.allSettled(relativePaths.map((relativePath) => options.wikiService.fetchNote(relativePath)))
    const evidenceTargets = new Set<string>()
    const sourceTargets = new Set<string>()
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue
      const evidenceBody = extractMarkdownSectionText(result.value?.note?.markdown || result.value?.note?.body || '', 'Evidence')
      for (const target of parseWikiLinkTargets(evidenceBody)) {
        if (target.startsWith('sources/')) sourceTargets.add(target)
        else evidenceTargets.add(target)
        if (sourceTargets.size >= limit || evidenceTargets.size >= limit) break
      }
    }
    const primary = sourceTargets.size ? Array.from(sourceTargets) : Array.from(evidenceTargets)
    return primary.slice(0, limit)
  }

  async function openHealthFindingNote(item: HealthFinding | null | undefined) {
    await openHealthFindingNotes([item], `巡检关联页面 · ${item?.title || item?.relativePath || '当前问题'}`)
  }

  async function openHealthFindingEvidence(item: HealthFinding | null | undefined) {
    const relativePath = String(item?.relativePath || '').trim()
    if (!relativePath) return
    try {
      const targetPaths = await resolveHealthEvidencePaths([item])
      if (!targetPaths.length) {
        options.notify('当前页面还没有可展开的 Evidence 链接', 'warning')
        return
      }
      await options.openNoteViewer(targetPaths, `Source Evidence · ${item?.title || relativePath}`)
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '读取 Evidence 失败'), 'danger')
    }
  }

  async function openHealthQueueNotes(items: Array<HealthFinding | null | undefined>, title = '批量关联页面') {
    await openHealthFindingNotes(items, title)
  }

  async function openHealthQueueEvidence(items: Array<HealthFinding | null | undefined>, title = '批量 Source Evidence') {
    try {
      const targetPaths = await resolveHealthEvidencePaths(items)
      if (!targetPaths.length) {
        options.notify('当前队列还没有可展开的 Evidence 链接', 'warning')
        return
      }
      await options.openNoteViewer(targetPaths, title)
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '读取批量 Evidence 失败'), 'danger')
    }
  }

  async function batchDecideHealthStaleDraftIssues(
    decision: 'approve' | 'dismiss',
    items: Array<HealthFinding | null | undefined> = [],
  ) {
    if (healthBatchActionLoading.value) return
    const targetPaths = new Set(
      (Array.isArray(items) ? items : [])
        .filter((item): item is HealthFinding => !!item && item.code === 'stale-draft-issue')
        .map((item) => String(item.relativePath || '').trim())
        .filter(Boolean),
    )
    if (!targetPaths.size) {
      options.notify('当前没有可批量处理的 stale draft issue', 'warning')
      return
    }
    if (!options.getPromotionQueue()) {
      await options.loadPromotionQueue(true)
    }
    const candidates = (options.getPromotionQueue()?.issueReviews || [])
      .filter((item) => targetPaths.has(String(item.currentPath || '').trim()))
    if (!candidates.length) {
      options.notify('当前没有匹配到可批量处理的 issue review 候选', 'warning')
      return
    }
    healthBatchActionLoading.value = true
    healthBatchActionLabel.value = decision === 'approve' ? '批量升格 stale draft issues' : '批量驳回 stale draft issues'
    let succeeded = 0
    let failed = 0
    for (const candidate of candidates) {
      try {
        await options.wikiService.decidePromotion({
          decision,
          kind: 'issue-review',
          title: candidate.title,
          currentPath: candidate.currentPath,
          project: candidate.project,
          summary: candidate.summary,
          evidenceItems: Array.isArray(candidate.evidenceItems) ? candidate.evidenceItems : [],
        })
        succeeded += 1
      } catch {
        failed += 1
      }
    }
    await Promise.all([
      options.loadPromotionQueue(true),
      loadWikiHealth(true),
    ])
    healthBatchActionLoading.value = false
    healthBatchActionLabel.value = ''
    if (failed > 0) {
      options.notify(`批量处理完成：成功 ${succeeded} 条，失败 ${failed} 条`, failed === candidates.length ? 'danger' : 'warning')
      return
    }
    options.notify(
      decision === 'approve'
        ? `已批量升格 ${succeeded} 条 stale draft issue`
        : `已批量驳回 ${succeeded} 条 stale draft issue`,
      'success',
    )
  }

  async function applyHealthRepairSuggestion(
    item: HealthFinding | null | undefined,
    candidatePath: string,
  ) {
    const relativePath = String(item?.relativePath || '').trim()
    const fromTarget = extractBrokenTarget(item?.detail)
    const toTarget = String(candidatePath || '').trim()
    if (!relativePath || !fromTarget || !toTarget) return
    await applyHealthRepairPlan({
      path: relativePath,
      fromTarget,
      toTarget,
    })
  }

  async function previewHealthRepairSuggestion(
    item: HealthFinding | null | undefined,
    candidatePath: string,
  ) {
    const relativePath = String(item?.relativePath || '').trim()
    const fromTarget = extractBrokenTarget(item?.detail)
    const toTarget = String(candidatePath || '').trim()
    if (!relativePath || !fromTarget || !toTarget) {
      throw new Error('修复参数不完整，无法生成预览')
    }
    return options.wikiService.previewRepairLink({
      path: relativePath,
      fromTarget,
      toTarget,
    })
  }

  async function applyHealthRepairPlan(payload: {
    path: string
    fromTarget: string
    toTarget: string
  }) {
    const relativePath = String(payload?.path || '').trim()
    const fromTarget = String(payload?.fromTarget || '').trim()
    const toTarget = String(payload?.toTarget || '').trim()
    if (!relativePath || !fromTarget || !toTarget || healthRepairApplyingTarget.value) return
    healthRepairApplyingTarget.value = `${relativePath}::${toTarget}`
    try {
      await options.wikiService.repairLink({
        path: relativePath,
        fromTarget,
        toTarget,
      })
      options.notify('断链已替换为建议目标', 'success')
      healthSuggestionMode.value = ''
      healthSuggestionKey.value = ''
      healthSuggestionTitle.value = ''
      healthSuggestionDescription.value = ''
      healthSuggestionQuery.value = ''
      healthSuggestionResults.value = []
      await loadWikiHealth(true)
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '断链修复失败'), 'danger')
      throw error
    } finally {
      healthRepairApplyingTarget.value = ''
    }
  }

  async function previewHealthAnchorSuggestion(
    item: HealthFinding | null | undefined,
    candidatePath: string,
  ) {
    const orphanTarget = String(item?.relativePath || '').trim()
    const candidate = String(candidatePath || '').trim()
    if (!orphanTarget || !candidate) throw new Error('锚点参数不完整')
    return options.wikiService.previewAnchorLink({ candidatePath: candidate, orphanTarget })
  }

  async function applyHealthAnchorPlan(payload: { candidatePath: string; orphanTarget: string }) {
    const candidatePath = String(payload?.candidatePath || '').trim()
    const orphanTarget = String(payload?.orphanTarget || '').trim()
    if (!candidatePath || !orphanTarget || healthRepairApplyingTarget.value) return
    healthRepairApplyingTarget.value = `${candidatePath}::${orphanTarget}`
    try {
      await options.wikiService.insertAnchorLink({ candidatePath, orphanTarget })
      options.notify('已在候选页面插入回链', 'success')
      healthSuggestionMode.value = ''
      healthSuggestionKey.value = ''
      healthSuggestionTitle.value = ''
      healthSuggestionDescription.value = ''
      healthSuggestionQuery.value = ''
      healthSuggestionResults.value = []
      await loadWikiHealth(true)
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '插入回链失败'), 'danger')
      throw error
    } finally {
      healthRepairApplyingTarget.value = ''
    }
  }

  async function triggerVaultRebuild() {
    if (vaultRebuildLoading.value) return
    vaultRebuildLoading.value = true
    try {
      await options.wikiService.rebuildWikiIndex()
      options.notify('Vault 索引重建完成', 'success')
      await loadWikiHealth(true)
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '重建索引失败'), 'danger')
    } finally {
      vaultRebuildLoading.value = false
    }
  }

  async function cleanHealthBrokenEvidence(item: HealthFinding | null | undefined) {
    const relativePath = String(item?.relativePath || '').trim()
    if (!relativePath) return
    const result = await options.wikiService.cleanSynthesisEvidence({ path: relativePath })
    if (result.removed.length) {
      options.notify(`已清理 ${result.removed.length} 条失效 evidence，finding 将在下次刷新后消失`, 'success')
      await loadWikiHealth(true)
    } else {
      options.notify('未发现失效 evidence，无需清理', 'info')
    }
  }

  return {
    healthLoading,
    wikiHealth,
    healthSummaryCards,
    healthSeverityFilter,
    healthCodeFilter,
    healthKeyword,
    healthCodeOptions,
    filteredHealthFindings,
    healthFindingGroups,
    healthActionQueues,
    selectedHealthFinding,
    healthSuggestionState,
    healthBatchActionLoading,
    healthBatchActionLabel,
    healthRepairApplyingTarget,
    vaultRebuildLoading,
    getHealthFindingKey,
    loadWikiHealth,
    selectHealthFinding,
    loadHealthRepairSuggestions,
    loadHealthAnchorSuggestions,
    previewHealthRepairSuggestion,
    previewHealthAnchorSuggestion,
    applyHealthRepairSuggestion,
    applyHealthRepairPlan,
    applyHealthAnchorPlan,
    batchDecideHealthStaleDraftIssues,
    openHealthFindingNote,
    openHealthFindingEvidence,
    openHealthQueueNotes,
    openHealthQueueEvidence,
    triggerVaultRebuild,
    cleanHealthBrokenEvidence,
  }
}
