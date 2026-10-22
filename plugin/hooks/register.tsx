import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Dashboard, DashboardState, PrRef, PullRequest, Summaries, WorkItem, WorkStatus } from '../types'
import type { Actions } from './actions'
import { prRef } from './format'
import { dashboardOf, isDashboard, shownWork, textOf, workFingerprint, workOf } from './result'
import { INITIAL } from './state'
import { restoreSummaries, summariseDashboard } from './summaries'
import { renderDashboard, renderSummaryBar } from './view'

const SERVER = 'pr-dashboard'
const PANE = 'pr-dashboard'
const TITLE = 'Pull requests'
const REFRESH_EVERY_MS = 5 * 60_000
const SYNC_WORK_EVERY_MS = 15_000
const CACHE_KEY = 'dashboard'

const NOT_STARTED =
  'The pr-dashboard server did not start. It needs Node.js 20 or later on your PATH; /mcp shows the error.'

const dashboard = atom({ plugin: 'pr-dashboard', key: 'dashboard' } as const, INITIAL)
const summaries = atom({ plugin: 'pr-dashboard', key: 'summaries' } as const, {} as Summaries)

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

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

function createActions($: EngineInterface, withSummaries: boolean): Actions {
  const patch = async (fn: (s: DashboardState) => DashboardState) => {
    await update($, dashboard, fn)
    $.ui.invalidate('ui.render')
  }

  async function loaded(data: Dashboard) {
    await patch((s) => ({ ...s, data, error: null, isLoading: false }))
    await $.store.set(CACHE_KEY, data).catch(() => undefined)
    if (withSummaries) void summariseDashboard($, data, (pr) => fetchDetails($, pr)).catch(() => undefined)
  }

  async function refresh() {
    await patch((s) => ({ ...s, isLoading: true }))
    try {
      await loaded(await fetchDashboard($))
    } catch (err) {
      await patch((s) => ({ ...s, error: message(err), isLoading: false }))
    }
  }

  async function syncWork() {
    const current = await read($, dashboard)
    if (!current.data || current.isLoading || current.pending.length > 0) return
    try {
      if (workFingerprint(await fetchWork($)) === workFingerprint(shownWork(current.data))) return
      await loaded(await fetchDashboard($))
    } catch {
      return
    }
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

  return { refresh, syncWork, setWork, summarise }
}

async function restoreCached($: EngineInterface): Promise<void> {
  const cached = await $.store.get(CACHE_KEY).catch(() => undefined)
  if (isDashboard(cached)) await update($, dashboard, (s) => (s.data ? s : { ...s, data: cached }))
  await restoreSummaries($)
}

async function openPane($: EngineInterface, withSummaries: boolean): Promise<boolean> {
  const { isPlaced } = await $.ui.open({ id: PANE, title: TITLE })
  if (isPlaced) await createActions($, withSummaries).refresh()
  return isPlaced
}

async function loadIfEmpty($: EngineInterface, withSummaries: boolean): Promise<void> {
  const { value } = await $.state.get({ plugin: 'pr-dashboard', key: 'dashboard' })
  if (!value?.data && !value?.isLoading) await createActions($, withSummaries).refresh()
}

export const register: Register = (on, options) => {
  const withSummaries = options.ai_summaries !== false

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
    $.clock.every(REFRESH_EVERY_MS, () => void createActions($, withSummaries).refresh())
    $.clock.every(SYNC_WORK_EVERY_MS, () => void createActions($, withSummaries).syncWork())
    if (options.open_on_start !== false) void openPane($, withSummaries)
    else void createActions($, withSummaries).refresh()
    return started
  })

  on('prompt.submit', async ($, e, next) => {
    void loadIfEmpty($, withSummaries)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'pr-dashboard' }, async ($) => {
    const isPlaced = await openPane($, withSummaries)
    return { text: isPlaced ? 'Opened the pull request pane.' : 'This surface cannot show panes.' }
  })

  on('tool.call', { tool: 'mcp__pr-dashboard__open_pane' }, async ($) => {
    const isPlaced = await openPane($, withSummaries)
    return { result: isPlaced ? 'The pull request pane is open beside the chat.' : 'This surface cannot show panes.' }
  }).catch(() => ({ result: 'Could not open the pull request pane.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
    renderDashboard($.ui.resolve(e), e.surface, await read($, dashboard), await read($, summaries), createActions($, withSummaries)),
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (options.summary_bar === false || e.props.hasSurvey) return next(e)
    return renderSummaryBar($.ui.resolve(e), e.surface, await read($, dashboard), () => void openPane($, withSummaries))
  })
}
