import { useEffect, useRef, useState } from 'react'
import { api, obsidianUrl } from '../api'
import { t, useT } from '../i18n'
import { store, useStore } from '../store'
import { PRIORITY_MAP, STATUS_MAP, type Issue, type NoteRef } from '../types'
import { addDays, formatDue, formatStamp, isOverdue, todayISO } from '../util/date'
import { renderMarkdown } from '../util/markdown'
import { Icon, PriorityBars, StatusRing, useMenu, type MenuItem } from './bits'
import { priorityMenuItems, statusMenuItems } from './IssueList'

export function IssueDetail({ issue }: { issue: Issue }) {
  const workspace = useStore((s) => s.workspace)
  const health = useStore((s) => s.health)
  const currentCycleId = useStore((s) => s.currentCycleId)
  const menu = useMenu()
  const [editingBody, setEditingBody] = useState(false)
  const [draftBody, setDraftBody] = useState(issue.body)
  const [linkQuery, setLinkQuery] = useState<string | null>(null)
  const [linkResults, setLinkResults] = useState<NoteRef[]>([])
  const titleRef = useRef<HTMLTextAreaElement>(null)
  useT()

  useEffect(() => {
    setDraftBody(issue.body)
    setEditingBody(false)
  }, [issue.id, issue.body])

  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [issue.title, issue.id])

  useEffect(() => {
    if (linkQuery === null) return
    let alive = true
    const timer = setTimeout(async () => {
      try {
        const { results } = await api.notesSearch(linkQuery)
        if (alive) setLinkResults(results)
      } catch {
        if (alive) setLinkResults([])
      }
    }, 140)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [linkQuery])

  if (!workspace) return null

  const client = workspace.clients.find((c) => c.id === issue.clientId)
  const project = workspace.projects.find((p) => p.id === issue.projectId)
  const cycle = workspace.cycles.find((c) => c.id === issue.cycleId)
  const projects = workspace.projects.filter((p) => p.clientId === issue.clientId && !p.archived)
  const obsidianVault = health?.notes.obsidianVault ?? null

  const patch = (data: Partial<Issue>) => void store.patchIssue(issue.id, data)

  const clientItems: MenuItem[] = workspace.clients
    .filter((c) => !c.archived)
    .map((c) => ({
      id: c.id,
      label: c.name,
      hint: c.key,
      active: c.id === issue.clientId,
      icon: <span className="client-dot" style={{ ['--client-color' as string]: c.color }} />,
      run: () => void store.moveIssueToClient(issue.id, c.id),
    }))

  const projectItems: MenuItem[] = [
    { id: 'none', label: t('panel.noProject'), active: !issue.projectId, run: () => patch({ projectId: null }) },
    ...projects.map((p) => ({
      id: p.id,
      label: p.name,
      active: p.id === issue.projectId,
      run: () => patch({ projectId: p.id }),
    })),
  ]

  const dateItems: MenuItem[] = [
    { id: 'today', label: t('panel.dueToday'), hint: formatDue(todayISO()), run: () => patch({ dueDate: todayISO() }) },
    { id: 'tomorrow', label: t('panel.dueTomorrow'), run: () => patch({ dueDate: addDays(todayISO(), 1) }) },
    { id: 'week', label: t('panel.dueWeek'), run: () => patch({ dueDate: addDays(todayISO(), 7) }) },
    { id: 'clear', label: t('panel.noDue'), active: !issue.dueDate, run: () => patch({ dueDate: null }) },
  ]

  const cycleItems: MenuItem[] = [
    {
      id: 'current',
      label: workspace.cycles.find((c) => c.id === currentCycleId)?.name ?? t('panel.currentCycle'),
      active: issue.cycleId === currentCycleId,
      run: () => patch({ cycleId: currentCycleId }),
    },
    { id: 'none', label: t('panel.noCycle'), active: !issue.cycleId, run: () => patch({ cycleId: null }) },
  ]

  const labelItems: MenuItem[] = workspace.labels.map((l) => ({
    id: l.id,
    label: l.name,
    active: issue.labels.includes(l.id),
    icon: <span className="client-dot" style={{ ['--client-color' as string]: l.color }} />,
    run: () =>
      patch({
        labels: issue.labels.includes(l.id)
          ? issue.labels.filter((x) => x !== l.id)
          : [...issue.labels, l.id],
      }),
  }))

  const saveBody = () => {
    setEditingBody(false)
    if (draftBody !== issue.body) patch({ body: draftBody })
  }

  const openWikilink = async (target: string) => {
    try {
      const { file } = await api.notesResolve(target)
      if (!file) return store.toast(t('notes.unresolved', { target }), 'warn')
      const url = obsidianUrl(obsidianVault, file.relPath)
      // Without a vault name there is no external app to hand the file to,
      // and pretending otherwise would open a dead link.
      if (url) window.location.href = url
    } catch (err) {
      store.toast((err as Error).message, 'error')
    }
  }

  const addChecklistItem = () =>
    patch({
      checklist: [...issue.checklist, { id: `k_${Date.now().toString(36)}`, text: '', done: false }],
    })

  return (
    <aside className="panel" style={{ ['--client-color' as string]: client?.color ?? 'var(--line)' }}>
      <header className="panel-head">
        <span className="client-dot" style={{ ['--client-color' as string]: client?.color }} />
        <span className="panel-key">
          {client?.key}-{issue.num}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
          {health?.notes.connected && (
            <button
              className="icon-btn"
              title={t('panel.toNotes')}
              onClick={() => void store.sendIssueToNotes(issue)}
            >
              <Icon.note />
            </button>
          )}
          <button className="icon-btn" title={t('panel.trash')} onClick={() => void store.trashIssue(issue.id)}>
            <Icon.trash />
          </button>
          <button className="icon-btn" title={t('panel.close')} onClick={() => store.openIssue(null)}>
            <Icon.close />
          </button>
        </div>
      </header>

      <div className="panel-body">
        <textarea
          ref={titleRef}
          className="panel-title-input"
          value={issue.title}
          rows={1}
          placeholder={t('panel.titlePlaceholder')}
          onChange={(e) => patch({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
        />

        <div className="panel-grid">
          <span className="panel-label">{t('panel.status')}</span>
          <button className="picker" onClick={(e) => menu.openFrom(e.currentTarget, statusMenuItems(issue))}>
            <StatusRing status={issue.status} />
            {t(STATUS_MAP[issue.status].labelKey)}
          </button>

          <span className="panel-label">{t('panel.priority')}</span>
          <button className="picker" onClick={(e) => menu.openFrom(e.currentTarget, priorityMenuItems(issue))}>
            <PriorityBars priority={issue.priority} />
            <span className={issue.priority === 0 ? 'picker-empty' : undefined}>
              {t(PRIORITY_MAP[issue.priority].labelKey)}
            </span>
          </button>

          <span className="panel-label">{t('panel.client')}</span>
          <button className="picker" onClick={(e) => menu.openFrom(e.currentTarget, clientItems)}>
            <span className="client-dot" style={{ ['--client-color' as string]: client?.color }} />
            {client?.name ?? '—'}
          </button>

          <span className="panel-label">{t('panel.project')}</span>
          <button className="picker" onClick={(e) => menu.openFrom(e.currentTarget, projectItems)}>
            <span className={project ? undefined : 'picker-empty'}>{project?.name ?? t('panel.noProject')}</span>
          </button>

          <span className="panel-label">{t('panel.due')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="picker" onClick={(e) => menu.openFrom(e.currentTarget, dateItems)}>
              <Icon.calendar />
              <span
                className={issue.dueDate ? undefined : 'picker-empty'}
                style={isOverdue(issue.dueDate) ? { color: 'var(--prio-1)' } : undefined}
              >
                {issue.dueDate ? formatDue(issue.dueDate) : t('panel.noDue')}
              </span>
            </button>
            {/* The native calendar stays reachable but stops standing next to the
                picker as a second control for the same thing. */}
            <label className="date-native" title={t('panel.datePicker')}>
              <Icon.calendar />
              <input
                type="date"
                value={issue.dueDate ?? ''}
                onChange={(e) => patch({ dueDate: e.target.value || null })}
              />
            </label>
          </div>

          <span className="panel-label">{t('panel.cycle')}</span>
          <button className="picker" onClick={(e) => menu.openFrom(e.currentTarget, cycleItems)}>
            <Icon.cycle />
            <span className={cycle ? undefined : 'picker-empty'}>{cycle?.name ?? t('panel.noCycle')}</span>
          </button>

          <span className="panel-label">{t('panel.labels')}</span>
          <button
            className="picker"
            onClick={(e) => menu.openFrom(e.currentTarget, labelItems)}
            style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}
          >
            {issue.labels.length === 0 && <span className="picker-empty">{t('panel.noLabels')}</span>}
            {workspace.labels
              .filter((l) => issue.labels.includes(l.id))
              .map((l) => (
                <span key={l.id} className="tag" style={{ ['--tag-color' as string]: l.color }}>
                  {l.name}
                </span>
              ))}
          </button>
        </div>

        {/* -------------------------------------------------------- opis */}
        {editingBody ? (
          <textarea
            className="body-editor"
            autoFocus
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            onBlur={saveBody}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setDraftBody(issue.body)
                setEditingBody(false)
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveBody()
            }}
            placeholder={t('panel.bodyEditorHint')}
          />
        ) : issue.body ? (
          <div
            className="md"
            onClick={(e) => {
              const target = (e.target as HTMLElement).closest('[data-wikilink]')
              if (target) {
                e.preventDefault()
                void openWikilink(target.getAttribute('data-wikilink') ?? '')
                return
              }
              if (!(e.target as HTMLElement).closest('a')) setEditingBody(true)
            }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(issue.body) }}
          />
        ) : (
          <div className="body-placeholder" onClick={() => setEditingBody(true)}>
            {t('panel.bodyPlaceholder')}
          </div>
        )}

        {/* --------------------------------------------------- checklista */}
        <div className="section-head" data-empty={issue.checklist.length === 0}>
          <span className="eyebrow">
            {t('panel.checklist')}
            {issue.checklist.length > 0 &&
              ` · ${issue.checklist.filter((c) => c.done).length}/${issue.checklist.length}`}
          </span>
          <button className="side-add" onClick={addChecklistItem} title={t('panel.checklistAdd')}>
            +
          </button>
        </div>
        {issue.checklist.map((item, index) => (
          <div key={item.id} className="checklist-item" data-done={item.done}>
            <button
              className="checkbox"
              role="checkbox"
              aria-checked={item.done}
              onClick={() =>
                patch({
                  checklist: issue.checklist.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c)),
                })
              }
            >
              ✓
            </button>
            <input
              className="checklist-text"
              value={item.text}
              autoFocus={!item.text}
              placeholder={t('panel.checklistItem')}
              onChange={(e) =>
                patch({
                  checklist: issue.checklist.map((c) =>
                    c.id === item.id ? { ...c, text: e.target.value } : c
                  ),
                })
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addChecklistItem()
                }
                if (e.key === 'Backspace' && !item.text) {
                  e.preventDefault()
                  patch({ checklist: issue.checklist.filter((c) => c.id !== item.id) })
                }
                e.stopPropagation()
              }}
            />
            <button
              className="icon-btn"
              style={{ width: 20, height: 20 }}
              title={t('panel.checklistRemove')}
              onClick={() => patch({ checklist: issue.checklist.filter((_, i) => i !== index) })}
            >
              <Icon.close />
            </button>
          </div>
        ))}

        {/* ------------------------------------------------- linki do vaultu */}
        {health?.notes.connected && (
          <>
            <div className="section-head" data-empty={issue.noteLinks.length === 0 && linkQuery === null}>
              <span className="eyebrow">{t('panel.notes')}</span>
              <button
                className="side-add"
                onClick={() => setLinkQuery(linkQuery === null ? '' : null)}
                title={t('panel.notesAdd')}
              >
                +
              </button>
            </div>

            {issue.noteLinks.map((link) => {
              const url = obsidianUrl(obsidianVault, link.relPath)
              return (
                <div key={link.relPath} className="link-row">
                  <Icon.link />
                  <a href={url ?? '#'} title={link.relPath}>
                    {link.label || link.relPath}
                  </a>
                  <button
                    className="icon-btn"
                    style={{ width: 20, height: 20, marginLeft: 'auto' }}
                    title={t('panel.notesUnlink')}
                    onClick={() =>
                      patch({ noteLinks: issue.noteLinks.filter((l) => l.relPath !== link.relPath) })
                    }
                  >
                    <Icon.close />
                  </button>
                </div>
              )
            })}

            {linkQuery !== null && (
              <div style={{ marginTop: 6 }}>
                <input
                  className="field"
                  autoFocus
                  value={linkQuery}
                  placeholder={t('panel.notesSearch')}
                  onChange={(e) => setLinkQuery(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Escape') setLinkQuery(null)
                  }}
                />
                <div style={{ marginTop: 4 }}>
                  {linkResults.map((result) => (
                    <button
                      key={result.relPath}
                      className="sheet-item"
                      onClick={() => {
                        if (!issue.noteLinks.some((l) => l.relPath === result.relPath)) {
                          patch({
                            noteLinks: [...issue.noteLinks, { relPath: result.relPath, label: result.name }],
                          })
                        }
                        setLinkQuery(null)
                      }}
                    >
                      <Icon.note />
                      <span className="sheet-item-label">{result.name}</span>
                      <span className="sheet-hint">{result.relPath.split('/').slice(0, -1).join('/')}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 28, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
          <div className="eyebrow">
            {t('panel.stamp', { created: formatStamp(issue.createdAt), updated: formatStamp(issue.updatedAt) })}
            {issue.completedAt && t('panel.stampDone', { completed: formatStamp(issue.completedAt) })}
          </div>
        </div>
      </div>
      {menu.node}
    </aside>
  )
}
