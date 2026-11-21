import * as React from 'react';

/**
 * Keeps an open picker's rail in the order it was first shown.
 *
 * Rows that were already on screen never swap places under the reader while the
 * popover stays open — selecting an Agent sends the favorites to the front of the
 * source list, and a rail that reordered mid-read would move the row just touched.
 *
 * A row that only appears after opening is a different matter: it was not on screen
 * to move. Appending it would also hand it a place nobody chose, so a late Favorites
 * view would read as the last resort after the Agents it only helps choose between.
 * It therefore joins where it currently belongs — before the first row shown so far
 * that it precedes today, or at the end when it precedes none of them.
 */
export function orderOptionsByFrozenIds<Option extends Readonly<{ id: string }>>(
    options: ReadonlyArray<Option>,
    frozenIds: readonly string[],
): ReadonlyArray<Option> {
    if (options.length <= 1 || frozenIds.length === 0) return options;

    const optionById = new Map(options.map((option) => [option.id, option]));
    const frozenRank = new Map(frozenIds.map((id, index) => [id, index] as const));
    const seenIds = new Set<string>();

    const orderedOptions: Option[] = [];
    for (const id of frozenIds) {
        const option = optionById.get(id);
        if (!option) continue;
        seenIds.add(id);
        orderedOptions.push(option);
    }

    // Place each late row against the rows already shown, in the order it holds now.
    // The anchor's position is read live: an earlier late row may already have moved
    // it, and a frozen index would then drop this row on the wrong side of a shown one.
    for (let index = 0; index < options.length; index += 1) {
        const option = options[index]!;
        if (seenIds.has(option.id)) continue;
        seenIds.add(option.id);
        const anchor = options.slice(index + 1).find((candidate) => frozenRank.has(candidate.id)) ?? null;
        if (!anchor) {
            orderedOptions.push(option);
            continue;
        }
        const anchorIndex = orderedOptions.findIndex((candidate) => candidate.id === anchor.id);
        orderedOptions.splice(anchorIndex, 0, option);
    }

    return orderedOptions;
}

/**
 * Which options an open picker should show, in the order it opened with.
 *
 * The order is captured on the first frame the picker is open, so later source
 * changes cannot move a row the reader is already looking at; closing and
 * reopening takes a fresh snapshot.
 */
export function useOpenStableAgentPickerOptions<Option extends Readonly<{ id: string }>>(
    options: ReadonlyArray<Option>,
    open: boolean,
): ReadonlyArray<Option> {
    const openOrderRef = React.useRef<readonly string[] | null>(null);

    if (!open) {
        openOrderRef.current = null;
        return options;
    }

    if (!openOrderRef.current) {
        openOrderRef.current = options.map((option) => option.id);
        return options;
    }

    return orderOptionsByFrozenIds(options, openOrderRef.current);
}
