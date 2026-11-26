# 8T builds: triggers, caches, and what was measured

Fork-local notes for `build-app.yml`, `build-web.yml`, `build-cli.yml`, `typecheck.yml` and the
composite actions they share. Written after the 25/11-2026 cache investigation; read it before
changing a trigger, a cache key, or the install action.

## Triggers (all push to `sharken/8t`)

| workflow | trigger shape | notes |
|---|---|---|
| `build-app.yml` | include list (`apps/ui/**`, `packages/**`, manifests, `.github/actions/**`, `.github/build-8t/**`) with every exclusion last (`ui-tests.txt`, `cli-tests.txt`, `protocol-tests.txt`, `apps/ui/public/**`, markdown) | an APK run costs 15-50 min, so anything that cannot reach the APK must be carved out |
| `build-web.yml` | `paths-ignore` list | still fires for `docs/`, `apps/stack/`, `dagger/`, `scripts/` pushes; tightening it to an include list is the next known saving |
| `build-cli.yml` | include list (`apps/cli/**`, six `packages/*`, manifests) | misses `.github/actions/**`, `.node-version`, `scripts/postinstall/**` — shared-action breakage is found later |
| `typecheck.yml` | any `typecheck/**` branch, or dispatch | two jobs, each installing; `save-cache` can never be true for the normal trigger |

**Order of `paths` matters.** GitHub evaluates an include list in order, so a positive pattern
placed after an exclusion re-includes what the exclusion removed. On 26/11-2026 a push that only
added `.github/build-8t/README.md` started a full APK build, because `.github/build-8t/**` was
listed after `!**/*.md`. Every exclusion now sits at the end of the list, and
`scripts/ci/build-trigger-paths.test.mjs` fails if a positive pattern is added after one.

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

## Is the Gradle cache worth its ~80-100 s and 2.9 GB?

Measured 26/11-2026, same commit, `gh workflow run build-app.yml -f gradle_cache=false` against the
normal push run:

| | with cache | without cache (`cache-disabled`) |
|---|---|---|
| `Setup Gradle (with cache)` | 104 s | 5 s |
| `Gradle assembleRelease` | 271 s | **failed after 45 s** |
| result | published (the 403 below is unrelated) | `Could not resolve com.google.code.gson:gson:2.9.1 … Received status code 429` |

So the comparison is not "80 s of restore versus N minutes of assembla": without the cache the
build has to pull every Maven and plugin dependency in one burst and Maven Central rate-limits it,
so the build cannot complete at all on a 2-CPU runner. Keep the cache. A cold Gradle build is not
a slower build here, it is a broken one.

The `gradle_cache` dispatch input stays as the lever to re-measure this (push runs always keep the
cache). Two things to know when using it:

- **Do not dispatch while a push run is queued for the same ref.** `cancel-in-progress: false`
  keeps the *running* build, but GitHub replaces any *pending* run in the group with the newer
  one — a dispatch therefore cancels a queued push run (it happened to `45719164446`).
- A cache that is disabled also means the *modules* cache shows its real miss cost in the same
  run: 346 s, against 63 s for a manifest hit.

## Publish 403

`gh release create` answered `HTTP 403: Resource not accessible by integration` three times in a
row on run `45717579607` (26/11-2026), losing a completed 20-minute APK to the artifact path. The
token had `contents: write`; the same workflow published minutes earlier and later.

The retry is now minutes long instead of 90 s: `scripts/ci/publish-retry.mjs` classifies the failure
and returns the next delay (30, 60, 120, 240 s — five tries, ~7.5 min of waiting), or refuses at
once for a 4xx that cannot improve (401, 404, 422, `already_exists`). An unrecognised `gh` message is
retried, because the tag is deleted before every try, so a wrong guess costs a sleep rather than a
malformed release. The four sleeps fit the APK job's 90-minute budget with ~60 min to spare.

A misconfigured `permissions:` block would produce the same 403 wording, so the publish step probes
`GET /repos/{repo}` → `permissions.push` before it starts: an explicit `false` fails the step at once
with the reason, while a missing field (some token types) is ignored so a valid publish is never
blocked. The probe cannot distinguish an incident from a revoked scope mid-run — the 403 itself is
still retried, which is the intent.

`already_exists` is only a real conflict when this step did *not* just fail to delete its own
half-created release: the helper receives `--cleanup-failed` in that case and retries instead of
failing fast, so a transient delete failure no longer costs the build.

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
