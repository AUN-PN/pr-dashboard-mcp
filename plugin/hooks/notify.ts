import type { EngineInterface } from 'claude-code'
import type { Dashboard, InboxSectionId, PullRequest } from '../types'
import { prRef } from './format'

const STORE_KEY = 'seen'
const MAX_SEPARATE = 3

type Seen = Record<string, string>

type Change = { pr: PullRequest; event: string }

const EVENTS: Partial<Record<InboxSectionId, (pr: PullRequest) => string>> = {
  review: () => 'Review requested',
  returned: (pr) => (pr.status === 'changes_requested' ? 'Changes requested' : 'Checks failed'),
  ready: () => 'Ready to merge',
}

const placeOf = (section: InboxSectionId, pr: PullRequest) => (section === 'returned' ? `${section}:${pr.status}` : section)

const isSeen = (value: unknown): value is Seen => typeof value === 'object' && value !== null && !Array.isArray(value)

function placesOf(data: Dashboard): Seen {
  return Object.fromEntries(
    data.sections.flatMap(({ id, pullRequests }) => pullRequests.map((pr) => [prRef(pr), placeOf(id, pr)])),
  )
}

export function changesSince(seen: Seen, data: Dashboard): Change[] {
  return data.sections.flatMap(({ id, pullRequests }) => {
    const event = EVENTS[id]
    if (!event) return []
    return pullRequests.filter((pr) => seen[prRef(pr)] !== placeOf(id, pr)).map((pr) => ({ pr, event: event(pr) }))
  })
}

const line = ({ pr, event }: Change) => `${event} · ${pr.repo}#${pr.number} ${pr.title}`

function digest(changes: Change[]): string {
  const counts = new Map<string, number>()
  for (const { event } of changes) counts.set(event, (counts.get(event) ?? 0) + 1)
  return [...counts].map(([event, n]) => `${event} (${n})`).join(' · ')
}

async function send($: EngineInterface, text: string): Promise<void> {
  const sent = await $.ui.notify(text).catch(() => ({ isSent: false as const }))
  if (!sent.isSent) $.ui.toast(text)
}

export async function announceChanges($: EngineInterface, data: Dashboard): Promise<void> {
  const stored = await $.store.get(STORE_KEY).catch(() => undefined)
  const current = placesOf(data)
  const kept = isSeen(stored) && (data.warnings?.length ?? 0) > 0 ? { ...stored, ...current } : current
  await $.store.set(STORE_KEY, kept).catch(() => undefined)
  if (!isSeen(stored)) return

  const changes = changesSince(stored, data)
  if (changes.length > MAX_SEPARATE) return send($, digest(changes))
  for (const change of changes) await send($, line(change))
}
