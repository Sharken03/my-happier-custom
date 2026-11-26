#!/usr/bin/env node
/**
 * Structural manifest for the cached `node_modules` tree.
 *
 * Why this exists: yarn v1 refuses to report a restored tree as "Already up-to-date"
 * in this workspace repo (its pre-install lockfile comparison never matches the
 * post-install `.yarn-integrity` it saved), so `yarn install` on a cache hit always
 * spends a full resolve/link cycle (~5 min) re-creating what the cache just restored.
 * The manifest is a cheap structural fingerprint instead: it is written next to the
 * tree before the cache is saved and re-computed on the hit, so a complete restore
 * costs a directory walk and a repairable tree is still detected.
 *
 * What it covers: every directory, file and symlink (with its target) under the
 * folders the modules cache stores, plus the bytes of `.yarn-integrity`. It does not
 * hash file contents; a corrupted blob is caught by the cache service itself.
 *
 * Usage:
 *   node scripts/ci/dependency-cache-manifest.mjs write
 *   node scripts/ci/dependency-cache-manifest.mjs verify [--github-output]
 *
 * Exit codes: 0 match, 1 mismatch, 2 no manifest was saved with the tree.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MANIFEST_PATH = join('node_modules', '.happier-cache-manifest.json');
const INTEGRITY_PATH = join('node_modules', '.yarn-integrity');
const MANIFEST_VERSION = 1;

/** The folders the cache stores, which is exactly what the manifest must cover. */
function modulesRoots() {
    const roots = [];
    if (existsSync('node_modules')) roots.push('node_modules');
    for (const parent of ['apps', 'packages']) {
        if (!existsSync(parent)) continue;
        for (const entry of readdirSync(parent, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const candidate = join(parent, entry.name, 'node_modules');
            if (existsSync(candidate)) roots.push(candidate);
        }
    }
    return roots;
}

/**
 * One line per tree entry: `d:path`, `f:path` or `l:path:target`.
 *
 * Types come from the directory entry itself, so a walk costs one readdir per folder
 * instead of a stat per file (measured on a 386k-entry tree: 3 s instead of 50 s).
 * Content corruption is the cache service's checksum to catch; this fingerprint is
 * about a tree that is complete and shaped as it was saved.
 */
function collectEntries(roots) {
    const lines = [];
    const counts = { dirs: 0, files: 0, links: 0 };
    for (const root of roots) {
        const stack = [root];
        while (stack.length > 0) {
            const directory = stack.pop();
            let entries;
            try {
                entries = readdirSync(directory, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const entry of entries) {
                const full = join(directory, entry.name);
                // The manifest lives inside the tree it describes and must not hash itself.
                if (full === MANIFEST_PATH) continue;
                if (entry.isSymbolicLink()) {
                    counts.links += 1;
                    let target = '';
                    try {
                        target = readlinkSync(full);
                    } catch {
                        target = '<unreadable>';
                    }
                    lines.push(`l:${full}:${target}`);
                } else if (entry.isDirectory()) {
                    counts.dirs += 1;
                    lines.push(`d:${full}`);
                    stack.push(full);
                } else {
                    counts.files += 1;
                    lines.push(`f:${full}`);
                }
            }
        }
    }
    lines.sort();
    return { lines, counts };
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

function fingerprint() {
    const roots = modulesRoots();
    const { lines, counts } = collectEntries(roots);
    const integritySha256 = existsSync(INTEGRITY_PATH)
        ? sha256(readFileSync(INTEGRITY_PATH))
        : null;
    return {
        version: MANIFEST_VERSION,
        roots,
        digest: sha256(lines.join('\n')),
        integritySha256,
        counts,
    };
}

function describe(manifest) {
    const { dirs, files, links } = manifest.counts ?? { dirs: 0, files: 0, links: 0 };
    return `${dirs} dirs, ${files} files, ${links} links (${manifest.roots?.length ?? 0} roots)`;
}

function write() {
    const manifest = fingerprint();
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`modules cache manifest written: ${describe(manifest)}\n`);
}

function verify() {
    if (!existsSync(MANIFEST_PATH)) {
        process.stdout.write('modules cache manifest: MISSING (tree was cached before the manifest existed)\n');
        return 2;
    }
    let expected;
    try {
        expected = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    } catch (error) {
        process.stdout.write(`modules cache manifest: UNREADABLE (${error.message})\n`);
        return 1;
    }
    if (expected.version !== MANIFEST_VERSION) {
        process.stdout.write(`modules cache manifest: VERSION ${expected.version} != ${MANIFEST_VERSION}\n`);
        return 2;
    }
    const actual = fingerprint();
    const problems = [];
    if (actual.digest !== expected.digest) problems.push('tree structure differs');
    if (actual.integritySha256 !== (expected.integritySha256 ?? null)) problems.push('.yarn-integrity differs');
    if (problems.length > 0) {
        process.stdout.write(
            `modules cache manifest: MISMATCH (${problems.join(', ')}); `
            + `expected ${describe(expected)}, found ${describe(actual)}\n`,
        );
        return 1;
    }
    process.stdout.write(`modules cache manifest: MATCH (${describe(actual)})\n`);
    return 0;
}

const command = process.argv[2];
const writeOutput = process.argv.includes('--github-output');
let code;
if (command === 'write') {
    write();
    code = 0;
} else if (command === 'verify') {
    code = verify();
    if (writeOutput && process.env.GITHUB_OUTPUT) {
        const matches = code === 0 ? 'true' : 'false';
        writeFileSync(process.env.GITHUB_OUTPUT, `matches=${matches}\n`, { flag: 'a' });
    }
} else {
    process.stderr.write('usage: dependency-cache-manifest.mjs write|verify [--github-output]\n');
    code = 64;
}
process.exit(code);
