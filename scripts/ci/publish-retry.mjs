#!/usr/bin/env node
/**
 * Backoff policy for the prerelease publish retry.
 *
 * Losing a finished 20-minute APK to `HTTP 403: Resource not accessible by integration` is what
 * this exists for: on 26/11-2026 three tries inside 90 s all failed during a GitHub API incident
 * while the same workflow published minutes earlier and later. The retry window is now minutes,
 * not seconds.
 *
 * The other half of the policy matters as much: an error that cannot improve (a validation
 * failure, a malformed tag) must fail immediately instead of blocking a 2-CPU runner for seven
 * more minutes.
 *
 * Usage: node scripts/ci/publish-retry.mjs --attempt N --error-log PATH
 * Prints the seconds to wait. Exit 1 with a reason when it must not be retried.
 * Env: PUBLISH_MAX_TRIES (5), PUBLISH_BASE_DELAY_SECONDS (30), PUBLISH_MAX_DELAY_SECONDS (300)
 */

import { readFileSync } from 'node:fs';

/** Statuses that GitHub answers during an incident rather than for a bad request. */
const TRANSIENT_PATTERNS = [
    /HTTP 5\d\d/, // 500, 502, 503, 504
    /HTTP 429/,
    /HTTP 403: Resource not accessible by integration/, // today's incident; the token had the scope
    /rate limit/i,
    /Bad Gateway|Service Unavailable|Gateway Timeout/i,
    /timed? ?out|ETIMEDOUT|ESOCKETTIMEDOUT/i,
    /socket hang up|ECONNRESET|ECONNREFUSED|EPIPE|EAI_AGAIN|ENOTFOUND|ENETUNREACH/i,
    /no such host|dial tcp|TLS handshake timeout|lookup .* (failed|timeout)/i,
    /(^|\s)EOF(\s|$)/,
    /connection (reset|closed|aborted)/i,
];

/** A 4xx that is not a throttling or integration-token answer is a real error. */
const PERMANENT_PATTERNS = [
    /HTTP 422/, // validation failed
    /HTTP 404/, // repository or endpoint gone
    /already_exists/,
    /HTTP 400: Bad Request/,
    /HTTP 401: Bad credentials/,
];

/**
 * @param {string} log stderr of the failed `gh release create`
 * @returns {'transient' | 'permanent' | 'unknown'}
 */
export function classifyPublishError(log) {
    if (PERMANENT_PATTERNS.some((pattern) => pattern.test(log))) return 'permanent';
    if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(log))) return 'transient';
    // gh errors that say nothing recognisable are treated as transient once: a publish is
    // idempotent (the tag is deleted before a retry), so a wrong retry costs a sleep and not a
    // corrupt release.
    return 'unknown';
}

/** Exponential backoff, capped, so five tries span about 7.5 minutes of waiting. */
export function nextDelaySeconds(attempt, options) {
    const { baseDelay, maxDelay } = options;
    return Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
}

function readLog(path) {
    try {
        return readFileSync(path, 'utf8');
    } catch {
        return '';
    }
}

function main(argv) {
    const value = (flag) => {
        const index = argv.indexOf(flag);
        return index === -1 ? undefined : argv[index + 1];
    };
    const attempt = Number(value('--attempt') ?? 1);
    const logPath = value('--error-log');
    const maxTries = Number(process.env.PUBLISH_MAX_TRIES ?? 5);
    const baseDelay = Number(process.env.PUBLISH_BASE_DELAY_SECONDS ?? 30);
    const maxDelay = Number(process.env.PUBLISH_MAX_DELAY_SECONDS ?? 300);

    if (!Number.isInteger(attempt) || attempt < 1) {
        process.stderr.write('publish-retry: --attempt must be a positive integer\n');
        return 1;
    }
    if (attempt >= maxTries) {
        process.stderr.write(`publish-retry: gave up after ${attempt} attempts\n`);
        return 1;
    }

    const log = logPath ? readLog(logPath) : '';
    const kind = classifyPublishError(log);
    if (kind === 'permanent') {
        process.stderr.write('publish-retry: the error is not transient, so a retry cannot help\n');
        return 1;
    }
    process.stdout.write(`${nextDelaySeconds(attempt, { baseDelay, maxDelay })}\n`);
    return 0;
}

if (process.argv[1] && process.argv[1].endsWith('publish-retry.mjs')) {
    process.exitCode = main(process.argv.slice(2));
}
