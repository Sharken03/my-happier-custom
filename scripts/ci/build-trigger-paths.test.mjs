import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The `paths` list of a trigger, read without a YAML dependency (this file must run with
 * nothing but the repository's own tooling). Workflow files are machine-written, so a
 * line scan under the `paths:` key is exact enough for string-level assertions.
 */
function pushPaths(name) {
    const lines = readFileSync(join(repoRoot, '.github', 'workflows', name), 'utf8').split('\n');
    const start = lines.findIndex((line) => /^\s+paths:\s*$/.test(line));
    assert.notEqual(start, -1, `${name} has no paths list`);
    const indent = lines[start].match(/^\s+/)[0].length;
    const patterns = [];
    for (const line of lines.slice(start + 1)) {
        // The lists carry explanatory comments between patterns; they must not end the scan.
        if (line.trim() === '' || /^\s*#/.test(line)) continue;
        const match = /^(\s+)-\s+"(.*)"\s*$/.exec(line);
        if (!match || match[1].length <= indent) break;
        patterns.push(match[2]);
    }
    assert.ok(patterns.length > 0, `${name} has an empty paths list`);
    return patterns;
}

function hasPathsIgnore(name) {
    return /^\s+paths-ignore:\s*$/m.test(readFileSync(join(repoRoot, '.github', 'workflows', name), 'utf8'));
}

const isExclusion = (pattern) => pattern.startsWith('!');

/**
 * GitHub applies an include list like build-app's in order: a positive pattern placed AFTER
 * an exclusion re-includes what the exclusion removed. A README under `.github/build-8t/**`
 * therefore triggered a full APK build (26/11-2026) even though the markdown exclusion was
 * listed, because the directory pattern came later. These assertions keep the exclusions last.
 */
for (const workflow of ['build-app.yml', 'build-cli.yml']) {
    test(`${workflow}: exclusions come after every positive pattern`, () => {
        const paths = pushPaths(workflow);
        assert.ok(Array.isArray(paths) && paths.length > 0, 'the trigger is an include list');
        const firstExclusion = paths.findIndex(isExclusion);
        assert.notEqual(firstExclusion, -1, 'markdown must be excluded somewhere');
        const trailingPositives = paths.slice(firstExclusion).filter((pattern) => !isExclusion(pattern));
        assert.deepEqual(trailingPositives, [],
            `these patterns re-include files an earlier exclusion removed: ${trailingPositives.join(', ')}`);
        assert.ok(paths.slice(firstExclusion).some((pattern) => pattern === '!**/*.md'),
            'markdown files must not pay for a build');
    });
}

test('build-app.yml: the test lists no APK build reads are carved out', () => {
    const paths = pushPaths('build-app.yml');
    for (const list of ['ui-tests.txt', 'cli-tests.txt', 'protocol-tests.txt']) {
        assert.ok(paths.includes(`!.github/build-8t/${list}`), `${list} only feeds the other workflows`);
    }
    assert.ok(paths.includes('.github/build-8t/**'), 'the rest of the build folder still reaches the APK');
});

test('build-app.yml: a markdown-only change matches no pattern, so no run starts', () => {
    const paths = pushPaths('build-app.yml');
    // Mirror the documented evaluation: later patterns win, so replay in order.
    const decide = (file) => paths.reduce((included, pattern) => {
        const negated = isExclusion(pattern);
        const glob = negated ? pattern.slice(1) : pattern;
        const matches = glob === '**/*.md' ? file.endsWith('.md') : new RegExp(`^${glob
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '\u0000')
            .replace(/\*/g, '[^/]*')
            .replace(/\u0000/g, '.*')}$`).test(file);
        return matches ? !negated : included;
    }, false);

    assert.equal(decide('.github/build-8t/README.md'), false, 'docs must not start an APK build');
    assert.equal(decide('apps/ui/sources/App.tsx'), true, 'app source still does');
    assert.equal(decide('.github/build-8t/ui-tests.txt'), false, 'the UI test list belongs to the web run');
    assert.equal(decide('.github/actions/install-yarn-dependencies/action.yml'), true,
        'a shared action change must still exercise the APK');
});

test('build-web.yml: it keeps an ignore list, so markdown alone cannot start an export', () => {
    assert.ok(hasPathsIgnore('build-web.yml'),
        'switching to `paths` without the ordering rule reintroduces the markdown bug');
    const source = readFileSync(join(repoRoot, '.github', 'workflows', 'build-web.yml'), 'utf8');
    assert.match(source, /^\s+- "\*\*\/\*\.md"$/m, 'markdown must stay ignored');
});
