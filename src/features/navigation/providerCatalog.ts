export const providerCatalog = [
  { id: 'all', label: '全部', desc: '显示所有来源会话' },
  { id: 'chatgpt', label: 'ChatGPT', desc: 'OpenAI 对话与导出数据' },
  { id: 'codex', label: 'Codex', desc: 'Codex 本地会话与事件流' },
  { id: 'claude-code', label: 'Claude Code', desc: 'Claude Code 本地会话与事件流' },
  { id: 'claude', label: 'Claude', desc: 'Anthropic 导出与插件数据' },
  { id: 'cursor', label: 'Cursor', desc: 'IDE 代理会话与转录' },
  { id: 'doubao', label: 'Doubao', desc: '豆包网页/导出记录' },
  { id: 'gemini', label: 'Gemini', desc: 'Google Gemini 会话' },
  { id: 'bug-cursor', label: 'Bug Trace', desc: '从 bug 代码反查 Cursor 会话' },
  { id: 'feishu-master', label: '飞书大师', desc: '展示飞书排期 todo 列表' },
  { id: 'component-library', label: '组件设置', desc: '组件预览与样式微调' },
  { id: 'model-settings', label: '模型配置', desc: '集中查看与管理系统当前使用的模型' },
  { id: 'knowledge-sources', label: '知识采集', desc: '按 capture / note / document 管理原始知识素材' },
  { id: 'knowledge-task-review', label: '任务复盘', desc: '先审查会话任务段，再决定是否送入升格候选' },
  { id: 'knowledge-promotion-review', label: '升格审核', desc: '集中查看待升格的 issue / pattern / synthesis 候选' },
  { id: 'knowledge-health', label: '健康巡检', desc: '查看 wiki lint、知识空洞和长期积压问题' },
  { id: 'other', label: 'Other', desc: '其他来源或混合数据' },
] as const

export type ProviderCatalogItem = (typeof providerCatalog)[number]
export type ProviderId = ProviderCatalogItem['id']

export const providerLogoMap: Record<ProviderId, string> = {
  all: 'ALL',
  chatgpt: 'GPT',
  codex: 'CDX',
  'claude-code': 'CCD',
  claude: 'CLD',
  cursor: 'CSR',
  doubao: 'DB',
  gemini: 'GEM',
  'bug-cursor': 'CSR',
  'feishu-master': 'FSH',
  'component-library': 'CMP',
  'model-settings': 'ML',
  'knowledge-sources': 'KB',
  'knowledge-task-review': 'KB',
  'knowledge-promotion-review': 'KB',
  'knowledge-health': 'KB',
  other: 'AI',
}
