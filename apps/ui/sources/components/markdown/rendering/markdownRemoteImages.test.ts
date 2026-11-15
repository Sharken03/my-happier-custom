import { describe, expect, it } from 'vitest';

import {
    isAllowedMarkdownRemoteImageUrl,
    normalizeMarkdownRemoteImageHosts,
    parseMarkdownRemoteImageHostsText,
    readStandaloneMarkdownRemoteImage,
    resolveMarkdownRemoteImageHosts,
} from './markdownRemoteImages';

const hosts = ['happy.example.org'];

describe('markdown remote image hosts', () => {
    it('normalizes typed hosts and drops invalid ones', () => {
        expect(parseMarkdownRemoteImageHostsText('https://Happy.Example.org/files, cdn.example.org\nhappy.example.org bad_host user@x.org x.org:8443'))
            .toEqual(['happy.example.org', 'cdn.example.org']);
        expect(normalizeMarkdownRemoteImageHosts('happy.example.org')).toEqual([]);
    });

    it('gives no hosts while the setting is off', () => {
        expect(resolveMarkdownRemoteImageHosts({ enabled: false, hosts })).toEqual([]);
        expect(resolveMarkdownRemoteImageHosts({ enabled: true, hosts })).toEqual(hosts);
    });

    it('allows only https URLs on an exact allowed host', () => {
        expect(isAllowedMarkdownRemoteImageUrl('https://happy.example.org/files/a.webp', hosts)).toBe(true);
        expect(isAllowedMarkdownRemoteImageUrl('http://happy.example.org/files/a.webp', hosts)).toBe(false);
        expect(isAllowedMarkdownRemoteImageUrl('https://evil.happy.example.org/a.png', hosts)).toBe(false);
        expect(isAllowedMarkdownRemoteImageUrl('https://happy.example.org.evil.com/a.png', hosts)).toBe(false);
        expect(isAllowedMarkdownRemoteImageUrl('https://user@happy.example.org/a.png', hosts)).toBe(false);
        expect(isAllowedMarkdownRemoteImageUrl('https://happy.example.org/a.png', [])).toBe(false);
    });
});

describe('readStandaloneMarkdownRemoteImage', () => {
    it('reads a paragraph that is only one allowed image', () => {
        expect(readStandaloneMarkdownRemoteImage('![Chart](https://happy.example.org/files/c.webp)\n', hosts))
            .toEqual({ url: 'https://happy.example.org/files/c.webp', alt: 'Chart' });
        expect(readStandaloneMarkdownRemoteImage('![](<https://happy.example.org/c.png> "title")', hosts))
            .toEqual({ url: 'https://happy.example.org/c.png', alt: '' });
    });

    it('leaves inline, foreign and malformed images to the drop policy', () => {
        expect(readStandaloneMarkdownRemoteImage('See ![c](https://happy.example.org/c.png)', hosts)).toBeNull();
        expect(readStandaloneMarkdownRemoteImage('![c](https://other.org/c.png)', hosts)).toBeNull();
        expect(readStandaloneMarkdownRemoteImage('![a](https://happy.example.org/a.png) ![b](https://happy.example.org/b.png)', hosts)).toBeNull();
        expect(readStandaloneMarkdownRemoteImage('![c](javascript:alert(1))', hosts)).toBeNull();
        expect(readStandaloneMarkdownRemoteImage('![c](https://happy.example.org/c.png)', [])).toBeNull();
    });
});
