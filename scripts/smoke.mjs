/**
 * Mount test: renders the whole interface in Node to catch hook and render
 * errors without opening a browser. Run it with: npm run smoke
 */
const noop = () => {}

globalThis.localStorage = {
  getItem: () => null,
  setItem: noop,
  removeItem: noop,
}
globalThis.window = {
  addEventListener: noop,
  removeEventListener: noop,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  innerWidth: 1440,
  innerHeight: 900,
  dispatchEvent: noop,
  location: { href: '' },
}
globalThis.document = {
  documentElement: { dataset: {} },
  addEventListener: noop,
  removeEventListener: noop,
}
globalThis.EventSource = class {
  addEventListener() {}
  close() {}
}
globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '{}' })

const { renderToString } = await import('react-dom/server')
const { createElement } = await import('react')
const { App } = await import('../src/App.tsx')
const { store } = await import('../src/store.ts')

const client = (id, key, name, color, kind) => ({
  id, key, name, color, kind, archived: false, order: 1, note: 'nota',
})
const issue = (id, num, clientId, title, status, priority, extra = {}) => ({
  id, num, clientId, projectId: null, title, body: 'Body with [[a wikilink]] and **bold**',
  status, priority, labels: ['l_ship'], checklist: [{ id: 'k1', text: 'a step', done: true }],
  noteLinks: [{ relPath: 'inbox/a-note.md', label: 'a note' }],
  cycleId: 'cy_1', dueDate: '2026-08-18', order: 1,
  createdAt: '2026-08-17T08:00:00Z', updatedAt: '2026-08-17T08:00:00Z', completedAt: null,
  ...extra,
})

store.state = {
  ...store.state,
  ready: true,
  error: null,
  workspace: {
    version: 1,
    settings: { theme: 'dark', locale: 'en', milestone: { name: 'Launch', date: '2026-09-04' }, weekStartsOn: 1, defaultView: 'today', showDoneDays: 14 },
    clients: [
      client('c_own', 'OWN', 'Own work', '#C9CCD1', 'own'),
      client('c_side', 'SIDE', 'Side project', '#6EA8FE', 'own'),
      client('c_client', 'ACME', 'Example client', '#A78BFA', 'client'),
    ],
    projects: [
      { id: 'p1', clientId: 'c_side', name: 'Build', color: '#7BD88F', archived: false, order: 1 },
      { id: 'p2', clientId: 'c_side', name: 'Launch', color: null, archived: false, order: 2 },
    ],
    cycles: [{ id: 'cy_1', number: 1, name: 'Week 1', startsAt: '2026-08-17', endsAt: '2026-08-23' }],
    counters: {},
    labels: [{ id: 'l_ship', name: 'ship', color: '#E0A458' }],
    createdAt: '2026-08-17',
  },
  issues: [
    issue('i1', 42, 'c_own', 'Landing hero', 'doing', 1),
    issue('i2', 41, 'c_own', 'Pricing — three tiers', 'todo', 2),
    // p1 carries a colour and p2 does not, so both project markers render here.
    issue('i3', 7, 'c_side', 'Module 12', 'waiting', 3, { projectId: 'p1', statusChangedAt: '2026-08-01T08:00:00Z' }),
    issue('i4', 8, 'c_side', 'Closed already', 'done', 0, { projectId: 'p2', completedAt: '2026-08-17T09:00:00Z' }),
    issue('i5', 1, 'c_client', 'Straight from the inbox', 'inbox', 0),
  ],
  currentCycleId: 'cy_1',
  health: {
    ok: true, dev: false,
    paths: { dataDir: '/home/u/solo-ops', dataDirSource: 'default', notesDir: '/home/u/notes', notesDirSource: 'config.json', notesInbox: '/home/u/notes/_Inbox', obsidianVault: null, notesConnected: true },
    sync: { dataDirPresent: true, watching: ['/home/u/solo-ops', '/home/u/solo-ops/issues'], pollMs: 20000, lastPollAt: '2026-08-17T09:05:00Z' },
    notes: { connected: true, dir: '/home/u/notes', inbox: '/home/u/notes/_Inbox', obsidianVault: null, inboxExists: true },
    conflicts: [],
  },
  noteEntries: [
    { name: 'a-capture.md', relPath: '_Inbox/a-capture.md', ext: '.md', kind: 'note', size: 900, modifiedAt: '2026-08-17T07:00:00Z', preview: 'some captured text', lines: 1 },
  ],
}

const scenarios = [
  ['list / today', { view: { kind: 'today' }, display: 'list' }],
  ['list / client + panel', { view: { kind: 'client', clientId: 'c_own', projectId: null }, display: 'list', openIssueId: 'i1' }],
  ['board / everything', { view: { kind: 'all' }, display: 'board', showDone: true }],
  ['inbox', { view: { kind: 'inbox' }, display: 'list' }],
  ['cycle / grouped by client', { view: { kind: 'cycle' }, display: 'list', groupBy: 'client' }],
  ['notes inbox', { view: { kind: 'notes' }, display: 'list' }],
  ['command palette', { view: { kind: 'today' }, paletteOpen: true }],
  ['new issue', { view: { kind: 'today' }, quickAddOpen: true }],
  ['shortcuts', { view: { kind: 'today' }, helpOpen: true }],
  ['settings', { view: { kind: 'today' }, settingsOpen: true }],
  ['empty view', { view: { kind: 'client', clientId: 'c_client', projectId: 'p1' }, display: 'list' }],
]

let failures = 0
for (const [name, patch] of scenarios) {
  store.state = {
    ...store.state,
    paletteOpen: false, quickAddOpen: false, helpOpen: false, settingsOpen: false,
    openIssueId: null, groupBy: 'status', showDone: false, query: '',
    ...patch,
  }
  try {
    const html = renderToString(createElement(App))
    const marker = html.length > 400 ? 'ok' : 'SUSPICIOUSLY SHORT'
    console.log(`  ${marker.padEnd(20)} ${name.padEnd(34)} ${html.length} chars`)
    if (marker !== 'ok') failures++
  } catch (err) {
    failures++
    console.log(`  FAILED               ${name}`)
    console.log(`     ${err.message.split('\n')[0]}`)
  }
}

// --- language: the dictionary has to reach the interface, both ways
const { setLocale } = await import('../src/i18n.ts')
store.state = { ...store.state, view: { kind: 'today' }, display: 'list' }

setLocale('en')
const english = renderToString(createElement(App))
setLocale('pl')
const polish = renderToString(createElement(App))
setLocale('en')

const enOk = english.includes('Today') && !english.includes('Dziś')
const plOk = polish.includes('Dziś') && !polish.includes('>Today<')
console.log(`\n  ${enOk ? 'ok  ' : 'FAIL'}                 english interface`)
console.log(`  ${plOk ? 'ok  ' : 'FAIL'}                 polish interface`)
if (!enOk || !plOk) failures++

console.log(failures ? `\n${failures} check(s) failed` : '\nAll scenarios rendered')
process.exit(failures ? 1 : 0)