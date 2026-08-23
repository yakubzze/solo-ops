import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { issuesForView, store, useStore } from '../store'
import { BOARD_STATUSES, STATUS_MAP, type Issue, type Status } from '../types'
import { daysSince, formatDue, isOverdue } from '../util/date'
import { Icon, PriorityBars, StatusRing } from './bits'

export function Board() {
  const issues = useStore(issuesForView)
  const workspace = useStore((s) => s.workspace)
  const focusedId = useStore((s) => s.focusedId)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<Status | null>(null)

  const columns = BOARD_STATUSES.filter((s) => s !== 'done' || issues.some((i) => i.status === 'done'))
  const inboxCount = issues.filter((i) => i.status === 'inbox').length

  const boardRef = useRef<HTMLDivElement>(null)

  /**
   * The last column cut off at the edge and nothing said there was more to find.
   * The shade appears only when there is something to scroll to, and goes away at
   * the end — otherwise it would become noise itself.
   */
  useEffect(() => {
    const board = boardRef.current
    const main = board?.closest('.main')
    if (!board || !(main instanceof HTMLElement)) return

    const update = () => {
      const more = board.scrollWidth - board.clientWidth - board.scrollLeft > 8
      main.dataset.scrollable = String(more)
    }
    update()

    board.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(board)
    return () => {
      board.removeEventListener('scroll', update)
      observer.disconnect()
      delete main.dataset.scrollable
    }
  }, [columns.length, inboxCount])

  return (
    <div className="board" ref={boardRef}>
      {inboxCount > 0 && (
        <Column
          status="inbox"
          issues={issues.filter((i) => i.status === 'inbox')}
          focusedId={focusedId}
          dragging={dragging}
          over={over === 'inbox'}
          onDragState={setDragging}
          onOver={setOver}
          clients={workspace?.clients ?? []}
        />
      )}
      {columns.map((status) => (
        <Column
          key={status}
          status={status}
          issues={issues.filter((i) => i.status === status)}
          focusedId={focusedId}
          dragging={dragging}
          over={over === status}
          onDragState={setDragging}
          onOver={setOver}
          clients={workspace?.clients ?? []}
        />
      ))}
    </div>
  )
}

function Column({
  status,
  issues,
  focusedId,
  dragging,
  over,
  onDragState,
  onOver,
  clients,
}: {
  status: Status
  issues: Issue[]
  focusedId: string | null
  dragging: string | null
  over: boolean
  onDragState: (id: string | null) => void
  onOver: (status: Status | null) => void
  clients: { id: string; key: string; color: string }[]
}) {
  const meta = STATUS_MAP[status]
  const t = useT()

  return (
    <section
      className="board-col"
      data-over={over && dragging !== null}
      onDragOver={(e) => {
        e.preventDefault()
        onOver(status)
      }}
      onDragLeave={() => onOver(null)}
      onDrop={(e) => {
        e.preventDefault()
        const id = e.dataTransfer.getData('text/plain') || dragging
        if (id) void store.patchIssue(id, { status })
        onDragState(null)
        onOver(null)
      }}
    >
      <header className="board-col-head">
        <StatusRing status={status} />
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{t(meta.labelKey)}</span>
        <span className="group-count">{issues.length}</span>
        <button
          className="side-add"
          style={{ marginLeft: 'auto' }}
          title={t('tools.newIssue')}
          onClick={() => store.setQuickAdd(true, { status })}
        >
          +
        </button>
      </header>

      <div className="board-col-body">
        {issues.map((issue) => {
          const client = clients.find((c) => c.id === issue.clientId)
          const due = formatDue(issue.dueDate)
          return (
            <div
              key={issue.id}
              className="card"
              draggable
              data-focused={focusedId === issue.id}
              data-dragging={dragging === issue.id}
              style={{ ['--client-color' as string]: client?.color ?? 'var(--line)' }}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', issue.id)
                e.dataTransfer.effectAllowed = 'move'
                onDragState(issue.id)
              }}
              onDragEnd={() => {
                onDragState(null)
                onOver(null)
              }}
              onMouseEnter={() => store.focus(issue.id)}
              onClick={() => store.openIssue(issue.id)}
            >
              <div className="card-title">{issue.title || t('row.untitled')}</div>
              <div className="card-foot">
                <span className="card-key">
                  {client?.key}-{issue.num}
                </span>
                <PriorityBars priority={issue.priority} />
                {issue.status === 'waiting' && daysSince(issue.statusChangedAt ?? issue.createdAt) > 0 && (
                  <span
                    className="row-waiting"
                    data-stale={daysSince(issue.statusChangedAt ?? issue.createdAt) >= 7}
                  >
                    {t('row.waitingDays', { days: daysSince(issue.statusChangedAt ?? issue.createdAt) })}
                  </span>
                )}
                {issue.noteLinks.length > 0 && <Icon.note />}
                {issue.checklist.length > 0 && (
                  <span className="mono" style={{ fontSize: 10 }}>
                    {issue.checklist.filter((c) => c.done).length}/{issue.checklist.length}
                  </span>
                )}
                {due && (
                  <span className="row-due" style={{ marginLeft: 'auto' }} data-overdue={isOverdue(issue.dueDate)}>
                    {due}
                  </span>
                )}
              </div>
            </div>
          )
        })}
        {over && dragging && <div className="drop-hint" />}
      </div>
    </section>
  )
}
