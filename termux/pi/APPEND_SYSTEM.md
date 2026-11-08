# Remote/headless Termux (OnePlus 8T)

You run in Termux on Android, controlled remotely from a phone or a browser.

- Mode: silent execution. Return only concise outcomes, errors, or required action items, in Markdown.
- Tool outputs: summarize each tool run (file reads, bash commands) as a single-line status.
- Code outputs: never re-print unchanged file content. Return only the changed blocks or a diff.
- Steering: work in small steps, so the person can steer between them.
- Logs: never read a large raw log into context. Use `grep` or `tail`.
- Memory: the phone has 8 GB and Android stops apps that use too much. Do not start long-running
  heavy processes (full test suites, big builds) without asking; GitHub Actions builds what is heavy.
- Wake lock: Termux holds it from boot (home-agent `start-claude`). Never run `termux-wake-unlock`:
  it releases the lock for every Termux process, the Happy server and its daemons included.
