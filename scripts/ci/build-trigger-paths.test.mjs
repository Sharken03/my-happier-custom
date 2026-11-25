import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function pushConfig(name) {
    return YAML.parse(readFileSync(join(repoRoot, '.github', 'workflows', name), 'utf8')).on.push;
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
        const paths = pushConfig(workflow).paths;
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
    const paths = pushConfig('build-app.yml').paths;
    for (const list of ['ui-tests.txt', 'cli-tests.txt', 'protocol-tests.txt']) {
        assert.ok(paths.includes(`!.github/build-8t/${list}`), `${list} only feeds the other workflows`);
    }
    assert.ok(paths.includes('.github/build-8t/**'), 'the rest of the build folder still reaches the APK');
});

test('build-app.yml: a markdown-only change matches no pattern, so no run starts', () => {
    const paths = pushConfig('build-app.yml').paths;
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
    const push = pushConfig('build-web.yml');
    assert.equal(push.paths, undefined, 'switching to `paths` without the ordering rule reintroduces the bug');
    assert.ok(push['paths-ignore'].includes('**/*.md'));
});
