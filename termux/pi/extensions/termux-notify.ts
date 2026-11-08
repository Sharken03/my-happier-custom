// A `notify` tool: an Android notification through Termux:API when a task completes or fails.
// The message goes to termux-notification as one argument, never through a shell.
// There is no wake-lock hook: Termux holds the lock from boot, and an unlock after a task would
// release it for every Termux process.
import { execFile } from "node:child_process";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "notify",
    label: "Notify",
    description:
      "Send a native Android notification via Termux:API when a task completes or fails.",
    parameters: Type.Object({
      message: Type.String({ description: "Notification content or status summary" }),
    }),
    async execute(_toolCallId, params) {
      const text = await new Promise<string>((resolve) => {
        execFile(
          "termux-notification",
          ["--title", "Pi (OnePlus 8T)", "--content", params.message],
          { timeout: 15000 },
          (error) => resolve(error ? `Notification failed: ${error.message}` : "Notification sent."),
        );
      });
      return { content: [{ type: "text", text }], details: {} };
    },
  });
}
