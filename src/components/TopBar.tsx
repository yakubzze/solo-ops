import { useEffect, useRef } from 'react'
import { useT } from '../i18n'
import { store, useStore } from '../store'
import { daysUntil } from '../util/date'
import { Icon } from './bits'

export function TopBar() {
  const workspace = useStore((s) => s.workspace)
  const view = useStore((s) => s.view)
  const query = useStore((s) => s.query)
  const inputRef = useRef<HTMLInputElement>(null)
  const t = useT()

  useEffect(() => {
    const onFocusSearch = () => inputRef.current?.focus()
    window.addEventListener('solo-ops:focus-search', onFocusSearch)
    return () => window.removeEventListener('solo-ops:focus-search', onFocusSearch)
  }, [])

  if (!workspace) return <header className="topbar" />

  const client = view.kind === 'client' ? workspace.clients.find((c) => c.id === view.clientId) : null
  const project =
    view.kind === 'client' && view.projectId
      ? workspace.projects.find((p) => p.id === view.projectId)
      : null

  const milestone = workspace.settings.milestone
  const left = milestone ? daysUntil(milestone.date) : null

  const theme = workspace.settings.theme
  const toggleTheme = () =>
    void store.saveWorkspace({
      ...workspace,
      settings: { ...workspace.settings, theme: theme === 'dark' ? 'light' : 'dark' },
    })

  return (
    <header className="topbar">
      <div className="topbar-mark">
        <span className="topbar-dot" />
        <span>{client ? client.name : t('app.name')}</span>
        {project && <span className="topbar-crumb">/ {project.name}</span>}
      </div>

      <div className="topbar-spacer" />

      <label className="topbar-search">
        <Icon.search />
        <input
          ref={inputRef}
          value={query}
          placeholder={t('search.placeholder')}
          onChange={(e) => store.setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              store.setQuery('')
              inputRef.current?.blur()
            }
          }}
        />
        {query ? (
          <button className="sheet-hint" onClick={() => store.setQuery('')} title={t('search.clear')}>
            esc
          </button>
        ) : (
          <span className="sheet-hint">/</span>
        )}
      </label>

      <button className="icon-btn" title={t('topbar.palette')} onClick={() => store.setPalette(true)}>
        <span className="mono" style={{ fontSize: 10 }}>
          ⌘K
        </span>
      </button>

      {milestone && left != null && (
        <div className="milestone" title={`${milestone.name} — ${milestone.date}`}>
          <span>{milestone.name.split('—')[0].trim()}</span>
          <span className="milestone-value" data-urgent={left <= 14}>
            {left > 0 ? `D-${left}` : left === 0 ? t('date.today').toUpperCase() : `+${-left}`}
          </span>
        </div>
      )}

      <button className="icon-btn" onClick={toggleTheme} title={t('topbar.theme')}>
        <Icon.theme />
      </button>
      <button className="icon-btn" onClick={() => store.setSettings(true)} title={t('topbar.settings')}>
        <Icon.settings />
      </button>
    </header>
  )
}
