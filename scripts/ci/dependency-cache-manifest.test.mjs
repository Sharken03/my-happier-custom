import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(repoRoot, 'scripts', 'ci', 'dependency-cache-manifest.mjs');

function run(cwd, ...args) {
    return spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
}

function runWithOutputs(cwd, outputPath) {
    return spawnSync(process.execPath, [script, 'verify', '--github-output'], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: outputPath },
    });
}

/** A tree shaped like the one the modules cache stores, without installing anything. */
function createTree() {
    const root = mkdtempSync(join(tmpdir(), 'happier-cache-manifest-'));
    mkdirSync(join(root, 'node_modules', 'left-pad'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;\n');
    writeFileSync(join(root, 'node_modules', '.yarn-integrity'), '{"flags":[]}\n');
    mkdirSync(join(root, 'apps', 'ui', 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(root, 'apps', 'ui', 'node_modules', 'dep', 'index.js'), 'export default 2;\n');
    mkdirSync(join(root, 'apps', 'cli'), { recursive: true });
    mkdirSync(join(root, 'packages', 'protocol', 'node_modules'), { recursive: true });
    return root;
}

test('a saved tree verifies as a match, and only the manifest itself is excluded', () => {
    const root = createTree();
    try {
        const written = run(root, 'write');
        assert.equal(written.status, 0, written.stderr);
        assert.match(written.stdout, /manifest written/);

        // Sorting must make the fingerprint independent of readdir order, so a second
        // write over the same tree has to produce the identical digest.
        const repeated = run(root, 'write');
        assert.equal(repeated.status, 0, repeated.stderr);
        const verified = run(root, 'verify');
        assert.equal(verified.status, 0, verified.stderr);
        assert.match(verified.stdout, /MATCH/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a tree that lost or gained an entry is reported as a mismatch', () => {
    const root = createTree();
    try {
        assert.equal(run(root, 'write').status, 0);

        unlinkSync(join(root, 'apps', 'ui', 'node_modules', 'dep', 'index.js'));
        const missing = run(root, 'verify');
        assert.equal(missing.status, 1);
        assert.match(missing.stdout, /MISMATCH/);
        assert.match(missing.stdout, /tree structure differs/);

        // Restoring the same path resurrects the match, so the signal tracks the tree.
        writeFileSync(join(root, 'apps', 'ui', 'node_modules', 'dep', 'index.js'), 'export default 2;\n');
        assert.equal(run(root, 'verify').status, 0);

        mkdirSync(join(root, 'node_modules', 'extra'), { recursive: true });
        const extra = run(root, 'verify');
        assert.equal(extra.status, 1);
        assert.match(extra.stdout, /MISMATCH/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a changed .yarn-integrity invalidates the tree even when the structure matches', () => {
    const root = createTree();
    try {
        assert.equal(run(root, 'write').status, 0);
        writeFileSync(join(root, 'node_modules', '.yarn-integrity'), '{"flags":["offline"]}\n');
        const result = run(root, 'verify');
        assert.equal(result.status, 1);
        assert.match(result.stdout, /\.yarn-integrity differs/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('the step output the action branches on is written for both outcomes', () => {
    const root = createTree();
    try {
        const outputPath = join(root, 'github-output');
        // The action's drop/repair steps branch on this exact string, so a match must be
        // reported as 'true' and everything else as 'false'.
        assert.equal(run(root, 'write').status, 0);
        assert.equal(runWithOutputs(root, outputPath).status, 0);
        assert.equal(readFileSync(outputPath, 'utf8'), 'matches=true\n');

        unlinkSync(join(root, 'node_modules', 'left-pad', 'index.js'));
        writeFileSync(outputPath, '');
        assert.equal(runWithOutputs(root, outputPath).status, 1);
        assert.equal(readFileSync(outputPath, 'utf8'), 'matches=false\n');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a tree cached before the manifest existed is reported as missing, not as a mismatch', () => {
    const root = createTree();
    try {
        const result = run(root, 'verify');
        assert.equal(result.status, 2, 'legacy caches must not be reported as damage');
        assert.match(result.stdout, /MISSING/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
