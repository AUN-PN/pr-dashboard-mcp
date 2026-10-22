import type { PrRef, PullRequest, WorkStatus } from '../types'

export type Actions = {
  refresh: () => Promise<void>
  syncWork: () => Promise<void>
  setWork: (pr: PrRef, status: WorkStatus) => Promise<void>
  summarise: (pr: PrRef & Partial<Pick<PullRequest, 'title'>>) => Promise<void>
}
