import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Dashboard, DashboardState, LiveState, PrRef, PullRequest, Summaries, WorkItem, WorkStatus } from '../types'
import type { Actions, LiveStep } from './actions'
import { fixWithClaude, reviewWithClaude } from './claude'
import { prRef } from './format'
import { announceChanges } from './notify'
import { dashboardOf, liveOf, shownWork, textOf, withWork, workFingerprint, workOf } from './result'
import { INITIAL } from './state'
import { mergeShared, summariseDashboard } from './summaries'
import { renderDashboard, renderSummaryBar } from './view'

const SERVER = 'pr-dashboard'
const PANE = 'pr-dashboard'
const TITLE = 'Pull requests'
const REFRESH_EVERY_MS = 5 * 60_000
const REFRESH_SLACK_MS = 30_000
const SYNC_WORK_EVERY_MS = 15_000
const STALE_AFTER_MS = 60_000
const LOAD_TIMEOUT_MS = 60_000
const REFRESH_AFTER_CHANGE_MS = [5_000, 30_000]
const LIVE_WAIT_SECONDS = 25
const BUSY_RETRY_MS = 1_000

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
    brief: true,
  })
  if (result.isError) throw new Error(textOf(result) || 'Could not read the pull request.')
  return textOf(result)
}

async function fetchWork($: EngineInterface): Promise<WorkItem[]> {
  const result = await $.mcp.call(await serverName($), 'get_pr_status')
  if (result.isError) throw new Error(textOf(result) || 'Could not read pull request work.')
  return workOf(result)
}

async function fetchLive($: EngineInterface, since: string | null): Promise<LiveState> {
  const args = since === null ? {} : { since, wait_seconds: LIVE_WAIT_SECONDS }
  const result = await $.mcp.call(await serverName($), 'get_live_updates', args)
  if (result.isError) throw new Error(textOf(result) || 'Could not read live updates.')
  const live = liveOf(result)
  if (!live) throw new Error('pr-dashboard returned live updates in an unexpected format.')
  return live
}

async function saveSummary($: EngineInterface, pr: PullRequest, text: string): Promise<void> {
  const result = await $.mcp.call(await serverName($), 'save_pr_summary', {
    owner: pr.owner,
    repo: pr.repo,
    pr_number: pr.number,
    updated_at: pr.updatedAt,
    text,
  })
  if (result.isError) throw new Error(textOf(result) || 'Could not save the summary.')
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

const isFresh = (data: Dashboard | null, maxAgeMs: number) => data !== null && Date.now() - Date.parse(data.generatedAt) < maxAgeMs

async function isPaneUp($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some((pane) => pane.id === PANE && pane.isPlaced)
}

function createActions($: EngineInterface, features: Features): Actions {
  const patch = (fn: (s: DashboardState) => DashboardState) => update($, dashboard, fn)

  async function summariseShown() {
    const { data } = await read($, dashboard)
    if (!features.summaries || !data || !(await isPaneUp($))) return
    await summariseDashboard(
      $,
      data,
      (pr) => fetchDetails($, pr),
      (pr, text) => saveSummary($, pr, text),
    )
  }

  async function show(data: Dashboard) {
    await patch((s) => ({ ...s, data, error: null }))
    inBackground(summariseShown())
  }

  async function loaded(data: Dashboard) {
    await patch((s) => ({ ...s, data, error: null, isLoading: false, loadingSince: null }))
    inBackground(summariseShown())
    if (features.notifications) inBackground(announceChanges($, data))
  }

  async function load(queueBehindRunning: boolean) {
    const now = Date.now()
    let isClaimed = false
    await patch((s) => {
      isClaimed = !s.isLoading || now - (s.loadingSince ?? 0) > LOAD_TIMEOUT_MS
      if (isClaimed) return { ...s, isLoading: true, loadingSince: now, isQueued: false }
      return queueBehindRunning ? { ...s, isQueued: true } : s
    })
    if (!isClaimed) return
    try {
      await loaded(await fetchDashboard($))
    } catch (err) {
      await patch((s) => ({ ...s, error: message(err), isLoading: false, loadingSince: null }))
    }
    if ((await read($, dashboard)).isQueued) await load(true)
  }

  const refresh = () => load(true)

  async function refreshIfStale(maxAgeMs: number = STALE_AFTER_MS) {
    const { data, isLoading, loadingSince } = await read($, dashboard)
    if (isLoading && Date.now() - (loadingSince ?? 0) <= LOAD_TIMEOUT_MS) return
    if (isFresh(data, maxAgeMs)) return
    await load(false)
  }

  async function showWork(items: WorkItem[] | null) {
    const { data } = await read($, dashboard)
    const next = data && items && withWork(data, items)
    if (next) await patch((s) => ({ ...s, data: next }))
    else await refresh()
  }

  async function syncWork() {
    const current = await read($, dashboard)
    if (!current.data || current.error !== null || current.isLoading || current.pending.length > 0) return
    let items: WorkItem[]
    try {
      items = await fetchWork($)
    } catch {
      return
    }
    if (workFingerprint(items) === workFingerprint(shownWork(current.data))) return
    await showWork(items)
  }

  async function applyLive(live: LiveState): Promise<boolean> {
    await mergeShared($, live.summaries)
    const shown = (await read($, dashboard)).data
    if (live.dashboard && live.dashboard.generatedAt > (shown?.generatedAt ?? '')) await show(live.dashboard)

    const current = await read($, dashboard)
    if (current.isLoading || current.pending.length > 0) return false
    if (!current.data || workFingerprint(live.work) === workFingerprint(shownWork(current.data))) return true
    const next = withWork(current.data, live.work)
    if (next) await patch((s) => ({ ...s, data: next }))
    else if (current.error === null) inBackground(refresh())
    return true
  }

  async function follow(since: string | null): Promise<LiveStep> {
    let live: LiveState
    try {
      live = await fetchLive($, since)
    } catch {
      await syncWork()
      return { since: null, afterMs: SYNC_WORK_EVERY_MS }
    }
    return (await applyLive(live)) ? { since: live.version, afterMs: 0 } : { since, afterMs: BUSY_RETRY_MS }
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
    await showWork(await fetchWork($).catch(() => null))
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

  return { refresh, refreshIfStale, syncWork, follow, setWork, summarise, summariseShown, review, fix }
}

async function openPane($: EngineInterface, features: Features): Promise<boolean> {
  const { isPlaced } = await $.ui.open({ id: PANE, title: TITLE })
  if (isPlaced) {
    const actions = createActions($, features)
    await actions.refreshIfStale()
    inBackground(actions.summariseShown())
  }
  return isPlaced
}

async function startUp($: EngineInterface, features: Features, openOnStart: boolean): Promise<void> {
  const isPlaced = openOnStart && (await openPane($, features))
  if (!isPlaced) await createActions($, features).refreshIfStale()
}

const LIVE_FALLBACK: LiveStep = { since: null, afterMs: SYNC_WORK_EVERY_MS }

function followLive($: EngineInterface, features: Features, since: string | null): void {
  inBackground(
    createActions($, features)
      .follow(since)
      .catch(() => ({ ...LIVE_FALLBACK, since }))
      .then((step) => $.clock.after(step.afterMs, () => followLive($, features, step.since))),
  )
}

async function firstSync($: EngineInterface, features: Features, openOnStart: boolean): Promise<void> {
  const step = await createActions($, features)
    .follow(null)
    .catch(() => LIVE_FALLBACK)
  await startUp($, features, openOnStart)
  $.clock.after(step.afterMs, () => followLive($, features, step.since))
}

type Background = { isRunning: boolean }

function begin($: EngineInterface, features: Features, openOnStart: boolean, background: Background): void {
  if (background.isRunning) return
  background.isRunning = true
  $.clock.every(REFRESH_EVERY_MS, () =>
    inBackground(createActions($, features).refreshIfStale(REFRESH_EVERY_MS - REFRESH_SLACK_MS)),
  )
  inBackground(firstSync($, features, openOnStart))
}

export const register: Register = (on, options) => {
  const features: Features = {
    summaries: options.ai_summaries !== false,
    notifications: options.notifications !== false,
  }

  const background: Background = { isRunning: false }
  const openOnStart = options.open_on_start !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pr-dashboard', description: 'Show your open pull requests in a pane' })
    await $.tool.register({
      name: 'open_pane',
      description:
        'Open the pull request dashboard as a pane beside the chat. Use when the user asks to see their PR dashboard or open pull requests in Claude Code.',
      isDeferred: false,
    })
    const started = await next(e)
    if (e.surface !== null || (await $.session.surfaces()).length > 0) begin($, features, openOnStart, background)
    return started
  })

  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    begin($, features, openOnStart, background)
    return attached
  })

  on('prompt.submit', async ($, e, next) => {
    if (background.isRunning) inBackground(createActions($, features).refreshIfStale())
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (background.isRunning && ran.deny === undefined && ran.isError !== true && CHANGES_PULL_REQUESTS.test(e.command)) {
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
