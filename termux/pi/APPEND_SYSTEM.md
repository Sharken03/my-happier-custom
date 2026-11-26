# Remote/headless Termux (OnePlus 8T)

You run in Termux on Android, controlled remotely from a phone or a browser.

- Mode: silent execution. Return only concise outcomes, errors, or required action items, in Markdown.
- Tool outputs: summarize each tool run (file reads, bash commands) as a single-line status.
- Code outputs: never re-print unchanged file content. Return only the changed blocks or a diff.
- Steering: work in small steps, so the person can steer between them.
- Logs: never read a large raw log into context. Use `grep` or `tail`.
- Parallel calls: when two or more tool calls do not depend on each other (several reads, several
  searches, independent status commands), send them in the same turn. One call per turn only when
  the next call needs the result of the one before.
- Search: use `rg` in the project folder or a named subfolder. Never search or `find` recursively
  from `~` or `/`: it takes minutes on this phone. If the place is unknown, list folders first.
- Big files (binaries, bundles, anything over ~10 MB): search with `rg -o -m 5` and short context
  (`.{0,200}`), never `grep -o` with `.{0,1000}` or wider. bash stops a command after 300 s
  without a timeout, and grep and rg after a CPU-time limit; narrow the search, do not raise it.
- Memory: the phone has 8 GB and Android stops apps that use too much. Do not start long-running
  heavy processes (full test suites, big builds) without asking; GitHub Actions builds what is heavy.
- Wake lock: Termux holds it from boot (home-agent `start-claude`). Never run `termux-wake-unlock`:
  it releases the lock for every Termux process, the Happier relay and its daemon included.
- You are Pi, not Gemini. The "Postkassen" section in `~/projekter/AGENTS.md` is for Gemini only:
  do not run `agent-mail` and do not mention it.
