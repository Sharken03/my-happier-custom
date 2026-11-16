import { Platform } from 'react-native';

import { isTauriDesktop } from '@/utils/platform/tauri';

/**
 * A browser tab: the web build outside the desktop shell. The desktop app (Tauri) also reports
 * `Platform.OS === 'web'`, so it is not a browser web client.
 */
export function isBrowserWebClient(): boolean {
    return Platform.OS === 'web' && !isTauriDesktop();
}
