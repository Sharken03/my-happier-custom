import { execFile } from 'node:child_process';

import type { SessionModelState } from '@/agent/acp/AcpBackend';

/**
 * Antigravity has two weekly quota groups: the Gemini models, and the Claude and GPT models. As in
 * Happy's agy chats (the fork's patch 31), a message for a used-up group goes to the other group's
 * model when that group has quota left; the chat gets a status line saying so. Only the agy CLI's
 * own ACP server (`agy acp`) answers `agy -p /quota`, so this runs only with that server.
 */
export type AgyQuotaReading = Readonly<{
  gemini: number | null;
  others: number | null;
  geminiReset: string | null;
  othersReset: string | null;
}>;

type Group = 'gemini' | 'others';

const FALLBACK_MODEL: Readonly<Record<Group, string>> = { gemini: 'gemini-3.8-flash', others: 'claude-sonnet-4-6' };
const GROUP_LABEL: Readonly<Record<Group, string>> = { gemini: 'Gemini', others: 'Claude/GPT' };
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const QUOTA_TIMEOUT_MS = 20_000;

export function parseAgyQuota(output: string): AgyQuotaReading | null {
  const row = (label: string) => output.split('\n').find((line) => line.toLowerCase().includes(label));
  const percent = (label: string) => {
    const match = row(label)?.match(/(\d+)%/);
    return match ? Number(match[1]) : null;
  };
  const reset = (label: string) => row(label)?.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/)?.[1] ?? null;
  const gemini = percent('gemini');
  const others = percent('claude');
  if (gemini === null && others === null) return null;
  return { gemini, others, geminiReset: reset('gemini'), othersReset: reset('claude') };
}

function groupOf(modelId: string): Group {
  return /^gemini/i.test(modelId) ? 'gemini' : 'others';
}

function untilText(iso: string | null, now: number): string {
  if (!iso) return '';
  const at = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return ` until ${at.toDateString() === new Date(now).toDateString() ? clock : `${WEEKDAYS[at.getDay()]} ${clock}`}`;
}

/** The model to switch to before a message, with the chat's status line; null to keep the model. */
export function decideAgyQuotaModelSwitch(params: Readonly<{
  modelState: Readonly<SessionModelState> | null;
  quota: AgyQuotaReading | null;
  now: number;
}>): Readonly<{ modelId: string; notice: string }> | null {
  const { modelState, quota } = params;
  if (!modelState || !quota) return null;
  const group = groupOf(modelState.currentModelId);
  const other: Group = group === 'gemini' ? 'others' : 'gemini';
  if (quota[group] !== 0) return null;
  const otherLeft = quota[other];
  if (typeof otherLeft !== 'number' || otherLeft <= 0) return null;
  const target = modelState.availableModels.find((model) => model.id === FALLBACK_MODEL[other]);
  if (!target) return null;
  const reset = group === 'gemini' ? quota.geminiReset : quota.othersReset;
  return {
    modelId: target.id,
    notice: `Antigravity quota for the ${GROUP_LABEL[group]} models is used up${untilText(reset, params.now)}. Switched to ${target.name}.`,
  };
}

/** Runs `<agy> -p /quota`; null when agy gives no reading. It uses no quota. */
export function readAgyQuota(agyCommand: string): Promise<AgyQuotaReading | null> {
  return new Promise((resolve) => {
    execFile(agyCommand, ['-p', '/quota', '--log-file', '/dev/null'], { timeout: QUOTA_TIMEOUT_MS }, (error, stdout) => {
      resolve(error ? null : parseAgyQuota(String(stdout)));
    });
  });
}

type BeforePromptContext = Readonly<{
  modelState: Readonly<SessionModelState> | null;
  setModel: (modelId: string) => Promise<void>;
  notify: (message: string) => void;
}>;

/**
 * The AcpBackend beforePrompt hook for agy. `agy -p /quota` takes about 4 s on the 8T, so a
 * message never waits for it: the decision uses the last reading. The first reading starts when
 * the chat is created, and each message starts the next one in the background (one at a time). The first message after a group runs out can
 * still get agy's quota error; the next one moves to the other group.
 */
export function createAgyQuotaGuard(deps: Readonly<{
  read: () => Promise<AgyQuotaReading | null>;
  now?: () => number;
}>): (context: BeforePromptContext) => Promise<void> {
  let reading: AgyQuotaReading | null = null;
  let refreshing = false;
  const refresh = () => {
    if (refreshing) return;
    refreshing = true;
    void deps.read()
      .then((next) => { if (next) reading = next; })
      .catch(() => {})
      .finally(() => { refreshing = false; });
  };
  refresh();
  return async (context) => {
    const decision = decideAgyQuotaModelSwitch({ modelState: context.modelState, quota: reading, now: (deps.now ?? Date.now)() });
    refresh();
    if (!decision) return;
    await context.setModel(decision.modelId);
    context.notify(decision.notice);
  };
}
