import { describe, expect, it } from 'vitest';
import { formatToolResultJson, stripInternalToolInputKeys } from './formatToolResultJson';

describe('formatToolResultJson', () => {
    it('formats a JSON object', () => {
        expect(formatToolResultJson('{"a":1,"b":[2]}')).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}');
    });

    it('formats a JSON array with surrounding whitespace', () => {
        expect(formatToolResultJson('  \n[1,2]\n ')).toBe('[\n  1,\n  2\n]');
    });

    it('returns null for plain text, numbers, strings and null', () => {
        expect(formatToolResultJson('hello')).toBeNull();
        expect(formatToolResultJson('42')).toBeNull();
        expect(formatToolResultJson('"text"')).toBeNull();
        expect(formatToolResultJson('null')).toBeNull();
    });

    it('returns null for invalid JSON', () => {
        expect(formatToolResultJson('{"a":')).toBeNull();
    });

    it('returns null for text over the size limit', () => {
        expect(formatToolResultJson(`["${'x'.repeat(200 * 1024)}"]`)).toBeNull();
    });
});

describe('stripInternalToolInputKeys', () => {
    it('removes _happier and _happy and keeps other keys', () => {
        expect(stripInternalToolInputKeys({ a: 1, _happier: { x: 1 }, _happy: {} })).toEqual({ a: 1 });
    });

    it('returns the same object when no internal key exists', () => {
        const input = { a: 1 };
        expect(stripInternalToolInputKeys(input)).toBe(input);
    });

    it('passes non-objects through', () => {
        expect(stripInternalToolInputKeys('x')).toBe('x');
        expect(stripInternalToolInputKeys(null)).toBeNull();
        const arr = [1];
        expect(stripInternalToolInputKeys(arr)).toBe(arr);
    });
});
