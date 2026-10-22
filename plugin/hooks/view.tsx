import type { Elements, RenderSurface } from 'claude-code'
import type { Dashboard, DashboardState, PullRequest, RepoGroup, WorkEntry, WorkItem } from '../types'
import type { Actions } from './actions'
import { age, plural, prRef, splitTicket, USER_ACTOR } from './format'
import { avatar, pill, repoMark } from './svg'
import { STATUS, SURFACE, TONES, type Tone } from './theme'

export type ViewElements = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button' | 'Link'> & {
  Svg?: Elements['desktop']['Svg']
}

type Ctx = { el: ViewElements; rich: boolean; actions: Actions; pending: string[] }

const isRich = (surface: RenderSurface, el: ViewElements) => surface !== 'terminal' && el.Svg !== undefined

const updated = (iso: string) => {
  const a = age(iso)
  return a === 'now' ? 'updated just now' : `updated ${a} ago`
}

const totalOpen = (data: Dashboard) => data.repos.reduce((n, g) => n + g.totalCount, 0)

export function renderDashboard(el: ViewElements, surface: RenderSurface, state: DashboardState, actions: Actions) {
  const { Box, Text, Button } = el
  const ctx: Ctx = { el, rich: isRich(surface, el), actions, pending: state.pending }
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
        <Button key="refresh" label={isLoading ? '⟳ Refreshing' : '⟳ Refresh'} onPress={() => void actions.refresh()} />
      </Box>
      {error !== null && renderNotice(ctx, error)}
      {data !== null && renderStats(ctx, data)}
      {data !== null && renderFocus(ctx, data)}
      {data !== null && renderRepos(ctx, data)}
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
  const prs = data.repos.flatMap((g) => g.pullRequests)
  const count = (...s: PullRequest['status'][]) => prs.filter((p) => s.includes(p.status)).length
  const stats: Array<{ label: string; value: number; tone: Tone }> = [
    { label: 'Open', value: totalOpen(data), tone: 'accent' },
    { label: 'In review', value: count('review_requested', 'changes_requested'), tone: 'warning' },
    { label: 'Failing', value: count('ci_failed'), tone: 'danger' },
    { label: 'Ready', value: count('approved'), tone: 'success' },
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

function renderRepos(ctx: Ctx, data: Dashboard) {
  const { Box, Text } = ctx.el
  const busy = data.repos.filter((g) => g.error !== null || g.pullRequests.length > 0)
  const quiet = data.repos.filter((g) => g.error === null && g.pullRequests.length === 0)

  if (data.repos.length === 0) {
    return (
      <Text key="empty" dimColor>
        🎉 All clear. No repositories with pull requests involving you in the last 30 days.
      </Text>
    )
  }

  return (
    <Box key="repos" flexDirection="column" gap="lg">
      {busy.map((g) => renderRepo(ctx, g, data))}
      {busy.length === 0 && <Text dimColor>🎉 All clear. Nothing open right now.</Text>}
      {quiet.length > 0 && (
        <Text dimColor size="footnote">
          {`Quiet: ${quiet.map((g) => `${g.owner}/${g.repo}`).join(', ')}`}
        </Text>
      )}
    </Box>
  )
}

function renderRepo(ctx: Ctx, group: RepoGroup, data: Dashboard) {
  const { Box, Text, Link, Svg } = ctx.el
  const name = `${group.owner}/${group.repo}`
  const hidden = group.totalCount - group.pullRequests.length
  const mark = repoMark(group.repo)

  return (
    <Box key={`repo-${name}`} flexDirection="column" gap="sm">
      <Box flexDirection="row" alignItems="center" gap="sm">
        {ctx.rich && Svg && <Svg source={mark.source} alt={group.repo} width={mark.width} height={mark.height} />}
        <Box flexDirection="row" gap="xs" alignItems="center" flexGrow={1} flexShrink={1}>
          <Text weight="semibold" bold>
            {group.repo}
          </Text>
          <Text dimColor size="footnote">
            {group.owner}
          </Text>
        </Box>
        <Text dimColor tabular size="footnote">
          {group.error ? 'error' : String(group.totalCount)}
        </Text>
      </Box>
      {group.error !== null && renderNotice(ctx, group.error)}
      {group.pullRequests.map((pr) => renderCard(ctx, pr, data.inProgress.filter((e) => prRef(e.item) === prRef(pr))))}
      {hidden > 0 && <Link href={`https://github.com/${name}/pulls`}>{`See ${hidden} more on GitHub ↗`}</Link>}
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

function renderCard(ctx: Ctx, pr: PullRequest, work: WorkEntry[]) {
  const { Box, Text, Button, Link, Svg } = ctx.el
  const ref = prRef(pr)
  const scope = `pr-${ref}`.slice(0, 64)
  const { ticket, title } = splitTicket(pr.title)
  const isWorking = work.length > 0
  const isMine = work.some((e) => isUser(e.item))
  const workers = work.map((e) => who(e.item)).join(', ')
  const face = avatar(pr.author ?? '?')
  const meta = [`#${pr.number}`, ticket, pr.author ? `@${pr.author}` : null, age(pr.updatedAt)].filter(Boolean).join(' · ')

  const buttons = (
    <Box flexDirection="row" gap="sm" alignItems="center">
      {!isMine && (
        <Button
          key={`start-${ref}`}
          label="▶ Start"
          dimColor={ctx.pending.includes(ref)}
          onPress={() => void ctx.actions.setWork(pr, 'working')}
        />
      )}
      <Link href={pr.url}>↗</Link>
    </Box>
  )

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
        </Box>
      </Box>
      {ctx.rich ? (
        <Box display="none" hover={{ scope, display: 'flex' }}>
          {buttons}
        </Box>
      ) : (
        buttons
      )}
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
    const prs = data.repos.flatMap((g) => g.pullRequests)
    const failing = prs.filter((p) => p.status === 'ci_failed').length
    const changes = prs.filter((p) => p.status === 'changes_requested').length
    const mine = data.inProgress.find((e) => isUser(e.item))?.item
    const agents = data.inProgress.filter((e) => !isUser(e.item)).length
    const accent = rich ? SURFACE.accent : 'claude'
    segments.push({ text: ` · ${totalOpen(data)} open`, dim: true })
    if (mine) segments.push({ text: ` · working on ${mine.repo}#${mine.number}`, color: accent })
    if (agents > 0) segments.push({ text: ` · ${plural(agents, 'PR')} with agents`, color: accent })
    if (failing > 0) segments.push({ text: ` · ${failing} CI failed`, color: 'error' })
    if (changes > 0) segments.push({ text: ` · ${changes} changes requested`, color: 'warning' })
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
