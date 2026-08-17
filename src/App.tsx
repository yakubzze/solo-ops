import { useEffect } from 'react'
import { Board } from './components/Board'
import { CommandPalette } from './components/CommandPalette'
import { HelpOverlay } from './components/HelpOverlay'
import { IssueDetail } from './components/IssueDetail'
import { IssueList } from './components/IssueList'
import { QuickAdd } from './components/QuickAdd'
import { Settings } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { NotesInbox } from './components/NotesInbox'
import { Icon, useMenu } from './components/bits'
import { useHotkeys } from './hotkeys'
import { t, useT, type MessageKey } from './i18n'
import {
  countsForSidebar,
  cycleSummary,
  cyclesNewestFirst,
  issuesForView,
  store,
  useStore,
  viewShowsClosed,
  type GroupBy,
} from './store'
import { formatRange, todayISO } from './util/date'

const groupLabel = (group: GroupBy) => t(`group.${group}` as MessageKey)

export function App() {
  useHotkeys()

  const ready = useStore((s) => s.ready)
  const error = useStore((s) => s.error)
  const workspace = useStore((s) => s.workspace)
  const view = useStore((s) => s.view)
  const openIssueId = useStore((s) => s.openIssueId)
  const issues = useStore((s) => s.issues)
  const display = useStore((s) => s.display)
  const theme = useStore((s) => s.workspace?.settings.theme ?? 'dark')
  useT()

  useEffect(() => {
    void store.load()
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // The whole interface's accent follows context — inside a client it is that client's colour.
  const accent =
    view.kind === 'client'
      ? workspace?.clients.find((c) => c.id === view.clientId)?.color
      : undefined

  if (!ready) {
    return (
      <div className="empty" style={{ height: '100vh' }}>
        <div className="empty-title">{t('app.loading')}</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="empty" style={{ height: '100vh' }}>
        <div className="empty-title">{t('app.loadFailed')}</div>
        <div className="mono" style={{ fontSize: 12, maxWidth: 620 }}>
          {error}
        </div>
        <button className="ghost-btn" onClick={() => void store.load()}>
          {t('app.retry')}
        </button>
      </div>
    )
  }

  const openIssue = issues.find((i) => i.id === openIssueId) ?? null

  return (
    <div className="app" style={accent ? ({ ['--accent' as string]: accent } as object) : undefined}>
      <TopBar />
      <Sidebar />
      <main className="main">
        <ViewHeader />
        {view.kind === 'notes' ? <NotesInbox /> : display === 'board' ? <Board /> : <IssueList />}
      </main>

      {openIssue && <IssueDetail issue={openIssue} />}

      <CommandPalette />
      <QuickAdd />
      <HelpOverlay />
      <Settings />
      <Toasts />
    </div>
  )
}

function ViewHeader() {
  const view = useStore((s) => s.view)
  const workspace = useStore((s) => s.workspace)
  const display = useStore((s) => s.display)
  const groupBy = useStore((s) => s.groupBy)
  const showDone = useStore((s) => s.showDone)
  const counts = useStore(countsForSidebar)
  const visible = useStore(issuesForView)
  const currentCycleId = useStore((s) => s.currentCycleId)
  const health = useStore((s) => s.health)
  const showsClosed = useStore(viewShowsClosed)
  const menu = useMenu()
  useT()

  if (!workspace) return null

  let title = ''
  let sub = ''

  switch (view.kind) {
    case 'today': {
      title = t('nav.today')
      sub = counts.overdue
        ? t('view.today.sub.overdue', { date: todayISO(), count: counts.overdue })
        : t('view.today.sub.clear', { date: todayISO() })
      break
    }
    case 'inbox':
      title = t('nav.inbox')
      sub = t('view.inbox.sub')
      break
    case 'cycle': {
      const cycle = workspace.cycles.find((c) => c.id === (view.cycleId ?? currentCycleId))
      title = cycle?.name ?? t('nav.cycle')
      sub = cycle ? formatRange(cycle.startsAt, cycle.endsAt) : ''
      break
    }
    case 'all':
      title = t('nav.all')
      sub = t('view.all.sub', { count: counts.all })
      break
    case 'client': {
      const client = workspace.clients.find((c) => c.id === view.clientId)
      const project = workspace.projects.find((p) => p.id === view.projectId)
      title = project ? project.name : client?.name ?? ''
      sub = project ? (client?.name ?? '') : client?.note ?? ''
      break
    }
    case 'notes':
      title = t('view.notes.title')
      sub = health?.notes.connected ? (health.notes.inbox ?? health.notes.dir ?? '') : t('view.notes.sub.off')
      break
  }

  const groupItems = (['status', 'priority', 'client', 'none'] as GroupBy[]).map((g) => ({
    id: g,
    label: groupLabel(g),
    active: groupBy === g,
    run: () => store.setGroupBy(g),
  }))

  return (
    <header className="view-header">
      <div className="view-title">
        <h1>{title}</h1>
        {sub && <span className="view-sub">{sub}</span>}
        {view.kind === 'cycle' && <CycleNav />}
      </div>

      <div className="view-tools">
        {view.kind === 'notes' ? (
          <button className="ghost-btn" onClick={() => void store.loadNotes()}>
            {t('tools.refresh')}
          </button>
        ) : (
          <>
            <span className="group-count" style={{ marginRight: 6 }}>
              {visible.length}
            </span>
            <button
              className="ghost-btn"
              onClick={(e) => menu.openFrom(e.currentTarget, groupItems)}
              title={t('tools.grouping')}
            >
              {groupLabel(groupBy)}
            </button>
            {!showsClosed && (
              <button
                className="ghost-btn"
                aria-pressed={showDone}
                onClick={() => store.toggleDone()}
                title={t('tools.showDone')}
              >
                {showDone ? t('tools.withDone') : t('tools.withoutDone')}
              </button>
            )}
            <div className="seg">
              <button
                aria-pressed={display === 'list'}
                onClick={() => store.setDisplay('list')}
                title={t('tools.list')}
              >
                <Icon.list />
              </button>
              <button
                aria-pressed={display === 'board'}
                onClick={() => store.setDisplay('board')}
                title={t('tools.board')}
              >
                <Icon.board />
              </button>
            </div>
            <button
              className="ghost-btn"
              data-variant="accent"
              onClick={() => store.setQuickAdd(true)}
              title={t('tools.newIssue')}
            >
              <Icon.plus />
            </button>
          </>
        )}
      </div>
      {menu.node}
    </header>
  )
}

/**
 * Cycle navigation plus what actually stays in your head from a week: how much
 * closed, how much moves on. The third number — how many there were — is left out
 * on purpose, because on its own it says nothing about whether the week was good.
 */
function CycleNav() {
  const summary = useStore(cycleSummary)
  const cycles = useStore(cyclesNewestFirst)
  const menu = useMenu()
  useT()

  if (!summary.cycle) return null

  const ordered = [...cycles].reverse()
  const goTo = (offset: number) => {
    const next = ordered[summary.index + offset]
    if (next) store.setView({ kind: 'cycle', cycleId: next.id })
  }

  const items = cycles.map((c) => ({
    id: c.id,
    label: c.name,
    hint: formatRange(c.startsAt, c.endsAt),
    active: c.id === summary.cycle?.id,
    run: () => store.setView({ kind: 'cycle', cycleId: c.id }),
  }))

  return (
    <span className="cycle-nav">
      <button
        className="cycle-step"
        onClick={() => goTo(-1)}
        disabled={summary.index <= 0}
        title={t('cycle.prev')}
        aria-label={t('cycle.prev')}
      >
        &lsaquo;
      </button>
      <button
        className="cycle-step"
        onClick={() => goTo(1)}
        disabled={summary.index >= summary.total - 1}
        title={t('cycle.next')}
        aria-label={t('cycle.next')}
      >
        &rsaquo;
      </button>
      <button className="cycle-pick" onClick={(e) => menu.openFrom(e.currentTarget, items)} title={t('cycle.pick')}>
        {summary.isCurrent ? t('cycle.current') : t('cycle.past')}
      </button>
      <span className="cycle-stats">
        <span className="cycle-stat" data-kind="closed">
          {t('cycle.closed', { count: summary.closed })}
        </span>
        {summary.carried > 0 && (
          <span className="cycle-stat" data-kind="carried">
            {summary.isCurrent
              ? t('cycle.open', { count: summary.carried })
              : t('cycle.carried', { count: summary.carried })}
          </span>
        )}
        {!summary.isCurrent && summary.carried > 0 && summary.cycle && (
          <button
            className="cycle-rollover"
            onClick={() => void store.rolloverCycle(summary.cycle!.id)}
            title={t('cycle.rolloverHint')}
          >
            {t('cycle.rollover')}
          </button>
        )}
      </span>
      {menu.node}
    </span>
  )
}

function Toasts() {
  const toasts = useStore((s) => s.toasts)
  if (!toasts.length) return null
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast" data-tone={toast.tone}>
          <span>{toast.text}</span>
          {toast.action && (
            <button
              onClick={() => {
                toast.action?.run()
                store.dismissToast(toast.id)
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
