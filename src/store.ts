import { useCallback, useRef, useSyncExternalStore } from 'react'
import { StaleError, api, type HealthInfo } from './api'
import { setLocale, t, type Locale } from './i18n'
import { setDateLocale } from './util/date'
import { PRIORITY_MAP, STATUS_MAP } from './types'
import type { Client, Cycle, Issue, Priority, Project, Status, NoteEntry, Workspace } from './types'
import { todayISO } from './util/date'

export type View =
  | { kind: 'today' }
  | { kind: 'inbox' }
  | { kind: 'cycle'; cycleId?: string }
  | { kind: 'all' }
  | { kind: 'client'; clientId: string; projectId: string | null }
  | { kind: 'notes' }

export type GroupBy = 'status' | 'priority' | 'client' | 'none'
export type Display = 'list' | 'board'

export interface Toast {
  id: string
  text: string
  tone: 'info' | 'warn' | 'error'
  action?: { label: string; run: () => void }
}

interface UiPrefs {
  view: View
  display: Display
  groupBy: GroupBy
  showDone: boolean
}

interface State extends UiPrefs {
  ready: boolean
  error: string | null
  workspace: Workspace | null
  issues: Issue[]
  currentCycleId: string | null
  health: HealthInfo | null
  noteEntries: NoteEntry[]
  notesLoading: boolean

  query: string
  focusedId: string | null
  openIssueId: string | null
  selection: Set<string>

  paletteOpen: boolean
  quickAddOpen: boolean
  quickAddSeed: Partial<Issue> | null
  helpOpen: boolean
  settingsOpen: boolean

  toasts: Toast[]
  /** Label of the last undoable action, for hints in the interface. */
  undoLabel: string | null
}

const PREFS_KEY = 'solo-ops.prefs.v1'

function loadPrefs(): UiPrefs {
  const fallback: UiPrefs = { view: { kind: 'today' }, display: 'list', groupBy: 'status', showDone: false }
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/**
 * Every list an issue carries, defaulted before anything renders.
 *
 * The store is a folder of JSON the user is invited to open in a text editor,
 * and the views read `.length` off these three without a guard — an issue that
 * lost `noteLinks` to a hand edit does not lose its chip, it blanks the entire
 * interface with nothing on screen to say why. Defaulted once here rather than
 * in each view, so a new view cannot forget.
 *
 * Only fills what is missing: an issue that is already whole is passed through
 * unchanged, so this does not churn objects React compares by identity.
 */
function withLists(issues: Issue[]): Issue[] {
  return issues.map((issue) =>
    issue.noteLinks && issue.labels && issue.checklist
      ? issue
      : {
          ...issue,
          noteLinks: issue.noteLinks ?? [],
          labels: issue.labels ?? [],
          checklist: issue.checklist ?? [],
        },
  )
}

class Store {
  state: State = {
    ...loadPrefs(),
    ready: false,
    error: null,
    workspace: null,
    issues: [],
    currentCycleId: null,
    health: null,
    noteEntries: [],
    notesLoading: false,
    query: '',
    focusedId: null,
    openIssueId: null,
    selection: new Set(),
    paletteOpen: false,
    quickAddOpen: false,
    quickAddSeed: null,
    helpOpen: false,
    settingsOpen: false,
    toasts: [],
    undoLabel: null,
  }

  private listeners = new Set<() => void>()

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = () => this.state

  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }

  private savePrefs() {
    const { view, display, groupBy, showDone } = this.state
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ view, display, groupBy, showDone }))
    } catch {
      /* private mode — preferences simply will not survive the session */
    }
  }

  /* ------------------------------------------------------------------ loading */

  /** Language lives in the workspace file, so it travels with the data, not the browser. */
  private applyLocale(locale: Locale | undefined) {
    const next = locale ?? 'en'
    setLocale(next)
    setDateLocale(next)
  }

  async load() {
    try {
      const [state, health] = await Promise.all([api.state(), api.health()])
      this.applyLocale(state.workspace.settings.locale)
      this.set({
        ready: true,
        error: null,
        workspace: state.workspace,
        issues: withLists(state.issues),
        currentCycleId: state.currentCycleId,
        health,
      })
      if (health.conflicts.length) {
        this.toast(t('toast.conflicts', { count: health.conflicts.length }), 'warn', {
          label: t('toast.show'),
          run: () => this.set({ settingsOpen: true }),
        })
      }
      this.connectEvents()
    } catch (err) {
      this.set({ ready: true, error: (err as Error).message })
    }
  }

  private eventsBound = false

  private connectEvents() {
    if (this.eventsBound) return
    this.eventsBound = true
    const source = new EventSource('/api/events')
    source.addEventListener('external-change', () => {
      void this.reloadFromDisk(t('toast.reloaded'))
    })
  }

  async reloadFromDisk(message?: string) {
    this.clearUndo()
    try {
      const state = await api.reload()
      // A reload that changed nothing has nothing to report.
      const issues = withLists(state.issues)
      const before = JSON.stringify([this.state.workspace, this.state.issues])
      const after = JSON.stringify([state.workspace, issues])
      this.applyLocale(state.workspace.settings.locale)
      this.set({
        workspace: state.workspace,
        issues,
        currentCycleId: state.currentCycleId,
      })
      if (message && before !== after) this.toast(message, 'info')
    } catch (err) {
      this.toast((err as Error).message, 'error')
    }
  }

  /* ------------------------------------------------------------------- undo */

  /**
   * Undo goes through the same methods as an ordinary change — it has no private
   * path to the server. So it inherits the stale-write guard: an undo built on a
   * stale base is refused like any other write, instead of quietly overwriting
   * whatever the other machine did in the meantime.
   */
  private undoStack: { label: string; run: () => Promise<unknown> }[] = []

  private pushUndo(label: string, run: () => Promise<unknown>) {
    this.undoStack.push({ label, run })
    /* A deeper stack is never used and holds old copies of issues in memory. */
    if (this.undoStack.length > 40) this.undoStack.shift()
    this.set({ undoLabel: label })
  }

  /** A reload changes the base state, so remembered undos no longer fit it. */
  private clearUndo() {
    this.undoStack = []
    this.set({ undoLabel: null })
  }

  async undo() {
    const entry = this.undoStack.pop()
    this.set({ undoLabel: this.undoStack.at(-1)?.label ?? null })
    if (!entry) {
      this.toast(t('undo.empty'), 'info')
      return
    }
    await entry.run()
    this.toast(t('undo.done', { what: entry.label }))
  }

  /** What is being undone, in the user's words — not which field changed. */
  private describePatch(issue: Issue, patch: Partial<Issue>): string {
    const key = this.issueKey(issue)
    if ('status' in patch) return `${key} → ${t(STATUS_MAP[patch.status as Status].labelKey).toLowerCase()}`
    if ('priority' in patch) return `${key} → ${t(PRIORITY_MAP[patch.priority as Priority].labelKey).toLowerCase()}`
    if ('dueDate' in patch) return `${key} → ${t('panel.due').toLowerCase()}`
    if ('title' in patch) return `${key} → ${t('undo.title')}`
    if ('body' in patch) return `${key} → ${t('undo.body')}`
    if ('projectId' in patch) return `${key} → ${t('panel.project').toLowerCase()}`
    if ('cycleId' in patch) return `${key} → ${t('panel.cycle').toLowerCase()}`
    if ('labels' in patch) return `${key} → ${t('panel.labels').toLowerCase()}`
    return `${key}`
  }

  /**
   * Closing a week: whatever stayed open moves to the current cycle. It runs
   * through patchMany, so the whole thing is one undo rather than twelve — and
   * this is exactly the action you are most likely to trigger by mistake.
   */
  async rolloverCycle(fromCycleId: string) {
    const target = this.state.currentCycleId
    if (!target || fromCycleId === target) return
    const open = this.state.issues.filter(
      (i) => i.cycleId === fromCycleId && i.status !== 'done' && i.status !== 'cancelled'
    )
    if (!open.length) return

    await this.patchMany(
      open.map((i) => i.id),
      { cycleId: target }
    )
    this.setView({ kind: 'cycle', cycleId: target })
    this.toast(t('cycle.rolledOver', { count: open.length }))
  }
  /* ---------------------------------------------------------------- toasts */

  toast(text: string, tone: Toast['tone'] = 'info', action?: Toast['action']) {
    // The same message twice on screen is noise, not information.
    if (this.state.toasts.some((t) => t.text === text)) return
    const toast: Toast = { id: uid('t'), text, tone, action }
    this.set({ toasts: [...this.state.toasts, toast] })
    setTimeout(() => this.dismissToast(toast.id), tone === 'error' ? 8000 : 4500)
  }

  dismissToast(id: string) {
    this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) })
  }

  private handleWriteError(err: unknown) {
    if (err instanceof StaleError) {
      this.toast(err.message, 'warn')
      void this.reloadFromDisk()
    } else {
      this.toast((err as Error).message, 'error')
    }
  }

  /* -------------------------------------------------------------------- UI */

  setView(view: View) {
    this.set({ view, focusedId: null, selection: new Set(), query: '' })
    this.savePrefs()
    if (view.kind === 'notes') void this.loadNotes()
  }

  setDisplay(display: Display) {
    this.set({ display })
    this.savePrefs()
  }

  setGroupBy(groupBy: GroupBy) {
    this.set({ groupBy })
    this.savePrefs()
  }

  toggleDone() {
    this.set({ showDone: !this.state.showDone })
    this.savePrefs()
  }

  setQuery(query: string) {
    this.set({ query })
  }

  focus(id: string | null) {
    this.set({ focusedId: id })
  }

  openIssue(id: string | null) {
    this.set({ openIssueId: id, focusedId: id ?? this.state.focusedId })
  }

  toggleSelected(id: string) {
    const next = new Set(this.state.selection)
    next.has(id) ? next.delete(id) : next.add(id)
    this.set({ selection: next })
  }

  clearSelection() {
    this.set({ selection: new Set() })
  }

  setPalette(open: boolean) {
    this.set({ paletteOpen: open })
  }

  setQuickAdd(open: boolean, seed: Partial<Issue> | null = null) {
    this.set({ quickAddOpen: open, quickAddSeed: seed })
  }

  setHelp(open: boolean) {
    this.set({ helpOpen: open })
  }

  setSettings(open: boolean) {
    this.set({ settingsOpen: open })
  }

  /* ------------------------------------------------------------------ issues */

  private nextNum(clientId: string) {
    const mine = this.state.issues.filter((i) => i.clientId === clientId)
    const client = this.state.workspace?.clients.find((c) => c.id === clientId)
    const counter = client ? this.state.workspace?.counters[client.key] ?? 0 : 0
    return Math.max(counter, ...mine.map((i) => i.num), 0) + 1
  }

  draft(seed: Partial<Issue> = {}): Issue {
    const view = this.state.view
    const fallbackClient =
      view.kind === 'client' ? view.clientId : this.state.workspace?.clients[0]?.id ?? ''
    const clientId = seed.clientId ?? fallbackClient
    const now = new Date().toISOString()
    return {
      id: uid('i'),
      num: this.nextNum(clientId),
      clientId,
      projectId: seed.projectId ?? (view.kind === 'client' ? view.projectId : null),
      title: '',
      body: '',
      status: view.kind === 'inbox' ? 'inbox' : 'todo',
      priority: 0,
      labels: [],
      checklist: [],
      noteLinks: [],
      cycleId: view.kind === 'cycle' ? (view.cycleId ?? this.state.currentCycleId) : null,
      dueDate: view.kind === 'today' ? todayISO() : null,
      order: Date.now(),
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      ...seed,
    }
  }

  async createIssue(issue: Issue) {
    this.pushUndo(t('undo.create'), () => this.trashIssue(issue.id))
    this.set({ issues: [...this.state.issues, issue], focusedId: issue.id })
    try {
      const { issue: saved } = await api.saveIssue(issue)
      this.set({ issues: this.state.issues.map((i) => (i.id === saved.id ? saved : i)) })
      return saved
    } catch (err) {
      this.set({ issues: this.state.issues.filter((i) => i.id !== issue.id) })
      this.handleWriteError(err)
      return null
    }
  }

  async patchIssue(id: string, patch: Partial<Issue>, options?: { undoable?: boolean }) {
    const before = this.state.issues.find((i) => i.id === id)
    if (!before) return

    /* Undo stores the PREVIOUS values of exactly the fields being changed.
       Storing the whole issue would also revert changes nobody asked to revert. */
    if (options?.undoable !== false) {
      const previous = Object.fromEntries(
        Object.keys(patch).map((key) => [key, before[key as keyof Issue]])
      ) as Partial<Issue>
      this.pushUndo(this.describePatch(before, patch), () =>
        this.patchIssue(id, previous, { undoable: false })
      )
    }
    const optimistic = { ...before, ...patch, updatedAt: new Date().toISOString() }
    if (patch.status === 'done' && before.status !== 'done') optimistic.completedAt = optimistic.updatedAt
    if (patch.status && patch.status !== 'done' && before.status === 'done') optimistic.completedAt = null

    this.set({ issues: this.state.issues.map((i) => (i.id === id ? optimistic : i)) })
    try {
      const { issue: saved } = await api.saveIssue(optimistic)
      this.set({ issues: this.state.issues.map((i) => (i.id === saved.id ? saved : i)) })
    } catch (err) {
      this.set({ issues: this.state.issues.map((i) => (i.id === id ? before : i)) })
      this.handleWriteError(err)
    }
  }

  async patchMany(ids: string[], patch: Partial<Issue>) {
    /* One entry for the whole operation. Otherwise undoing a change across ten
       selected issues would take ten undos. */
    const originals = ids
      .map((id) => this.state.issues.find((i) => i.id === id))
      .filter((i): i is Issue => Boolean(i))
    if (originals.length) {
      const keys = Object.keys(patch) as (keyof Issue)[]
      const snapshot = originals.map((issue) => ({
        id: issue.id,
        previous: Object.fromEntries(keys.map((key) => [key, issue[key]])) as Partial<Issue>,
      }))
      const label =
        originals.length === 1
          ? this.describePatch(originals[0], patch)
          : `${this.describePatch(originals[0], patch)} (${originals.length})`
      this.pushUndo(label, async () => {
        for (const entry of snapshot) await this.patchIssue(entry.id, entry.previous, { undoable: false })
      })
    }
    const before = this.state.issues
    const patches = ids
      .map((id) => before.find((i) => i.id === id))
      .filter((i): i is Issue => Boolean(i))
      .map((i) => ({ ...i, ...patch }))
    if (!patches.length) return
    this.set({
      issues: before.map((i) => patches.find((p) => p.id === i.id) ?? i),
    })
    try {
      const { issues } = await api.saveIssues(patches)
      this.set({
        issues: this.state.issues.map((i) => issues.find((s) => s.id === i.id) ?? i),
      })
    } catch (err) {
      this.set({ issues: before })
      this.handleWriteError(err)
    }
  }

  async moveIssueToClient(id: string, toClientId: string) {
    const issue = this.state.issues.find((i) => i.id === id)
    if (!issue || issue.clientId === toClientId) return
    const movedFrom = issue.clientId
    try {
      const { issue: moved } = await api.moveIssue(id, issue.clientId, toClientId)
      this.set({ issues: this.state.issues.map((i) => (i.id === id ? moved : i)) })
      await this.refreshWorkspaceCounters()
      /* Pushed after the move succeeded: the key an undo would name only exists
         once the issue has landed in the other client's file.

         This undoes the move, not everything the move did. A move drops the
         project (projects belong to one client) and takes the next free number
         in the destination; coming back takes the next free number again. The
         issue returns to its client, not to its old key. */
      this.pushUndo(t('undo.move', { key: this.issueKey(moved) }), () =>
        this.moveIssueToClient(moved.id, movedFrom)
      )
      this.toast(
        t('toast.moved', {
          client: this.clientOf(moved)?.name ?? t('toast.movedFallback'),
          key: this.issueKey(moved),
        })
      )
    } catch (err) {
      this.handleWriteError(err)
    }
  }

  private async refreshWorkspaceCounters() {
    try {
      const state = await api.state()
      this.set({ workspace: state.workspace })
    } catch {
      /* counters catch up on the next read */
    }
  }

  async trashIssue(id: string) {
    const issue = this.state.issues.find((i) => i.id === id)
    if (!issue) return
    this.pushUndo(t('undo.trash', { key: this.issueKey(issue) }), () => this.restoreIssue(id))
    const before = this.state.issues
    this.set({
      issues: before.filter((i) => i.id !== id),
      openIssueId: this.state.openIssueId === id ? null : this.state.openIssueId,
    })
    try {
      await api.trashIssue(id, issue.clientId)
      this.toast(t('toast.trashed', { key: this.issueKey(issue) }), 'info', {
        label: t('toast.undo'),
        run: () => void this.restoreIssue(id),
      })
    } catch (err) {
      this.set({ issues: before })
      this.handleWriteError(err)
    }
  }

  async restoreIssue(id: string) {
    try {
      const { issue } = await api.restore(id)
      this.set({ issues: [...this.state.issues, issue] })
    } catch (err) {
      this.handleWriteError(err)
    }
  }

  /* ------------------------------------------------- clients and workspace */

  async saveWorkspace(next: Workspace) {
    const before = this.state.workspace
    this.applyLocale(next.settings.locale)
    this.set({ workspace: next })
    try {
      const { workspace } = await api.saveWorkspace(next)
      this.applyLocale(workspace.settings.locale)
      this.set({ workspace })
    } catch (err) {
      if (before) this.set({ workspace: before })
      this.handleWriteError(err)
    }
  }

  async addClient(client: Omit<Client, 'id' | 'order'>) {
    const ws = this.state.workspace
    if (!ws) return
    const next: Workspace = {
      ...ws,
      clients: [
        ...ws.clients,
        { ...client, id: uid('c'), order: ws.clients.length + 1 },
      ],
    }
    await this.saveWorkspace(next)
  }

  async addProject(clientId: string, name: string) {
    const ws = this.state.workspace
    if (!ws) return
    const project: Project = {
      id: uid('p'),
      clientId,
      name,
      color: null,
      archived: false,
      order: ws.projects.filter((p) => p.clientId === clientId).length + 1,
    }
    await this.saveWorkspace({ ...ws, projects: [...ws.projects, project] })
  }

  /* ------------------------------------------------------------------- notes */

  async loadNotes() {
    this.set({ notesLoading: true })
    try {
      const { entries } = await api.notesInbox()
      this.set({ noteEntries: entries, notesLoading: false })
    } catch (err) {
      this.set({ notesLoading: false })
      this.toast((err as Error).message, 'error')
    }
  }

  async issueFromNoteEntry(entry: NoteEntry, clientId: string) {
    const title = entry.name.replace(/\.(md|txt)$/i, '')
    const issue = this.draft({
      clientId,
      title,
      body: entry.preview,
      status: 'todo',
      noteLinks: entry.kind === 'note' ? [{ relPath: entry.relPath, label: title }] : [],
    })
    const saved = await this.createIssue(issue)
    if (saved) this.toast(t('notes.createdFrom', { key: this.issueKey(saved) }))
    return saved
  }

  async sendIssueToNotes(issue: Issue) {
    try {
      const { relPath } = await api.notesWrite({
        title: issue.title,
        body: issue.body,
        source: `${this.issueKey(issue)} · ${this.clientOf(issue)?.name ?? ''}`,
      })
      await this.patchIssue(issue.id, {
        noteLinks: [...issue.noteLinks, { relPath, label: issue.title }],
      })
      this.toast(t('notes.written', { path: relPath }))
    } catch (err) {
      this.toast((err as Error).message, 'error')
    }
  }

  /* ------------------------------------------------------------------ helpers */

  clientOf(issue: Issue): Client | undefined {
    return this.state.workspace?.clients.find((c) => c.id === issue.clientId)
  }

  issueKey(issue: Issue) {
    return `${this.clientOf(issue)?.key ?? '??'}-${issue.num}`
  }
}

export const store = new Store()

/**
 * A selector result is cached until the state reference changes.
 * Without this, selectors that build a new array (issuesForView, countsForSidebar)
 * would return a different object on every call, and useSyncExternalStore
 * compares with Object.is — so it would render forever.
 */
export function useStore<T>(select: (s: State) => T): T {
  const selectRef = useRef(select)
  selectRef.current = select
  const cache = useRef<{ state: State; value: T } | null>(null)

  const getSnapshot = useCallback(() => {
    const state = store.getSnapshot()
    if (!cache.current || cache.current.state !== state) {
      cache.current = { state, value: selectRef.current(state) }
    }
    return cache.current.value
  }, [])

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}

/* ---------------------------------------------------------------- selectors */

export function issuesForView(state: State): Issue[] {
  const { view, issues, workspace, currentCycleId, showDone } = state
  if (!workspace) return []
  const today = todayISO()
  const doneCutoff = new Date(Date.now() - (workspace.settings.showDoneDays ?? 14) * 864e5).toISOString()

  const active = (i: Issue) => i.status !== 'done' && i.status !== 'cancelled'
  const recentlyDone = (i: Issue) => i.status === 'done' && (i.completedAt ?? i.updatedAt) >= doneCutoff

  let list: Issue[]
  switch (view.kind) {
    case 'today':
      list = issues.filter(
        (i) =>
          (active(i) && ((i.dueDate && i.dueDate <= today) || i.status === 'doing')) ||
          (i.status === 'done' && (i.completedAt ?? '').slice(0, 10) === today)
      )
      break
    case 'inbox':
      list = issues.filter((i) => i.status === 'inbox')
      break
    case 'cycle': {
      const cycleId = view.cycleId ?? currentCycleId
      /* A closed cycle is opened to see what got finished in it. The "last N days"
         filter makes sense for current work; in history it would hide exactly the
         issues you came for. */
      const isPast = cycleId !== currentCycleId
      list = issues.filter(
        (i) => i.cycleId === cycleId && (isPast || active(i) || showDone || recentlyDone(i))
      )
      break
    }
    case 'client': {
      list = issues.filter((i) => i.clientId === view.clientId)
      if (view.projectId) list = list.filter((i) => i.projectId === view.projectId)
      list = list.filter((i) => active(i) || (showDone ? true : recentlyDone(i)))
      break
    }
    case 'all':
      list = issues.filter((i) => active(i) || (showDone && i.status !== 'cancelled'))
      break
    case 'notes':
      return []
  }

  const q = state.query.trim().toLowerCase()
  if (q) {
    const client = (i: Issue) => workspace.clients.find((c) => c.id === i.clientId)
    list = list.filter((i) => {
      const key = `${client(i)?.key ?? ''}-${i.num}`.toLowerCase()
      return (
        i.title.toLowerCase().includes(q) ||
        i.body.toLowerCase().includes(q) ||
        key.includes(q)
      )
    })
  }

  const rank: Record<Status, number> = {
    doing: 0, review: 1, waiting: 2, todo: 3, inbox: 4, done: 5, cancelled: 6,
  }
  const prio = (p: Priority) => (p === 0 ? 9 : p)

  return list.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      prio(a.priority) - prio(b.priority) ||
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
      a.order - b.order
  )
}

export interface CycleSummary {
  cycle: Cycle | null
  index: number
  total: number
  closed: number
  open: number
  carried: number
  isCurrent: boolean
}

/**
 * Numbers for the cycle header. `carried` is what stayed open — the only one of
 * these that says something about next week rather than the last one.
 */
/**
 * Whether the view shows closed issues regardless of the toggle. A closed cycle
 * always does — and until the interface knew that, the button read "without done"
 * above a list full of struck-through issues.
 */
export function viewShowsClosed(state: State): boolean {
  if (state.view.kind !== 'cycle') return false
  const cycleId = state.view.cycleId ?? state.currentCycleId
  return cycleId !== state.currentCycleId
}

export function cycleSummary(state: State): CycleSummary {
  const cycles = [...(state.workspace?.cycles ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const wanted = state.view.kind === 'cycle' ? state.view.cycleId ?? state.currentCycleId : state.currentCycleId
  const index = cycles.findIndex((c) => c.id === wanted)
  const cycle = index >= 0 ? cycles[index] : null
  const mine = cycle ? state.issues.filter((i) => i.cycleId === cycle.id) : []
  const closed = mine.filter((i) => i.status === 'done').length
  const open = mine.filter((i) => i.status !== 'done' && i.status !== 'cancelled').length

  return {
    cycle,
    index,
    total: cycles.length,
    closed,
    open,
    carried: open,
    isCurrent: cycle?.id === state.currentCycleId,
  }
}

/** Cycles newest first, for navigation and for the picker. */
export function cyclesNewestFirst(state: State): Cycle[] {
  return [...(state.workspace?.cycles ?? [])].sort((a, b) => b.startsAt.localeCompare(a.startsAt))
}

export function countsForSidebar(state: State) {
  const { issues, currentCycleId } = state
  const today = todayISO()
  const active = (i: Issue) => i.status !== 'done' && i.status !== 'cancelled'
  return {
    today: issues.filter((i) => active(i) && ((i.dueDate && i.dueDate <= today) || i.status === 'doing')).length,
    overdue: issues.filter((i) => active(i) && i.dueDate && i.dueDate < today).length,
    inbox: issues.filter((i) => i.status === 'inbox').length,
    cycle: issues.filter((i) => i.cycleId === currentCycleId && active(i)).length,
    all: issues.filter(active).length,
    byClient: new Map(
      [...new Set(issues.map((i) => i.clientId))].map((clientId) => [
        clientId,
        issues.filter((i) => i.clientId === clientId && active(i)).length,
      ])
    ),
  }
}
