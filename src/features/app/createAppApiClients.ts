import type { BugInboxItem, FeishuBugCandidate, FeishuTodoItem } from '@/features/bug-inbox/useBugInboxFeishuDomain'
import type { BugTraceConversationDetail, BugTraceFilePreview, BugTraceResponse } from '@/features/bug-trace/useBugTraceDomain'
import type { PromptEffectAssessmentResult, PromptOptimizeResult, PromptScoreResult } from '@/features/prompt-score/usePromptScoreDomain'
import type { JsonRequest } from '@/services/httpClient'
import type { Issue, SessionItem, SessionRetrieveResponse } from '@/services/sessionContracts'
import {
  createBugInboxFeishuApi,
  createBugTraceApi,
  createFeishuProjectSettingsApi,
  createImportApi,
  createKnowledgeItemsApi,
  createMessageTagApi,
  createModelSettingsApi,
  createPatchDirSettingsApi,
  createPromptApi,
  createSessionDataApi,
  createWikiVaultApi,
} from '@/services/kbApiServices'

export function createAppApiClients(requestJson: JsonRequest) {
  const sessionDataApi = createSessionDataApi<SessionItem, Issue, SessionRetrieveResponse>(requestJson)
  const patchDirSettingsApi = createPatchDirSettingsApi(requestJson)
  const modelSettingsApi = createModelSettingsApi(requestJson)
  const promptApi = createPromptApi<PromptScoreResult, PromptOptimizeResult, PromptEffectAssessmentResult>(requestJson)
  const messageTagApi = createMessageTagApi(requestJson)
  const importApi = createImportApi(requestJson)
  const knowledgeItemsApi = createKnowledgeItemsApi(requestJson)
  const wikiVaultApi = createWikiVaultApi(requestJson)
  const bugTraceApi = createBugTraceApi<BugTraceFilePreview, BugTraceConversationDetail, BugTraceResponse>(requestJson)
  const bugInboxFeishuApi = createBugInboxFeishuApi<BugInboxItem, FeishuTodoItem, FeishuBugCandidate>(requestJson)
  const feishuProjectSettingsApi = createFeishuProjectSettingsApi(requestJson)

  return {
    sessionDataApi,
    patchDirSettingsApi,
    modelSettingsApi,
    promptApi,
    messageTagApi,
    importApi,
    knowledgeItemsApi,
    wikiVaultApi,
    bugTraceApi,
    bugInboxFeishuApi,
    feishuProjectSettingsApi,
  }
}
