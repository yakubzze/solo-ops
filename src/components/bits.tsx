import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '../i18n'
import { PRIORITY_MAP, STATUS_MAP, type Priority, type Status } from '../types'

/** The status ring fills as work progresses. */
export function StatusRing({ status }: { status: Status }) {
  const meta = STATUS_MAP[status]
  return (
    <span
      className="status-ring"
      data-tone={meta.tone}
      title={t(meta.labelKey)}
      style={{ ['--fill' as string]: meta.fill }}
    >
      <i />
    </span>
  )
}

export function PriorityBars({ priority }: { priority: Priority }) {
  return (
    <span className="prio" data-level={priority} title={t(PRIORITY_MAP[priority].labelKey)}>
      <span />
      <span />
      <span />
    </span>
  )
}

export function Tag({ label, color }: { label: string; color?: string }) {
  return (
    <span className="tag" style={color ? ({ ['--tag-color' as string]: color } as object) : undefined}>
      {label}
    </span>
  )
}

/* ------------------------------------------------------------------- menu */

export interface MenuItem {
  id: string
  label: string
  hint?: string
  icon?: ReactNode
  run: () => void
  active?: boolean
}

export interface MenuAnchor {
  x: number
  y: number
}

export function Menu({
  anchor,
  items,
  onClose,
}: {
  anchor: MenuAnchor
  items: MenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState(() => Math.max(0, items.findIndex((i) => i.active)))
  const [pos, setPos] = useState(anchor)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const box = el.getBoundingClientRect()
    setPos({
      x: Math.min(anchor.x, window.innerWidth - box.width - 8),
      y: Math.min(anchor.y, window.innerHeight - box.height - 8),
    })
  }, [anchor.x, anchor.y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCursor((c) => (c + 1) % items.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) => (c - 1 + items.length) % items.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        items[cursor]?.run()
        onClose()
      }
    }
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown)
    }
  }, [items, cursor, onClose])

  return (
    <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }} role="menu">
      {items.map((item, i) => (
        <button
          key={item.id}
          className="menu-item"
          role="menuitem"
          data-active={i === cursor}
          onMouseEnter={() => setCursor(i)}
          onClick={() => {
            item.run()
            onClose()
          }}
        >
          {item.icon}
          <span className="sheet-item-label">{item.label}</span>
          {item.hint && <span className="sheet-hint">{item.hint}</span>}
          {item.active && <span className="sheet-hint">✓</span>}
        </button>
      ))}
    </div>
  )
}

/** Context-menu state — the keyboard and the mouse open it through the same call. */
export function useMenu() {
  const [state, setState] = useState<{ anchor: MenuAnchor; items: MenuItem[] } | null>(null)
  return {
    node: state ? <Menu anchor={state.anchor} items={state.items} onClose={() => setState(null)} /> : null,
    open: (anchor: MenuAnchor, items: MenuItem[]) => setState({ anchor, items }),
    openFrom: (el: HTMLElement | null, items: MenuItem[]) => {
      const box = el?.getBoundingClientRect()
      setState({ anchor: { x: box?.left ?? 200, y: (box?.bottom ?? 200) + 4 }, items })
    },
    close: () => setState(null),
    isOpen: state !== null,
  }
}

/* ------------------------------------------------------------------- icons */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export const Icon = {
  search: () => (
    <svg width="12" height="12" viewBox="0 0 14 14" {...stroke}>
      <circle cx="6" cy="6" r="4.2" />
      <path d="M9.2 9.2 12 12" />
    </svg>
  ),
  plus: () => (
    <svg width="13" height="13" viewBox="0 0 14 14" {...stroke}>
      <path d="M7 3v8M3 7h8" />
    </svg>
  ),
  list: () => (
    <svg width="12" height="12" viewBox="0 0 14 14" {...stroke}>
      <path d="M3 4h8M3 7h8M3 10h8" />
    </svg>
  ),
  board: () => (
    <svg width="12" height="12" viewBox="0 0 14 14" {...stroke}>
      <rect x="2.5" y="2.5" width="3.5" height="9" rx="1" />
      <rect x="8" y="2.5" width="3.5" height="6" rx="1" />
    </svg>
  ),
  theme: () => (
    <svg width="13" height="13" viewBox="0 0 14 14" {...stroke}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M7 2.5v9" />
      <path d="M7 2.5a4.5 4.5 0 0 1 0 9z" fill="currentColor" stroke="none" />
    </svg>
  ),
  settings: () => (
    <svg width="13" height="13" viewBox="0 0 14 14" {...stroke}>
      <circle cx="7" cy="7" r="2" />
      <path d="M7 1.6v1.6M7 10.8v1.6M12.4 7h-1.6M3.2 7H1.6M10.8 3.2l-1.1 1.1M4.3 9.7l-1.1 1.1M10.8 10.8 9.7 9.7M4.3 4.3 3.2 3.2" />
    </svg>
  ),
  note: () => (
    <svg width="12" height="12" viewBox="0 0 14 14" {...stroke}>
      <path d="M3 2.5h5.5L11 5v6.5H3z" />
      <path d="M8.5 2.5V5H11" />
    </svg>
  ),
  link: () => (
    <svg width="11" height="11" viewBox="0 0 14 14" {...stroke}>
      <path d="M6 8a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 8 2.5l-1 1" />
      <path d="M8 6a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 6 11.5l1-1" />
    </svg>
  ),
  close: () => (
    <svg width="12" height="12" viewBox="0 0 14 14" {...stroke}>
      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
    </svg>
  ),
  arrowRight: () => (
    <svg width="11" height="11" viewBox="0 0 14 14" {...stroke}>
      <path d="M3 7h8M7.5 3.5 11 7l-3.5 3.5" />
    </svg>
  ),
  calendar: () => (
    <svg width="11" height="11" viewBox="0 0 14 14" {...stroke}>
      <rect x="2.5" y="3" width="9" height="8.5" rx="1" />
      <path d="M2.5 5.5h9M5 2v2M9 2v2" />
    </svg>
  ),
  trash: () => (
    <svg width="12" height="12" viewBox="0 0 14 14" {...stroke}>
      <path d="M3 4h8M5.5 4V2.8h3V4M4 4l.5 7.2h5L10 4" />
    </svg>
  ),
  cycle: () => (
    <svg width="12" height="12" viewBox="0 0 14 14" {...stroke}>
      <path d="M11.5 7a4.5 4.5 0 1 1-1.6-3.4" />
      <path d="M11.6 1.8v2.2H9.4" />
    </svg>
  ),
  today: () => (
    <svg width="12" height="12" viewBox="0 0 14 14" {...stroke}>
      <circle cx="7" cy="7" r="4.8" />
      <path d="M7 4.2V7l2 1.2" />
    </svg>
  ),
  inbox: () => (
    <svg width="12" height="12" viewBox="0 0 14 14" {...stroke}>
      <path d="M2 8.2 3.6 3h6.8L12 8.2v3.3H2z" />
      <path d="M2 8.2h3l.8 1.4h2.4L9 8.2h3" />
    </svg>
  ),
  layers: () => (
    <svg width="12" height="12" viewBox="0 0 14 14" {...stroke}>
      <path d="M7 2 2 4.7 7 7.4l5-2.7z" />
      <path d="M2 8.2 7 11l5-2.8" />
    </svg>
  ),
}
