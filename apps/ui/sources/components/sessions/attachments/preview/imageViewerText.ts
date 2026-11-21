const ELLIPSIS = '...';
const MAX_KEPT_EXTENSION_LENGTH = 6;

/**
 * Shortens a file name in the middle and keeps its extension, for example "1000....jpg".
 * React Native Web cannot ellipsize in the middle, so the viewer shortens the text itself.
 */
export function truncateFileNameMiddle(name: string, maxLength: number): string {
    if (name.length <= maxLength) return name;
    const dot = name.lastIndexOf('.');
    const extension = dot > 0 && name.length - dot <= MAX_KEPT_EXTENSION_LENGTH ? name.slice(dot) : '';
    const room = maxLength - ELLIPSIS.length - extension.length;
    if (extension && room >= 1) {
        return `${name.slice(0, room)}${ELLIPSIS}${extension}`;
    }
    const keep = Math.max(1, maxLength - ELLIPSIS.length);
    const head = Math.ceil(keep / 2);
    const tail = keep - head;
    return `${name.slice(0, head)}${ELLIPSIS}${tail > 0 ? name.slice(-tail) : ''}`;
}
