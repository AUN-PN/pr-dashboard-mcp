import type { EngineInterface } from 'claude-code'
import type { PullRequest } from '../types'
import { prRef } from './format'

const REVIEW_COMMAND = 'code-review'

const needsFix = (pr: PullRequest) =>
  pr.status === 'ci_failed' || pr.status === 'changes_requested' || pr.ci === 'failure'

export const canFix = (pr: PullRequest, viewer: string | null) =>
  viewer !== null && pr.author === viewer && needsFix(pr)

const describe = (pr: PullRequest) => `pull request ${prRef(pr)} "${pr.title}" (${pr.url})`

function problems(pr: PullRequest): string {
  const found = [
    pr.ci === 'failure' || pr.status === 'ci_failed' ? 'its checks are failing' : null,
    pr.status === 'changes_requested' ? 'a reviewer requested changes' : null,
  ].filter((p): p is string => p !== null)
  return found.join(' and ')
}

export function fixPrompt(pr: PullRequest): string {
  return [
    `Fix ${describe(pr)}: ${problems(pr)}.`,
    'Work on its branch in a separate git worktree so my current checkout stays as it is.',
    'Read the failing check logs and the unresolved review comments, make the fix and run the relevant tests.',
    "Show me what you changed before pushing to the pull request's branch.",
  ].join(' ')
}

export async function reviewWithClaude($: EngineInterface, pr: PullRequest): Promise<void> {
  const commands = await $.command.list().catch(() => [])
  if (commands.some((c) => c.name === REVIEW_COMMAND)) {
    await $.command.run({ command: REVIEW_COMMAND, args: pr.url })
    return
  }
  await $.prompt.submit({ text: `Review ${describe(pr)} and report what you find.`, asUser: true })
}

export async function fixWithClaude($: EngineInterface, pr: PullRequest): Promise<void> {
  await $.prompt.submit({ text: fixPrompt(pr), asUser: true })
}
