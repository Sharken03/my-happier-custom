---
name: setup-preset
description: Set up a project in Termux from a Git URL - clone it, install its dependencies with the project's own package manager, and run its linter.
---

# Set up a project from a Git URL

1. Clone into the current folder: `git clone -- "<url>"`. Stop if the target folder already exists.
2. `cd` into the clone. Pick the package manager from the lockfile: `pnpm-lock.yaml` → pnpm,
   `yarn.lock` → yarn, `bun.lock` or `bun.lockb` → bun, `package-lock.json` → npm. Without a
   lockfile, ask.
3. Install with lifecycle scripts off first (`--ignore-scripts`). Run scripts only if the project
   needs them and the person agrees: they run code from the repository.
4. Run the project's lint script if `package.json` has one. Report the result in one line.
5. Android: a native addon that needs a build may fail in Termux. Report it; do not install
   toolchains without asking.
