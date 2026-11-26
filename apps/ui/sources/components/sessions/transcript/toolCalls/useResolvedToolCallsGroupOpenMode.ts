import * as React from 'react';

import { useSetting } from '@/sync/domains/state/storage';
import { isBrowserWebClient } from '@/utils/platform/browserWeb';
import {
    resolveToolCallsGroupOpenModeForPlatform,
    type ToolCallsGroupOpenMode,
} from '@/components/sessions/transcript/toolCalls/resolveToolCallsGroupOpenMode';

/** The Tool calls group mode of the client that runs now: the app's value or the web's value. */
export function useResolvedToolCallsGroupOpenMode(): ToolCallsGroupOpenMode {
    const appMode = useSetting('transcriptToolCallsGroupOpenMode');
    const webMode = useSetting('transcriptToolCallsGroupOpenModeWeb');
    const isWeb = isBrowserWebClient();
    return React.useMemo(
        () => resolveToolCallsGroupOpenModeForPlatform({ appMode, webMode, isWeb }),
        [appMode, webMode, isWeb],
    );
}
