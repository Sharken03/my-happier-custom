import assert from 'node:assert/strict';
import test from 'node:test';

import { planPrune } from './prune-build-caches.mjs';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-11-25T12:00:00Z');
const ago = (days) => new Date(now - days * DAY).toISOString();

const MODULES_UI = 'modules-v1-Linux-X64-24.22.1-2.39-default-ui+protocol+agents';
const MODULES_APP = 'modules-v1-Linux-X64-24.22.1-2.39-default-ui+protocol+agents+audio-stream-native+sherpa-native';
const MODULES_CLI = 'modules-v1-Linux-X64-24.22.1-2.39-default-cli+protocol+agents';
const hash = (n) => String(n).padStart(64, 'a');

function entry(id, key, days, sizeMiB = 1000) {
    return { id, key, createdAt: ago(days), sizeInBytes: sizeMiB * 1024 * 1024 };
}

test('old lockfile rotations are pruned, the newest per scope and its predecessor survive', () => {
    const entries = [
        entry(1, `${MODULES_UI}-${hash(1)}`, 1),
        entry(2, `${MODULES_UI}-${hash(2)}`, 20),
        entry(3, `${MODULES_UI}-${hash(3)}`, 40),
        entry(4, `${MODULES_APP}-${hash(4)}`, 2),
        entry(5, `${MODULES_APP}-${hash(5)}`, 30),
        entry(6, `${MODULES_CLI}-${hash(6)}`, 3),
    ];
    const plan = planPrune(entries, { now, minAgeDays: 7, keepModules: 2, keepGradle: 1 });

    // The identity of a modules entry includes its scope, so a deletion can never remove
    // the live entry of another workflow's install: only the third rotation of one scope goes.
    assert.deepEqual(plan.deletions.map((d) => d.id), [3]);
    assert.deepEqual(plan.kept.map((k) => k.id).sort(), [1, 2, 4, 5, 6]);
});

test('nothing is deleted while it is younger than the age limit, even when superseded', () => {
    const entries = [
        entry(1, `${MODULES_UI}-${hash(1)}`, 0.5),
        entry(2, `${MODULES_UI}-${hash(2)}`, 1),
        entry(3, `${MODULES_UI}-${hash(3)}`, 2),
    ];
    const plan = planPrune(entries, { now, minAgeDays: 7, keepModules: 1, keepGradle: 1 });
    assert.deepEqual(plan.deletions, [], 'a concurrent run may be restoring any of these');
    assert.equal(plan.kept.length, 3);
});

test('the second newest entry is kept: a rotation in flight must not be pruned away', () => {
    const entries = [
        entry(1, `${MODULES_UI}-${hash(1)}`, 1),
        entry(2, `${MODULES_UI}-${hash(2)}`, 10),
        entry(3, `${MODULES_UI}-${hash(3)}`, 11),
    ];
    const plan = planPrune(entries, { now, minAgeDays: 7, keepModules: 2, keepGradle: 1 });
    assert.deepEqual(plan.deletions.map((d) => d.id), [3]);
});

test('gradle caches are one group and keep only the newest', () => {
    const entries = [
        entry(1, 'setup-java-Linux-x64-gradle-9eee815299cbca26cf8e', 1),
        entry(2, 'setup-java-Linux-x64-gradle-1aaa815299cbca26cf8e', 10),
        entry(3, 'setup-gradle-Linux-x64-abc123', 12),
    ];
    const plan = planPrune(entries, { now, minAgeDays: 7, keepModules: 2, keepGradle: 1 });
    assert.deepEqual(plan.deletions.map((d) => d.id).sort(), [2, 3]);
});

test('caches this script does not own are never touched', () => {
    const entries = [
        entry(1, 'metro-app-v1-d40804f4a5d31426-45690612091', 30),
        entry(2, 'ccache-app-v1-45690612091', 30),
        entry(3, 'sherpa-onnx-android-v1.12.25', 60),
    ];
    const plan = planPrune(entries, { now, minAgeDays: 7, keepModules: 2, keepGradle: 1 });
    assert.deepEqual(plan.deletions, []);
    assert.deepEqual(plan.kept, []);
});

test('freed bytes report what a dry run would reclaim', () => {
    const entries = [
        entry(1, `${MODULES_UI}-${hash(1)}`, 1, 1600),
        entry(2, `${MODULES_UI}-${hash(2)}`, 30, 1500),
    ];
    const plan = planPrune(entries, { now, minAgeDays: 7, keepModules: 1, keepGradle: 1 });
    assert.equal(plan.deletions.length, 1);
    assert.equal(plan.freedBytes, 1500 * 1024 * 1024);
});
