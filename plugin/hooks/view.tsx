import type { Elements, RenderSurface } from 'claude-code'
import type { Dashboard, DashboardState, InboxSection, InboxSectionId, PullRequest, Summaries, WorkEntry, WorkItem } from '../types'
import type { Actions } from './actions'
import { age, plural, prRef, splitTicket, USER_ACTOR } from './format'
import { avatar, pill, skeleton } from './svg'
import { STATUS, SURFACE, TONES, type Tone } from './theme'

export type ViewElements = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button' | 'Link'> & {
  Svg?: Elements['desktop']['Svg']
}

type Ctx = { el: ViewElements; rich: boolean; actions: Actions; pending: string[]; summaries: Summaries }

const isRich = (surface: RenderSurface, el: ViewElements) => surface !== 'terminal' && el.Svg !== undefined

const updated = (iso: string) => {
  const a = age(iso)
  return a === 'now' ? 'updated just now' : `updated ${a} ago`
}

const totalOpen = (data: Dashboard) => data.sections.reduce((n, s) => n + s.pullRequests.length, 0)

const sectionCount = (data: Dashboard, id: InboxSectionId) =>
  data.sections.find((s) => s.id === id)?.pullRequests.length ?? 0

const SECTION_TONE: Record<InboxSectionId, Tone> = {
  review: 'info',
  returned: 'danger',
  ready: 'success',
  waiting: 'warning',
  drafts: 'draft',
}

export function renderDashboard(
  el: ViewElements,
  surface: RenderSurface,
  state: DashboardState,
  summaries: Summaries,
  actions: Actions,
) {
  const { Box, Text, Button } = el
  const ctx: Ctx = { el, rich: isRich(surface, el), actions, pending: state.pending, summaries }
  const { data, error, isLoading } = state

  return (
    <Box flexDirection="column" gap="lg" paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
        <Text dimColor size="footnote" wrap="truncate-end">
          {data
            ? `${plural(totalOpen(data), 'open PR')} · ${updated(data.generatedAt)}`
            : isLoading
              ? 'Loading your pull requests…'
              : 'Not loaded yet'}
        </Text>
        <Button key="refresh" label="⟳ Refresh" dimColor={isLoading} onPress={() => void actions.refresh()} />
      </Box>
      {error !== null && renderNotice(ctx, error)}
      {data === null && error === null && renderSkeleton(ctx)}
      {data !== null && renderStats(ctx, data)}
      {data !== null && renderFocus(ctx, data)}
      {data !== null && renderSections(ctx, data)}
    </Box>
  )
}

function renderSkeleton({ el, rich }: Ctx) {
  const { Box, Svg } = el
  if (!rich || !Svg) return null
  const bar = skeleton()
  return (
    <Box key="skeleton" flexDirection="column" gap="sm">
      {[0, 1, 2].map((i) => (
        <Box
          key={`skeleton-${i}`}
          borderStyle="round"
          borderColor={SURFACE.border}
          backgroundColor={SURFACE.card}
          paddingX={1}
          paddingY={1}
        >
          <Svg source={bar.source} alt="Loading" width={bar.width} height={bar.height} isInteractive />
        </Box>
      ))}
    </Box>
  )
}

function renderNotice({ el, rich }: Ctx, message: string) {
  const { Box, Text } = el
  return (
    <Box
      key="notice"
      borderStyle="round"
      borderColor={rich ? SURFACE.border : 'error'}
      backgroundColor={rich ? TONES.danger.tint : undefined}
      paddingX={1}
      paddingY={rich ? 1 : 0}
    >
      <Text color="error">{message}</Text>
    </Box>
  )
}

function renderStats(ctx: Ctx, data: Dashboard) {
  const { Box, Text } = ctx.el
  const stats: Array<{ label: string; value: number; tone: Tone }> = [
    { label: 'To review', value: sectionCount(data, 'review'), tone: SECTION_TONE.review },
    { label: 'Returned', value: sectionCount(data, 'returned'), tone: SECTION_TONE.returned },
    { label: 'Ready', value: sectionCount(data, 'ready'), tone: SECTION_TONE.ready },
    { label: 'Waiting', value: sectionCount(data, 'waiting'), tone: SECTION_TONE.waiting },
  ]

  if (!ctx.rich) {
    return (
      <Text key="stats" dimColor>
        {stats.map((s) => `${s.value} ${s.label.toLowerCase()}`).join(' · ')}
      </Text>
    )
  }

  return (
    <Box key="stats" flexDirection="row" gap="sm" flexWrap="wrap">
      {stats.map((s) => (
        <Box
          key={`stat-${s.label}`}
          flexDirection="column"
          flexGrow={1}
          minWidth={10}
          paddingX={1}
          paddingY={1}
          borderStyle="round"
          borderColor={SURFACE.border}
          backgroundColor={s.value > 0 ? TONES[s.tone].tint : SURFACE.card}
        >
          <Text size="title" weight="bold" color={s.value > 0 ? TONES[s.tone].fg : undefined} dimColor={s.value === 0} tabular>
            {String(s.value)}
          </Text>
          <Text size="caption" dimColor>
            {s.label}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

const isUser = (item: WorkItem) => item.actor === USER_ACTOR

const who = (item: WorkItem) => (isUser(item) ? 'you' : (item.label ?? item.actor))

function renderFocus(ctx: Ctx, data: Dashboard) {
  const { Box, Text, Button } = ctx.el
  const heading = (
    <Text size="caption" weight="semibold" color={ctx.rich ? SURFACE.accent : 'claude'}>
      IN PROGRESS
    </Text>
  )

  return (
    <Box key="focus" flexDirection="column" gap="xs">
      {heading}
      {data.inProgress.length === 0 ? (
        <Box borderStyle={ctx.rich ? 'dashed' : 'round'} borderColor={SURFACE.border} paddingX={1} paddingY={ctx.rich ? 1 : 0}>
          <Text dimColor>☕ Nothing in progress. Hover a pull request and press Start.</Text>
        </Box>
      ) : (
        data.inProgress.map((entry) => renderWork(ctx, entry))
      )}
      {data.paused.length > 0 && (
        <Box flexDirection="row" gap="xs" flexWrap="wrap" alignItems="center">
          <Text dimColor size="footnote">
            Paused:
          </Text>
          {data.paused.map((p) =>
            isUser(p) ? (
              <Button key={`resume-${prRef(p)}`} plain onPress={() => void ctx.actions.setWork(p, 'working')}>
                <Text color="warning">{`${p.repo}#${p.number}`}</Text>
              </Button>
            ) : (
              <Text key={`paused-${prRef(p)}-${p.actor}`} color="warning" size="footnote">
                {`${p.repo}#${p.number} (${who(p)})`}
              </Text>
            ),
          )}
        </Box>
      )}
    </Box>
  )
}

function renderWork(ctx: Ctx, { item, pullRequest: pr }: WorkEntry) {
  const { Box, Text, Button, Link } = ctx.el
  const ref = prRef(item)
  const mine = isUser(item)
  const id = mine ? ref : `${ref}@${item.actor}`
  const isBusy = ctx.pending.includes(ref)
  const { ticket, title } = splitTicket(pr?.title ?? '')
  const target = { ...item, title: pr?.title }
  const byline = mine ? null : [`🤖 ${who(item)}`, item.note].filter(Boolean).join(' · ')

  return (
    <Box
      key={`work-${id}`}
      flexDirection="column"
      gap="sm"
      borderStyle="round"
      borderColor={ctx.rich ? (mine ? SURFACE.focusBorder : SURFACE.border) : mine ? 'claude' : 'subtle'}
      backgroundColor={ctx.rich ? (mine ? SURFACE.focus : SURFACE.card) : undefined}
      paddingX={1}
      paddingY={ctx.rich ? 1 : 0}
    >
      <Text weight="semibold" bold={!ctx.rich}>
        {pr ? title : ref}
      </Text>
      {byline && (
        <Text key={`by-${id}`} color={ctx.rich ? SURFACE.accent : 'claude'} size="footnote" wrap="truncate-end">
          {byline}
        </Text>
      )}
      <Box flexDirection="row" gap="xs" alignItems="center" flexWrap="wrap">
        {pr && renderStatus(ctx, pr, `work-status-${id}`)}
        <Text dimColor size="footnote">
          {[`${item.repo}#${item.number}`, ticket, mine ? null : age(item.updatedAt)].filter(Boolean).join(' · ')}
        </Text>
      </Box>
      <Box flexDirection="row" gap="sm" flexWrap="wrap" alignItems="center">
        {mine && (
          <Button
            key="active-done"
            variant="primary"
            label="✓ Done"
            dimColor={isBusy}
            onPress={() => void ctx.actions.setWork(item, 'done')}
          />
        )}
        <Button key={`work-summarise-${id}`} label="Summarise" onPress={() => void ctx.actions.summarise(target)} />
        {mine && (
          <Button key="active-pause" label="Pause" dimColor={isBusy} onPress={() => void ctx.actions.setWork(item, 'paused')} />
        )}
        {pr && <Link href={pr.url}>Open on GitHub ↗</Link>}
      </Box>
    </Box>
  )
}

function renderSections(ctx: Ctx, data: Dashboard) {
  const { Box, Text } = ctx.el
  const filled = data.sections.filter((s) => s.pullRequests.length > 0)

  if (filled.length === 0) {
    return (
      <Text key="empty" dimColor>
        🎉 All clear. Nothing waiting for your review and no open pull requests of yours.
      </Text>
    )
  }

  return (
    <Box key="sections" flexDirection="column" gap="lg">
      {filled.map((s) => renderSection(ctx, s, data))}
    </Box>
  )
}

function renderSection(ctx: Ctx, section: InboxSection, data: Dashboard) {
  const { Box, Text } = ctx.el
  const tone = TONES[SECTION_TONE[section.id]]

  return (
    <Box key={`section-${section.id}`} flexDirection="column" gap="sm">
      <Box flexDirection="row" alignItems="center" gap="sm">
        <Text size="caption" weight="semibold" color={ctx.rich ? tone.fg : tone.key} bold={!ctx.rich}>
          {section.title.toUpperCase()}
        </Text>
        <Text dimColor tabular size="footnote">
          {String(section.pullRequests.length)}
        </Text>
      </Box>
      {section.pullRequests.map((pr) =>
        renderCard(ctx, pr, data.viewer, data.inProgress.filter((e) => prRef(e.item) === prRef(pr))),
      )}
    </Box>
  )
}

function renderStatus(ctx: Ctx, pr: PullRequest, key: string) {
  const { Box, Text, Svg } = ctx.el
  const status = STATUS[pr.status]
  if (ctx.rich && Svg) {
    const p = pill(status.label, status.tone)
    return (
      <Box key={key}>
        <Svg source={p.source} alt={status.label} width={p.width} height={p.height} />
      </Box>
    )
  }
  return (
    <Box key={key}>
      <Text color={TONES[status.tone].key}>{status.label}</Text>
    </Box>
  )
}

function renderSummary(ctx: Ctx, pr: PullRequest) {
  const { Text } = ctx.el
  const summary = ctx.summaries[prRef(pr)]
  if (!summary || summary.status === 'failed') return null
  const isFresh = summary.updatedAt === pr.updatedAt
  const text = summary.status === 'ready' ? summary.text : null
  return (
    <Text key={`summary-${prRef(pr)}`} size="footnote" dimColor={!isFresh || text === null} wrap="wrap">
      {text === null ? '✦ Summarising…' : `✦ ${text}`}
    </Text>
  )
}

function renderCard(ctx: Ctx, pr: PullRequest, viewer: string | null, work: WorkEntry[]) {
  const { Box, Text, Button, Link, Svg } = ctx.el
  const ref = prRef(pr)
  const scope = `pr-${ref}`.slice(0, 64)
  const { ticket, title } = splitTicket(pr.title)
  const isWorking = work.length > 0
  const isMine = work.some((e) => isUser(e.item))
  const workers = work.map((e) => who(e.item)).join(', ')
  const face = avatar(pr.author ?? '?')
  const byOther = pr.author !== null && pr.author !== viewer
  const meta = [`${pr.repo}#${pr.number}`, ticket, byOther ? `@${pr.author}` : null, age(pr.updatedAt)].filter(Boolean).join(' · ')

  return (
    <Box
      key={`pr-${ref}`}
      flexDirection="row"
      alignItems="flex-start"
      gap="sm"
      borderStyle="round"
      borderColor={ctx.rich ? (isWorking ? SURFACE.focusBorder : SURFACE.border) : isWorking ? 'claude' : 'subtle'}
      backgroundColor={ctx.rich ? SURFACE.card : undefined}
      paddingX={1}
      paddingY={ctx.rich ? 1 : 0}
      hover={ctx.rich ? { scope, backgroundColor: SURFACE.cardHover } : undefined}
    >
      {ctx.rich && Svg && (
        <Svg source={face.source} alt={pr.author ?? 'unknown author'} width={face.width} height={face.height} />
      )}
      <Box flexDirection="column" gap="xs" flexGrow={1} flexShrink={1} minWidth={0}>
        <Button key={`summarise-${ref}`} plain onPress={() => void ctx.actions.summarise(pr)}>
          {title}
        </Button>
        {renderSummary(ctx, pr)}
        <Box flexDirection="row" gap="xs" alignItems="center" flexWrap="wrap">
          {renderStatus(ctx, pr, `status-${ref}`)}
          {isWorking && (
            <Text color={ctx.rich ? SURFACE.accent : 'claude'} size="footnote">
              {`in progress · ${workers}`}
            </Text>
          )}
          {pr.workStatus === 'paused' && (
            <Text color="warning" size="footnote">
              paused
            </Text>
          )}
          <Text dimColor size="footnote" wrap="truncate-end">
            {meta}
          </Text>
          <Box flexDirection="row" gap="sm" alignItems="center" flexGrow={1} justifyContent="flex-end">
            {!isMine && (
              <Button
                key={`start-${ref}`}
                plain
                dimColor={ctx.pending.includes(ref)}
                onPress={() => void ctx.actions.setWork(pr, 'working')}
              >
                <Text color={ctx.rich ? SURFACE.accent : 'claude'} size="footnote">
                  ▶ Start
                </Text>
              </Button>
            )}
            <Link href={pr.url}>↗</Link>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export function renderSummaryBar(el: ViewElements, surface: RenderSurface, state: DashboardState, onOpen: () => void) {
  const { Box, Text, Button } = el
  const rich = isRich(surface, el)
  const { data, error, isLoading } = state
  const segments: Array<{ text: string; color?: string; dim?: boolean }> = []

  if (!data) {
    segments.push(
      error !== null
        ? { text: ' · could not load', color: 'error' }
        : { text: isLoading ? ' · loading…' : ' · open ›', dim: true },
    )
  } else {
    const review = sectionCount(data, 'review')
    const returned = sectionCount(data, 'returned')
    const ready = sectionCount(data, 'ready')
    const mine = data.inProgress.find((e) => isUser(e.item))?.item
    const agents = data.inProgress.filter((e) => !isUser(e.item)).length
    const accent = rich ? SURFACE.accent : 'claude'
    segments.push({ text: ` · ${totalOpen(data)} open`, dim: true })
    if (mine) segments.push({ text: ` · working on ${mine.repo}#${mine.number}`, color: accent })
    if (agents > 0) segments.push({ text: ` · ${plural(agents, 'PR')} with agents`, color: accent })
    if (review > 0) segments.push({ text: ` · ${review} to review`, color: rich ? TONES.info.fg : TONES.info.key })
    if (returned > 0) segments.push({ text: ` · ${returned} returned`, color: 'error' })
    if (ready > 0) segments.push({ text: ` · ${ready} ready`, color: 'success' })
    segments.push({ text: ' · open ›', dim: true })
  }

  return (
    <Box
      borderStyle={rich ? 'round' : undefined}
      borderColor={rich ? SURFACE.border : undefined}
      backgroundColor={rich ? SURFACE.card : undefined}
      paddingX={rich ? 1 : 0}
      hover={rich ? { scope: 'pr-summary', backgroundColor: SURFACE.cardHover } : undefined}
    >
      <Button key="pr-summary" plain onPress={onOpen}>
        <Text weight="semibold" bold>
          Pull requests
        </Text>
        {segments.map((s) => (s.color ? <Text color={s.color}>{s.text}</Text> : <Text dimColor={s.dim}>{s.text}</Text>))}
      </Button>
    </Box>
  )
}
