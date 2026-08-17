@AGENTS.md

<!--
  The Claude Code adapter, following the agent-ops convention.

  Claude Code reads CLAUDE.md and does not read AGENTS.md natively. `@AGENTS.md`
  above is Claude Code's import syntax, not a Markdown link — it pulls the shared
  file into context at session start. Keep it as the first line.

  Everything below is genuinely Claude Code-specific. Shared guidance belongs in
  AGENTS.md; two copies drift, and the next session cannot tell which is stale.
-->

## Claude Code

**Memory location.** Auto memory defaults to `~/.claude/projects/<project>/memory/`,
keyed by where this repository sits — so moving or re-cloning the checkout starts
an empty memory and nothing warns you. Pin it with `autoMemoryDirectory` in
`.claude/settings.local.json`. The value must be absolute or start with `~/`.
This is the same failure that invariant 1 in AGENTS.md protects the user's data
from; it applies to your notes about the code too.

**Do not run the dev server to "check" a change.** It binds port 4321 and stays
up. Run `npm run smoke` instead — it renders every interface state in Node and
exits. Start a server only when you actually need to look at pixels, and stop it
afterwards.

**Never point a test at the real store.** `SOLO_OPS_DATA_DIR` takes a throwaway
path; use it. The default is `~/solo-ops`, which on a contributor's machine holds
their real work.

**When touching `server/store.mjs`, verify both directions.** It is easy to stop
false reloads by disabling the watcher, and easy to stop stale writes by refusing
everything. Prove that a genuine external change is still detected and that a
normal write still succeeds — one without the other is not a fix.
