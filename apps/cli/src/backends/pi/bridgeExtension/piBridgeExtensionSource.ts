import {
  TOOLS_SERVE_READY_TYPE,
  TOOLS_SERVE_REQUEST_TYPE,
  TOOLS_SERVE_RESULT_MAX_BYTES,
  TOOLS_SERVE_RESULT_TYPE,
} from '@/cli/commands/toolsServe';
import { PI_BRIDGE_CONFIG_PATH_FLAG, PI_BRIDGE_TOKEN_COUNT_MARKER_TYPE, PI_BRIDGE_USER_INPUT_MARKER_TYPE } from './piBridgeExtensionEnv';

export const PI_BRIDGE_EXTENSION_VERSION = '6';

function jsString(value: string): string {
  return JSON.stringify(value);
}

export function buildPiBridgeExtensionSource(): string {
  return `// Happier Pi tools-bridge extension (generated). Version: ${PI_BRIDGE_EXTENSION_VERSION}.
// Generic adapter: the host-owned protected session manifest owns tool policy and prompt guidance.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const CONFIG_PATH_FLAG = ${jsString(PI_BRIDGE_CONFIG_PATH_FLAG)};
const TOKEN_COUNT_MARKER_TYPE = ${jsString(PI_BRIDGE_TOKEN_COUNT_MARKER_TYPE)};
const USER_INPUT_MARKER_TYPE = ${jsString(PI_BRIDGE_USER_INPUT_MARKER_TYPE)};
const SESSION_TITLE_REMINDER_MESSAGE_TYPE = "happier-session-title-reminder";
const BRIDGE_OUTPUT_MAX_BYTES = 1024 * 1024;
const BRIDGE_OUTPUT_MAX_LINES = 4000;
const TOOL_OUTPUT_MAX_BYTES = 50 * 1024;
const TOOL_OUTPUT_MAX_LINES = 2000;
const TOOL_OUTPUT_NOTICE_RESERVE_BYTES = 256;
const SERVE_READY_TYPE = ${jsString(TOOLS_SERVE_READY_TYPE)};
const SERVE_REQUEST_TYPE = ${jsString(TOOLS_SERVE_REQUEST_TYPE)};
const SERVE_RESULT_TYPE = ${jsString(TOOLS_SERVE_RESULT_TYPE)};
const SERVE_RESULT_MAX_BYTES = ${TOOLS_SERVE_RESULT_MAX_BYTES};

function readFlagString(pi, name) {
  try {
    const value = typeof pi.getFlag === "function" ? pi.getFlag(name) : undefined;
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

function readSessionConfig(pi) {
  const path = readFlagString(pi, CONFIG_PATH_FLAG);
  if (!path) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || parsed.v !== 1 || typeof parsed.sessionId !== "string" || !parsed.sessionId.trim()) return null;
    if (!Array.isArray(parsed.directTools) || typeof parsed.promptAddition !== "string") return null;
    if (!parsed.launch || typeof parsed.launch !== "object") return null;
    if (typeof parsed.launch.filePath !== "string" || !parsed.launch.filePath.trim()) return null;
    if (!Array.isArray(parsed.launch.argPrefix) || !parsed.launch.argPrefix.every((value) => typeof value === "string")) return null;
    if (!parsed.launch.env || typeof parsed.launch.env !== "object" || Array.isArray(parsed.launch.env)) return null;
    if (!Object.values(parsed.launch.env).every((value) => typeof value === "string")) return null;
    const directTools = [];
    for (const tool of parsed.directTools) {
      if (!tool || typeof tool !== "object") return null;
      if (typeof tool.name !== "string" || !tool.name.trim()) return null;
      if (typeof tool.title !== "string" || !tool.title.trim()) return null;
      if (typeof tool.description !== "string" || !tool.description.trim()) return null;
      if (!tool.inputSchema || typeof tool.inputSchema !== "object" || Array.isArray(tool.inputSchema)) return null;
      if (!tool.call || typeof tool.call !== "object" || typeof tool.call.toolName !== "string" || !tool.call.toolName.trim()) return null;
      if (tool.call.actionId !== null && (typeof tool.call.actionId !== "string" || !tool.call.actionId.trim())) return null;
      directTools.push(tool);
    }
    return { ...parsed, sessionId: parsed.sessionId.trim(), directTools };
  } catch {
    return null;
  }
}

function parseEnvelope(stdout) {
  const trimmed = typeof stdout === "string" ? stdout.trim() : "";
  if (!trimmed) return { ok: false, error: { code: "bridge_no_output", message: "Happier tools bridge returned no output" } };
  const lines = trimmed.split("\\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && typeof parsed.ok === "boolean") return parsed;
    } catch {}
  }
  return { ok: false, error: { code: "bridge_invalid_output", message: trimmed.slice(0, 500) } };
}

function truncateToolOutput(value) {
  const text = typeof value === "string" ? value : String(value ?? "");
  const totalBytes = Buffer.byteLength(text, "utf8");
  const lines = text.split("\\n");
  const totalLines = lines.length;
  let content = lines.slice(0, TOOL_OUTPUT_MAX_LINES).join("\\n");
  const contentByteLimit = TOOL_OUTPUT_MAX_BYTES - TOOL_OUTPUT_NOTICE_RESERVE_BYTES;
  if (Buffer.byteLength(content, "utf8") > contentByteLimit) {
    const bytes = Buffer.from(content, "utf8");
    let end = contentByteLimit;
    while (end > 0) {
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end));
        break;
      } catch {
        end -= 1;
      }
    }
  }
  const truncated = totalLines > TOOL_OUTPUT_MAX_LINES || totalBytes > Buffer.byteLength(content, "utf8");
  if (!truncated) return { content, truncated: false };
  const notice = "\\n\\n[Output truncated: showing the first " + Buffer.byteLength(content, "utf8")
    + " of " + totalBytes + " bytes and at most " + TOOL_OUTPUT_MAX_LINES + " lines]";
  return { content: content + notice, truncated: true, totalBytes, totalLines };
}

function envelopeToToolResult(envelope) {
  if (envelope.ok) {
    const output = envelope.data && typeof envelope.data === "object" && "output" in envelope.data
      ? envelope.data.output
      : (envelope.data ?? null);
    const projected = truncateToolOutput(JSON.stringify(output) ?? "null");
    return { content: [{ type: "text", text: projected.content }], details: { truncation: projected } };
  }
  const error = envelope.error && typeof envelope.error === "object" ? envelope.error : {};
  const parts = ["code=" + (typeof error.code === "string" && error.code ? error.code : "unknown")];
  if (typeof error.message === "string" && error.message) parts.push(error.message);
  if (Array.isArray(error.candidates) && error.candidates.length > 0) parts.push("candidates: " + error.candidates.join(", "));
  const projected = truncateToolOutput(parts.join(" — "));
  throw new Error(projected.content);
}

function runChild(filePath, argv, options) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(filePath, argv, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ stdout: "", stderr: String(error?.message ?? error), code: null, killed: false });
      return;
    }
    const createOutputCollector = () => {
      const chunks = [];
      let bytes = 0;
      let lines = 1;
      let limited = false;
      return {
        append(data) {
          const chunk = Buffer.isBuffer(data) ? data : Buffer.from(String(data ?? ""), "utf8");
          lines += (chunk.toString("utf8").match(/\\n/g) ?? []).length;
          const remaining = Math.max(0, BRIDGE_OUTPUT_MAX_BYTES - bytes);
          if (remaining > 0) {
            const accepted = chunk.subarray(0, remaining);
            chunks.push(accepted);
            bytes += accepted.length;
          }
          if (chunk.length > remaining || lines > BRIDGE_OUTPUT_MAX_LINES) limited = true;
        },
        text() { return Buffer.concat(chunks, bytes).toString("utf8"); },
        get limited() { return limited; },
      };
    };
    const stdout = createOutputCollector();
    const stderr = createOutputCollector();
    let killed = false;
    let settled = false;
    let forceKillTimer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (forceKillTimer) clearTimeout(forceKillTimer);
      options.signal?.removeEventListener?.("abort", killChild);
      resolve(result);
    };
    const killChild = () => {
      if (killed || child.exitCode !== null || child.signalCode !== null) return;
      killed = true;
      try { child.kill("SIGTERM"); } catch {}
      forceKillTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5000);
      forceKillTimer.unref?.();
    };
    if (options.signal) {
      if (options.signal.aborted) killChild();
      else options.signal.addEventListener("abort", killChild, { once: true });
    }
    child.stdout?.on("data", (data) => {
      stdout.append(data);
      if (stdout.limited) killChild();
    });
    child.stderr?.on("data", (data) => {
      stderr.append(data);
      if (stderr.limited) killChild();
    });
    child.once("error", (error) => {
      stderr.append(String(error?.message ?? error));
      finish({ stdout: stdout.text(), stderr: stderr.text(), code: null, killed, outputLimited: stdout.limited || stderr.limited });
    });
    child.once("close", (code) => finish({
      stdout: stdout.text(),
      stderr: stderr.text(),
      code,
      killed,
      outputLimited: stdout.limited || stderr.limited,
    }));
  });
}

async function callHappierTool(config, toolName, args, toolCallId, signal, cwd) {
  const argv = [
    ...config.launch.argPrefix,
    "tools", "call",
    "--session-id", config.sessionId,
    "--directory", cwd,
    "--source", "happier",
    "--tool", toolName,
    "--args-json", JSON.stringify(args ?? {}),
    "--session-agent-bridge",
    ...(typeof toolCallId === "string" && toolCallId.trim() ? ["--tool-call-id", toolCallId.trim()] : []),
    "--json",
  ];
  const result = await runChild(config.launch.filePath, argv, {
    cwd,
    env: { ...process.env, ...config.launch.env },
    signal,
  });
  if (result.outputLimited) return { ok: false, error: { code: "bridge_output_limit", message: "Happier tools bridge output exceeded its bounded transport limit" } };
  if (result.killed) return { ok: false, error: { code: "bridge_cancelled", message: "Happier tool call was cancelled" } };
  if (!result.stdout.trim() && result.code !== 0) {
    const diagnostic = result.stderr.trim().slice(0, 500);
    const exit = result.code === null ? "unavailable" : String(result.code);
    return {
      ok: false,
      error: {
        code: "bridge_process_failed",
        message: "Happier tools bridge exited with code " + exit + (diagnostic ? ": " + diagnostic : ""),
      },
    };
  }
  return parseEnvelope(result.stdout);
}

// One long-lived "tools serve" process per session pays the CLI start-up once; a
// process per call pays it on every call (about 4 s on a phone). The serve process ends
// itself after a time without calls, and the next call starts a new one. call() returns
// null when no serve process can answer (an older CLI exits without the ready line, or
// the process ended during the call), and the caller then spawns "tools call" for it.
function createToolsServeClient(config) {
  let current = null;
  let unavailable = false;
  const start = () => {
    let child;
    try {
      child = spawn(config.launch.filePath, [...config.launch.argPrefix, "tools", "serve", "--session-id", config.sessionId], {
        env: { ...process.env, ...config.launch.env },
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch {
      unavailable = true;
      return null;
    }
    const server = { child, pending: new Map(), nextId: 1, alive: true, wasReady: false };
    let markReady = () => {};
    server.ready = new Promise((resolve) => { markReady = resolve; });
    let buffer = "";
    server.stop = () => {
      if (!server.alive) return;
      server.alive = false;
      if (!server.wasReady) unavailable = true;
      markReady(false);
      if (current === server) current = null;
      for (const finish of server.pending.values()) {
        finish(null);
      }
      server.pending.clear();
      try { child.kill("SIGTERM"); } catch {}
    };
    child.stdout.on("data", (data) => {
      buffer += data.toString("utf8");
      let index;
      while ((index = buffer.indexOf("\\n")) !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line.startsWith("{")) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message && message.type === SERVE_READY_TYPE) {
          server.wasReady = true;
          markReady(true);
        } else if (message && message.type === SERVE_RESULT_TYPE && server.pending.has(message.id)) {
          const finish = server.pending.get(message.id);
          server.pending.delete(message.id);
          const envelope = message.envelope;
          finish(envelope && typeof envelope === "object" && typeof envelope.ok === "boolean"
            ? envelope
            : { ok: false, error: { code: "bridge_invalid_output", message: "Happier tools serve returned an invalid result" } });
        }
      }
      // A result line is at most SERVE_RESULT_MAX_BYTES; more without a newline is a broken stream.
      if (Buffer.byteLength(buffer, "utf8") > SERVE_RESULT_MAX_BYTES + 1024) server.stop();
    });
    child.stdin.on("error", () => server.stop());
    child.once("error", () => server.stop());
    child.once("close", () => server.stop());
    // Pi must be able to exit while the serve process waits; Pi's exit closes its stdin and stops it.
    child.unref?.();
    child.stdin.unref?.();
    child.stdout.unref?.();
    return server;
  };
  return {
    warm() {
      if (!current && !unavailable) current = start();
    },
    async call(toolName, args, toolCallId, signal) {
      if (!current && !unavailable) current = start();
      const server = current;
      if (!server || !(await server.ready) || !server.alive) return null;
      if (signal?.aborted) return { ok: false, error: { code: "bridge_cancelled", message: "Happier tool call was cancelled" } };
      return await new Promise((resolve) => {
        const id = server.nextId++;
        const onAbort = () => {
          server.pending.delete(id);
          resolve({ ok: false, error: { code: "bridge_cancelled", message: "Happier tool call was cancelled" } });
        };
        server.pending.set(id, (envelope) => {
          signal?.removeEventListener?.("abort", onAbort);
          resolve(envelope);
        });
        signal?.addEventListener?.("abort", onAbort, { once: true });
        server.child.stdin.write(JSON.stringify({
          type: SERVE_REQUEST_TYPE,
          id,
          tool: toolName,
          args: args ?? {},
          toolCallId: typeof toolCallId === "string" ? toolCallId.trim() : "",
        }) + "\\n");
      });
    },
    stop() {
      current?.stop();
      current = null;
    },
  };
}

function emitContextTelemetryMarker(ctx) {
  let usage = null;
  try { usage = typeof ctx?.getContextUsage === "function" ? ctx.getContextUsage() : null; } catch {}
  if (!usage || typeof usage !== "object") return;
  const used = typeof usage.tokens === "number" && Number.isFinite(usage.tokens) && usage.tokens >= 0 ? Math.trunc(usage.tokens) : null;
  const size = typeof usage.contextWindow === "number" && Number.isFinite(usage.contextWindow) && usage.contextWindow > 0 ? Math.trunc(usage.contextWindow) : null;
  if (used === null || used <= 0 || size === null) return;
  try { process.stderr.write(JSON.stringify({ type: TOKEN_COUNT_MARKER_TYPE, used, size }) + "\\n"); } catch {}
}

export default function HappierPiToolsBridgeExtension(pi) {
  pi.registerFlag(CONFIG_PATH_FLAG, {
    description: "Protected Happier session tools-bridge configuration path",
    type: "string",
  });

  let registered = false;
  pi.on("session_start", () => {
    if (registered) return;
    const config = readSessionConfig(pi);
    if (!config) return;
    registered = true;
    const toolsServe = createToolsServeClient(config);
    toolsServe.warm();
    pi.on("session_shutdown", () => toolsServe.stop());

    // Observe submitted extension input at Pi's public input boundary, as the host does
    // for its own submissions. Later input handlers may transform or handle it; a handler
    // that already handled the input prevents this observer from running.
    pi.on("input", (event, ctx) => {
      if (event.source !== "extension" || typeof event.text !== "string" || !event.text.length) return;
      // The native notification API shares Pi's RPC output stream with lifecycle events.
      // User message_end echoes have no origin and must never infer this observation.
      ctx.ui.notify(JSON.stringify({ type: USER_INPUT_MARKER_TYPE, text: event.text }));
    });

    pi.on("message_end", (event, ctx) => {
      const message = event && typeof event === "object" ? event.message : null;
      if (message && typeof message === "object" && message.role === "assistant") emitContextTelemetryMarker(ctx);
    });

    // Some models ignore the session-title section of the system prompt. The host resolves a
    // reminder for a session that still needs a title; it goes out once, as a hidden message
    // after the user message that starts a run, unless the model already set a title.
    const reminderConfig = config.sessionTitleReminder && typeof config.sessionTitleReminder === "object" ? config.sessionTitleReminder : null;
    const sessionTitleToolName = typeof reminderConfig?.toolName === "string" ? reminderConfig.toolName : "";
    let sessionTitleReminder = typeof reminderConfig?.text === "string" ? reminderConfig.text.trim() : "";

    pi.on("before_agent_start", async (event) => {
      const addition = config.promptAddition.trim();
      const result = {};
      if (addition) {
        const base = event && typeof event.systemPrompt === "string" ? event.systemPrompt.trim() : "";
        result.systemPrompt = base ? base + "\\n\\n" + addition : addition;
      }
      if (sessionTitleReminder && event?.messageType !== "custom") {
        result.message = { customType: SESSION_TITLE_REMINDER_MESSAGE_TYPE, content: sessionTitleReminder, display: false };
        sessionTitleReminder = "";
      }
      return result.systemPrompt === undefined && result.message === undefined ? undefined : result;
    });

    for (const tool of config.directTools) {
      pi.registerTool({
        name: tool.name,
        label: tool.title,
        description: tool.description,
        parameters: tool.inputSchema,
        async execute(toolCallId, args, signal, _onUpdate, ctx) {
          if (tool.name === sessionTitleToolName) sessionTitleReminder = "";
          const cwd = typeof ctx?.cwd === "string" && ctx.cwd.trim() ? ctx.cwd : process.cwd();
          const callArgs = tool.call.actionId === null
            ? args
            : { actionId: tool.call.actionId, input: args };
          const served = await toolsServe.call(tool.call.toolName, callArgs, toolCallId, signal);
          return envelopeToToolResult(served ?? await callHappierTool(config, tool.call.toolName, callArgs, toolCallId, signal, cwd));
        },
      });
    }

  });
}
`;
}
