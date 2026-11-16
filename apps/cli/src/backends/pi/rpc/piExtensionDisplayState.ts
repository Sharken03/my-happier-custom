/**
 * Pi extensions call `ctx.ui.setStatus(key, text)` and `ctx.ui.setWidget(key, lines)`. In RPC mode
 * Pi sends both as fire-and-forget `extension_ui_request` events. This module keeps the latest
 * value per key, so the app can show them (for example the status of a plan-mode extension).
 * The snapshot goes to session metadata under PI_EXTENSION_UI_METADATA_KEY.
 */

export const PI_EXTENSION_UI_METADATA_KEY = 'piExtensionUiV1';

/** Limits keep a noisy extension from growing session metadata. */
const MAX_KEYS = 8;
const MAX_TEXT_LENGTH = 200;
const MAX_WIDGET_LINES = 12;

export type PiExtensionDisplayUpdate =
  | Readonly<{ kind: 'status'; key: string; text: string | null }>
  | Readonly<{ kind: 'widget'; key: string; lines: readonly string[] | null }>;

export type PiExtensionUiSnapshotV1 = Readonly<{
  v: 1;
  statuses: ReadonlyArray<Readonly<{ key: string; text: string }>>;
  widgets: ReadonlyArray<Readonly<{ key: string; lines: readonly string[] }>>;
}>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readKey(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

// Removes terminal escape sequences and control characters, and limits the length.
function cleanText(value: string): string {
  return value
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

// Some extensions use a widget as a channel to the host, for example pi-subagents sends
// "PI_SUBAGENT_ASYNC_JSON:{...}". Such lines are data, not text for a person.
function isMachinePayloadLine(line: string): boolean {
  return /^[A-Z][A-Z0-9_]*_JSON:/.test(line);
}

/** Returns the update for a setStatus or setWidget event, else null. */
export function parsePiExtensionDisplayUpdate(value: unknown): PiExtensionDisplayUpdate | null {
  const request = asRecord(value);
  if (request?.type !== 'extension_ui_request') return null;
  if (request.method === 'setStatus') {
    const key = readKey(request.statusKey);
    if (!key) return null;
    const text = typeof request.statusText === 'string' ? cleanText(request.statusText) : '';
    return { kind: 'status', key, text: text.length > 0 ? text : null };
  }
  if (request.method === 'setWidget') {
    const key = readKey(request.widgetKey);
    if (!key) return null;
    if (!Array.isArray(request.widgetLines)) return { kind: 'widget', key, lines: null };
    const lines = request.widgetLines
      .filter((line): line is string => typeof line === 'string')
      .filter((line) => !isMachinePayloadLine(line))
      .map(cleanText)
      .filter((line) => line.length > 0)
      .slice(0, MAX_WIDGET_LINES);
    return { kind: 'widget', key, lines: lines.length > 0 ? lines : null };
  }
  return null;
}

export class PiExtensionDisplayState {
  private readonly statuses = new Map<string, string>();
  private readonly widgets = new Map<string, readonly string[]>();
  private lastPublished: string | null = null;

  /** Applies an update. Returns true when the snapshot changed. */
  apply(update: PiExtensionDisplayUpdate): boolean {
    const before = this.fingerprint();
    if (update.kind === 'status') {
      if (update.text === null) this.statuses.delete(update.key);
      else if (this.statuses.has(update.key) || this.statuses.size < MAX_KEYS) this.statuses.set(update.key, update.text);
    } else if (update.lines === null) {
      this.widgets.delete(update.key);
    } else if (this.widgets.has(update.key) || this.widgets.size < MAX_KEYS) {
      this.widgets.set(update.key, update.lines);
    }
    return this.fingerprint() !== before;
  }

  snapshot(): PiExtensionUiSnapshotV1 {
    return {
      v: 1,
      statuses: [...this.statuses].map(([key, text]) => ({ key, text })),
      widgets: [...this.widgets].map(([key, lines]) => ({ key, lines })),
    };
  }

  /**
   * Returns the snapshot when it differs from the last one given for publication, else null.
   * With force, it also returns an unchanged snapshot (used when a new publisher attaches,
   * so that a stale value in session metadata is replaced).
   */
  takeSnapshotToPublish(force = false): PiExtensionUiSnapshotV1 | null {
    const fingerprint = this.fingerprint();
    if (!force && fingerprint === this.lastPublished) return null;
    this.lastPublished = fingerprint;
    return this.snapshot();
  }

  private fingerprint(): string {
    return JSON.stringify(this.snapshot());
  }
}
