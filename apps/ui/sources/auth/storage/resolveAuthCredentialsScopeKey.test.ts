import { describe, expect, it, vi } from 'vitest';

const hashCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('@noble/hashes/sha2', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@noble/hashes/sha2')>();
    return {
        ...actual,
        sha256: (input: Uint8Array) => {
            hashCalls.count += 1;
            return actual.sha256(input);
        },
    };
});

import { resolveAuthCredentialsScopeKey } from './resolveAuthCredentialsScopeKey';

describe('resolveAuthCredentialsScopeKey', () => {
    it('does not embed raw legacy credential material', () => {
        const credentials = {
            token: 'RAW_TOKEN_VALUE_THAT_MUST_NOT_APPEAR_IN_SCOPE_KEY',
            secret: 'RAW_SECRET_VALUE_THAT_MUST_NOT_APPEAR_IN_SCOPE_KEY',
        } as const;

        const scopeKey = resolveAuthCredentialsScopeKey(credentials);

        expect(scopeKey).toContain('legacy');
        expect(scopeKey).not.toContain(credentials.token);
        expect(scopeKey).not.toContain(credentials.secret);
        expect(resolveAuthCredentialsScopeKey({ ...credentials })).toBe(scopeKey);
        expect(resolveAuthCredentialsScopeKey({ ...credentials, secret: `${credentials.secret}_changed` })).not.toBe(scopeKey);
    });

    it('does not embed raw data-key credential material', () => {
        const credentials = {
            token: 'RAW_DATA_KEY_TOKEN_VALUE_THAT_MUST_NOT_APPEAR',
            encryption: {
                publicKey: 'RAW_PUBLIC_KEY_VALUE_THAT_MUST_NOT_APPEAR',
                machineKey: 'RAW_MACHINE_KEY_VALUE_THAT_MUST_NOT_APPEAR',
            },
        } as const;

        const scopeKey = resolveAuthCredentialsScopeKey(credentials);

        expect(scopeKey).toContain('data-key');
        expect(scopeKey).not.toContain(credentials.token);
        expect(scopeKey).not.toContain(credentials.encryption.publicKey);
        expect(scopeKey).not.toContain(credentials.encryption.machineKey);
        expect(resolveAuthCredentialsScopeKey({ ...credentials })).toBe(scopeKey);
        expect(resolveAuthCredentialsScopeKey({
            ...credentials,
            encryption: {
                ...credentials.encryption,
                machineKey: `${credentials.encryption.machineKey}_changed`,
            },
        })).not.toBe(scopeKey);
    });

    it('hashes a credentials object once, however often its scope key is read', () => {
        const credentials = {
            token: 'TOKEN_READ_ON_EVERY_RENDER',
            encryption: { publicKey: 'PUBLIC_KEY', machineKey: 'MACHINE_KEY' },
        } as const;

        const first = resolveAuthCredentialsScopeKey(credentials);
        const hashesForFirstRead = hashCalls.count;
        expect(resolveAuthCredentialsScopeKey(credentials)).toBe(first);
        expect(resolveAuthCredentialsScopeKey(credentials)).toBe(first);

        expect(hashCalls.count).toBe(hashesForFirstRead);
    });
});
