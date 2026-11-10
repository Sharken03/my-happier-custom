// Tests for extensions/bash-guard.ts with Pi's real bash tool.
// Run: node --test termux/pi/tests/ (Node 24, Pi installed in Termux' global node_modules)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

// Pi's own loader resolves the package for an extension; here it comes from the global install.
const PI = path.join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
registerHooks({
  resolve(specifier, context, next) {
    if (specifier !== "@earendil-works/pi-coding-agent") return next(specifier, context);
    return { url: pathToFileURL(path.join(PI, "dist/index.js")).href, shortCircuit: true };
  },
});
const { default: extension, guardTimeout, DEFAULT_TIMEOUT_S, MAX_TIMEOUT_S, NICE } = await import(
  "../extensions/bash-guard.ts"
);

function loadBash() {
  const tools = {};
  extension({ registerTool: (tool) => { tools[tool.name] = tool; } });
  return tools.bash;
}

async function run(command, timeout) {
  const result = await loadBash().execute("t1", { command, timeout }, undefined, undefined, undefined);
  return result.content.map((part) => part.text).join("");
}

test("a call without a timeout gets the default, and a long timeout is cut to the maximum", () => {
  assert.equal(guardTimeout(undefined), DEFAULT_TIMEOUT_S);
  assert.equal(guardTimeout(0), DEFAULT_TIMEOUT_S);
  assert.equal(guardTimeout(20), 20);
  assert.equal(guardTimeout(MAX_TIMEOUT_S * 10), MAX_TIMEOUT_S);
});

test("the command runs at lower priority, and grep and rg come from the guard folder", async () => {
  const out = await run("cut -d' ' -f19 /proc/self/stat; command -v grep; command -v rg");
  const [nice, grep, rg] = out.trim().split("\n");
  assert.equal(Number(nice), NICE);
  assert.equal(path.basename(path.dirname(grep)), "bin");
  assert.equal(path.dirname(grep), path.dirname(rg));
});

test("a command that runs longer than its timeout is stopped", async () => {
  await assert.rejects(run("sleep 5", 1), /timed out after 1 seconds/);
});

test("grep that passes its CPU-time limit is stopped with a reason", async () => {
  // The pattern of 10/11-2026: wide context on each side of a match on one long line.
  const out = await run("head -c 3000000 /dev/urandom | base64 -w0 | PI_GUARD_GREP_CPU_S=1 grep -oE '.{0,2500}A.{0,2500}' | wc -c")
    .catch((error) => error.message);
  assert.match(out, /stopped by bash-guard after 1 s of CPU time/);
});
