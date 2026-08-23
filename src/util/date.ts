import { t } from '../i18n'

/**
 * Dates are formatted through Intl, so switching language switches the calendar
 * vocabulary too — no hand-kept lists of month names to fall out of sync.
 * The one thing Intl will not do is decide when a date stops deserving words
 * instead of digits; that judgement lives in formatDue.
 */

const pad = (n: number) => String(n).padStart(2, '0')

let locale = 'en'
export function setDateLocale(next: string) {
  locale = next
}

const cache = new Map<string, Intl.DateTimeFormat>()
function fmt(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options)}`
  let formatter = cache.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options)
    cache.set(key, formatter)
  }
  return formatter
}

export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function toISO(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return toISO(d)
}

/** Whole days between two dates — negative for the past. */
export function daysBetween(fromISO: string, toISODate: string): number {
  const a = new Date(`${fromISO}T00:00:00`).getTime()
  const b = new Date(`${toISODate}T00:00:00`).getTime()
  return Math.round((b - a) / 864e5)
}

/** A due date reads like speech for as long as counting days still means something. */
export function formatDue(iso: string | null): string {
  if (!iso) return ''
  const diff = daysBetween(todayISO(), iso)
  const d = new Date(`${iso}T00:00:00`)

  if (diff === 0) return t('date.today')
  if (diff === 1) return t('date.tomorrow')
  if (diff === -1) return t('date.yesterday')
  if (diff < -1 && diff >= -6) return t('date.daysAgo', { count: -diff })
  if (diff > 1 && diff <= 6) return fmt({ weekday: 'short', day: 'numeric', month: 'numeric' }).format(d)
  return fmt({ day: 'numeric', month: 'short' }).format(d)
}

export function isOverdue(iso: string | null): boolean {
  return Boolean(iso && daysBetween(todayISO(), iso) < 0)
}

export function formatRange(startsAt: string, endsAt: string): string {
  const a = new Date(`${startsAt}T00:00:00`)
  const b = new Date(`${endsAt}T00:00:00`)
  const range = fmt({ day: 'numeric', month: 'short' })
  // formatRange keeps "3 – 9 Nov" from becoming "3 Nov – 9 Nov" where the locale prefers it.
  return typeof range.formatRange === 'function' ? range.formatRange(a, b) : `${range.format(a)} – ${range.format(b)}`
}

export function formatStamp(iso: string): string {
  return fmt({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

/** Days left to a milestone — positive in the future. */
export function daysUntil(iso: string): number {
  return daysBetween(todayISO(), iso)
}

/** Whole days since a timestamp. Negative clock skew reads as 0, never as "tomorrow". */
export function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5))
}
