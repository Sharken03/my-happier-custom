import type { NormalizedMessage } from '@/sync/typesRaw';

import { extractWorkspaceMutationsFromNormalizedMessages } from './workspaceMutationDetection/extractWorkspaceMutations';

export type WorkspaceMutationInvalidation = Readonly<{
    sessionId: string;
    changedPaths: readonly string[];
    hasUnknownMutations: boolean;
    /** True when a tool result for a mutating tool call caused this invalidation. */
    fromCompletedTool: boolean;
}>;

export type WorkspaceMutationInvalidatorOptions = Readonly<{
    debounceMs: number;
    minUnknownOnlyIntervalMs: number;
    now: () => number;
    setTimer: (fn: () => void, ms: number) => unknown;
    clearTimer: (handle: unknown) => void;
    onInvalidate: (event: WorkspaceMutationInvalidation) => void;
    /**
     * When it returns true, the result of a mutating tool call invalidates again. The tool call itself
     * arrives before the tool runs, so without this a slow command or a tool that waits for
     * permission leaves the status stale until the next poll.
     */
    refreshOnToolDone?: () => boolean;
}>;

type OpenToolCall = Readonly<{ paths: readonly string[]; hasUnknownMutations: boolean }>;

/** The open mutating tool calls kept per session; the oldest go first when a session has more. */
const MAX_OPEN_TOOL_CALLS_PER_SESSION = 200;

export class WorkspaceMutationInvalidator {
    private readonly pendingBySession = new Map<string, {
        paths: Set<string>;
        hasUnknownMutations: boolean;
        timer: unknown | null;
        lastUnknownOnlyEmitAtMs: number;
        fromCompletedTool: boolean;
    }>();
    private readonly openToolCallsBySession = new Map<string, Map<string, OpenToolCall>>();

    constructor(private readonly options: WorkspaceMutationInvalidatorOptions) {}

    ingest(sessionId: string, messages: readonly NormalizedMessage[]): void {
        if (typeof sessionId !== 'string' || sessionId.trim().length === 0) return;
        if (!Array.isArray(messages) || messages.length === 0) return;

        const extracted = extractWorkspaceMutationsFromNormalizedMessages({ messages });
        const completed = this.options.refreshOnToolDone?.() === true
            ? this.trackToolCalls(sessionId, messages)
            : null;
        if (extracted.paths.size === 0 && extracted.hasUnknownMutations !== true && !completed) {
            return;
        }

        const existing = this.pendingBySession.get(sessionId) ?? {
            paths: new Set<string>(),
            hasUnknownMutations: false,
            timer: null,
            lastUnknownOnlyEmitAtMs: 0,
            fromCompletedTool: false,
        };

        const addedPaths = completed ? [...extracted.paths, ...completed.paths] : extracted.paths;
        for (const path of addedPaths) {
            if (typeof path === 'string' && path.trim().length > 0) {
                existing.paths.add(path);
            }
        }
        existing.hasUnknownMutations = existing.hasUnknownMutations
            || extracted.hasUnknownMutations
            || completed?.hasUnknownMutations === true;
        if (completed) existing.fromCompletedTool = true;

        let delayMs = this.options.debounceMs;
        const hasKnownPaths = existing.paths.size > 0;
        const unknownOnly = !hasKnownPaths && existing.hasUnknownMutations;
        if (unknownOnly) {
            const nowMs = this.options.now();
            const sinceLastMs = nowMs - existing.lastUnknownOnlyEmitAtMs;
            if (existing.lastUnknownOnlyEmitAtMs > 0 && sinceLastMs < this.options.minUnknownOnlyIntervalMs) {
                if (!existing.fromCompletedTool) {
                    // Too soon to emit another unknown-only invalidation. Keep pending state but don't schedule.
                    this.pendingBySession.set(sessionId, existing);
                    return;
                }
                // A finished tool must still show its changes: emit when the interval ends.
                delayMs = Math.max(delayMs, this.options.minUnknownOnlyIntervalMs - sinceLastMs);
            }
        }

        if (existing.timer != null) {
            this.options.clearTimer(existing.timer);
            existing.timer = null;
        }

        existing.timer = this.options.setTimer(() => {
            this.flush(sessionId);
        }, delayMs);

        this.pendingBySession.set(sessionId, existing);
    }

    private flush(sessionId: string): void {
        const pending = this.pendingBySession.get(sessionId);
        if (!pending) return;

        if (pending.timer != null) {
            this.options.clearTimer(pending.timer);
            pending.timer = null;
        }

        const changedPaths = Array.from(pending.paths);
        const hasUnknownMutations = pending.hasUnknownMutations;
        const fromCompletedTool = pending.fromCompletedTool;
        pending.paths = new Set();
        pending.hasUnknownMutations = false;
        pending.fromCompletedTool = false;

        if (changedPaths.length === 0 && hasUnknownMutations && fromCompletedTool) {
            // ingest() already waited for the unknown-only interval to end.
            pending.lastUnknownOnlyEmitAtMs = this.options.now();
        } else if (changedPaths.length === 0 && hasUnknownMutations) {
            const nowMs = this.options.now();
            if (pending.lastUnknownOnlyEmitAtMs > 0 && nowMs - pending.lastUnknownOnlyEmitAtMs < this.options.minUnknownOnlyIntervalMs) {
                this.pendingBySession.set(sessionId, pending);
                return;
            }
            pending.lastUnknownOnlyEmitAtMs = nowMs;
        }

        this.pendingBySession.set(sessionId, pending);
        this.options.onInvalidate({
            sessionId,
            changedPaths,
            hasUnknownMutations,
            fromCompletedTool,
        });
    }

    /**
     * Remembers each mutating tool call by id and returns what the tool results in `messages`
     * completed, or null when no result matches an open call.
     */
    private trackToolCalls(sessionId: string, messages: readonly NormalizedMessage[]): OpenToolCall | null {
        let open = this.openToolCallsBySession.get(sessionId);
        const paths: string[] = [];
        let hasUnknownMutations = false;
        let matched = false;

        for (const message of messages) {
            if (!message || message.role !== 'agent' || !Array.isArray(message.content)) continue;
            for (const part of message.content) {
                if (!part || typeof part !== 'object') continue;
                if (part.type === 'tool-call' && typeof part.id === 'string' && part.id.length > 0) {
                    const call = extractWorkspaceMutationsFromNormalizedMessages({
                        messages: [{ ...message, content: [part] } as NormalizedMessage],
                    });
                    if (call.paths.size === 0 && !call.hasUnknownMutations) continue;
                    if (!open) {
                        open = new Map();
                        this.openToolCallsBySession.set(sessionId, open);
                    }
                    open.set(part.id, { paths: Array.from(call.paths), hasUnknownMutations: call.hasUnknownMutations });
                    if (open.size > MAX_OPEN_TOOL_CALLS_PER_SESSION) {
                        const oldest = open.keys().next().value;
                        if (oldest !== undefined) open.delete(oldest);
                    }
                    continue;
                }
                if (part.type === 'tool-result' && typeof part.tool_use_id === 'string') {
                    const call = open?.get(part.tool_use_id);
                    if (!call) continue;
                    open!.delete(part.tool_use_id);
                    matched = true;
                    paths.push(...call.paths);
                    hasUnknownMutations = hasUnknownMutations || call.hasUnknownMutations;
                }
            }
        }

        if (open && open.size === 0) this.openToolCallsBySession.delete(sessionId);
        return matched ? { paths, hasUnknownMutations } : null;
    }
}
