import { useMemo, useState } from 'react'
import { t, useT } from '../i18n'
import { store, useStore } from '../store'
import { PRIORITY_MAP, type Issue, type Priority } from '../types'
import { addDays, formatDue, todayISO } from '../util/date'
import { Icon, PriorityBars } from './bits'

const WEEKDAYS: Record<string, number> = {
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0,
  pon: 1, wt: 2, sr: 3, czw: 4, pt: 5, sob: 6, nd: 0,
}

/** The next such weekday — today does not count, because "on Tuesday" means the next one. */
function nextWeekday(target: number): string {
  const now = new Date()
  const delta = (target - now.getDay() + 7) % 7 || 7
  return addDays(todayISO(), delta)
}

interface Parsed {
  title: string
  clientId?: string
  priority?: Priority
  dueDate?: string | null
  labels: string[]
  tokens: { text: string; kind: string }[]
}

/**
 * One field instead of a form: "@acme fix the hero !1 ~tomorrow #ship".
 * Anything that is not a token is the title.
 */
function parse(
  input: string,
  clients: { id: string; key: string; name: string }[],
  labels: { id: string; name: string }[]
): Parsed {
  const parsed: Parsed = { title: '', labels: [], tokens: [] }
  const words: string[] = []

  for (const word of input.split(/\s+/)) {
    if (!word) continue

    if (word.startsWith('@') && word.length > 1) {
      const needle = word.slice(1).toLowerCase()
      const client = clients.find(
        (c) => c.key.toLowerCase() === needle || c.name.toLowerCase().startsWith(needle)
      )
      if (client) {
        parsed.clientId = client.id
        parsed.tokens.push({ text: client.name, kind: t('quick.token.client') })
        continue
      }
    }

    if (/^!([0-4])$/.test(word)) {
      const level = Number(word.slice(1)) as Priority
      parsed.priority = level
      parsed.tokens.push({ text: t(PRIORITY_MAP[level].labelKey), kind: t('quick.token.priority') })
      continue
    }

    if (word.startsWith('~') && word.length > 1) {
      const raw = word.slice(1).toLowerCase()
      let date: string | null = null
      if (raw === 'today' || raw === 'dzis' || raw === 'dzisiaj') date = todayISO()
      else if (raw === 'tomorrow' || raw === 'jutro') date = addDays(todayISO(), 1)
      else if (raw === 'pojutrze') date = addDays(todayISO(), 2)
      else if (raw === 'week' || raw === 'tydzien') date = addDays(todayISO(), 7)
      else if (raw in WEEKDAYS) date = nextWeekday(WEEKDAYS[raw])
      else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) date = raw
      else if (/^\d{1,2}\.\d{1,2}$/.test(raw)) {
        const [d, m] = raw.split('.').map(Number)
        date = `${new Date().getFullYear()}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      }
      if (date) {
        parsed.dueDate = date
        parsed.tokens.push({ text: formatDue(date), kind: t('quick.token.due') })
        continue
      }
    }

    if (word.startsWith('#') && word.length > 1) {
      const needle = word.slice(1).toLowerCase()
      const label = labels.find((l) => l.name.toLowerCase().startsWith(needle))
      if (label) {
        parsed.labels.push(label.id)
        parsed.tokens.push({ text: label.name, kind: t('quick.token.label') })
        continue
      }
    }

    words.push(word)
  }

  parsed.title = words.join(' ')
  return parsed
}

export function QuickAdd() {
  const open = useStore((s) => s.quickAddOpen)
  const seed = useStore((s) => s.quickAddSeed)
  const workspace = useStore((s) => s.workspace)
  const view = useStore((s) => s.view)
  const [input, setInput] = useState('')
  useT()

  const parsed = useMemo(
    () => parse(input, workspace?.clients ?? [], workspace?.labels ?? []),
    [input, workspace]
  )

  if (!open || !workspace) return null

  const fallbackClientId =
    seed?.clientId ?? (view.kind === 'client' ? view.clientId : workspace.clients[0]?.id ?? '')
  const clientId = parsed.clientId ?? fallbackClientId
  const client = workspace.clients.find((c) => c.id === clientId)

  const close = () => {
    setInput('')
    store.setQuickAdd(false)
  }

  const submit = async (thenOpen: boolean) => {
    if (!parsed.title.trim()) return
    const issue: Issue = store.draft({
      ...seed,
      clientId,
      title: parsed.title.trim(),
      priority: parsed.priority ?? 0,
      labels: parsed.labels,
      ...(parsed.dueDate !== undefined ? { dueDate: parsed.dueDate } : {}),
    })
    close()
    const saved = await store.createIssue(issue)
    if (saved && thenOpen) store.openIssue(saved.id)
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet" role="dialog" aria-label={t('quick.title')} style={{ width: 'min(560px, 92vw)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 14px', borderBottom: '1px solid var(--line)' }}>
          <span className="client-dot" style={{ ['--client-color' as string]: client?.color }} />
          <span className="panel-key">{client?.key ?? '—'}</span>
          <input
            className="sheet-input"
            style={{ borderBottom: 'none', paddingLeft: 4 }}
            autoFocus
            value={input}
            placeholder={t('quick.placeholder')}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') close()
              if (e.key === 'Enter') {
                e.preventDefault()
                void submit(e.shiftKey)
              }
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', flexWrap: 'wrap', minHeight: 40 }}>
          {parsed.tokens.length === 0 ? (
            <span className="sheet-hint">{t('quick.hint')}</span>
          ) : (
            parsed.tokens.map((token, i) => (
              <span key={i} className="tag" style={{ ['--tag-color' as string]: 'var(--accent)' }}>
                {token.kind}: {token.text}
              </span>
            ))
          )}
          {parsed.priority ? <PriorityBars priority={parsed.priority} /> : null}
        </div>

        <div className="sheet-foot">
          <span className="sheet-hint">{t('quick.save')}</span>
          <span className="sheet-hint">{t('quick.saveOpen')}</span>
          <button
            className="ghost-btn"
            data-variant="accent"
            style={{ marginLeft: 'auto' }}
            disabled={!parsed.title.trim()}
            onClick={() => void submit(false)}
          >
            <Icon.plus /> {t('quick.add')}
          </button>
        </div>
      </div>
    </div>
  )
}
