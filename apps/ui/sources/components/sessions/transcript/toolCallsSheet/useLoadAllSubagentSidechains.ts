import * as React from 'react';

import { resolveToolTranscriptSidechainId } from '@/components/tools/shell/views/resolveToolTranscriptSidechainId';
import type { Message } from '@/sync/domains/messages/messageTypes';
import { sync } from '@/sync/sync';
import { fireAndForget } from '@/utils/system/fireAndForget';

import { isToolCallsSheetSubagentCall } from './toolCallsSheetSubagent';

/** Upper limit of older pages per sidechain, so a broken "has more" flag cannot loop forever. */
const MAX_OLDER_PAGES = 50;

/**
 * The sidechain ids of the subagent calls in a list and under them. A nested subagent shows only
 * after its parent's sidechain has loaded, so the list grows as the loads finish.
 */
export function collectSubagentSidechainIds(messages: readonly Message[]): string[] {
    const ids: string[] = [];
    const visit = (list: readonly Message[]) => {
        for (const message of list) {
            if (message.kind !== 'tool-call') continue;
            if (message.tool && isToolCallsSheetSubagentCall(message.tool)) {
                const id = resolveToolTranscriptSidechainId({ tool: message.tool, normalizedToolName: message.tool.name });
                if (id && !ids.includes(id)) ids.push(id);
            }
            if (message.children?.length) visit(message.children);
        }
    };
    visit(messages);
    return ids;
}

async function loadWholeSidechain(sessionId: string, sidechainId: string): Promise<void> {
    if (await sync.ensureSidechainMessagesLoaded(sessionId, sidechainId) !== 'loaded') return;
    for (let page = 0; page < MAX_OLDER_PAGES; page++) {
        const result = await sync.loadOlderSidechainMessages(sessionId, sidechainId);
        if (result.status !== 'loaded' || !result.hasMore) return;
    }
}

/**
 * Loads every page of the sidechains of the subagent calls in `messages`, nested subagents
 * included. The Tool calls sheet uses it, so its diff stats count all edits of its subagents.
 * Each sidechain loads one time per mount, and only while the sheet is open.
 */
export function useLoadAllSubagentSidechains(sessionId: string, messages: readonly Message[]): void {
    const requestedRef = React.useRef(new Set<string>());
    const ids = React.useMemo(() => collectSubagentSidechainIds(messages), [messages]);
    const signature = ids.join('\n');
    React.useEffect(() => {
        for (const id of ids) {
            const key = `${sessionId}\n${id}`;
            if (requestedRef.current.has(key)) continue;
            requestedRef.current.add(key);
            fireAndForget(loadWholeSidechain(sessionId, id), { tag: 'useLoadAllSubagentSidechains' });
        }
        // `signature` stands for `ids`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, signature]);
}
