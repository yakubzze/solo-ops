/**
 * The starting state. Three placeholder clients, not because anyone works this way,
 * but because an empty tracker teaches you nothing about how this one is shaped.
 * Rename or delete all of them in Settings — nothing else depends on these names.
 */

const today = () => new Date().toISOString().slice(0, 10)

export function seedWorkspace() {
  return {
    version: 1,
    settings: {
      theme: 'dark',
      locale: 'en',
      // A countdown in the top bar. Set it to something real or clear it in Settings.
      milestone: null,
      weekStartsOn: 1,
      defaultView: 'today',
      showDoneDays: 14,
    },
    clients: [
      {
        id: 'c_own',
        key: 'OWN',
        name: 'Own work',
        note: 'The thing you would keep doing if nobody paid you.',
        color: '#C9CCD1',
        kind: 'own',
        archived: false,
        order: 1,
      },
      {
        id: 'c_side',
        key: 'SIDE',
        name: 'Side project',
        note: 'Rename this, or delete it in Settings.',
        color: '#6EA8FE',
        kind: 'own',
        archived: false,
        order: 2,
      },
      {
        id: 'c_client',
        key: 'ACME',
        name: 'Example client',
        note: 'Client work sits in its own group — see the sidebar.',
        color: '#A78BFA',
        kind: 'client',
        archived: false,
        order: 3,
      },
    ],
    projects: [
      { id: 'p_site', clientId: 'c_own', name: 'Website', color: null, archived: false, order: 1 },
      { id: 'p_build', clientId: 'c_side', name: 'Build', color: null, archived: false, order: 1 },
    ],
    cycles: [],
    counters: {},
    labels: [
      { id: 'l_ship', name: 'ship', color: '#E0A458' },
      { id: 'l_build', name: 'build', color: '#6EA8FE' },
      { id: 'l_admin', name: 'admin', color: '#8B8E96' },
      { id: 'l_research', name: 'research', color: '#A78BFA' },
      { id: 'l_bug', name: 'bug', color: '#FF5C5C' },
    ],
    createdAt: today(),
  }
}

/** Three issues that teach the interface and delete themselves once they have. */
export function seedIssues(clientId) {
  const now = new Date().toISOString()
  const base = {
    clientId,
    projectId: null,
    status: 'inbox',
    priority: 0,
    labels: [],
    checklist: [],
    noteLinks: [],
    cycleId: null,
    dueDate: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  }
  return [
    {
      ...base,
      id: 'i_welcome_1',
      num: 1,
      title: 'Press ? — the whole keyboard on one screen',
      body:
        'This is built for the keyboard.\n\n' +
        '- `C` creates an issue from anywhere\n' +
        '- `⌘K` / `Ctrl K` opens the command palette — jump to a client, change a status, anything\n' +
        '- `J` / `K` move through the list, `Enter` opens\n' +
        '- `1`–`4` set priority on whatever is highlighted\n\n' +
        'Done reading? Press `Backspace` and this goes to the trash, where you can still get it back.',
      order: 1,
    },
    {
      ...base,
      id: 'i_welcome_2',
      num: 2,
      title: 'Your data is a folder you can read',
      body:
        'Every client gets its own JSON file under `issues/`. Separate files mean work on one ' +
        'client never touches another one\'s file — which matters the moment you sync the folder ' +
        'between machines.\n\n' +
        'The server holds two lines you can rely on:\n' +
        '- it **will not overwrite a file that changed underneath it** — it reloads instead of clobbering\n' +
        '- it **reports sync conflict copies** like `workspace 2.json` and never deletes them itself\n\n' +
        'Settings → data shows the exact folder.',
      order: 2,
    },
    {
      ...base,
      id: 'i_welcome_3',
      num: 3,
      title: 'Point it at your notes',
      body:
        'Set `notesDir` in `config.json` to any folder of Markdown — an Obsidian vault, a plain ' +
        'notes directory, or an [agent-ops](https://github.com/yakubzze/agent-ops) memory store.\n\n' +
        'Then the **Notes** tab shows what is sitting in your inbox, and one click turns an entry ' +
        'into an issue with the note still linked. It works the other way too: `[[wikilink]]` in a ' +
        'description resolves against your notes, and the panel can write an issue back out as a note.',
      order: 3,
    },
  ]
}
