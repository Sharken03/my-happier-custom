import { maybeParseJson } from '@happier-dev/protocol';
import { isShowImageToolNameAlias } from '@happier-dev/protocol/tools/v2';

import { canonicalizeToolNameForRendering } from '@/components/tools/normalization/normalize/nameInference';
import type { ToolCall, ToolCallMessage } from '@/sync/domains/messages/messageTypes';
import {
    parseSessionMediaMessageMeta,
    type SessionMediaInlineImageSummary,
} from '@/sync/domains/sessionMedia/sessionMediaMessageMeta';

import { resolveSessionMediaImageMimeType } from './sessionMediaPresentation';

export type SharedImageToolCallPresentation = Readonly<{
    images: readonly SessionMediaInlineImageSummary[];
    caption: string | null;
}>;

/** Is this a call to the Happier `show_image` tool, by its canonical rendering name? */
export function isShowImageToolCall(tool: Pick<ToolCall, 'name' | 'input' | 'description'>): boolean {
    return isShowImageToolNameAlias(canonicalizeToolNameForRendering(tool.name, maybeParseJson(tool.input), tool.description));
}

function readCaption(input: unknown): string | null {
    const parsed = maybeParseJson(input);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const caption = (parsed as Record<string, unknown>).caption;
    if (typeof caption !== 'string') return null;
    const trimmed = caption.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * What the transcript draws for a `show_image` call: its images and the optional caption. Null
 * while the call has no image (still running, failed, no media): the row is then a tool call.
 * The row renderer and the row height estimate both read this, so they agree on the shape.
 */
export function resolveSharedImageToolCallPresentation(message: ToolCallMessage): SharedImageToolCallPresentation | null {
    const tool = message.tool;
    if (!tool || tool.state === 'error' || !isShowImageToolCall(tool)) return null;
    const images = parseSessionMediaMessageMeta(message.meta).inlineImages
        .filter((image) => resolveSessionMediaImageMimeType(image) !== null);
    if (images.length === 0) return null;
    return { images, caption: readCaption(tool.input) };
}
