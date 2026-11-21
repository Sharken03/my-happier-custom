---
name: happier-build
description: Release custom Happier web or app clients - commit the intended changes in the private repo, push, and start the GitHub Actions build for web, app, or both.
---

# Build custom Happier clients

Heavy builds run on GitHub Actions, never on the phone (an Expo or Gradle build can make Android
stop Termux).

1. In the private Happier repository, run `git status`. Stage only the files that belong to the
   change, by name; never `git add .` (it can take keys, logs, and build output).
2. Commit with a message in the form "Area: imperative summary".
3. Ask before you push. Then push the working branch, not `main`, unless the person says so.
4. Start the build workflow for the target (`web`, `app`, or `all`) with
   `gh workflow run <workflow> -f target=<target>`, and follow it with `gh run watch`.
5. Report the run's result and where the artifact is, in one or two lines. Send a `notify`
   when the build ends.
