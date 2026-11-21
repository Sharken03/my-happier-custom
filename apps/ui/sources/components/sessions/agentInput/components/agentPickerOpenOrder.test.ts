import { describe, expect, it } from 'vitest';

import { orderOptionsByFrozenIds } from './agentPickerOpenOrder';

type Option = Readonly<{ id: string }>;

function ids(options: ReadonlyArray<Option>): string[] {
    return options.map((option) => option.id);
}

const FAVORITES = { id: 'favorite-models' };
const RUNNING = { id: 'engine:pi' };
const CODEX = { id: 'builtInAgent:codex' };

describe('agent picker open order', () => {
    it('keeps rows that were already shown in their shown order when the source reorders them', () => {
        expect(ids(orderOptionsByFrozenIds([RUNNING, FAVORITES, CODEX], [FAVORITES.id, RUNNING.id, CODEX.id])))
            .toEqual([FAVORITES.id, RUNNING.id, CODEX.id]);
    });

    it('lets a row that arrives while open join where it belongs, not at the end', () => {
        // The rail opens with the running Agent alone; the Favorites view and the rest
        // of the catalog arrive with the machine's answer, the Favorites view first.
        expect(ids(orderOptionsByFrozenIds([FAVORITES, RUNNING, CODEX], [RUNNING.id])))
            .toEqual([FAVORITES.id, RUNNING.id, CODEX.id]);
    });

    it('keeps several late rows in their own order at the position they now hold', () => {
        const claude = { id: 'builtInAgent:claude' };
        expect(ids(orderOptionsByFrozenIds([FAVORITES, RUNNING, CODEX, claude], [RUNNING.id])))
            .toEqual([FAVORITES.id, RUNNING.id, CODEX.id, claude.id]);
    });

    it('keeps a late row after the shown row it follows, even when another late row precedes it', () => {
        const late = { id: 'favorite-models' };
        expect(ids(orderOptionsByFrozenIds([late, RUNNING, CODEX, { id: 'builtInAgent:claude' }], [RUNNING.id, CODEX.id])))
            .toEqual([late.id, RUNNING.id, CODEX.id, 'builtInAgent:claude']);
        expect(ids(orderOptionsByFrozenIds([late, RUNNING, { id: 'builtInAgent:claude' }, CODEX], [RUNNING.id, CODEX.id])))
            .toEqual([late.id, RUNNING.id, 'builtInAgent:claude', CODEX.id]);
    });

    it('appends a late row that follows every row already shown', () => {
        expect(ids(orderOptionsByFrozenIds([RUNNING, CODEX], [RUNNING.id])))
            .toEqual([RUNNING.id, CODEX.id]);
    });

    it('returns the source unchanged when there is nothing to freeze', () => {
        const options = [FAVORITES, RUNNING];
        expect(orderOptionsByFrozenIds(options, [])).toBe(options);
    });
});
