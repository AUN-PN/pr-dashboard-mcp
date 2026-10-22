import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Dashboard, PullRequest, SavedSummary, Summaries, Summary } from '../types'
import { prRef } from './format'

export const SUMMARY_MODEL = 'haiku'

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

const isCurrent = (summary: Summary | undefined, pr: PullRequest): summary is Summary => summary?.updatedAt === pr.updatedAt

export type SaveSummary = (pr: PullRequest, text: string) => Promise<void>

export async function mergeShared($: EngineInterface, saved: readonly SavedSummary[]): Promise<void> {
  await update($, summaries, (all) => {
    const next = { ...all }
    for (const s of saved) {
      const ref = prRef(s)
      const local = next[ref]
      if (local?.status === 'ready' && local.updatedAt === s.updatedAt && local.text === s.text) continue
      if (!local || s.updatedAt >= local.updatedAt) next[ref] = { status: 'ready', updatedAt: s.updatedAt, text: s.text }
    }
    return next
  })
}

async function summariseOne(
  $: EngineInterface,
  pr: PullRequest,
  details: (pr: PullRequest) => Promise<string>,
  save: SaveSummary,
) {
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
  if (text) await save(pr, text).catch(() => undefined)
}

export async function summariseDashboard(
  $: EngineInterface,
  data: Dashboard,
  details: (pr: PullRequest) => Promise<string>,
  save: SaveSummary,
): Promise<void> {
  const prs = visiblePullRequests(data).slice(0, MAX_SUMMARIES)

  let stale: PullRequest[] = []
  await update($, summaries, (all) => {
    const kept: Summaries = {}
    stale = []
    for (const pr of prs) {
      const own = all[prRef(pr)]
      if (isCurrent(own, pr)) kept[prRef(pr)] = own
      else stale.push(pr)
    }
    return {
      ...kept,
      ...Object.fromEntries(stale.map((pr): [string, Summary] => [prRef(pr), { status: 'pending', updatedAt: pr.updatedAt }])),
    }
  })

  const queue = [...stale]
  const worker = async () => {
    for (let pr = queue.shift(); pr; pr = queue.shift()) await summariseOne($, pr, details, save)
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker))
}
