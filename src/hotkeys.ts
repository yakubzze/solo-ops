import { useEffect } from 'react'
import { issuesForView, store } from './store'
import type { MessageKey } from './i18n'
import { BOARD_STATUSES, type Priority } from './types'
import { addDays, todayISO } from './util/date'

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null
  if (!el) return false
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  )
}

/** Whether the caret sits somewhere text is typed — the only place Ctrl+Z belongs to the browser. */
const isEditingText = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest('input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable]:not([contenteditable="false"])')
  )
}
/**
 * One global listener instead of shortcuts scattered across components.
 * The "G, then a letter" sequence works like Linear does — the second key has 900 ms.
 */
export function useHotkeys() {
  useEffect(() => {
    let awaitingGoto = false
    let gotoTimer: number | undefined

    const onKey = (e: KeyboardEvent) => {
      const state = store.getSnapshot()
      const mod = e.metaKey || e.ctrlKey

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        /* Narrower than isTyping: there a button counts as a control too, and
           Ctrl+Z on a button should undo a change rather than do nothing. */
        if (isEditingText(e.target)) return
        e.preventDefault()
        void store.undo()
        return
      }

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        store.setPalette(!state.paletteOpen)
        return
      }

      if (isTyping(e.target)) return

      const anyOverlay = state.paletteOpen || state.quickAddOpen || state.helpOpen || state.settingsOpen

      if (e.key === 'Escape') {
        if (state.paletteOpen) return store.setPalette(false)
        if (state.quickAddOpen) return store.setQuickAdd(false)
        if (state.helpOpen) return store.setHelp(false)
        if (state.settingsOpen) return store.setSettings(false)
        if (state.openIssueId) return store.openIssue(null)
        if (state.selection.size) return store.clearSelection()
        if (state.query) return store.setQuery('')
        return
      }

      if (anyOverlay || mod || e.altKey) return

      // --- the "go to" sequence
      if (awaitingGoto) {
        awaitingGoto = false
        window.clearTimeout(gotoTimer)
        const map: Record<string, () => void> = {
          d: () => store.setView({ kind: 'today' }),
          i: () => store.setView({ kind: 'inbox' }),
          c: () => store.setView({ kind: 'cycle' }),
          a: () => store.setView({ kind: 'all' }),
          v: () => store.setView({ kind: 'notes' }),
        }
        const run = map[e.key.toLowerCase()]
        if (run) {
          e.preventDefault()
          run()
        }
        return
      }

      if (e.key.toLowerCase() === 'g') {
        awaitingGoto = true
        gotoTimer = window.setTimeout(() => (awaitingGoto = false), 900)
        return
      }

      const list = issuesForView(state)
      const index = list.findIndex((i) => i.id === state.focusedId)
      const focused = index >= 0 ? list[index] : null

      const move = (delta: number) => {
        if (!list.length) return
        const next = index < 0 ? 0 : Math.min(list.length - 1, Math.max(0, index + delta))
        store.focus(list[next].id)
      }

      switch (e.key) {
        case 'j':
        case 'J':
        case 'ArrowDown':
          e.preventDefault()
          move(1)
          return
        case 'k':
        case 'K':
        case 'ArrowUp':
          e.preventDefault()
          move(-1)
          return
        case 'Enter':
          if (focused) {
            e.preventDefault()
            store.openIssue(focused.id)
          }
          return
        case 'c':
        case 'C':
          e.preventDefault()
          store.setQuickAdd(true)
          return
        case '/':
          e.preventDefault()
          window.dispatchEvent(new Event('solo-ops:focus-search'))
          return
        case '?':
          e.preventDefault()
          store.setHelp(true)
          return
        case 'b':
        case 'B':
          e.preventDefault()
          store.setDisplay(state.display === 'list' ? 'board' : 'list')
          return
        case 'x':
        case 'X':
          if (focused) {
            e.preventDefault()
            store.toggleSelected(focused.id)
          }
          return
        case 'e':
        case 'E':
          if (focused) {
            e.preventDefault()
            store.openIssue(focused.id)
          }
          return
        case 'Backspace':
        case 'Delete': {
          const targets = state.selection.size ? [...state.selection] : focused ? [focused.id] : []
          if (targets.length) {
            e.preventDefault()
            targets.forEach((id) => void store.trashIssue(id))
            store.clearSelection()
          }
          return
        }
        case 's':
        case 'S': {
          // Moves an issue one column to the right — the most common move of the day.
          if (!focused) return
          e.preventDefault()
          const order = BOARD_STATUSES
          const at = order.indexOf(focused.status)
          const next = order[Math.min(order.length - 1, at + 1)] ?? 'todo'
          const ids = state.selection.size ? [...state.selection] : [focused.id]
          void store.patchMany(ids, { status: next })
          return
        }
        case 't':
        case 'T': {
          /* The most common decision of the day is "not today". Without this you
             have to open the panel and walk a menu to move one date. */
          if (!focused) return
          e.preventDefault()
          const ids = state.selection.size ? [...state.selection] : [focused.id]
          const base = focused.dueDate && focused.dueDate > todayISO() ? focused.dueDate : todayISO()
          void store.patchMany(ids, { dueDate: addDays(base, 1) })
          return
        }
        case 'd':
        case 'D': {
          if (!focused) return
          e.preventDefault()
          const ids = state.selection.size ? [...state.selection] : [focused.id]
          void store.patchMany(ids, { status: focused.status === 'done' ? 'todo' : 'done' })
          return
        }
        default:
          break
      }

      if (/^[0-4]$/.test(e.key) && focused) {
        e.preventDefault()
        const ids = state.selection.size ? [...state.selection] : [focused.id]
        void store.patchMany(ids, { priority: Number(e.key) as Priority })
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(gotoTimer)
    }
  }, [])
}

export const SHORTCUTS: { groupKey: MessageKey; items: [string, MessageKey][] }[] = [
  {
    groupKey: 'help.group.move',
    items: [
      ['⌘K / Ctrl K', 'key.palette'],
      ['G then D', 'key.today'],
      ['G then I', 'key.inbox'],
      ['G then C', 'key.cycle'],
      ['G then A', 'key.all'],
      ['G then V', 'key.notes'],
      ['/', 'key.search'],
      ['J / K', 'key.updown'],
      ['Enter', 'key.open'],
      ['Esc', 'key.escape'],
    ],
  },
  {
    groupKey: 'help.group.change',
    items: [
      ['C', 'key.new'],
      ['S', 'key.forward'],
      ['D', 'key.done'],
      ['T', 'key.snooze'],
      ['1 – 4', 'key.prio'],
      ['X', 'key.select'],
      ['Backspace', 'key.trash'],
      ['⌘Z / Ctrl Z', 'key.undo'],
      ['B', 'key.display'],
      ['?', 'key.help'],
    ],
  },
  {
    groupKey: 'help.group.quick',
    items: [
      ['@acme', 'key.quickClient'],
      ['!1 … !4', 'key.quickPrio'],
      ['~tomorrow, ~fri, ~20.08', 'key.quickDue'],
      ['#ship', 'key.quickLabel'],
      ['⇧⏎', 'key.quickSaveOpen'],
    ],
  },
]