/**
 * pi-review extension entry point.
 *
 * Registers:
 *  - `/review` slash command (registerCommand) — parses `--change-type`,
 *    `--base`, `--model`, `--depth`, `--instructions` (see parseCliArgs).
 *  - a `review` tool (registerTool) — same parameters as structured input.
 *
 * Both call the shared `runReview` core in review.ts.
 */
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { runReview, type ReviewModelHost } from "./review.js";

const changeTypeEnum = Type.Union([
  Type.Literal("uncommitted"),
  Type.Literal("committed"),
  Type.Literal("all"),
]);
const depthEnum = Type.Union([Type.Literal("fast"), Type.Literal("deep")]);

type ReviewCliFlags = {
  changeType?: "uncommitted" | "committed" | "all";
  base?: string;
  model?: string;
  depth?: "fast" | "deep";
  instructions?: string;
};

function parseCliArgs(raw: string):
  | { ok: true; flags: ReviewCliFlags }
  | { ok: false; error: string } {
  const tokens = raw.trim().split(/\s+/).filter((token) => token.length > 0);
  const flags: ReviewCliFlags = {};
  const instructionParts: string[] = [];

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token.startsWith("--")) {
      instructionParts.push(token);
      i += 1;
      continue;
    }

    const eq = token.indexOf("=");
    const name = eq >= 0 ? token.slice(0, eq) : token;
    const inlineValue = eq >= 0 ? token.slice(eq + 1) : undefined;

    if (name === "--instructions") {
      instructionParts.push(...(inlineValue !== undefined ? [inlineValue, ...tokens.slice(i + 1)] : tokens.slice(i + 1)));
      break;
    }

    const value = inlineValue !== undefined ? inlineValue : tokens[i + 1];

    if (name === "--change-type") {
      if (value === undefined || value !== "uncommitted" && value !== "committed" && value !== "all") {
        return { ok: false, error: `--change-type requires uncommitted|committed|all (got ${JSON.stringify(value)})` };
      }
      flags.changeType = value;
      i += inlineValue !== undefined ? 1 : 2;
      continue;
    }
    if (name === "--base") {
      if (value === undefined || value.trim().length === 0) {
        return { ok: false, error: "--base requires a branch or commit ref" };
      }
      flags.base = value;
      i += inlineValue !== undefined ? 1 : 2;
      continue;
    }
    if (name === "--model") {
      if (value === undefined || value.trim().length === 0) {
        return { ok: false, error: "--model requires a model id (provider/modelId)" };
      }
      flags.model = value;
      i += inlineValue !== undefined ? 1 : 2;
      continue;
    }
    if (name === "--depth") {
      if (value === undefined || value !== "fast" && value !== "deep") {
        return { ok: false, error: `--depth requires fast|deep (got ${JSON.stringify(value)})` };
      }
      flags.depth = value;
      i += inlineValue !== undefined ? 1 : 2;
      continue;
    }

    // Unknown flag: pass through verbatim as instructions.
    instructionParts.push(token);
    i += 1;
  }

  if (instructionParts.length > 0) flags.instructions = instructionParts.join(" ");
  return { ok: true, flags };
}

function makeHost(ctx: unknown): ReviewModelHost {
  const c = ctx as {
    model?: unknown;
    modelRegistry?: {
      find?: (provider: string, modelId: string) => unknown;
      hasConfiguredAuth?: (model: unknown) => boolean;
      complete?: (
        model: unknown,
        context: { messages: unknown[] },
        options: Record<string, unknown>,
      ) => Promise<{ content: Array<{ type: string; text?: string }> }>;
    };
  };
  const registry = c.modelRegistry ?? {};
  return {
    activeModel: c.model ?? null,
    find: (provider, modelId) => (registry.find ? registry.find(provider, modelId) : null),
    hasConfiguredAuth: (model) => (registry.hasConfiguredAuth ? registry.hasConfiguredAuth(model) : undefined),
    complete: (model, context, options) => {
      if (!registry.complete) {
        return Promise.reject(new Error("ctx.modelRegistry.complete is unavailable"));
      }
      return registry.complete(model, context, options) as Promise<{ content: Array<{ type: string; text?: string }> }>;
    },
  };
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("review", {
    description:
      "Review code changes in the working directory (--change-type uncommitted|committed|all, --base <ref>, --model <provider/id>, --depth fast|deep) and write findings to .happier/review/<runId>.json",
    handler: async (args, ctx) => {
      const parsed = parseCliArgs(args);
      if (!parsed.ok) {
        if (ctx.hasUI) ctx.ui.notify(parsed.error, "error");
        else console.error(parsed.error);
        return;
      }
      const result = await runReview({
        host: makeHost(ctx),
        cwd: ctx.cwd,
        changeType: parsed.flags.changeType,
        base: parsed.flags.base,
        model: parsed.flags.model,
        depth: parsed.flags.depth,
        instructions: parsed.flags.instructions,
      });
      if (ctx.hasUI) ctx.ui.notify(result.message, result.ok ? "info" : "error");
      else if (result.ok) console.log(result.message);
      else console.error(result.message);
    },
  });

  pi.registerTool({
    name: "review",
    label: "Review",
    description:
      "Review code changes in the working directory (uncommitted, committed, or all scopes) and write ReviewFindingsV2-compatible findings to .happier/review/<runId>.json.",
    promptSnippet: "Review current code changes and write findings to .happier/review/<runId>.json",
    parameters: Type.Object({
      changeType: Type.Optional(changeTypeEnum),
      base: Type.Optional(Type.String({ description: "Base branch or commit ref (committed/all scopes)" })),
      model: Type.Optional(Type.String({ description: "Pi model as provider/modelId" })),
      depth: Type.Optional(depthEnum),
      instructions: Type.Optional(Type.String({ description: "Extra review instructions" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await runReview({
        host: makeHost(ctx),
        cwd: ctx.cwd,
        changeType: params.changeType,
        base: params.base,
        model: params.model,
        depth: params.depth,
        instructions: params.instructions,
        signal,
      });
      return {
        content: [{ type: "text", text: result.message }],
        details: {
          ok: result.ok,
          runId: result.runId,
          path: result.path,
          findings: result.findingsCount,
        },
      };
    },
  });
}
