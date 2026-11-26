#!/usr/bin/env node
/**
 * Prune superseded build caches.
 *
 * The repository's Actions cache budget is 10 GB and the modules cache alone is ~1.6 GB per
 * install scope. On 15/11-2026 the node_modules entries pushed everything else out of the
 * budget, so every build installed from scratch. The publish action already keeps only the
 * newest Metro and ccache entry per kind; this covers the two families it does not touch:
 *
 *   modules-v1-<os>-<arch>-<node>-<libc>-<tree>-<scope>-<lockfile hash>
 *   setup-java-…-gradle-<hash> / setup-gradle-…            (gradle/actions/setup-gradle)
 *
 * A modules entry is only usable by the exact tree that produced it, so when yarn.lock or a
 * workspace manifest changes, the previous entry can never be restored again. Those are what
 * this deletes: within one identity (everything except the trailing hash) keep the newest
 * keepPerGroup, and never touch anything younger than minAgeDays — another workflow's run may
 * be about to restore it, and a needless miss costs a full install.
 *
 * Usage: node scripts/ci/prune-build-caches.mjs [--dry-run]
 * Env:   GH_TOKEN, GH_REPO, PRUNE_KEEP_MODULES (2), PRUNE_KEEP_GRADLE (1), PRUNE_MIN_AGE_DAYS (7)
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `modules-v1-Linux-X64-24.22.1-2.39-default-ui+protocol-<hash>` -> identity without the hash. */
function modulesIdentity(key) {
    const match = /^(modules-v1-.+)-[0-9a-f]{40,64}$/.exec(key);
    return match ? match[1] : null;
}

function gradleIdentity(key) {
    return /(^|-)(setup-java|setup-gradle)-/.test(key) ? 'gradle' : null;
}

/**
 * Pure decision function: which cache ids to delete, and why.
 *
 * @param {Array<{id: number, key: string, sizeInBytes: number, createdAt: string}>} entries
 * @param {{ now: number, minAgeDays: number, keepModules: number, keepGradle: number }} options
 */
export function planPrune(entries, options) {
    const { now, minAgeDays, keepModules, keepGradle } = options;
    const groups = new Map();
    for (const entry of entries) {
        const identity = modulesIdentity(entry.key) ?? gradleIdentity(entry.key);
        if (!identity) continue;
        const limit = modulesIdentity(entry.key) ? keepModules : keepGradle;
        const group = groups.get(identity) ?? { identity, limit, entries: [] };
        group.entries.push(entry);
        groups.set(identity, group);
    }

    const deletions = [];
    const kept = [];
    for (const group of groups.values()) {
        const createdAt = (entry) => {
            const parsed = Date.parse(entry.createdAt);
            return Number.isFinite(parsed) ? parsed : null;
        };
        const ordered = [...group.entries].sort((a, b) => (createdAt(b) ?? Infinity) - (createdAt(a) ?? Infinity));
        ordered.forEach((entry, index) => {
            const created = createdAt(entry);
            const ageDays = created === null ? null : (now - created) / DAY_MS;
            if (index < group.limit) {
                kept.push({ ...entry, reason: 'newest in its group' });
            } else if (ageDays === null) {
                // An entry with no readable timestamp is never provably old, so it stays.
                kept.push({ ...entry, reason: 'no usable createdAt' });
            } else if (ageDays < minAgeDays) {
                kept.push({ ...entry, reason: `younger than ${minAgeDays} d` });
            } else {
                deletions.push({ ...entry, reason: `superseded and ${Math.floor(ageDays)} d old` });
            }
        });
    }
    return {
        deletions,
        kept,
        freedBytes: deletions.reduce((sum, entry) => sum + (entry.sizeInBytes ?? 0), 0),
    };
}

function ghCacheList(repo) {
    const result = spawnSync('gh', ['cache', 'list', '--limit', '200', '--sort', 'created_at', '--order', 'desc',
        '--json', 'id,key,sizeInBytes,createdAt', '--repo', repo], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`gh cache list failed: ${result.stderr}`);
    return JSON.parse(result.stdout);
}

function ghCacheDelete(repo, id) {
    const result = spawnSync('gh', ['cache', 'delete', String(id), '--repo', repo], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`gh cache delete ${id} failed: ${result.stderr}`);
}

function main(argv) {
    const dryRun = argv.includes('--dry-run');
    const repo = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY;
    if (!repo) throw new Error('GH_REPO or GITHUB_REPOSITORY is required');
    const options = {
        now: Date.now(),
        minAgeDays: Number(process.env.PRUNE_MIN_AGE_DAYS ?? 7),
        keepModules: Number(process.env.PRUNE_KEEP_MODULES ?? 2),
        keepGradle: Number(process.env.PRUNE_KEEP_GRADLE ?? 1),
    };

    const entries = ghCacheList(repo);
    const plan = planPrune(entries, options);
    const mib = (bytes) => `${(bytes / (1024 * 1024)).toFixed(0)} MiB`;
    process.stdout.write(`cache prune: ${entries.length} entries seen, keeping ${plan.kept.length}, `
        + `deleting ${plan.deletions.length} (${mib(plan.freedBytes)})\n`);
    for (const entry of plan.deletions) {
        process.stdout.write(`  delete ${entry.key} (${mib(entry.sizeInBytes ?? 0)}, ${entry.reason})${dryRun ? ' [dry run]' : ''}\n`);
        if (!dryRun) ghCacheDelete(repo, entry.id);
    }
    for (const entry of plan.kept) {
        process.stdout.write(`  keep   ${entry.key} (${entry.reason})\n`);
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
