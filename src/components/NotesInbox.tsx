import { api, obsidianUrl } from '../api'
import { useT } from '../i18n'
import { store, useStore } from '../store'
import { formatStamp } from '../util/date'
import { Icon, useMenu, type MenuItem } from './bits'

export function NotesInbox() {
  const entries = useStore((s) => s.noteEntries)
  const loading = useStore((s) => s.notesLoading)
  const health = useStore((s) => s.health)
  const workspace = useStore((s) => s.workspace)
  const menu = useMenu()
  const t = useT()

  if (!health?.notes.connected) {
    return (
      <div className="empty">
        <div className="empty-title">{t('notes.disconnected.title')}</div>
        <div style={{ fontSize: 12, maxWidth: 470 }}>{t('notes.disconnected.hint')}</div>
      </div>
    )
  }

  if (loading && !entries.length) {
    return (
      <div className="empty">
        <div className="empty-title">{t('notes.loading')}</div>
      </div>
    )
  }

  if (!entries.length) {
    return (
      <div className="empty">
        <div className="empty-title">{t('notes.empty.title')}</div>
        <div style={{ fontSize: 12 }}>{t('notes.empty.hint')}</div>
        <button className="ghost-btn" onClick={() => void store.loadNotes()}>
          {t('tools.refresh')}
        </button>
      </div>
    )
  }

  const clientItems = (onPick: (clientId: string) => void): MenuItem[] =>
    (workspace?.clients ?? [])
      .filter((c) => !c.archived)
      .map((c) => ({
        id: c.id,
        label: c.name,
        hint: c.key,
        icon: <span className="client-dot" style={{ ['--client-color' as string]: c.color }} />,
        run: () => onPick(c.id),
      }))

  return (
    <div className="scroll">
      <div className="notes-grid">
        {entries.map((entry) => {
          const url = obsidianUrl(health.notes.obsidianVault, entry.relPath)
          return (
            <article key={entry.relPath} className="note-card">
              <div>
                <div className="note-card-name" title={entry.relPath}>
                  {entry.name}
                </div>
                <div className="eyebrow" style={{ marginTop: 3 }}>
                  {entry.ext.replace('.', '') || 'file'} · {formatStamp(entry.modifiedAt)}
                </div>
              </div>

              {entry.preview ? (
                <div className="note-preview">{entry.preview.trim()}</div>
              ) : (
                <div className="note-preview" style={{ color: 'var(--text-ghost)' }}>
                  {t('notes.noPreview')}
                </div>
              )}

              <div className="note-actions">
                <button
                  className="ghost-btn"
                  data-variant="accent"
                  onClick={(e) =>
                    menu.openFrom(
                      e.currentTarget,
                      clientItems(async (clientId) => {
                        await store.issueFromNoteEntry(entry, clientId)
                      })
                    )
                  }
                >
                  {t('notes.toIssue')}
                </button>
                {entry.kind === 'note' && url && (
                  <a className="ghost-btn" href={url} title={t('notes.open')}>
                    <Icon.note />
                  </a>
                )}
                <button
                  className="ghost-btn"
                  style={{ marginLeft: 'auto' }}
                  title={t('notes.archiveHint')}
                  onClick={async () => {
                    try {
                      const { movedTo } = await api.notesArchive(entry.relPath)
                      store.toast(t('notes.movedTo', { path: movedTo }))
                      void store.loadNotes()
                    } catch (err) {
                      store.toast((err as Error).message, 'error')
                    }
                  }}
                >
                  {t('notes.archive')}
                </button>
              </div>
            </article>
          )
        })}
      </div>
      {menu.node}
    </div>
  )
}
