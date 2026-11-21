import { describe, expect, it } from 'vitest';

import { canonicalizeToolNameForRendering } from './nameInference';

describe('canonicalizeToolNameForRendering (agy parity)', () => {
    it('maps agy command tool name to Bash like pi shell tool', () => {
        expect(canonicalizeToolNameForRendering('command', { command: 'ls -la' })).toBe('Bash');
    });

    it('maps agy command tool name to Bash without input', () => {
        expect(canonicalizeToolNameForRendering('command')).toBe('Bash');
    });

    it('keeps existing agy-compatible aliases', () => {
        expect(canonicalizeToolNameForRendering('read_file', { filePath: '/tmp/a.txt' })).toBe('Read');
        expect(
            canonicalizeToolNameForRendering('write_file', { filePath: '/tmp/a.txt', newText: 'hi' }),
        ).toBe('Write');
        expect(canonicalizeToolNameForRendering('execute', { command: 'ls' })).toBe('Bash');
    });

    it('passes MCP and unknown names through unchanged', () => {
        expect(canonicalizeToolNameForRendering('mcp__fs__read', {})).toBe('mcp__fs__read');
        expect(canonicalizeToolNameForRendering('read_url', { url: 'https://example.com' })).toBe('read_url');
    });
});
