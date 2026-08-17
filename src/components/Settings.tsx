import { useEffect, useState } from 'react'
import { api } from '../api'
import { LOCALES, useT, type Locale, type MessageKey } from '../i18n'
import { store, useStore } from '../store'
import type { Client, Issue, Workspace } from '../types'
import { formatStamp } from '../util/date'
import { Icon } from './bits'

type Tab = 'clients' | 'data' | 'trash'

export function Settings() {
  const open = useStore((s) => s.settingsOpen)
  const workspace = useStore((s) => s.workspace)
  const health = useStore((s) => s.health)
  const [tab, setTab] = useState<Tab>('clients')
  const t = useT()
  const [trash, setTrash] = useState<{ issue: Issue; deletedAt: string }[]>([])

  useEffect(() => {
    if (open && tab === 'trash') {
      void api.trash().then((r) => setTrash(r.trash))
    }
  }, [open, tab])

  if (!open || !workspace) return null

  const save = (next: Partial<Workspace>) => void store.saveWorkspace({ ...workspace, ...next })

  const patchClient = (id: string, patch: Partial<Client>) =>
    save({ clients: workspace.clients.map((c) => (c.id === id ? { ...c, ...patch } : c)) })

  const addClient = (kind: Client['kind']) =>
    void store.addClient({
      key: 'NEW',
      name: t('settings.newClient'),
      color: '#A78BFA',
      kind,
      archived: false,
      note: '',
    })

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && store.setSettings(false)}>
      <div className="sheet" role="dialog" aria-label={t('topbar.settings')} style={{ width: 'min(720px, 94vw)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
          <div className="seg">
            {(['clients', 'data', 'trash'] as Tab[]).map((tab_) => (
              <button key={tab_} aria-pressed={tab === tab_} onClick={() => setTab(tab_)}>
                {t(('settings.tab.' + tab_) as MessageKey)}
              </button>
            ))}
          </div>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={() => store.setSettings(false)}>
            <Icon.close />
          </button>
        </div>

        <div className="settings-body">
          {tab === 'clients' && (
            <>
              <div className="sheet-section" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="eyebrow">{t('settings.own')}</span>
                <button className="side-add" onClick={() => addClient('own')} title={t('nav.addClient')}>
                  +
                </button>
              </div>
              {workspace.clients
                .filter((c) => c.kind === 'own')
                .map((client) => (
                  <ClientRow key={client.id} client={client} onPatch={patchClient} />
                ))}

              <div className="sheet-section" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="eyebrow">{t('settings.clients')}</span>
                <button className="side-add" onClick={() => addClient('client')} title={t('nav.addClient')}>
                  +
                </button>
              </div>
              {workspace.clients
                .filter((c) => c.kind === 'client')
                .map((client) => (
                  <ClientRow key={client.id} client={client} onPatch={patchClient} />
                ))}

              <div className="sheet-section">
                <span className="eyebrow">{t('settings.projects')}</span>
              </div>
              {workspace.clients
                .filter((c) => !c.archived)
                .map((client) => {
                  const projects = workspace.projects.filter((p) => p.clientId === client.id)
                  return (
                    <div key={client.id} className="set-row" style={{ alignItems: 'start' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                        <span className="client-dot" style={{ ['--client-color' as string]: client.color }} />
                        {client.name}
                      </span>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {projects.map((project) => (
                          <input
                            key={project.id}
                            className="field"
                            style={{ width: 150 }}
                            defaultValue={project.name}
                            onBlur={(e) =>
                              e.target.value !== project.name &&
                              save({
                                projects: workspace.projects.map((p) =>
                                  p.id === project.id ? { ...p, name: e.target.value } : p
                                ),
                              })
                            }
                          />
                        ))}
                        <button
                          className="ghost-btn"
                          onClick={() => void store.addProject(client.id, 'New project')}
                        >
                          {t('settings.addProject')}
                        </button>
                      </div>
                    </div>
                  )
                })}
            </>
          )}

          {tab === 'data' && (
            <>
              <div className="sheet-section">
                <span className="eyebrow">{t('settings.whereData')}</span>
              </div>
              <div className="set-row">
                <span className="panel-label">{t('settings.folder')}</span>
                <span className="set-value">{health?.paths.dataDir}</span>
              </div>
              <div className="set-row">
                <span className="panel-label">{t('settings.pathSource')}</span>
                <span className="set-value">{health?.paths.dataDirSource}</span>
              </div>
              <div className="set-row">
                <span className="panel-label">{t('settings.notesFolder')}</span>
                <span className="set-value">
                  {health?.notes.connected ? health.notes.dir : t('settings.notConnected')}
                </span>
              </div>

              {health && health.conflicts.length > 0 && (
                <>
                  <div className="sheet-section">
                    <span className="eyebrow" style={{ color: 'var(--prio-2)' }}>
                      {t('settings.conflicts')}
                    </span>
                  </div>
                  <div style={{ padding: '0 16px 8px', fontSize: 12, color: 'var(--text-dim)' }}>
                    {t('settings.conflictsHint')}
                  </div>
                  {health.conflicts.map((conflict) => (
                    <div key={conflict.file} className="set-row">
                      <span className="panel-label">{conflict.name}</span>
                      <span className="set-value">
                        {conflict.size} B ·{' '}
                        {conflict.originalExists ? t('settings.conflictOriginal') : t('settings.conflictNoOriginal')}
                      </span>
                    </div>
                  ))}
                </>
              )}

              <div className="sheet-section">
                <span className="eyebrow">{t('settings.milestone')}</span>
              </div>
              <div className="set-row">
                <span className="panel-label">{t('settings.milestoneName')}</span>
                <input
                  className="field"
                  defaultValue={workspace.settings.milestone?.name ?? ''}
                  placeholder={t('settings.milestoneNamePlaceholder')}
                  onBlur={(e) =>
                    save({
                      settings: {
                        ...workspace.settings,
                        milestone: e.target.value
                          ? { name: e.target.value, date: workspace.settings.milestone?.date ?? '' }
                          : null,
                      },
                    })
                  }
                />
              </div>
              <div className="set-row">
                <span className="panel-label">{t('settings.milestoneDate')}</span>
                <input
                  type="date"
                  className="field"
                  style={{ width: 150 }}
                  defaultValue={workspace.settings.milestone?.date ?? ''}
                  onBlur={(e) =>
                    save({
                      settings: {
                        ...workspace.settings,
                        milestone: e.target.value
                          ? { name: workspace.settings.milestone?.name ?? 'Milestone', date: e.target.value }
                          : null,
                      },
                    })
                  }
                />
              </div>
              <div className="set-row">
                <span className="panel-label">{t('settings.language')}</span>
                <div className="seg" style={{ justifySelf: 'start' }}>
                  {LOCALES.map((option) => (
                    <button
                      key={option.id}
                      aria-pressed={workspace.settings.locale === option.id}
                      onClick={() =>
                        save({ settings: { ...workspace.settings, locale: option.id as Locale } })
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="set-row">
                <span className="panel-label">{t('settings.doneVisible')}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="number"
                    className="field"
                    style={{ width: 70 }}
                    min={1}
                    max={365}
                    defaultValue={workspace.settings.showDoneDays}
                    onBlur={(e) =>
                      save({
                        settings: { ...workspace.settings, showDoneDays: Number(e.target.value) || 14 },
                      })
                    }
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{t('settings.days')}</span>
                </span>
              </div>
            </>
          )}

          {tab === 'trash' && (
            <>
              <div className="sheet-section">
                <span className="eyebrow">{t('settings.trashTitle')}</span>
              </div>
              {trash.length === 0 && (
                <div style={{ padding: '16px', color: 'var(--text-faint)', fontSize: 12 }}>{t('settings.trashEmpty')}</div>
              )}
              {trash.map(({ issue, deletedAt }) => {
                const client = workspace.clients.find((c) => c.id === issue.clientId)
                return (
                  <div key={issue.id} className="set-row" style={{ gridTemplateColumns: '1fr auto' }}>
                    <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                        {client?.key}-{issue.num}{' '}
                      </span>
                      {issue.title || t('row.untitled')}
                      <span className="eyebrow" style={{ marginLeft: 8 }}>
                        {formatStamp(deletedAt)}
                      </span>
                    </span>
                    <button
                      className="ghost-btn"
                      onClick={async () => {
                        await store.restoreIssue(issue.id)
                        setTrash((t) => t.filter((x) => x.issue.id !== issue.id))
                      }}
                    >
                      {t('settings.restore')}
                    </button>
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ClientRow({
  client,
  onPatch,
}: {
  client: Client
  onPatch: (id: string, patch: Partial<Client>) => void
}) {
  const t = useT()
  return (
    <div className="client-editor">
      <input
        type="color"
        className="swatch"
        value={client.color}
        title={t('settings.clientColor')}
        onChange={(e) => onPatch(client.id, { color: e.target.value })}
      />
      <input
        className="field"
        defaultValue={client.name}
        onBlur={(e) => e.target.value !== client.name && onPatch(client.id, { name: e.target.value })}
      />
      <input
        className="field mono"
        defaultValue={client.key}
        title={t('settings.clientKey')}
        onBlur={(e) => {
          const key = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
          if (key && key !== client.key) onPatch(client.id, { key })
        }}
      />
      <button
        className="ghost-btn"
        onClick={() => onPatch(client.id, { archived: !client.archived })}
        title={client.archived ? t('settings.unhide') : t('settings.hide')}
      >
        {client.archived ? t('settings.hidden') : t('settings.active')}
      </button>
      <span className="eyebrow" style={{ textAlign: 'right' }}>
        {client.kind === 'own' ? 'own' : 'client'}
      </span>
    </div>
  )
}
