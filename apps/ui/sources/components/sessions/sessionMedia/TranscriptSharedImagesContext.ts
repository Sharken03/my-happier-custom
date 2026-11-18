import * as React from 'react';

/**
 * Set by the main transcript list while the account shows images the agent shares
 * (`transcriptSharedImagesEnabled`). The width is the one the row height estimate reads, so a
 * `show_image` row paints the box the estimate sized. Without a provider (tool sheet, previews,
 * other lists) a `show_image` call renders as a normal tool call.
 */
export type TranscriptSharedImages = Readonly<{
    transcriptContentWidthPx: number;
}>;

export const TranscriptSharedImagesContext = React.createContext<TranscriptSharedImages | null>(null);
