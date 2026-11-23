/**
 * Colors of the composer buttons while the setting composerFilledButtonsV1 is on:
 * a gray fill behind every button and an orange send button.
 * Fixed values, one set for light themes and one for dark themes.
 */
export const COMPOSER_SEND_ACCENT = '#D97757';
export const COMPOSER_SEND_ACCENT_TINT = '#FFFFFF';

export type ComposerFilledButtonColors = Readonly<{
    /** Fill behind the chips, the action buttons and the idle microphone. */
    fill: string;
    /** Send button with nothing to send yet. */
    dimAccent: string;
    dimAccentTint: string;
}>;

const LIGHT: ComposerFilledButtonColors = { fill: '#ECEAE4', dimAccent: '#EFB9A6', dimAccentTint: '#FFFFFF' };
const DARK: ComposerFilledButtonColors = { fill: '#382F2F', dimAccent: '#6E3F30', dimAccentTint: '#E9C9BD' };

export function resolveComposerFilledButtonColors(dark: boolean): ComposerFilledButtonColors {
    return dark ? DARK : LIGHT;
}
