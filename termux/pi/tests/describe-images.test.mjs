// Tests for extensions/describe-images.ts with a stand-in for Pi's extension API.
// Run: node --test termux/pi/tests/
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";

// The extension imports getAgentDir from Pi, which only Pi's own loader can resolve.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier !== "@earendil-works/pi-coding-agent") return next(specifier, context);
    return { url: "data:text/javascript,export const getAgentDir=()=>process.env.PI_CODING_AGENT_DIR;", shortCircuit: true };
  },
});
const { default: extension } = await import("../extensions/describe-images.ts");

const model = (provider, id, input, cost = 1) => ({ provider, id, input, cost: { input: cost, output: cost } });
const PRO = model("ds", "pro", ["text"]);
const FLASH = model("ds", "flash", ["text", "image"], 2);
const CHEAP = model("or", "cheap/vision", ["text", "image"], 1);
const NO_AUTH = model("or", "no-auth", ["text", "image"], 0);
const image = (data) => ({ type: "image", data, mimeType: "image/png" });
const answer = (text, cost = 0.5) => ({ content: [{ type: "text", text }], stopReason: "stop", usage: { cost: { total: cost } } });

let agentDir;
/** One loaded extension with what it registered, and a context whose model calls are recorded. */
function load({ flag, entries = [], active = PRO, complete = () => answer("a red square") } = {}) {
  const handlers = {};
  const commands = {};
  const appended = [];
  const calls = [];
  const notes = [];
  extension({
    on: (event, handler) => { handlers[event] = handler; },
    registerFlag: () => {},
    getFlag: () => flag,
    registerCommand: (name, command) => { commands[name] = command; },
    appendEntry: (customType, data) => appended.push({ type: "custom", customType, data }),
  });
  const models = [PRO, FLASH, CHEAP, NO_AUTH];
  const ctx = {
    model: active,
    hasUI: true,
    signal: undefined,
    ui: { notify: (text, level) => notes.push([level, text]), select: async () => undefined },
    sessionManager: { getEntries: () => entries },
    modelRegistry: {
      getAvailable: () => models,
      find: (provider, id) => models.find((m) => m.provider === provider && m.id === id),
      hasConfiguredAuth: (m) => m !== NO_AUTH,
      complete: async (m, context) => {
        calls.push({ model: m, context });
        return complete(m, context);
      },
    },
  };
  handlers.session_start({}, ctx);
  return { handlers, commands, appended, calls, notes, ctx };
}
const conversation = () => [
  { role: "user", content: [{ type: "text", text: "what is this?" }, image("AAAA")] },
  { role: "assistant", content: [{ type: "text", text: "let me read it again" }] },
  { role: "toolResult", content: [{ type: "text", text: "Read image file" }, image("AAAA"), image("BBBB")] },
];

beforeEach(() => {
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "describe-images-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

test("a text-only model gets one description per different image, in user messages and tool results", async () => {
  const { handlers, calls, appended, ctx } = load();
  const result = await handlers.context({ messages: conversation() }, ctx);
  assert.equal(calls.length, 2);
  assert.doesNotMatch(JSON.stringify(result.messages), /"type":"image"/);
  assert.match(result.messages[0].content[1].text, /ds\/pro reads text only, so or\/cheap\/vision described the image:\]\na red square\n/);
  assert.equal(result.messages[0].content[0].text, "what is this?");
  assert.equal(result.messages[2].content[1].text, result.messages[0].content[1].text);
  assert.deepEqual(appended.map((entry) => entry.customType), ["describe-images", "describe-images"]);
  // The image model gets the image and the user's request.
  const sent = calls[0].context.messages[0].content;
  assert.match(sent[0].text, /cannot see images.*what is this\?/s);
  assert.deepEqual(sent[1], image("AAAA"));
});

test("a known image is not described again, and the text stays the same", async () => {
  const { handlers, calls, ctx } = load();
  const first = await handlers.context({ messages: conversation() }, ctx);
  const second = await handlers.context({ messages: conversation() }, ctx);
  assert.equal(calls.length, 2);
  assert.deepEqual(second.messages, first.messages);
});

test("a model that reads images, and a conversation without images, are not changed", async () => {
  const vision = load({ active: FLASH });
  assert.equal(await vision.handlers.context({ messages: conversation() }, vision.ctx), undefined);
  const plain = load();
  assert.equal(await plain.handlers.context({ messages: [{ role: "user", content: "hi" }] }, plain.ctx), undefined);
  assert.equal(vision.calls.length + plain.calls.length, 0);
});

test("the cost of new descriptions goes on the next answer, once", async () => {
  const { handlers, ctx } = load({ complete: () => answer("x", 0.25) });
  await handlers.context({ messages: conversation() }, ctx);
  const message = { role: "assistant", content: [], usage: { input: 5, cost: { input: 1, total: 1 } } };
  const first = handlers.message_end({ message }, ctx);
  assert.deepEqual(first.message.usage, { input: 5, cost: { input: 1, total: 1.5 } });
  assert.equal(handlers.message_end({ message }, ctx), undefined);
  assert.equal(handlers.message_end({ message: { role: "user", content: "hi" } }, ctx), undefined);
});

test("a resumed session uses the descriptions stored in it", async () => {
  const before = load();
  await before.handlers.context({ messages: conversation() }, before.ctx);
  const resumed = load({ entries: [...before.appended, { type: "custom", customType: "other", data: {} }] });
  const result = await resumed.handlers.context({ messages: conversation() }, resumed.ctx);
  assert.equal(resumed.calls.length, 0);
  assert.match(result.messages[0].content[1].text, /a red square/);
});

test("the image model: the flag, then the file, then the cheapest model with authentication", async () => {
  const used = async (options) => {
    const { handlers, calls, ctx } = load(options);
    await handlers.context({ messages: conversation() }, ctx);
    return calls[0].model;
  };
  assert.equal(await used(), CHEAP);
  fs.writeFileSync(path.join(agentDir, "describe-images.json"), JSON.stringify({ model: "ds/flash" }));
  assert.equal(await used(), FLASH);
  assert.equal(await used({ flag: "or/cheap/vision" }), CHEAP);
  // A model that is unknown, reads text only or has no authentication is not used.
  for (const wrong of ["ds/gone", "ds/pro", "or/no-auth"]) assert.equal(await used({ flag: wrong }), CHEAP);
});

test("a failed description leaves the image, stores nothing and warns once", async () => {
  const { handlers, appended, notes, ctx } = load({
    complete: (_model, context) => (context.messages[0].content[1].data === "BBBB" ? { content: [], stopReason: "error", errorMessage: "down", usage: { cost: { total: 0 } } } : answer("ok")),
  });
  const result = await handlers.context({ messages: conversation() }, ctx);
  await handlers.context({ messages: conversation() }, ctx);
  assert.deepEqual(result.messages[2].content[2], image("BBBB"));
  assert.equal(result.messages[2].content[1].type, "text");
  assert.equal(appended.length, 1);
  assert.deepEqual(notes.map(([level]) => level), ["warning"]);
});

test("/image-model stores a model that reads images and refuses another", async () => {
  const { commands, notes, ctx } = load();
  const file = path.join(agentDir, "describe-images.json");
  await commands["image-model"].handler("ds/flash", ctx);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { model: "ds/flash" });
  await commands["image-model"].handler("ds/pro", ctx);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { model: "ds/flash" });
  assert.equal(notes.at(-1)[0], "error");
  await commands["image-model"].handler("auto", ctx);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { model: "auto" });
});
