/**
 * Markdown images from allowed hosts (8T fork setting, off by default).
 *
 * The enriched renderer drops every markdown image on purpose (`applyEnrichedMarkdownImagePolicy`):
 * a remote image can track the reader, and its height is unknown until it loads. With the setting
 * on, a paragraph or a paragraph line that is only one image from an allowed https host becomes its
 * own segment, which `MarkdownRemoteImage` paints in a fixed 16:9 box. Every other image stays dropped.
 */

const HOST_PATTERN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

// `![alt](<url> "title")`: one image and nothing else in the paragraph.
const STANDALONE_IMAGE_PATTERN = /^!\[([^\]\n]*)\]\(\s*<?(https:\/\/[^\s<>()]+)>?(?:\s+"[^"\n]*")?\s*\)$/i;

/** One host from user input: `https://Example.org/path` and `example.org` both give `example.org`. */
function normalizeHost(raw: string): string | null {
    let value = raw.trim().toLowerCase();
    if (!value) return null;
    value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
    value = value.split(/[/?#]/, 1)[0] ?? '';
    if (value.includes('@') || value.includes(':')) return null;
    value = value.replace(/\.$/, '');
    return HOST_PATTERN.test(value) ? value : null;
}

/** The allowed hosts as stored: valid, lower case, no duplicates, in the user's order. */
export function normalizeMarkdownRemoteImageHosts(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const hosts: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== 'string') continue;
        const host = normalizeHost(entry);
        if (host && !hosts.includes(host)) hosts.push(host);
    }
    return hosts;
}

/** The settings text field: hosts split on commas, spaces or new lines. */
export function parseMarkdownRemoteImageHostsText(text: string): string[] {
    return normalizeMarkdownRemoteImageHosts(text.split(/[\s,]+/));
}

/** The hosts the transcript uses: none while the setting is off. */
export function resolveMarkdownRemoteImageHosts(params: Readonly<{ enabled: unknown; hosts: unknown }>): readonly string[] {
    return params.enabled === true ? normalizeMarkdownRemoteImageHosts(params.hosts) : [];
}

export function isAllowedMarkdownRemoteImageUrl(url: string, hosts: readonly string[]): boolean {
    if (hosts.length === 0) return false;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    return hosts.includes(parsed.hostname.toLowerCase().replace(/\.$/, ''));
}

export type MarkdownRemoteImage = Readonly<{ url: string; alt: string }>;

/** The image of a paragraph that is only one image from an allowed host, else null. */
export function readStandaloneMarkdownRemoteImage(source: string, hosts: readonly string[]): MarkdownRemoteImage | null {
    if (hosts.length === 0) return null;
    const match = source.trim().match(STANDALONE_IMAGE_PATTERN);
    if (!match) return null;
    const url = match[2]!;
    if (!isAllowedMarkdownRemoteImageUrl(url, hosts)) return null;
    return { url, alt: match[1]!.trim() };
}
