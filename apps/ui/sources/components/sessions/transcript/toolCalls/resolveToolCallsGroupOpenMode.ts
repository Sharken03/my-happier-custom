import type { Settings } from '@/sync/domains/settings/settings';

export type ToolCallsGroupOpenMode = Settings['transcriptToolCallsGroupOpenMode'];

export type ToolCallsGroupOpenModeForPlatformParams = Readonly<{
    appMode: Settings['transcriptToolCallsGroupOpenMode'];
    webMode: Settings['transcriptToolCallsGroupOpenModeWeb'];
    isWeb: boolean;
}>;

/**
 * The app and the web client each keep their own Tool calls group mode. Both live on the account
 * (`transcriptToolCallsGroupOpenMode` for the app, `transcriptToolCallsGroupOpenModeWeb` for the
 * web client), so a phone can open a sheet while a browser shows the list.
 */
export function resolveToolCallsGroupOpenModeForPlatform(
    params: ToolCallsGroupOpenModeForPlatformParams,
): ToolCallsGroupOpenMode {
    return params.isWeb ? params.webMode : params.appMode;
}
