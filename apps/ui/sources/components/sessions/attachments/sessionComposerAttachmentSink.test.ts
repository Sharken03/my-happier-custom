import { describe, expect, it, vi } from 'vitest';

import {
    addAttachmentsToSessionComposer,
    hasSessionComposerAttachmentSink,
    registerSessionComposerAttachmentSink,
} from './sessionComposerAttachmentSink';

const source = { kind: 'native' as const, uri: 'file:///cache/markup.png', name: 'markup.png', mimeType: 'image/png' };

describe('sessionComposerAttachmentSink', () => {
    it('hands attachments to the composer that owns the session draft', () => {
        const add = vi.fn();
        const unregister = registerSessionComposerAttachmentSink('s1', add);

        expect(hasSessionComposerAttachmentSink('s1')).toBe(true);
        expect(addAttachmentsToSessionComposer('s1', [source])).toBe(true);
        expect(add).toHaveBeenCalledWith([source]);

        unregister();
        expect(hasSessionComposerAttachmentSink('s1')).toBe(false);
        expect(addAttachmentsToSessionComposer('s1', [source])).toBe(false);
    });

    it('keeps the newer sink when an older one unregisters late', () => {
        const older = vi.fn();
        const newer = vi.fn();
        const unregisterOlder = registerSessionComposerAttachmentSink('s2', older);
        const unregisterNewer = registerSessionComposerAttachmentSink('s2', newer);

        unregisterOlder();
        addAttachmentsToSessionComposer('s2', [source]);

        expect(older).not.toHaveBeenCalled();
        expect(newer).toHaveBeenCalledTimes(1);
        unregisterNewer();
    });

    it('ignores empty session ids', () => {
        expect(hasSessionComposerAttachmentSink('')).toBe(false);
        expect(addAttachmentsToSessionComposer(null, [source])).toBe(false);
    });
});
