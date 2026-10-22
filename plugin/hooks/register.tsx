import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Dashboard, DashboardState, PrRef, PullRequest, Summaries, WorkItem, WorkStatus } from '../types'
import type { Actions } from './actions'
import { fixWithClaude, reviewWithClaude } from './claude'
import { prRef } from './format'
import { announceChanges } from './notify'
import { dashboardOf, isDashboard, shownWork, textOf, workFingerprint, workOf } from './result'
import { INITIAL } from './state'
import { restoreSummaries, summariseDashboard } from './summaries'
import { renderDashboard, renderSummaryBar } from './view'

const SERVER = 'pr-dashboard'
const PANE = 'pr-dashboard'
const TITLE = 'Pull requests'
const REFRESH_EVERY_MS = 5 * 60_000
const SYNC_WORK_EVERY_MS = 15_000
const STALE_AFTER_MS = 60_000
const LOAD_TIMEOUT_MS = 60_000
const REFRESH_AFTER_CHANGE_MS = [5_000, 30_000]
const CACHE_KEY = 'dashboard'

const CHANGES_PULL_REQUESTS =
  /\bgit\s+(?:-C\s+\S+\s+)?push\b|\bgh\s+pr\s+(?:create|merge|close|reopen|ready|edit|review|comment)\b/

const NOT_STARTED =
  'The pr-dashboard server did not start. It needs Node.js 20 or later on your PATH; /mcp shows the error.'

const dashboard = atom({ plugin: 'pr-dashboard', key: 'dashboard' } as const, INITIAL)
const summaries = atom({ plugin: 'pr-dashboard', key: 'summaries' } as const, {} as Summaries)

type Features = { summaries: boolean; notifications: boolean }

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

const inBackground = (work: Promise<unknown>) => void work.catch(() => undefined)

async function serverName($: EngineInterface): Promise<string> {
  const own = await $.mcp.connect(SERVER)
  if (own.isConnected) return own.server
  if (own.reason === 'failed') throw new Error(NOT_STARTED)
  if (own.reason !== 'unlisted') throw new Error(own.message)
  return SERVER
}

async function fetchDashboard($: EngineInterface): Promise<Dashboard> {
  const result = await $.mcp.call(await serverName($), 'get_dashboard_data')
  if (result.isError) throw new Error(textOf(result) || 'pr-dashboard returned an error.')
  const data = dashboardOf(result)
  if (!data) throw new Error('pr-dashboard returned data in an unexpected format.')
  return data
}

async function fetchDetails($: EngineInterface, pr: PrRef): Promise<string> {
  const result = await $.mcp.call(await serverName($), 'get_pr_details', {
    owner: pr.owner,
    repo: pr.repo,
    pr_number: pr.number,
  })
  if (result.isError) throw new Error(textOf(result) || 'Could not read the pull request.')
  return textOf(result)
}

async function fetchWork($: EngineInterface): Promise<WorkItem[]> {
  const result = await $.mcp.call(await serverName($), 'get_pr_status')
  if (result.isError) throw new Error(textOf(result) || 'Could not read pull request work.')
  return workOf(result)
}

async function setWorkStatus($: EngineInterface, pr: PrRef, status: WorkStatus): Promise<void> {
  const result = await $.mcp.call(await serverName($), 'set_pr_status', {
    owner: pr.owner,
    repo: pr.repo,
    pr_number: pr.number,
    status,
  })
  if (result.isError) throw new Error(textOf(result) || 'Could not update the pull request.')
}

function createActions($: EngineInterface, features: Features): Actions {
  const patch = async (fn: (s: DashboardState) => DashboardState) => {
    await update($, dashboard, fn)
    $.ui.invalidate('ui.render')
  }

  async function loaded(data: Dashboard) {
    await patch((s) => ({ ...s, data, error: null, isLoading: false, loadingSince: null }))
    await $.store.set(CACHE_KEY, data).catch(() => undefined)
    if (features.summaries) inBackground(summariseDashboard($, data, (pr) => fetchDetails($, pr)))
    if (features.notifications) inBackground(announceChanges($, data))
  }

  async function refresh() {
    const now = Date.now()
    let isClaimed = false
    await patch((s) => {
      isClaimed = !s.isLoading || now - (s.loadingSince ?? 0) > LOAD_TIMEOUT_MS
      return isClaimed ? { ...s, isLoading: true, loadingSince: now, isQueued: false } : { ...s, isQueued: true }
    })
    if (!isClaimed) return
    try {
      await loaded(await fetchDashboard($))
    } catch (err) {
      await patch((s) => ({ ...s, error: message(err), isLoading: false, loadingSince: null }))
    }
    if ((await read($, dashboard)).isQueued) await refresh()
  }

  async function refreshIfStale() {
    const { data, isLoading, loadingSince } = await read($, dashboard)
    if (isLoading && Date.now() - (loadingSince ?? 0) <= LOAD_TIMEOUT_MS) return
    if (data && Date.now() - Date.parse(data.generatedAt) < STALE_AFTER_MS) return
    await refresh()
  }

  async function syncWork() {
    const current = await read($, dashboard)
    if (!current.data || current.isLoading || current.pending.length > 0) return
    try {
      if (workFingerprint(await fetchWork($)) === workFingerprint(shownWork(current.data))) return
    } catch {
      return
    }
    await refresh()
  }

  async function setWork(pr: PrRef, status: WorkStatus) {
    const key = prRef(pr)
    await patch((s) => ({ ...s, pending: [...s.pending, key] }))
    try {
      await setWorkStatus($, pr, status)
    } catch (err) {
      await patch((s) => ({ ...s, error: message(err) }))
    } finally {
      await patch((s) => ({ ...s, pending: s.pending.filter((k) => k !== key) }))
    }
    await refresh()
  }

  async function summarise(pr: PrRef & Partial<Pick<PullRequest, 'title'>>) {
    const title = pr.title ? ` ("${pr.title}")` : ''
    await $.prompt.submit({ text: `Summarise PR ${prRef(pr)}${title} for me.`, asUser: true })
  }

  async function handOver(work: Promise<void>) {
    await work.catch((err) => $.ui.toast(message(err)))
  }

  const review = (pr: PullRequest) => handOver(reviewWithClaude($, pr))
  const fix = (pr: PullRequest) => handOver(fixWithClaude($, pr))

  return { refresh, refreshIfStale, syncWork, setWork, summarise, review, fix }
}

async function restoreCached($: EngineInterface): Promise<void> {
  const cached = await $.store.get(CACHE_KEY).catch(() => undefined)
  if (isDashboard(cached)) await update($, dashboard, (s) => (s.data ? s : { ...s, data: cached }))
  await restoreSummaries($)
}

async function openPane($: EngineInterface, features: Features): Promise<boolean> {
  const { isPlaced } = await $.ui.open({ id: PANE, title: TITLE })
  if (isPlaced) await createActions($, features).refreshIfStale()
  return isPlaced
}

export const register: Register = (on, options) => {
  const features: Features = {
    summaries: options.ai_summaries !== false,
    notifications: options.notifications !== false,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pr-dashboard', description: 'Show your open pull requests in a pane' })
    await $.tool.register({
      name: 'open_pane',
      description:
        'Open the pull request dashboard as a pane beside the chat. Use when the user asks to see their PR dashboard or open pull requests in Claude Code.',
      isDeferred: false,
    })
    const started = await next(e)
    await restoreCached($)
    $.clock.every(REFRESH_EVERY_MS, () => inBackground(createActions($, features).refresh()))
    $.clock.every(SYNC_WORK_EVERY_MS, () => inBackground(createActions($, features).syncWork()))
    if (options.open_on_start !== false) inBackground(openPane($, features))
    else inBackground(createActions($, features).refreshIfStale())
    return started
  })

  on('prompt.submit', async ($, e, next) => {
    inBackground(createActions($, features).refreshIfStale())
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && CHANGES_PULL_REQUESTS.test(e.command)) {
      for (const ms of REFRESH_AFTER_CHANGE_MS) {
        $.clock.after(ms, () => inBackground(createActions($, features).refresh()))
      }
    }
    return ran
  })

  on('command.run', { command: 'pr-dashboard' }, async ($) => {
    const isPlaced = await openPane($, features)
    return { text: isPlaced ? 'Opened the pull request pane.' : 'This surface cannot show panes.' }
  })

  on('tool.call', { tool: 'mcp__pr-dashboard__open_pane' }, async ($) => {
    const isPlaced = await openPane($, features)
    return { result: isPlaced ? 'The pull request pane is open beside the chat.' : 'This surface cannot show panes.' }
  }).catch(() => ({ result: 'Could not open the pull request pane.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
    renderDashboard($.ui.resolve(e), e.surface, await read($, dashboard), await read($, summaries), createActions($, features)),
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (options.summary_bar === false || e.props.hasSurvey) return next(e)
    return renderSummaryBar($.ui.resolve(e), e.surface, await read($, dashboard), () => inBackground(openPane($, features)))
  })
}
