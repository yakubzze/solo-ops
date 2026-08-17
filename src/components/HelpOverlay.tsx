import { SHORTCUTS } from '../hotkeys'
import { useT } from '../i18n'
import { store, useStore } from '../store'
import { Icon } from './bits'

/** Separators inside a key hint stay quiet — only the actual keys look like keys. */
const CONNECTORS = new Set(['then', '/', '…', '–'])

export function HelpOverlay() {
  const open = useStore((s) => s.helpOpen)
  const t = useT()
  if (!open) return null

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && store.setHelp(false)}>
      <div className="sheet" role="dialog" aria-label={t('palette.shortcuts')} style={{ width: 'min(680px, 94vw)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontSize: 14, fontWeight: 560 }}>{t('help.title')}</span>
          <span className="eyebrow" style={{ marginLeft: 10 }}>
            {t('help.sub')}
          </span>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={() => store.setHelp(false)}>
            <Icon.close />
          </button>
        </div>

        <div className="settings-body" style={{ padding: '4px 0 16px' }}>
          {SHORTCUTS.map((group) => (
            <div key={group.groupKey}>
              <div className="sheet-section">
                <span className="eyebrow">{t(group.groupKey)}</span>
              </div>
              {group.items.map(([keys, descriptionKey]) => (
                <div
                  key={keys}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '176px 1fr',
                    gap: 12,
                    padding: '4px 16px',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {keys.split(' ').map((part, i) =>
                      CONNECTORS.has(part) ? (
                        <span key={i} style={{ color: 'var(--text-ghost)', fontSize: 11 }}>
                          {part}
                        </span>
                      ) : (
                        <kbd key={i}>{part}</kbd>
                      )
                    )}
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>{t(descriptionKey)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
