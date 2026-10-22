import type { PrRef } from '../types'

export const USER_ACTOR = 'user'

const UNITS: Array<[string, number]> = [
  ['y', 365 * 86_400],
  ['mo', 30 * 86_400],
  ['w', 7 * 86_400],
  ['d', 86_400],
  ['h', 3_600],
  ['m', 60],
]

export function age(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000)
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${unit}`
  }
  return 'now'
}

export const prRef = (p: PrRef) => `${p.owner}/${p.repo}#${p.number}`

const TICKET = /^([A-Z][A-Z0-9]+-\d+)\s+/

export function splitTicket(full: string): { ticket: string | null; title: string } {
  const match = TICKET.exec(full)
  return match ? { ticket: match[1] ?? null, title: full.slice(match[0].length) } : { ticket: null, title: full }
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
