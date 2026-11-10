import { resolveCodingPromptSessionTitleInstructionModeV1 } from '@happier-dev/protocol';

/**
 * Some models (Nemotron, for example) do not act on the session-title section of the system
 * prompt, but do act on the same request when it stands next to the user's message. The bridge
 * extension sends this text once, as a hidden message after the first user message of a run.
 */
export const PI_SESSION_TITLE_REMINDER =
  "Before you respond, call the change_title tool once to set a short, descriptive session title based on the user's message.";

/** The reminder for a session, or undefined when the session needs none. */
export function resolvePiSessionTitleReminder(params: Readonly<{
  settings: Record<string, unknown> | null | undefined;
  sessionMetadata?: unknown;
  sessionTitleToolAvailable: boolean;
}>): Readonly<{ text: string; toolName: string }> | undefined {
  if (!params.sessionTitleToolAvailable) return undefined;
  const mode = resolveCodingPromptSessionTitleInstructionModeV1(params.settings ?? null, params.sessionMetadata);
  return mode === 'disabled' ? undefined : { text: PI_SESSION_TITLE_REMINDER, toolName: 'change_title' };
}
