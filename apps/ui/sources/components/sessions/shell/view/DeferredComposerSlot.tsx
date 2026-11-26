import * as React from 'react';
import { View } from 'react-native';

import { storage } from '@/sync/domains/state/storage';

import {
    readRememberedComposerHeight,
    rememberComposerHeight,
    useDeferredComposerAfterOpen,
    type DeferredComposerOptions,
} from './useDeferredComposerAfterOpen';

/** True when the transcript has loaded rows, so it has something to show before the composer. */
export function hasLoadedTranscriptRows(sessionId: string): boolean {
    const entry = storage.getState().sessionMessages[sessionId];
    return entry?.isLoaded === true && (entry.messageIdsOldestFirst?.length ?? 0) > 0;
}

const deferredComposerOptions: DeferredComposerOptions = {
    shouldWaitForTranscriptReveal: hasLoadedTranscriptRows,
};

/**
 * The composer of an open session, held back while the session opens (setting
 * sessionOpenDeferComposerV1). The hold state lives here, so its release renders the composer
 * only, not the whole session view.
 */
export function DeferredComposerSlot(props: Readonly<{
    sessionId: string;
    enabled: boolean;
    children: React.ReactNode;
}>) {
    const ready = useDeferredComposerAfterOpen(props.sessionId, props.enabled, deferredComposerOptions);
    if (!ready) {
        // Placeholder with the last composer height, so the transcript does not move when the
        // composer mounts.
        return <View style={{ height: readRememberedComposerHeight() }} />;
    }
    return (
        <View onLayout={(event) => rememberComposerHeight(event.nativeEvent.layout.height)}>
            {props.children}
        </View>
    );
}
