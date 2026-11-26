# Pi agent config (OnePlus 8T, Termux)

Versioned copies of the Pi coding agent config from `~/.pi/agent` on the phone.

| File | Purpose |
| --- | --- |
| `APPEND_SYSTEM.md` | Extra system prompt for remote, headless use in Termux |
| `extensions/termux-notify.ts` | `notify` tool: Android notification through Termux:API |
| `extensions/bash-guard.ts` | Limits for the bash tool: 300 s without a timeout (1800 s at most), nice 10, and `bin/` first in PATH |
| `bin/cpu-guard` | `bin/grep` and `bin/rg` link to it: the real tool with a CPU-time limit (grep 60 s, rg 120 s; `PI_GUARD_GREP_CPU_S`, `PI_GUARD_RG_CPU_S`) |
| `skills/setup-preset/SKILL.md` | Set up a project from a Git URL |
| `skills/happier-build/SKILL.md` | Commit, push and start the Happier GitHub Actions build |
| `extensions/describe-images.ts` | Describes each image for a model that reads text only, with an image model of your choice; see [Image descriptions](#image-descriptions) |
| `describe-images.json` | The image model on the 8T: `deepseek-router/deepseek-flash` |
| `tests/*.test.mjs` | Tests for the extensions: `node --test termux/pi/tests/*.test.mjs` (Node 24) |
| `models.json` | Model providers; the API keys are placeholders that the router replaces. The DeepSeek base URL has "openrouter.ai" in it, so Pi takes the cost from the router's answer (the model that answered, peak-hours price); `compat` keeps Pi's other OpenRouter rules off and sets DeepSeek's thinking format. Models with `contextWindow ≥ 500000` are capped to `320000` (see [Context budget](#context-budget-compaction)) |

This folder holds no credentials, sessions or `auth.json`. Do not add them.

## Install

From the repository root:

```sh
mkdir -p ~/.pi/agent
cp -R termux/pi/APPEND_SYSTEM.md termux/pi/models.json termux/pi/describe-images.json termux/pi/extensions termux/pi/bin termux/pi/skills ~/.pi/agent/
```

Restart Pi to load the changes.

## Context budget (compaction)

`models.json` caps every model with `contextWindow ≥ 500000` to **320000**. Together with the
compaction settings below, Pi compacts at **256k tokens** instead of letting a session grow toward
the full 1M window — agent cost grows ~C²·⁵, so each doubling of context costs ~6× more.

`settings.json` is device-local and not in this folder; set the same policy there by hand:

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 64000,
    "keepRecentTokens": 40000
  }
}
```

- Threshold = `contextWindow − reserveTokens` = 320000 − 64000 = **256000** tokens.
- `reserveTokens: 64000` also fixes Pi's default of 16384, which caps near-threshold generation
  at ~12k tokens; 64k raises the ceiling to ~60k, needed for long, tool-heavy turns.
- `keepRecentTokens: 40000` keeps the last ~40k tokens verbatim and summarizes the rest. DeepSeek
  summaries are lossy, so the larger keep buffer matters more here than on Claude.
- Models at 200–262k are left unchanged; only the ≥500k models are capped.

To change the budget, raise/lower `contextWindow` (threshold moves 1:1) and keep `reserveTokens`
at the desired near-threshold output headroom.

Sources (2026-08): WorkOS "Stop giving your coding agent a million-token context window"
(Pi-specific; recommends exactly 320000/64000/40000 → 256k); LangWatch "Finding the Optimal
Context Window for Coding Agents" (cost optimum ~220k, operating range 250–450k, lower bound
~110–146k).

## Image descriptions

`extensions/describe-images.ts` has no link to the 8T setup; it works with any Pi providers.

- A model without `"image"` in its `input` cannot read an image. Before each model call, the
  extension puts a text description in the place of each image. An image model writes the
  description once per image; the session stores it, so a resumed session does not pay again.
- The session keeps the image itself. After a switch to a model that reads images, that model gets
  the image.
- The image model, in this order: the flag `--image-model <provider/id>`; `"model"` in
  `~/.pi/agent/describe-images.json` (the command `/image-model [provider/id|auto]` writes it); the
  cheapest model with authentication that reads images.
- The cost of a description is added to the cost of the next answer in the same session.
- When no description can be made, the image stays, and Pi puts its own text
  "(image omitted: model does not support images)" there.
