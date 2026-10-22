import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Dashboard, PullRequest, Summaries, Summary } from '../types'
import { prRef } from './format'

export const SUMMARY_MODEL = 'haiku'

const STORE_KEY = 'summaries'
const MAX_INPUT_CHARS = 12_000
const MAX_SUMMARIES = 20
const PARALLEL = 2

const SYSTEM =
  'You summarise a GitHub pull request for a developer scanning a list. Reply with one plain sentence of at most 25 words: what the change does, and the main risk if there is one. No preamble, no markdown, no PR number.'

export const summaries = atom({ plugin: 'pr-dashboard', key: 'summaries' } as const, {} as Summaries)

export function visiblePullRequests(data: Dashboard): PullRequest[] {
  const seen = new Map<string, PullRequest>()
  for (const pr of data.sections.flatMap((s) => s.pullRequests)) seen.set(prRef(pr), pr)
  for (const { pullRequest } of data.inProgress) if (pullRequest) seen.set(prRef(pullRequest), pullRequest)
  return [...seen.values()]
}

async function loadStored($: EngineInterface): Promise<Summaries> {
  const stored = await $.store.get(STORE_KEY).catch(() => undefined)
  return stored && typeof stored === 'object' ? (stored as Summaries) : {}
}

export async function restoreSummaries($: EngineInterface): Promise<Summaries> {
  const stored = await loadStored($)
  await update($, summaries, (all) => ({ ...stored, ...all }))
  return read($, summaries)
}

async function persist($: EngineInterface, refs: Set<string>): Promise<void> {
  const all = await read($, summaries)
  const kept = Object.fromEntries(Object.entries(all).filter(([ref, s]) => refs.has(ref) && s.status === 'ready'))
  await $.store.set(STORE_KEY, kept).catch(() => undefined)
}

async function summariseOne($: EngineInterface, pr: PullRequest, details: (pr: PullRequest) => Promise<string>) {
  const ref = prRef(pr)
  let text: string | null = null
  try {
    const body = (await details(pr)).slice(0, MAX_INPUT_CHARS)
    const reply = await $.model.complete({
      model: SUMMARY_MODEL,
      system: SYSTEM,
      prompt: body,
      maxTokens: 120,
      effort: 'low',
    })
    if (reply.isAnswered) text = reply.text.trim().replace(/\s+/g, ' ')
  } catch {
    text = null
  }
  const summary: Summary = text
    ? { status: 'ready', updatedAt: pr.updatedAt, text }
    : { status: 'failed', updatedAt: pr.updatedAt }
  await update($, summaries, (all) => ({ ...all, [ref]: summary }))
  $.ui.invalidate('ui.render')
}

export async function summariseDashboard(
  $: EngineInterface,
  data: Dashboard,
  details: (pr: PullRequest) => Promise<string>,
): Promise<void> {
  const prs = visiblePullRequests(data).slice(0, MAX_SUMMARIES)
  let current = await read($, summaries)
  if (Object.keys(current).length === 0) current = await restoreSummaries($)

  const stale = prs.filter((pr) => current[prRef(pr)]?.updatedAt !== pr.updatedAt)
  if (stale.length === 0) return

  const pending: Summaries = Object.fromEntries(
    stale.map((pr): [string, Summary] => [prRef(pr), { status: 'pending', updatedAt: pr.updatedAt }]),
  )
  await update($, summaries, (all) => ({ ...all, ...pending }))

  const queue = [...stale]
  const worker = async () => {
    for (let pr = queue.shift(); pr; pr = queue.shift()) await summariseOne($, pr, details)
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker))
  await persist($, new Set(prs.map(prRef)))
}
