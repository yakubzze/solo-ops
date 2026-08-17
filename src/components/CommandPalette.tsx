import { useEffect, useMemo, useRef, useState } from 'react'
import { t, useT, type MessageKey } from '../i18n'
import { store, useStore, type View } from '../store'
import type { Issue } from '../types'
import { Icon, PriorityBars, StatusRing } from './bits'

interface Command {
  id: string
  label: string
  section: string
  hint?: string
  icon?: React.ReactNode
  run: () => void
}

/** Subsequence match, so "acmsit" finds "Acme / site". */
function fuzzy(needle: string, haystack: string): number {
  if (!needle) return 0
  const n = needle.toLowerCase()
  const h = haystack.toLowerCase()
  const direct = h.indexOf(n)
  if (direct === 0) return 0
  if (direct > 0) return 1
  let i = 0
  let gaps = 0
  let last = -1
  for (const ch of n) {
    const at = h.indexOf(ch, i)
    if (at === -1) return -1
    if (last >= 0) gaps += at - last - 1
    last = at
    i = at + 1
  }
  return 2 + gaps / 100
}

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen)
  const workspace = useStore((s) => s.workspace)
  const issues = useStore((s) => s.issues)
  const display = useStore((s) => s.display)
  const groupBy = useStore((s) => s.groupBy)
  const showDone = useStore((s) => s.showDone)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  useT()

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    if (!workspace) return []
    const go = (label: string, view: View, hint?: string): Command => ({
      id: `go:${JSON.stringify(view)}`,
      label,
      section: t('palette.section.goto'),
      hint,
      icon: <Icon.arrowRight />,
      run: () => store.setView(view),
    })

    const clientCommands = workspace.clients
      .filter((c) => !c.archived)
      .map<Command>((c) => ({
        id: `client:${c.id}`,
        label: c.name,
        section: c.kind === 'own' ? t('palette.section.own') : t('palette.section.clients'),
        hint: c.key,
        icon: <span className="client-dot" style={{ ['--client-color' as string]: c.color }} />,
        run: () => store.setView({ kind: 'client', clientId: c.id, projectId: null }),
      }))

    const projectCommands = workspace.projects
      .filter((p) => !p.archived)
      .map<Command>((p) => {
        const client = workspace.clients.find((c) => c.id === p.clientId)
        return {
          id: `project:${p.id}`,
          label: `${client?.name ?? ''} / ${p.name}`,
          section: t('palette.section.projects'),
          icon: <span className="client-dot" style={{ ['--client-color' as string]: client?.color }} />,
          run: () => store.setView({ kind: 'client', clientId: p.clientId, projectId: p.id }),
        }
      })

    return [
      {
        id: 'new',
        label: t('empty.newIssue'),
        section: t('palette.section.actions'),
        hint: 'C',
        icon: <Icon.plus />,
        run: () => store.setQuickAdd(true),
      },
      go(t('nav.today'), { kind: 'today' }, 'G D'),
      go(t('nav.inbox'), { kind: 'inbox' }, 'G I'),
      go(t('key.cycle'), { kind: 'cycle' }, 'G C'),
      go(t('nav.all'), { kind: 'all' }, 'G A'),
      go(t('view.notes.title'), { kind: 'notes' }, 'G V'),
      ...clientCommands,
      ...projectCommands,
      {
        id: 'display',
        label: display === 'list' ? t('palette.showBoard') : t('palette.showList'),
        section: t('palette.section.view'),
        hint: 'B',
        icon: display === 'list' ? <Icon.board /> : <Icon.list />,
        run: () => store.setDisplay(display === 'list' ? 'board' : 'list'),
      },
      ...(['status', 'priority', 'client', 'none'] as const).map<Command>((g) => ({
        id: `group:${g}`,
        label: t('palette.groupBy', { mode: t(`group.${g}` as MessageKey) }),
        section: t('palette.section.view'),
        icon: <Icon.list />,
        run: () => store.setGroupBy(g),
      })).filter((c) => !c.id.endsWith(groupBy)),
      {
        id: 'done',
        label: showDone ? t('palette.hideDone') : t('palette.showDone'),
        section: t('palette.section.view'),
        icon: <StatusRing status="done" />,
        run: () => store.toggleDone(),
      },
      {
        id: 'reload',
        label: t('palette.reload'),
        section: t('palette.section.data'),
        icon: <Icon.cycle />,
        run: () => void store.reloadFromDisk(t('toast.reloadedManual')),
      },
      {
        id: 'settings',
        label: t('palette.settings'),
        section: t('palette.section.data'),
        icon: <Icon.settings />,
        run: () => store.setSettings(true),
      },
      {
        id: 'help',
        label: t('palette.shortcuts'),
        section: t('palette.section.data'),
        hint: '?',
        icon: <Icon.list />,
        run: () => store.setHelp(true),
      },
    ]
  }, [workspace, display, groupBy, showDone])

  const issueResults = useMemo<Command[]>(() => {
    if (!workspace || query.trim().length < 2) return []
    const key = (i: Issue) => {
      const client = workspace.clients.find((c) => c.id === i.clientId)
      return `${client?.key ?? ''}-${i.num}`
    }
    return issues
      .map((i) => ({ issue: i, score: Math.min(fuzzy(query, i.title), fuzzy(query, key(i))) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, 8)
      .map(({ issue }) => ({
        id: `issue:${issue.id}`,
        label: issue.title || t('row.untitled'),
        section: t('palette.section.issues'),
        hint: key(issue),
        icon: <StatusRing status={issue.status} />,
        run: () => {
          store.setView({ kind: 'client', clientId: issue.clientId, projectId: null })
          store.openIssue(issue.id)
        },
      }))
  }, [query, issues, workspace])

  const results = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, score: fuzzy(query, `${c.label} ${c.hint ?? ''}`) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => a.score - b.score)
      .map((r) => r.c)
    return [...scored.slice(0, 14), ...issueResults]
  }, [commands, issueResults, query])

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, results.length - 1)))
  }, [results.length])

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!open) return null

  const runAt = (index: number) => {
    const command = results[index]
    if (!command) return
    store.setPalette(false)
    command.run()
  }

  let lastSection = ''

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && store.setPalette(false)}>
      <div className="sheet" role="dialog" aria-label={t('topbar.palette')}>
        <input
          className="sheet-input"
          autoFocus
          value={query}
          placeholder={t('palette.placeholder')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor((c) => (c + 1) % Math.max(1, results.length))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor((c) => (c - 1 + results.length) % Math.max(1, results.length))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              runAt(cursor)
            } else if (e.key === 'Escape') {
              store.setPalette(false)
            }
          }}
        />
        <div className="sheet-list" ref={listRef}>
          {results.length === 0 && (
            <div style={{ padding: '18px 14px', color: 'var(--text-faint)', fontSize: 12 }}>
              {t('palette.empty')}
            </div>
          )}
          {results.map((command, index) => {
            const header = command.section !== lastSection ? command.section : null
            lastSection = command.section
            return (
              <div key={command.id}>
                {header && (
                  <div className="sheet-section">
                    <span className="eyebrow">{header}</span>
                  </div>
                )}
                <button
                  className="sheet-item"
                  data-active={index === cursor}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => runAt(index)}
                >
                  {command.icon}
                  <span className="sheet-item-label">{command.label}</span>
                  {command.hint && <span className="sheet-hint">{command.hint}</span>}
                </button>
              </div>
            )
          })}
        </div>
        <div className="sheet-foot">
          <span className="sheet-hint">{t('palette.foot.move')}</span>
          <span className="sheet-hint">{t('palette.foot.run')}</span>
          <span className="sheet-hint">{t('palette.foot.close')}</span>
          <span className="sheet-hint" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <PriorityBars priority={1} /> 1–4
          </span>
        </div>
      </div>
    </div>
  )
}
