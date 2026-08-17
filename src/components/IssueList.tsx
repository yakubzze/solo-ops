import { useEffect, useRef } from 'react'
import { t, useT, type MessageKey } from '../i18n'
import { issuesForView, store, useStore, viewShowsClosed, type GroupBy } from '../store'
import { PRIORITIES, PRIORITY_MAP, STATUSES, STATUS_MAP, type Issue, type Priority, type Status } from '../types'
import { formatDue, isOverdue, todayISO } from '../util/date'
import { excerpt } from '../util/markdown'
import { Icon, PriorityBars, StatusRing, useMenu, type MenuItem } from './bits'

interface Group {
  id: string
  label: string
  color?: string
  icon?: React.ReactNode
  issues: Issue[]
}

function groupIssues(issues: Issue[], groupBy: GroupBy, clients: { id: string; name: string; color: string }[]): Group[] {
  if (groupBy === 'none') return [{ id: 'all', label: '', issues }]

  if (groupBy === 'status') {
    return STATUSES.map((s) => ({
      id: s.id,
      label: t(s.labelKey),
      icon: <StatusRing status={s.id} />,
      issues: issues.filter((i) => i.status === s.id),
    })).filter((g) => g.issues.length)
  }

  if (groupBy === 'priority') {
    return PRIORITIES.map((p) => ({
      id: String(p.id),
      label: t(p.labelKey),
      icon: <PriorityBars priority={p.id} />,
      issues: issues.filter((i) => i.priority === p.id),
    })).filter((g) => g.issues.length)
  }

  return clients
    .map((c) => ({
      id: c.id,
      label: c.name,
      color: c.color,
      issues: issues.filter((i) => i.clientId === c.id),
    }))
    .filter((g) => g.issues.length)
}

export function IssueList() {
  const issues = useStore(issuesForView)
  const groupBy = useStore((s) => s.groupBy)
  const workspace = useStore((s) => s.workspace)
  const focusedId = useStore((s) => s.focusedId)
  const selection = useStore((s) => s.selection)
  const menu = useMenu()
  useT()

  const groups = groupIssues(issues, groupBy, workspace?.clients ?? [])

  if (!issues.length) return <EmptyState />

  return (
    <div className="scroll">
      {groups.map((group) => (
        <section key={group.id}>
          {group.label && (
            <header className="group-head">
              {group.icon}
              {group.color && (
                <span className="client-dot" style={{ ['--client-color' as string]: group.color }} />
              )}
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{group.label}</span>
              <span className="group-count">{group.issues.length}</span>
            </header>
          )}
          {group.issues.map((issue) => (
            <Row
              key={issue.id}
              issue={issue}
              focused={focusedId === issue.id}
              selected={selection.has(issue.id)}
              menu={menu}
            />
          ))}
        </section>
      ))}
      <ListEnd count={issues.length} />
      {menu.node}
    </div>
  )
}

/**
 * A list ending mid-screen looks like something failed to load. One quiet line
 * says "this is all of it" and closes the view.
 */
function ListEnd({ count }: { count: number }) {
  /* Two separate calls rather than `a || b` on one line: short-circuiting would
     skip the second hook and change hook order between renders. */
  const showDone = useStore((s) => s.showDone)
  const showsClosed = useStore(viewShowsClosed)
  const closedVisible = showDone || showsClosed
  useT()
  return (
    <div className="list-end">
      <span className="eyebrow">
        {count === 1 ? t('list.end.one') : t('list.end.count', { count })}
        {!closedVisible && ` · ${t('list.end.doneHidden')}`}
      </span>
      <button className="list-end-add" onClick={() => store.setQuickAdd(true)}>
        {t('list.end.add')}
      </button>
    </div>
  )
}

export function statusMenuItems(issue: Issue): MenuItem[] {
  return STATUSES.map((s) => ({
    id: s.id,
    label: t(s.labelKey),
    icon: <StatusRing status={s.id} />,
    hint: t(s.shortKey),
    active: issue.status === s.id,
    run: () => void store.patchIssue(issue.id, { status: s.id as Status }),
  }))
}

export function priorityMenuItems(issue: Issue): MenuItem[] {
  return PRIORITIES.map((p) => ({
    id: String(p.id),
    label: t(p.labelKey),
    icon: <PriorityBars priority={p.id} />,
    hint: p.id === 0 ? '0' : String(p.id),
    active: issue.priority === p.id,
    run: () => void store.patchIssue(issue.id, { priority: p.id as Priority }),
  }))
}

function Row({
  issue,
  focused,
  selected,
  menu,
}: {
  issue: Issue
  focused: boolean
  selected: boolean
  menu: ReturnType<typeof useMenu>
}) {
  const workspace = useStore((s) => s.workspace)
  const ref = useRef<HTMLDivElement>(null)
  useT()

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [focused])

  const client = workspace?.clients.find((c) => c.id === issue.clientId)

  /* A project name repeated on every row is noise wherever the view already
     carries it. It stays where it actually distinguishes something. */
  const view = useStore((s) => s.view)
  const projectIsImplied =
    view.kind === 'client' && (view.projectId === issue.projectId || view.projectId === null)
  const project = projectIsImplied
    ? undefined
    : workspace?.projects.find((p) => p.id === issue.projectId)
  const labels = (workspace?.labels ?? []).filter((l) => issue.labels.includes(l.id))
  const due = formatDue(issue.dueDate)

  return (
    <div
      ref={ref}
      className="row"
      /* A stable handle for the end-to-end tests: classes and copy change with
         every visual pass, the issue id does not. */
      data-issue-id={issue.id}
      data-focused={focused}
      data-selected={selected}
      data-done={issue.status === 'done'}
      style={{ ['--client-color' as string]: client?.color ?? 'transparent' }}
      onMouseEnter={() => store.focus(issue.id)}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) store.toggleSelected(issue.id)
        else store.openIssue(issue.id)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        store.focus(issue.id)
        menu.open({ x: e.clientX, y: e.clientY }, [
          ...statusMenuItems(issue),
          { id: 'sep', label: '', run: () => {} },
          ...priorityMenuItems(issue),
        ])
      }}
    >
      <span className="row-pad" />
      <button
        onClick={(e) => {
          e.stopPropagation()
          menu.openFrom(e.currentTarget, statusMenuItems(issue))
        }}
        title={t(STATUS_MAP[issue.status].labelKey)}
        style={{ display: 'grid', placeItems: 'center' }}
      >
        <StatusRing status={issue.status} />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          menu.openFrom(e.currentTarget, priorityMenuItems(issue))
        }}
        title={t(PRIORITY_MAP[issue.priority].labelKey)}
        style={{ display: 'grid', placeItems: 'center' }}
      >
        <PriorityBars priority={issue.priority} />
      </button>

      <span className="row-key">
        {client?.key}-{issue.num}
      </span>

      <span className="row-title">
        {issue.title || <span style={{ color: 'var(--text-ghost)' }}>{t('row.untitled')}</span>}
        {issue.body && <span className="row-excerpt">{excerpt(issue.body, 70)}</span>}
      </span>

      <span className="row-meta">
        {issue.noteLinks.length > 0 && (
          <span className="chip-note" title={t('row.notesCount', { count: issue.noteLinks.length })}>
            <Icon.note />
          </span>
        )}
        {issue.checklist.length > 0 && (
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
            {issue.checklist.filter((c) => c.done).length}/{issue.checklist.length}
          </span>
        )}
        {labels.map((l) => (
          <span key={l.id} className="tag" style={{ ['--tag-color' as string]: l.color }}>
            {l.name}
          </span>
        ))}
        {project && <span className="row-project">{project.name}</span>}
        {due && (
          <span className="row-due" data-overdue={isOverdue(issue.dueDate)} data-today={issue.dueDate === todayISO()}>
            {due}
          </span>
        )}
      </span>
    </div>
  )
}

function EmptyState() {
  const view = useStore((s) => s.view)
  const query = useStore((s) => s.query)

  if (query) {
    return (
      <div className="empty">
        <div className="empty-title">{t('empty.search.title', { query })}</div>
        <button className="ghost-btn" onClick={() => store.setQuery('')}>
          {t('empty.search.clear')}
        </button>
      </div>
    )
  }

  // Every view gets its own empty state, because "nothing here" means something
  // different in an inbox than it does in a cycle.
  const known = ['today', 'inbox', 'cycle', 'client']
  const kind = known.includes(view.kind) ? view.kind : 'all'

  return (
    <div className="empty">
      <div className="empty-title">{t(`empty.${kind}.title` as MessageKey)}</div>
      <div style={{ fontSize: 12 }}>{t(`empty.${kind}.hint` as MessageKey)}</div>
      <button className="ghost-btn" data-variant="accent" onClick={() => store.setQuickAdd(true)}>
        {t('empty.newIssue')}
      </button>
    </div>
  )
}