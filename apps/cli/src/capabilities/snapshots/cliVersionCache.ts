import { open, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { AsyncTtlCache } from '@happier-dev/protocol';

import { logger } from '@/ui/logger';

export type CliVersionProbeResult = Readonly<{ version: string | null; successful: boolean }>;

type VersionFact = Readonly<{ identity: string; version: string }>;

type ExecutableIdentity = Readonly<{ identity: string; manifestVersion: string | null }>;

/** Inventory reuse only; launch/install verification continues to own its fresh probes. */
export class CliVersionCache {
    // One current executable fact per provider, rather than one entry per historical fingerprint.
    #caches = new Map<string, AsyncTtlCache<VersionFact>>();

    clear(): void {
        // Pending probes may finish, but can publish only into their retired cache instance.
        this.#caches = new Map<string, AsyncTtlCache<VersionFact>>();
    }

    async read(params: Readonly<{
        name: string;
        resolvedPath: string;
        nativeInstall: boolean;
        fresh: boolean;
        probeKey: string;
        probe: () => Promise<CliVersionProbeResult>;
    }>): Promise<string | null> {
        let cache = this.#caches.get(params.name);
        if (!cache || params.fresh) {
            cache = new AsyncTtlCache<VersionFact>({ successTtlMs: Infinity, errorTtlMs: 0 });
            this.#caches.set(params.name, cache);
        }
        const executable = await readExecutableIdentity(params.resolvedPath, params.nativeInstall);
        // Ordinary listings take the version a package declares for its bin script; starting a
        // JavaScript CLI can take longer than the inventory budget.
        if (!params.fresh && executable?.manifestVersion) return executable.manifestVersion;
        const identity = executable?.identity ?? null;
        const cached = cache.get(params.name);
        if (!params.fresh && identity && cached?.kind === 'success' && cached.value.identity === identity) {
            return cached.value.version;
        }
        const run = async () => {
            const { version, successful } = await params.probe();
            // Updates may retarget a launcher while the bounded process probe is running.
            // Admit only an observation bracketed by the same executable identity.
            if (successful && identity && version && (await readExecutableIdentity(params.resolvedPath, params.nativeInstall))?.identity === identity) {
                cache.setSuccess(params.name, { identity, version });
            }
            return version;
        };
        // Explicit recovery never waits on an older ordinary observation. Only the existing
        // bounded process probe is coalesced; filesystem identity reads happen beforehand.
        return params.fresh ? await run() : await cache.runDedupe(
            JSON.stringify([params.name, params.resolvedPath, identity, params.probeKey]), run,
        );
    }
}

async function readExecutableIdentity(path: string, nativeInstall: boolean): Promise<ExecutableIdentity | null> {
    const native = nativeInstall ? await readNativeExecutableIdentity(path) : null;
    return native ? { identity: native, manifestVersion: null } : await readPackageBinIdentity(path);
}

/**
 * A package manager install (npm, for example) links the command to a bin script of a package.
 * The script can load other files, but an update of the package also rewrites its manifest, so
 * the script and the manifest together identify the installed version, and the manifest
 * declares it. A local build that keeps the manifest version reports that version.
 */
async function readPackageBinIdentity(path: string): Promise<ExecutableIdentity | null> {
    try {
        const resolved = await realpath(path);
        // The nearest manifest owns the script.
        let dir = dirname(resolved);
        for (let depth = 0; depth < 6; depth += 1) {
            const manifestPath = join(dir, 'package.json');
            const manifestInfo = await stat(manifestPath).catch(() => null);
            if (manifestInfo) {
                const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { bin?: unknown; version?: unknown };
                const bin = manifest.bin;
                const entries = typeof bin === 'string' ? [bin]
                    : bin && typeof bin === 'object' ? Object.values(bin as Record<string, unknown>) : [];
                if (!entries.some(entry => typeof entry === 'string' && resolve(dir, entry) === resolved)) return null;
                const info = await stat(resolved);
                const identity = JSON.stringify([
                    resolved, info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs,
                    manifestPath, manifestInfo.dev, manifestInfo.ino, manifestInfo.size, manifestInfo.mtimeMs, manifestInfo.ctimeMs,
                ]);
                const version = typeof manifest.version === 'string' ? manifest.version.trim() : '';
                return { identity, manifestVersion: version || null };
            }
            const parent = dirname(dir);
            if (parent === dir) return null;
            dir = parent;
        }
        return null;
    } catch {
        // No readable package: probe without version reuse.
        return null;
    }
}

async function readNativeExecutableIdentity(path: string): Promise<string | null> {
    try {
        const resolved = await realpath(path);
        const file = await open(resolved, 'r');
        try {
            const header = Buffer.alloc(4);
            const { bytesRead } = await file.read(header, 0, header.length, 0);
            if (bytesRead < 4) return null;
            const magic = header.readUInt32BE(0);
            // Eligibility, not executable validation: exclude opaque script/shim launchers.
            const native = magic === 0x7f454c46 // ELF
                || header.subarray(0, 2).toString('ascii') === 'MZ' // PE
                || [0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic); // Mach-O
            if (!native) return null;
            const info = await file.stat();
            return JSON.stringify([resolved, info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs]);
        } finally { await file.close(); }
    } catch (error) {
        logger.warn('[capabilities] Native CLI version identity unavailable; probing without version reuse', { error });
        return null;
    }
}
