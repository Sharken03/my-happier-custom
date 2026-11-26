import { describe, expect, it } from 'vitest';

import { buildPiExtensionUiStatusBadges, readPiExtensionUiEntries, readPiExtensionUiSnapshot } from './piExtensionUiStatusBadges';

describe('Pi extension status badges', () => {
    it('gives one badge per status, with the widget lines of the matching key', () => {
        const snapshot = readPiExtensionUiSnapshot({
            piExtensionUiV1: {
                v: 1,
                statuses: [{ key: 'plan-mode', text: 'plan ready' }],
                widgets: [{ key: 'plan-mode-plan', lines: ['1. Read the code', '2. Fix it'] }],
            },
        });
        expect(readPiExtensionUiEntries(snapshot)).toEqual([
            { key: 'plan-mode', text: 'plan ready', lines: ['1. Read the code', '2. Fix it'] },
        ]);
        const [badge] = buildPiExtensionUiStatusBadges(snapshot);
        expect(badge).toMatchObject({ key: 'pi-ext:plan-mode', label: 'plan ready' });
        expect(typeof badge?.renderPopover).toBe('function');
    });

    it('shows nothing for a missing or unknown snapshot', () => {
        expect(buildPiExtensionUiStatusBadges(readPiExtensionUiSnapshot({}))).toEqual([]);
        expect(buildPiExtensionUiStatusBadges({ v: 2, statuses: [{ key: 'a', text: 'b' }] })).toEqual([]);
        expect(buildPiExtensionUiStatusBadges({ v: 1, statuses: [], widgets: [] })).toEqual([]);
    });
});
