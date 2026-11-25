import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { classifyPublishError, nextDelaySeconds } from './publish-retry.mjs';

const script = join(resolve(dirname(fileURLToPath(import.meta.url))), 'publish-retry.mjs');

function runCli(log, attempt, env = {}) {
    const directory = mkdtempSync(join(tmpdir(), 'publish-retry-'));
    try {
        const logPath = join(directory, 'error.log');
        writeFileSync(logPath, log);
        return spawnSync(process.execPath, [script, '--attempt', String(attempt), '--error-log', logPath], {
            encoding: 'utf8',
            env: { ...process.env, ...env },
        });
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

test('the error that cost a finished APK on 26/11-2026 is retried', () => {
    // Verbatim from build-app run 45717579607.
    const log = 'HTTP 403: Resource not accessible by integration (https://api.github.com/repos/Sharken03/my-happier-custom/releases)\n';
    assert.equal(classifyPublishError(log), 'transient');
    const result = runCli(log, 1);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '30');
});

test('inconclusive gh failures are still retried, because a publish retry is idempotent', () => {
    // The tag is deleted before every retry, so a wrong guess costs a sleep, not a bad release.
    assert.equal(classifyPublishError(''), 'unknown');
    assert.equal(classifyPublishError('some new gh message nobody has seen\n'), 'unknown');
    assert.equal(runCli('unrecognised failure', 1).status, 0);
});

test('permanent errors fail immediately instead of blocking the runner', () => {
    const cases = [
        'HTTP 422: Validation Failed (https://api.github.com/repos/x/y/releases)',
        'HTTP 401: Bad credentials (https://api.github.com/repos/x/y/releases)',
        'HTTP 404: Not Found (https://api.github.com/repos/x/y/releases)',
        'tag_name already_exists',
    ];
    for (const log of cases) {
        assert.equal(classifyPublishError(log), 'permanent', log);
        const result = runCli(log, 1);
        assert.equal(result.status, 1, `${log} must not be retried`);
        assert.match(result.stderr, /not transient/);
    }
});

test('server errors, throttling and network drops are retried', () => {
    for (const log of [
        'HTTP 502: Bad Gateway',
        'HTTP 503: Service Unavailable',
        'HTTP 429: Too Many Requests',
        'Post "https://api.github.com/...": dial tcp: lookup api.github.com: no such host',
        'read: connection reset by peer',
        'Post "https://api.github.com/...": net/http: TLS handshake timeout',
        'request to https://api.github.com/ failed: ETIMEDOUT',
    ]) {
        assert.equal(classifyPublishError(log), 'transient', log);
    }
});

test('the backoff spans minutes, and stops at the configured try count', () => {
    const options = { baseDelay: 30, maxDelay: 300 };
    assert.deepEqual([1, 2, 3, 4, 5].map((attempt) => nextDelaySeconds(attempt, options)), [30, 60, 120, 240, 300]);
    // Five tries spend 30+60+120+240 = 450 s waiting, against losing a ~20 min APK.
    assert.equal([1, 2, 3, 4].reduce((sum, attempt) => sum + nextDelaySeconds(attempt, options), 0), 450);

    const exhausted = runCli('HTTP 502: Bad Gateway', 5);
    assert.equal(exhausted.status, 1, 'the last attempt must not sleep again');
    assert.match(exhausted.stderr, /gave up after 5 attempts/);

    const shorter = runCli('HTTP 502: Bad Gateway', 2, { PUBLISH_MAX_TRIES: '3' });
    assert.equal(shorter.status, 0);
    assert.equal(shorter.stdout.trim(), '60');
    assert.equal(runCli('HTTP 502: Bad Gateway', 3, { PUBLISH_MAX_TRIES: '3' }).status, 1);
});

test('the schedule stays tunable from the workflow env', () => {
    const result = runCli('HTTP 503: Service Unavailable', 2, { PUBLISH_BASE_DELAY_SECONDS: '10', PUBLISH_MAX_DELAY_SECONDS: '15' });
    assert.equal(result.stdout.trim(), '15', 'the cap wins over the doubled base');
});
