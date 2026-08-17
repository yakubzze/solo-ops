// Type-only import: erased at compile time, so it creates no runtime cycle
// even though i18n reaches back into the store.
import type { Locale, MessageKey } from './i18n'

export type Status = 'inbox' | 'todo' | 'doing' | 'waiting' | 'review' | 'done' | 'cancelled'
export type Priority = 0 | 1 | 2 | 3 | 4
export type ClientKind = 'own' | 'client'

export interface Client {
  id: string
  key: string
  name: string
  note?: string
  color: string
  kind: ClientKind
  archived: boolean
  order: number
}

export interface Project {
  id: string
  clientId: string
  name: string
  color: string | null
  archived: boolean
  order: number
}

export interface Cycle {
  id: string
  number: number
  name: string
  startsAt: string
  endsAt: string
}

export interface Label {
  id: string
  name: string
  color: string
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface NoteLink {
  relPath: string
  label: string
}

export interface Issue {
  id: string
  num: number
  clientId: string
  projectId: string | null
  title: string
  body: string
  status: Status
  priority: Priority
  labels: string[]
  checklist: ChecklistItem[]
  noteLinks: NoteLink[]
  cycleId: string | null
  dueDate: string | null
  order: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface Milestone {
  name: string
  date: string
}

export interface Settings {
  theme: 'dark' | 'light'
  locale: Locale
  milestone: Milestone | null
  weekStartsOn: number
  defaultView: string
  showDoneDays: number
}

export interface Workspace {
  version: number
  settings: Settings
  clients: Client[]
  projects: Project[]
  cycles: Cycle[]
  counters: Record<string, number>
  labels: Label[]
  createdAt: string
}

export interface NoteEntry {
  name: string
  relPath: string
  ext: string
  kind: 'note' | 'file'
  size: number
  modifiedAt: string
  preview: string
  lines: number
}

export interface NoteRef {
  name: string
  relPath: string
}

/* ---------------------------------------------------------------- dictionaries */

interface StatusMeta {
  id: Status
  labelKey: MessageKey
  shortKey: MessageKey
  /** How full the status ring is drawn — 0 empty, 1 solid. */
  fill: number
  onBoard: boolean
  tone: 'neutral' | 'active' | 'blocked' | 'done'
}

export const STATUSES: StatusMeta[] = [
  { id: 'inbox', labelKey: 'status.inbox', shortKey: 'status.short.inbox', fill: 0, onBoard: false, tone: 'neutral' },
  { id: 'todo', labelKey: 'status.todo', shortKey: 'status.short.todo', fill: 0, onBoard: true, tone: 'neutral' },
  { id: 'doing', labelKey: 'status.doing', shortKey: 'status.short.doing', fill: 0.5, onBoard: true, tone: 'active' },
  { id: 'waiting', labelKey: 'status.waiting', shortKey: 'status.short.waiting', fill: 0.25, onBoard: true, tone: 'blocked' },
  { id: 'review', labelKey: 'status.review', shortKey: 'status.short.review', fill: 0.75, onBoard: true, tone: 'active' },
  { id: 'done', labelKey: 'status.done', shortKey: 'status.short.done', fill: 1, onBoard: true, tone: 'done' },
  { id: 'cancelled', labelKey: 'status.cancelled', shortKey: 'status.short.cancelled', fill: 1, onBoard: false, tone: 'neutral' },
]

export const STATUS_MAP: Record<Status, StatusMeta> = Object.fromEntries(
  STATUSES.map((s) => [s.id, s])
) as Record<Status, StatusMeta>

export const BOARD_STATUSES: Status[] = STATUSES.filter((s) => s.onBoard).map((s) => s.id)

interface PriorityMeta {
  id: Priority
  labelKey: MessageKey
  short: string
  color: string
}

export const PRIORITIES: PriorityMeta[] = [
  { id: 1, labelKey: 'prio.1', short: 'P1', color: 'var(--prio-1)' },
  { id: 2, labelKey: 'prio.2', short: 'P2', color: 'var(--prio-2)' },
  { id: 3, labelKey: 'prio.3', short: 'P3', color: 'var(--prio-3)' },
  { id: 4, labelKey: 'prio.4', short: 'P4', color: 'var(--prio-4)' },
  { id: 0, labelKey: 'prio.0', short: '—', color: 'var(--prio-0)' },
]

export const PRIORITY_MAP: Record<Priority, PriorityMeta> = Object.fromEntries(
  PRIORITIES.map((p) => [p.id, p])
) as Record<Priority, PriorityMeta>
