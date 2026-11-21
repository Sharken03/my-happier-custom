// Describes images for a model that reads text only. Before each model call, each image in the
// conversation becomes a text description that an image model wrote. The session keeps the image
// itself, so a later switch to a model that reads images sends the image again.
//
// The image model:
//   1. the flag --image-model <provider/id>
//   2. "model" in <agent dir>/describe-images.json, set with the command /image-model
//   3. the cheapest model with authentication that reads images
// One image gets one description per session; it is stored in the session, so a resumed session
// does not pay again. The cost of a description is added to the next answer's cost.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Api, ImageContent, Model, TextContent } from "@earendil-works/pi-ai";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";

const ENTRY_TYPE = "describe-images";
const CONFIG_FILE = "describe-images.json";
const AUTO = "auto";
/** The longest part of the user's request that the image model gets, in characters. */
const REQUEST_CHARS = 2000;

const INSTRUCTIONS = [
  "You describe an image for another AI model that cannot see images.",
  "That model must do the user's request from your description alone.",
  "Transcribe all visible text exactly, in its original language and in reading order.",
  "Describe the layout, the UI elements and their state, numbers, colours that carry meaning,",
  "charts (axes, values, trends) and anything unusual.",
  "Do not answer the user's request and do not give advice.",
].join(" ");

type Block = TextContent | ImageContent;
type Stored = { hash: string; model: string; text: string };

const nameOf = (model: Model<Api>) => `${model.provider}/${model.id}`;
const hashOf = (image: ImageContent) => createHash("sha256").update(image.data).digest("hex");

/** The content blocks of a message that can hold images: user messages and tool results. */
function blocksOf(message: { role: string; content?: unknown }): Block[] | undefined {
  if (message.role !== "user" && message.role !== "toolResult") return undefined;
  return Array.isArray(message.content) ? (message.content as Block[]) : undefined;
}

function readConfiguredModel(): string {
  try {
    const model = JSON.parse(readFileSync(join(getAgentDir(), CONFIG_FILE), "utf8")).model;
    return typeof model === "string" && model ? model : AUTO;
  } catch {
    return AUTO;
  }
}

export default function (pi: ExtensionAPI) {
  const descriptions = new Map<string, Stored>();
  // The cost of the descriptions made since the last answer, in USD.
  let pendingCost = 0;
  let warned = "";

  pi.registerFlag("image-model", {
    description: "Model that describes images for a model that reads text only (provider/id)",
    type: "string",
  });

  const wantedModel = () => {
    const flag = pi.getFlag("image-model");
    return typeof flag === "string" && flag ? flag : readConfiguredModel();
  };

  const usable = (ctx: ExtensionContext, model: Model<Api> | undefined) =>
    model && model.input.includes("image") && ctx.modelRegistry.hasConfiguredAuth(model) ? model : undefined;

  /** The model that describes images, or undefined when no model with authentication reads images. */
  const imageModel = (ctx: ExtensionContext): Model<Api> | undefined => {
    const wanted = wantedModel();
    if (wanted !== AUTO) {
      const slash = wanted.indexOf("/");
      const found = usable(ctx, ctx.modelRegistry.find(wanted.slice(0, slash), wanted.slice(slash + 1)));
      if (found) return found;
    }
    const candidates = ctx.modelRegistry.getAvailable().filter((model) => usable(ctx, model));
    return candidates.sort((a, b) => a.cost.input - b.cost.input)[0];
  };

  const warnOnce = (ctx: ExtensionContext, text: string) => {
    if (warned === text) return;
    warned = text;
    if (ctx.hasUI) ctx.ui.notify(text, "warning");
  };

  const describe = async (ctx: ExtensionContext, model: Model<Api>, image: ImageContent, request: string) => {
    const focus = request ? `\n\nThe user's request, for focus only:\n${request}` : "";
    const response = await ctx.modelRegistry.complete(
      model,
      { messages: [{ role: "user", content: [{ type: "text", text: INSTRUCTIONS + focus }, image], timestamp: Date.now() }] },
      { signal: ctx.signal, cacheRetention: "none" },
    );
    const text = response.content
      .filter((part): part is TextContent => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (response.stopReason === "error" || !text) throw new Error(response.errorMessage ?? "no description");
    pendingCost += response.usage.cost.total;
    return text;
  };

  pi.on("session_start", (_event, ctx) => {
    descriptions.clear();
    pendingCost = 0;
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
      const stored = entry.data as Stored;
      descriptions.set(stored.hash, stored);
    }
  });

  pi.on("context", async (event, ctx) => {
    const active = ctx.model;
    if (!active || active.input.includes("image")) return;
    const images = new Map<string, ImageContent>();
    let request = "";
    for (const message of event.messages) {
      const blocks = blocksOf(message);
      if (!blocks) {
        if (message.role === "user" && typeof message.content === "string") request = message.content;
        continue;
      }
      for (const block of blocks) if (block.type === "image") images.set(hashOf(block), block);
      const text = blocks.filter((block): block is TextContent => block.type === "text").map((block) => block.text).join("\n");
      if (message.role === "user" && text.trim()) request = text;
    }
    if (images.size === 0) return;

    const missing = [...images].filter(([hash]) => !descriptions.has(hash));
    if (missing.length > 0) {
      const model = imageModel(ctx);
      if (!model) {
        warnOnce(ctx, "describe-images: no model with authentication reads images; set one with /image-model");
        return;
      }
      const results = await Promise.allSettled(
        missing.map(([, image]) => describe(ctx, model, image, request.trim().slice(0, REQUEST_CHARS))),
      );
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          warnOnce(ctx, `describe-images: ${nameOf(model)} gave no description (${String(result.reason?.message ?? result.reason)})`);
          return;
        }
        const stored = { hash: missing[index][0], model: nameOf(model), text: result.value };
        descriptions.set(stored.hash, stored);
        pi.appendEntry(ENTRY_TYPE, stored);
      });
    }

    // An image without a description stays; Pi then puts its own placeholder there.
    const messages = event.messages.map((message) => {
      const blocks = blocksOf(message);
      if (!blocks?.some((block) => block.type === "image")) return message;
      const content = blocks.map((block): Block => {
        const stored = block.type === "image" ? descriptions.get(hashOf(block)) : undefined;
        if (!stored) return block;
        return {
          type: "text",
          text: `[An image was here. ${nameOf(active)} reads text only, so ${stored.model} described the image:]\n${stored.text}\n[End of the image description.]`,
        };
      });
      return { ...message, content } as typeof message;
    });
    return { messages };
  });

  pi.on("message_end", (event) => {
    const message = event.message;
    if (message.role !== "assistant" || pendingCost === 0) return;
    const cost = { ...message.usage.cost, total: message.usage.cost.total + pendingCost };
    pendingCost = 0;
    return { message: { ...message, usage: { ...message.usage, cost } } };
  });

  pi.registerCommand("image-model", {
    description: "Choose the model that describes images for a model that reads text only",
    handler: async (args, ctx) => {
      let choice = args.trim();
      if (!choice && ctx.hasUI) {
        const models = ctx.modelRegistry.getAvailable().filter((model) => usable(ctx, model)).map(nameOf);
        choice = (await ctx.ui.select(`Image model (now: ${wantedModel()})`, [AUTO, ...models])) ?? "";
      }
      if (!choice) {
        const model = imageModel(ctx);
        ctx.ui.notify(`Image model: ${wantedModel()}${model ? ` -> ${nameOf(model)}` : " (no usable model)"}`, "info");
        return;
      }
      if (choice !== AUTO) {
        const slash = choice.indexOf("/");
        if (!usable(ctx, ctx.modelRegistry.find(choice.slice(0, slash), choice.slice(slash + 1)))) {
          ctx.ui.notify(`${choice} is not a model with authentication that reads images`, "error");
          return;
        }
      }
      writeFileSync(join(getAgentDir(), CONFIG_FILE), `${JSON.stringify({ model: choice }, null, 2)}\n`);
      ctx.ui.notify(`Image model: ${choice}`, "info");
    },
  });
}
