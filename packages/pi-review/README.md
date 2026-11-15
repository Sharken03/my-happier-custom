# pi-review

Offline code review for [Pi](https://pi.dev): gather a git diff, ask the model,
and write `ReviewFindingsV2`-compatible findings — the same shape Happier parses,
without depending on `@happier-dev/protocol`.

## Install

From the Happier checkout (local path):

```bash
pi install ./packages/pi-review
```

or copy the directory into `~/.pi/agent/extensions/pi-review/` and run
`npm install` inside it so `zod` resolves. `pi install` from npm/git installs
`dependencies` automatically; a local path does not, so `npm install` the
package once if you use it locally.

## Usage

Slash command:

```text
/review [--change-type uncommitted|committed|all] [--base <branch|commit>]
        [--model <provider/modelId>] [--depth fast|deep] [--instructions <text...>]
```

Tool (callable by the model):

```text
review { changeType?, base?, model?, depth?, instructions? }
```

- `--change-type uncommitted` (default) — uncommitted tracked changes + untracked
  files; `committed` — `<base>...HEAD`; `all` — both.
- `--base <ref>` — base for committed/all scopes; omit to use `@{upstream}` or
  the remote default branch.
- `--model <provider/modelId>` — a fixed Pi model (or a bare model id).
- `--depth fast|deep` — uses the `PI_REVIEW_FAST_MODEL` /
  `PI_REVIEW_DEEP_MODEL` environment variables as the pair. Offline pi-review has
  no account/engine policy to name the pair, so it fails loudly if they are
  unset.
- Passing both `--model` and `--depth` is an error (`review_model_policy_conflict`).

Output is written to `.happier/review/<runId>.json` relative to the working
directory. `runId`/`callId` are generated locally and `backendId` is `'pi'`; no
`publication` overlay is written (that is Happier-only state). The resolved
model policy rides along as passthrough keys (`requestedConfiguration`,
`modelPolicy`, `depth`).

## Notes / divergences from Happier

- Happier's LLM review engines compute no diff (the model reads files itself);
  pi-review inlines the diff into the prompt instead.
- `--model` names a Pi model (`provider/modelId`), not a Happier model id.
- Scope resolution mirrors Happier's CodeRabbit preflight git commands; see the
  header comment in `src/diffScope.ts` for the exact edge cases and the two
  documented divergences.
