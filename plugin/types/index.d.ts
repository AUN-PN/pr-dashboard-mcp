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

export type RepoGroup = {
  owner: string
  repo: string
  pullRequests: PullRequest[]
  totalCount: number
  error: string | null
}

export type Dashboard = {
  generatedAt: string
  inProgress: WorkEntry[]
  paused: WorkItem[]
  repos: RepoGroup[]
}

export type DashboardState = {
  data: Dashboard | null
  error: string | null
  isLoading: boolean
  pending: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'pr-dashboard': { dashboard: DashboardState }
  }
}
