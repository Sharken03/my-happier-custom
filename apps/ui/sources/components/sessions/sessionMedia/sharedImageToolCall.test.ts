import { describe, expect, it } from 'vitest';

import type { ToolCallMessage } from '@/sync/domains/messages/messageTypes';

import { isShowImageToolCall, resolveSharedImageToolCallPresentation } from './sharedImageToolCall';

const imagePath = '.happier/uploads/artifacts/show-image/chart.png';

function toolCallMessage(params: Readonly<{
    name: string;
    input?: unknown;
    state?: ToolCallMessage['tool']['state'];
    withMedia?: boolean;
}>): ToolCallMessage {
    return {
        kind: 'tool-call', id: 'm1', localId: null, createdAt: 1, children: [],
        tool: {
            id: 't1', name: params.name, state: params.state ?? 'completed',
            input: params.input ?? { path: 'chart.png' },
            createdAt: 1, startedAt: 1, completedAt: 2, description: null, result: {},
        },
        ...(params.withMedia === false ? {} : {
            meta: { happierMedia: { kind: 'session_media.v1', payload: { media: [{
                id: 'media-1', role: 'output', category: 'tool-artifact', mediaKind: 'image',
                mimeType: 'image/png', name: 'chart.png', path: imagePath, sizeBytes: 80,
                width: 1200, height: 800,
                origin: { source: 'tool-output', toolCallId: 't1' },
            }] } } },
        }),
    };
}

describe('isShowImageToolCall', () => {
    it('recognizes the raw MCP name and the canonical name the CLI stores', () => {
        expect(isShowImageToolCall(toolCallMessage({ name: 'mcp__happier__show_image' }).tool)).toBe(true);
        expect(isShowImageToolCall(toolCallMessage({
            name: 'mcp__happier__show_image',
            input: { path: 'chart.png', _happier: { v: 2, canonicalToolName: 'show_image' } },
        }).tool)).toBe(true);
        expect(isShowImageToolCall(toolCallMessage({ name: 'Read' }).tool)).toBe(false);
    });
});

describe('resolveSharedImageToolCallPresentation', () => {
    it('returns the images and the caption of a finished show_image call', () => {
        const presentation = resolveSharedImageToolCallPresentation(toolCallMessage({
            name: 'show_image',
            input: { path: 'chart.png', caption: '  Sales by month  ' },
        }));
        expect(presentation?.images.map((image) => image.path)).toEqual([imagePath]);
        expect(presentation?.caption).toBe('Sales by month');
    });

    it('returns null when the call has no image yet, failed, or is another tool', () => {
        expect(resolveSharedImageToolCallPresentation(toolCallMessage({ name: 'show_image', state: 'running', withMedia: false }))).toBeNull();
        expect(resolveSharedImageToolCallPresentation(toolCallMessage({ name: 'show_image', state: 'error' }))).toBeNull();
        expect(resolveSharedImageToolCallPresentation(toolCallMessage({ name: 'Read' }))).toBeNull();
    });
});
