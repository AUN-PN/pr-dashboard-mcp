import type { Color } from 'claude-code'
import type { PrStatus } from '../types'

export type Tone = 'accent' | 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'merged' | 'draft'

export const TONES: Record<Tone, { fg: string; tint: string; key: Color }> = {
  accent: { fg: '#D97757', tint: 'rgba(217, 119, 87, 0.12)', key: 'claude' },
  neutral: { fg: '#8A877F', tint: 'rgba(138, 135, 127, 0.12)', key: 'subtle' },
  info: { fg: '#5B87B3', tint: 'rgba(91, 135, 179, 0.13)', key: 'suggestion' },
  success: { fg: '#6F8A4C', tint: 'rgba(111, 138, 76, 0.14)', key: 'success' },
  warning: { fg: '#B07A2E', tint: 'rgba(176, 122, 46, 0.14)', key: 'warning' },
  danger: { fg: '#C0503D', tint: 'rgba(192, 80, 61, 0.12)', key: 'error' },
  merged: { fg: '#9A7088', tint: 'rgba(154, 112, 136, 0.13)', key: 'merged' },
  draft: { fg: '#8A877F', tint: 'rgba(138, 135, 127, 0.10)', key: 'inactive' },
}

export const STATUS: Record<PrStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'draft' },
  ci_failed: { label: 'CI failed', tone: 'danger' },
  changes_requested: { label: 'Changes requested', tone: 'warning' },
  review_requested: { label: 'Review requested', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
  open: { label: 'Open', tone: 'neutral' },
  closed: { label: 'Closed', tone: 'draft' },
  merged: { label: 'Merged', tone: 'merged' },
}

export const SURFACE = {
  card: 'rgba(120, 110, 95, 0.05)',
  cardHover: 'rgba(217, 119, 87, 0.08)',
  border: 'rgba(120, 110, 95, 0.20)',
  focus: 'rgba(217, 119, 87, 0.09)',
  focusBorder: 'rgba(217, 119, 87, 0.45)',
  accent: '#D97757',
  ivory: '#FAF9F5',
}

export const EARTH = ['#D97757', '#C2895D', '#788C5D', '#6A9BCC', '#B0717A', '#8A7F72', '#BF6F4A', '#9C8A5A']

function hash(seed: string): number {
  let h = 5381
  for (const ch of seed) h = (Math.imul(h, 33) ^ ch.charCodeAt(0)) >>> 0
  return h
}

export const earth = (seed: string) => EARTH[hash(seed.toLowerCase()) % EARTH.length] ?? SURFACE.accent
