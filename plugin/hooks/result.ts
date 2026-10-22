import type { McpToolResult } from 'claude-code'
import type { Dashboard, LiveState, PullRequest, WorkItem, WorkStatus } from '../types'
import { prRef, USER_ACTOR } from './format'

export function textOf(result: McpToolResult): string {
  return result.content
    .map((block) => ('text' in block && typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
}

export function isDashboard(value: unknown): value is Dashboard {
  const v = value as Partial<Dashboard> | null
  return typeof v?.generatedAt === 'string' && Array.isArray(v.sections) && Array.isArray(v.inProgress) && Array.isArray(v.paused)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export function dashboardOf(result: McpToolResult): Dashboard | null {
  if (isDashboard(result.structuredContent)) return result.structuredContent
  for (const block of result.content) {
    if (!('text' in block) || typeof block.text !== 'string') continue
    const parsed = parseJson(block.text)
    if (isDashboard(parsed)) return parsed
  }
  return null
}

export function workOf(result: McpToolResult): WorkItem[] {
  const items = (result.structuredContent as { items?: unknown } | undefined)?.items
  return Array.isArray(items) ? (items as WorkItem[]) : []
}

export function liveOf(result: McpToolResult): LiveState | null {
  const live = result.structuredContent as Partial<LiveState> | undefined
  if (typeof live?.version !== 'string' || !Array.isArray(live.work) || !Array.isArray(live.summaries)) return null
  return {
    version: live.version,
    work: live.work,
    dashboard: isDashboard(live.dashboard) ? live.dashboard : null,
    summaries: live.summaries,
  }
}

export const workFingerprint = (items: WorkItem[]) =>
  items
    .filter((i) => i.status !== 'done')
    .map((i) => [prRef(i), i.actor, i.status, i.note ?? '', i.updatedAt].join('|'))
    .sort()
    .join('\n')

export const shownWork = (data: Dashboard) => [...data.inProgress.map((e) => e.item), ...data.paused]

const RANK: Record<WorkStatus, number> = { working: 3, paused: 2, done: 1 }

const keyOf = (ref: Parameters<typeof prRef>[0]) => prRef(ref).toLowerCase()

export function withWork(data: Dashboard, items: WorkItem[]): Dashboard | null {
  const known = new Map<string, PullRequest | null>()
  for (const { item, pullRequest } of data.inProgress) known.set(keyOf(item), pullRequest)
  for (const pr of data.sections.flatMap((s) => s.pullRequests)) known.set(keyOf(pr), pr)

  const working = items
    .filter((i) => i.status === 'working')
    .sort((a, b) => Number(b.actor === USER_ACTOR) - Number(a.actor === USER_ACTOR))
  if (working.some((i) => !known.has(keyOf(i)))) return null

  const status = new Map<string, WorkStatus>()
  for (const i of items) {
    const current = status.get(keyOf(i))
    if (!current || RANK[i.status] > RANK[current]) status.set(keyOf(i), i.status)
  }
  const marked = (pr: PullRequest): PullRequest => ({ ...pr, workStatus: status.get(keyOf(pr)) ?? null })

  return {
    ...data,
    inProgress: working.map((item) => {
      const pr = known.get(keyOf(item)) ?? null
      return { item, pullRequest: pr && marked(pr) }
    }),
    paused: items.filter((i) => i.status === 'paused'),
    sections: data.sections.map((s) => ({ ...s, pullRequests: s.pullRequests.map(marked) })),
  }
}
