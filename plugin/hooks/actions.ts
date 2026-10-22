import type { PrRef, PullRequest, WorkStatus } from '../types'

export type LiveStep = { since: string | null; afterMs: number }

export type Actions = {
  refresh: () => Promise<void>
  refreshIfStale: (maxAgeMs?: number) => Promise<void>
  syncWork: () => Promise<void>
  follow: (since: string | null) => Promise<LiveStep>
  setWork: (pr: PrRef, status: WorkStatus) => Promise<void>
  summarise: (pr: PrRef & Partial<Pick<PullRequest, 'title'>>) => Promise<void>
  summariseShown: () => Promise<void>
  review: (pr: PullRequest) => Promise<void>
  fix: (pr: PullRequest) => Promise<void>
}
