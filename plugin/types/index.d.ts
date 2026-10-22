export type PrStatus =
  | 'draft'
  | 'ci_failed'
  | 'changes_requested'
  | 'review_requested'
  | 'approved'
  | 'open'
  | 'closed'
  | 'merged'

export type CiStatus = 'success' | 'failure' | 'pending' | 'none'

export type WorkStatus = 'working' | 'paused' | 'done'

export type PrRef = { owner: string; repo: string; number: number }

export type PullRequest = PrRef & {
  title: string
  url: string
  author: string | null
  status: PrStatus
  ci: CiStatus
  updatedAt: string
  workStatus: WorkStatus | null
}

export type WorkItem = PrRef & {
  status: WorkStatus
  actor: string
  label: string | null
  note: string | null
  updatedAt: string
  expiresAt: string | null
}

export type WorkEntry = { item: WorkItem; pullRequest: PullRequest | null }

export type InboxSectionId = 'review' | 'returned' | 'ready' | 'team' | 'waiting' | 'drafts'

export type InboxSection = {
  id: InboxSectionId
  title: string
  pullRequests: PullRequest[]
}

export type Dashboard = {
  generatedAt: string
  viewer: string | null
  inProgress: WorkEntry[]
  paused: WorkItem[]
  sections: InboxSection[]
  warnings?: string[]
}

export type DashboardState = {
  data: Dashboard | null
  error: string | null
  isLoading: boolean
  loadingSince: number | null
  isQueued: boolean
  pending: string[]
}

export type Summary =
  | { status: 'pending'; updatedAt: string }
  | { status: 'ready'; updatedAt: string; text: string }
  | { status: 'failed'; updatedAt: string }

export type Summaries = Record<string, Summary>

export type SavedSummary = PrRef & { updatedAt: string; text: string }

export type LiveState = {
  version: string
  work: WorkItem[]
  dashboard: Dashboard | null
  summaries: SavedSummary[]
}

declare module 'claude-code' {
  interface PluginState {
    'pr-dashboard': { dashboard: DashboardState; summaries: Summaries }
  }
}
