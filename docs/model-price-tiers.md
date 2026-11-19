# Model price tiers in the model picker

Decision record for showing a price level (`$` … `$$$$`) instead of exact per-token
numbers in the model picker. Status: implemented in the new-session model picker (expanded list and compact dropdown).

## Decision: the price level is independent of thinking level

The band is a property of the model, not of the selected thinking/effort level.
Selecting `high` instead of `low` must not change the symbol.

Evidence (OpenRouter catalog, 445 models, 2026-11-19):

- Every model has `pricing.completion`; 36 also carry `pricing.internal_reasoning`.
- Only 1 of those 36 charges a different reasoning rate:
  `perplexity/sonar-deep-research` (output $8, reasoning $3 per 1M) — cheaper, and it
  does not cross any band boundary.
- Reasoning tokens are billed as output tokens. A higher effort level therefore buys
  more output tokens, not a different rate: the cost per call rises, the band does not.

Consequences:

- Do not render ranges such as `$$–$$$`; today that would be noise for 0 models.
- Revisit only if a model's reasoning rate differs **and** crosses a band boundary.
- Effort-dependent information, if ever shown, belongs in the model detail view
  ("output price includes reasoning tokens"), never in the row symbol.
- `models.json` cannot express per-thinking-level prices (`cost` has only `input`,
  `output`, `cacheRead`, `cacheWrite` and input-token `tiers`), so no schema change.
- Levels a model does not support (see `thinkingLevelMap`) need no special handling.

## Band definition

`blend = input + 3 × output`, in USD per 1M tokens (3:1 output:input is the typical
session mix). Thresholds chosen with k-means on `log10(blend)` over the 376 analyzable
models (61 `:batch` variants and 8 sentinel-priced entries excluded):

| band | rule |
| --- | --- |
| `free` | input = output = 0 |
| `?` | unknown or sentinel price (catalog uses `-1000000` for `openrouter/auto*`, `nvidia/switchyard`, `typesafe/jev-router`) |
| `$` | 0 < blend ≤ 1.25 |
| `$$` | ≤ 7 |
| `$$$` | ≤ 36 |
| `$$$$` | > 36 |

Each step is ≈ ×5.7, matching the log-normal price distribution; the median model lands
at `$$$`. Resulting split over the catalog: 62 / 124 / 121 / 52 plus 17 free.

## Display

A fixed-width column (~44 px) right-aligned between the row subtitle and the favorite
star, so the stars and the selected check mark stay on the same x for every row.

- Symbols in the mono variant, `text.secondary`, slight letter-spacing: `$` reads as one
  unit instead of four loose characters.
- Free renders nothing: no badge, no `$0`, no empty placeholder. A free model simply has no
  marker where paid models show their level.
- Unknown or sentinel prices render nothing either, which is the same visual outcome as
  free and therefore needs no separate glyph.
- No colour coding by price level: expensive is not an error state.
- Accessibility: the column announces `Cost: 3/4` (reusing the existing `usage.cost` key), so a
  screen reader does not read "dollar dollar dollar". Free and unpriced rows announce nothing
  because they show nothing.
- No translation keys are needed at all: the symbols are language-neutral and the free
  tier is silent.

Rejected: putting the symbol at the end of the subtitle. It disappears exactly on the
narrow screens where it matters, and it turns the subtitle into a mixed-purpose string.

## Implementation notes

- Prices travel as `costInputPerMTok` / `costOutputPerMTok` from Pi's registry through the
  catalog entry, the preflight probe and the session-model state into the row. Three hops
  strip unknown keys unless they are named explicitly: the nested zod schemas in
  `storageTypes.ts`, the session-control schema, and `sessionModelsSeedPublish.ts`.
- `PERSIST_VERSION` in `dynamicModelProbeCache.ts` is bumped so preflight lists cached
  before the fields existed are discarded instead of showing unpriced rows for 30 days.
- The new-session picker auto-collapses to the compact dropdown above 8 models, so both
  presentations render the column from the same `ModelPriceColumn` component.
- The in-session model picker (`ModelPickerOverlay.tsx`) does not render the level yet; it
  is the remaining surface.

## Where the numbers come from

Read `cost.input` / `cost.output` from the provider-scoped model metadata that Pi already
reports per model. Do not look prices up in the OpenRouter catalog by id: provider-scoped
ids such as `deepseek-router/deepseek-flash` do not exist there and would render as `?`.

## Current data

Operator constraint: 8 paid + 3 free models in the `openrouter-router` list
(`~/.pi/agent/models.json`).

```
free   inclusionai/ling-3.2-flash:free
free   nvidia/nemotron-3.5-super-vl:free
free   google/gemma-4-26b-a4b-it:free
$      deepseek/deepseek-v4-flash     0.09 / 0.18
$$     openai/gpt-6-luna-pro           0.1 / 0.5
$$$    google/gemini-4-hydrogen        1.5 / 7.5
$$$    x-ai/grok-4.7                   2 / 6
$$$    openai/gpt-6.2-sol-pro          2 / 10
$$$    qwen/qwen4-max                  1.425 / 4.275
$$$$   anthropic/claude-opus-5.5       4 / 20
$$$$   openai/gpt-6.2-astra-pro        8 / 40
```

`$` and `$$` are the thin bands (one model each); `$$$` carries four, including two
near-duplicates (`gemini-4-hydrogen` vs `qwen/qwen4-max`, `sol-pro` vs `grok-4.7`).
