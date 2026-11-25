# 8T builds: triggers, caches, and what was measured

Fork-local notes for `build-app.yml`, `build-web.yml`, `build-cli.yml`, `typecheck.yml` and the
composite actions they share. Written after the 25/11-2026 cache investigation; read it before
changing a trigger, a cache key, or the install action.

## Triggers (all push to `sharken/8t`)

| workflow | trigger shape | notes |
|---|---|---|
| `build-app.yml` | include list (`apps/ui/**`, `packages/**`, manifests, `.github/actions/**`, `.github/build-8t/**` minus the two test lists and `protocol-tests.txt`) | an APK run costs 15-50 min, so anything that cannot reach the APK must be carved out |
| `build-web.yml` | `paths-ignore` list | still fires for `docs/`, `apps/stack/`, `dagger/`, `scripts/` pushes; tightening it to an include list is the next known saving |
| `build-cli.yml` | include list (`apps/cli/**`, six `packages/*`, manifests) | misses `.github/actions/**`, `.node-version`, `scripts/postinstall/**` — shared-action breakage is found later |
| `typecheck.yml` | any `typecheck/**` branch, or dispatch | two jobs, each installing; `save-cache` can never be true for the normal trigger |

`concurrency` groups are per workflow, so the web export never cancels the APK build.
`build-app` uses `cancel-in-progress: false` on purpose: a cancelled APK loses up to an hour and
GitHub keeps only the newest waiting run.

## Cache families

| prefix | size | owner of retention |
|---|---|---|
| `modules-v1-<os>-<arch>-<node>-<libc>-<tree>-<scope>-<lockfile hash>` | ~1.6 GB per scope | `publish/action.yml` → `scripts/ci/prune-build-caches.mjs` |
| `setup-java-…-gradle-<hash>` / `setup-gradle-…` | ~2.9 GB | same prune step, keeps the newest 1 |
| `metro-<kind>-v1-…`, `ccache-<kind>-v1-…` | 100-1000 MB | `publish/action.yml`, keeps the newest 1 per kind |
| `sherpa-onnx-android-v1.12.25` | 69 MB | nobody, it never rotates |

The repository budget is 10 GB. On 15/11-2026 the `node_modules` entries filled it and pushed
everything else out, so every build installed from scratch. Retention now runs on every publish:
a `modules` entry is only usable by the exact tree that produced it, so a lockfile or manifest
change makes the previous entry unreachable forever — those are what gets deleted. Scopes are
part of the cache identity, so pruning one workflow's scope can never remove another's live entry.

## The install action: why a hit no longer runs yarn

`.github/actions/install-yarn-dependencies/action.yml`

Measured on this fork's runners: on **every** cache hit the verify step re-linked the whole tree
(~370 s), so a hit saved only the download (~60 s) and cost a restore (~40 s). Root cause, proven
with a temporary instrumented run (`yarn check --integrity` plus a before/after diff of the
integrity file):

- yarn v1's up-to-date bailout compares the **pre-install** parse of `lockfile.cache` against the
  **post-install** `.yarn-integrity` it saved. Every compared field (flags, systemParams,
  linkedModules, topLevelPatterns, lockfileEntries, modulesFolders) was identical before and after
  the re-link, and a re-install reproduced the same file byte for byte — so the bailout is
  unreachable in this workspace repo.
- It is **not** a flag problem. The older `--offline` verify failed in ~1 s with
  `Can't make a request in offline mode` because `flags` is part of the integrity comparison
  (`offline` != `preferOffline`), and the fallback then paid the full re-link silently.

So do not try to make `yarn install` cheap on a hit. The action verifies a structural fingerprint
instead:

- `scripts/ci/dependency-cache-manifest.mjs write` runs on the miss path right before the cache
  save; it hashes a sorted list of every directory, file and symlink (with target) under the cached
  roots plus the bytes of `node_modules/.yarn-integrity`. Measured on the real 386k-entry tree:
  15 s cold, 6 s warm.
- `… verify` runs on the hit path right after the restore: exit 0 match, 1 mismatch, 2 legacy entry
  without a manifest. A match skips `yarn install` **and** the bundle-copy drop, because a
  manifest-bearing cache is saved immediately after install and therefore holds no build leftovers;
  deleting those `apps/*/node_modules/@happier-dev` symlinks and not re-linking could break
  resolution. Any other outcome keeps the old repair path.
- The script path is part of the cache key's `hashFiles`, so entries saved before the manifest
  existed are unreachable and migrate on the next miss.
- `refresh-workspace-postinstall.mjs` still runs on every hit: it owns the outputs that live
  outside `node_modules`.

Result: web cache-hit install 371 s → 50 s, whole web run 630-669 s → 301 s.

## When the numbers look wrong

- `!!`-style warnings in an install step: a mismatch warning means the cached snapshot was damaged
  and was repaired. That entry stays stale — `gh cache delete <id>` and let the next miss recreate
  it.
- `gh cache list --repo Sharken03/my-happier-custom` to see the inventory,
  `node scripts/ci/prune-build-caches.mjs --dry-run` to see what retention would delete.
- To see whether an install ran from cache: the step shows `Cache restored from key: modules-v1-…`
  followed by either `modules cache manifest: MATCH` / `skipping yarn install` or a repair line.
