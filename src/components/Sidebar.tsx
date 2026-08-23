import { useT } from '../i18n'
import { countsForSidebar, store, useStore, type View } from '../store'
import type { Client } from '../types'
import { Icon } from './bits'

function sameView(a: View, b: View) {
  if (a.kind !== b.kind) return false
  if (a.kind === 'client' && b.kind === 'client') {
    return a.clientId === b.clientId && (a.projectId ?? null) === (b.projectId ?? null)
  }
  return true
}

export function Sidebar() {
  const workspace = useStore((s) => s.workspace)
  const view = useStore((s) => s.view)
  const counts = useStore(countsForSidebar)
  const cycles = useStore((s) => s.workspace?.cycles ?? [])
  const currentCycleId = useStore((s) => s.currentCycleId)
  const t = useT()

  if (!workspace) return <nav className="sidebar" />

  const cycle = cycles.find((c) => c.id === currentCycleId)
  const own = workspace.clients.filter((c) => c.kind === 'own' && !c.archived).sort((a, b) => a.order - b.order)
  const clients = workspace.clients.filter((c) => c.kind === 'client' && !c.archived).sort((a, b) => a.order - b.order)

  const NavItem = ({
    target,
    icon,
    label,
    count,
    overdue,
  }: {
    target: View
    icon: React.ReactNode
    label: string
    count?: number
    overdue?: boolean
  }) => (
    <button
      className="side-item"
      aria-current={sameView(view, target)}
      onClick={() => store.setView(target)}
    >
      <span style={{ display: 'grid', placeItems: 'center', width: 13, color: 'inherit' }}>{icon}</span>
      <span className="side-item-label">{label}</span>
      {count != null && count > 0 && (
        <span className="side-count" data-overdue={Boolean(overdue)}>
          {count}
        </span>
      )}
    </button>
  )

  const ClientGroup = ({ client }: { client: Client }) => {
    const isActive = view.kind === 'client' && view.clientId === client.id
    const projects = workspace.projects
      .filter((p) => p.clientId === client.id && !p.archived)
      .sort((a, b) => a.order - b.order)
    const count = counts.byClient.get(client.id) ?? 0

    return (
      <div style={{ ['--client-color' as string]: client.color }}>
        <button
          className="side-item"
          aria-current={isActive}
          onClick={() => store.setView({ kind: 'client', clientId: client.id, projectId: null })}
          title={client.note}
        >
          <span className="client-dot" />
          <span className="side-item-label">{client.name}</span>
          {isActive ? <span className="side-key">{client.key}</span> : count > 0 && <span className="side-count">{count}</span>}
        </button>
        {isActive &&
          projects.map((project) => (
            <button
              key={project.id}
              className="side-project"
              // The client keeps the tint and the dot beside its own name; a project
              // colours only its own marker, so the two never contend for one slot and
              // a project is free to take a colour unrelated to its client's.
              data-colored={project.color !== null}
              style={project.color ? ({ ['--project-color' as string]: project.color } as object) : undefined}
              aria-current={view.projectId === project.id}
              onClick={() =>
                store.setView({
                  kind: 'client',
                  clientId: client.id,
                  projectId: view.projectId === project.id ? null : project.id,
                })
              }
            >
              <span className="side-item-label">{project.name}</span>
            </button>
          ))}
      </div>
    )
  }

  return (
    <nav className="sidebar">
      <NavItem target={{ kind: 'today' }} icon={<Icon.today />} label={t('nav.today')} count={counts.today} overdue={counts.overdue > 0} />
      <NavItem target={{ kind: 'inbox' }} icon={<Icon.inbox />} label={t('nav.inbox')} count={counts.inbox} />
      <NavItem
        target={{ kind: 'cycle' }}
        icon={<Icon.cycle />}
        label={cycle ? cycle.name : t('nav.cycle')}
        count={counts.cycle}
      />
      <NavItem target={{ kind: 'all' }} icon={<Icon.layers />} label={t('nav.all')} count={counts.all} />
      <NavItem target={{ kind: 'notes' }} icon={<Icon.note />} label={t('nav.notes')} />

      <div className="side-divider" />

      <div className="side-section">
        <span className="eyebrow">{t('nav.own')}</span>
      </div>
      {own.map((client) => (
        <ClientGroup key={client.id} client={client} />
      ))}

      <div className="side-section">
        <span className="eyebrow">{t('nav.clients')}</span>
        <button className="side-add" title={t('nav.addClient')} onClick={() => store.setSettings(true)}>
          +
        </button>
      </div>
      {clients.map((client) => (
        <ClientGroup key={client.id} client={client} />
      ))}
    </nav>
  )
}
