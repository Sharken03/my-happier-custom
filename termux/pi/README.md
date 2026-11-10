# Pi agent config (OnePlus 8T, Termux)

Versioned copies of the Pi coding agent config from `~/.pi/agent` on the phone.

| File | Purpose |
| --- | --- |
| `APPEND_SYSTEM.md` | Extra system prompt for remote, headless use in Termux |
| `extensions/termux-notify.ts` | `notify` tool: Android notification through Termux:API |
| `skills/setup-preset/SKILL.md` | Set up a project from a Git URL |
| `skills/happier-build/SKILL.md` | Commit, push and start the Happier GitHub Actions build |
| `extensions/describe-images.ts` | Describes each image for a model that reads text only, with an image model of your choice; see [Image descriptions](#image-descriptions) |
| `describe-images.json` | The image model on the 8T: `deepseek-router/deepseek-flash` |
| `tests/describe-images.test.mjs` | Tests for the extension: `node --test termux/pi/tests/describe-images.test.mjs` (Node 24) |
| `models.json` | Model providers; the API keys are placeholders that the router replaces. The DeepSeek base URL has "openrouter.ai" in it, so Pi takes the cost from the router's answer (the model that answered, peak-hours price); `compat` keeps Pi's other OpenRouter rules off and sets DeepSeek's thinking format |

This folder holds no credentials, sessions or `auth.json`. Do not add them.

## Install

From the repository root:

```sh
mkdir -p ~/.pi/agent
cp -R termux/pi/APPEND_SYSTEM.md termux/pi/models.json termux/pi/describe-images.json termux/pi/extensions termux/pi/skills ~/.pi/agent/
```

Restart Pi to load the changes.

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
