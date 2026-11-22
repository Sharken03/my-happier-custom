const MODEL_LABEL_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Sorts model picker entries by their shown label, ignoring case and comparing digit runs as
 * numbers (`GPT 6.2` before `GPT 6.10`). The `default` entry ("use CLI settings") is not a
 * model, so it stays in front of the sorted models.
 */
export function sortModelPickerEntriesByLabel<T>(
    entries: readonly T[],
    read: (entry: T) => Readonly<{ value: string; label: string }>,
): T[] {
    const defaults: T[] = [];
    const models: T[] = [];
    for (const entry of entries) {
        (read(entry).value === 'default' ? defaults : models).push(entry);
    }
    models.sort((a, b) => MODEL_LABEL_COLLATOR.compare(read(a).label, read(b).label));
    return [...defaults, ...models];
}
