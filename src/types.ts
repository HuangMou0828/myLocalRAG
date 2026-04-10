export type StepType = 'analysis' | 'action' | 'reflection'

export interface ProcessStep {
  id: string
  title: string
  content: string
  type: StepType
  createdAt: string
}

export interface AIWorkspace {
  id: string
  name: string
  description: string
  color: string
  createdAt: string
}

export interface KnowledgeEntry {
  id: string
  workspaceId: string
  title: string
  question: string
  answer: string
  reasoning: string
  methodology: string
  tags: string[]
  steps: ProcessStep[]
  createdAt: string
  updatedAt: string
}

export interface KnowledgeState {
  workspaces: AIWorkspace[]
  entries: KnowledgeEntry[]
}
