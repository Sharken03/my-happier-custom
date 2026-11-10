# Pi agent config (OnePlus 8T, Termux)

Versioned copies of the Pi coding agent config from `~/.pi/agent` on the phone.

| File | Purpose |
| --- | --- |
| `APPEND_SYSTEM.md` | Extra system prompt for remote, headless use in Termux |
| `extensions/termux-notify.ts` | `notify` tool: Android notification through Termux:API |
| `skills/setup-preset/SKILL.md` | Set up a project from a Git URL |
| `skills/happier-build/SKILL.md` | Commit, push and start the Happier GitHub Actions build |
| `models.json` | Model providers; the API keys are placeholders that the router replaces. Each model has `"image"` in `input`: the router sends an image for a model that reads text only to DS Flash |

This folder holds no credentials, sessions or `auth.json`. Do not add them.

## Install

From the repository root:

```sh
mkdir -p ~/.pi/agent
cp -R termux/pi/APPEND_SYSTEM.md termux/pi/models.json termux/pi/extensions termux/pi/skills ~/.pi/agent/
```

Restart Pi to load the changes.
