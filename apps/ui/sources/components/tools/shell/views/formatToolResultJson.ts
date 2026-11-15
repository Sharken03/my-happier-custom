/** Results larger than this are never parsed, to keep the UI fast. */
const MAX_FORMAT_CHARS = 200 * 1024;

/** Keys that hold internal metadata and are hidden in the tool detail. */
const INTERNAL_INPUT_KEYS = ['_happier', '_happy'];

/**
 * Returns the text as indented JSON when it holds a JSON object or array.
 * Returns null for anything else (plain text, numbers, strings, too large).
 */
export function formatToolResultJson(text: string): string | null {
    if (text.length > MAX_FORMAT_CHARS) return null;
    const trimmed = text.trim();
    const first = trimmed[0];
    if (first !== '{' && first !== '[') return null;
    try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed === null || typeof parsed !== 'object') return null;
        return JSON.stringify(parsed, null, 2);
    } catch {
        return null;
    }
}

/** Returns the tool input without internal metadata keys. Other values pass through. */
export function stripInternalToolInputKeys<T>(input: T): T {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return input;
    const record = input as Record<string, unknown>;
    if (!INTERNAL_INPUT_KEYS.some((key) => key in record)) return input;
    const copy: Record<string, unknown> = { ...record };
    for (const key of INTERNAL_INPUT_KEYS) delete copy[key];
    return copy as T;
}
