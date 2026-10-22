import { earth, SURFACE, TONES, type Tone } from './theme'

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ')
  const first = parts[0] ?? '?'
  const letters = parts.length > 1 ? `${first[0]}${parts[1]?.[0] ?? ''}` : first.slice(0, 2)
  return letters.toUpperCase() || '?'
}

export function avatar(name: string, size = 30): { source: string; width: number; height: number } {
  const r = size / 2
  return {
    width: size,
    height: size,
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${r}" cy="${r}" r="${r}" fill="${earth(name)}"/><text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="${FONT}" font-size="${size * 0.38}" font-weight="600" fill="${SURFACE.ivory}">${escape(initials(name))}</text></svg>`,
  }
}

export function pill(label: string, tone: Tone, dot = true): { source: string; width: number; height: number } {
  const { fg } = TONES[tone]
  const height = 20
  const pad = 8
  const dotSpace = dot ? 11 : 0
  const width = Math.round(pad * 2 + dotSpace + label.length * 6.1)
  const textX = pad + dotSpace
  return {
    width,
    height,
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" rx="${height / 2}" fill="${fg}" fill-opacity="0.16"/>${dot ? `<circle cx="${pad + 3}" cy="${height / 2}" r="3" fill="${fg}"/>` : ''}<text x="${textX}" y="${height / 2}" dy=".35em" font-family="${FONT}" font-size="11" font-weight="600" fill="${fg}">${escape(label)}</text></svg>`,
  }
}
