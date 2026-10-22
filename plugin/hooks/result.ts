import type { McpToolResult } from 'claude-code'
import type { Dashboard, WorkItem } from '../types'
import { prRef } from './format'

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

export const workFingerprint = (items: WorkItem[]) =>
  items
    .filter((i) => i.status !== 'done')
    .map((i) => [prRef(i), i.actor, i.status, i.note ?? '', i.updatedAt].join('|'))
    .sort()
    .join('\n')

export const shownWork = (data: Dashboard) => [...data.inProgress.map((e) => e.item), ...data.paused]
