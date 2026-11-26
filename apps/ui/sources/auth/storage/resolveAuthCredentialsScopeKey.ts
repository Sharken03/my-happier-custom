import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import { isLegacyAuthCredentials, isDataKeyAuthCredentials, type AuthCredentials } from './tokenStorage';

function fingerprintCredentialPart(value: string): string {
    return `sha256:${bytesToHex(sha256(utf8ToBytes(value)))}`;
}

// Screens read the scope key on every render, and the hashes run in JavaScript (about 10 ms per key
// on a phone). Credentials objects are read-only, so one key per object is safe. The WeakMap holds
// no credential material after the object is released.
const scopeKeyByCredentials = new WeakMap<AuthCredentials, string>();

export function resolveAuthCredentialsScopeKey(credentials: AuthCredentials): string {
    const cached = scopeKeyByCredentials.get(credentials);
    if (cached !== undefined) return cached;
    const scopeKey = buildAuthCredentialsScopeKey(credentials);
    scopeKeyByCredentials.set(credentials, scopeKey);
    return scopeKey;
}

function buildAuthCredentialsScopeKey(credentials: AuthCredentials): string {
    if (isLegacyAuthCredentials(credentials)) {
        return [
            'legacy',
            fingerprintCredentialPart(credentials.token),
            fingerprintCredentialPart(credentials.secret),
        ].join('\u0000');
    }
    if (!isDataKeyAuthCredentials(credentials)) return ['token-only', fingerprintCredentialPart(credentials.token)].join('\u0000');
    return [
        'data-key',
        fingerprintCredentialPart(credentials.token),
        fingerprintCredentialPart(credentials.encryption.publicKey),
        fingerprintCredentialPart(credentials.encryption.machineKey),
    ].join('\u0000');
}
