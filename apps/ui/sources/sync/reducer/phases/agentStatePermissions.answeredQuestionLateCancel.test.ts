import { describe, expect, it } from 'vitest';
import { createReducer } from '../reducer';
import { runAgentStatePermissionsPhase } from './agentStatePermissions';

/**
 * Observed on a phone (2026-11-19): a plan-mode question was answered, but the transcript
 * re-rendered it as a red "Permission canceled" card after a late terminal settlement for the
 * same request id arrived (a cancel). Plan-mode / AskUserQuestion rows never set `startedAt`,
 * so the existing "already approved and executing" guard cannot protect them.
 *
 * These assertions describe the user-visible contract: an answered question stays answered.
 */
describe('runAgentStatePermissionsPhase (answered question then late cancel)', () => {
    const requestId = '3ce8eb02-04d2-4b6c-816f-36dd29cafe01';
    const questionText = 'Hvor læser du tabellen, når du gerne vil kunne vælge indhold?';
    const questions = [{
        header: 'Platform',
        question: questionText,
        options: [{ label: 'Begge steder', description: 'Det skal virke både i appen og på web.' }],
        multiSelect: false,
    }];
    const request = {
        tool: 'AskUserQuestion',
        kind: 'user_action' as const,
        arguments: { questions },
        createdAt: 1795075324029,
    };

    function runPhase(params: Readonly<{
        state: ReturnType<typeof createReducer>;
        requests: Record<string, unknown>;
        completedRequests: Record<string, unknown> | null;
    }>) {
        runAgentStatePermissionsPhase({
            state: params.state,
            agentState: {
                controlledByUser: null,
                requests: params.requests,
                completedRequests: params.completedRequests,
            } as never,
            incomingToolIds: new Set<string>(),
            changed: new Set<string>(),
            allocateId: () => 'question-message',
            enableLogging: false,
        });
    }

    it('keeps the approved answer when a cancel for the same request id arrives afterwards', () => {
        const state = createReducer();

        runPhase({ state, requests: { [requestId]: request }, completedRequests: null });
        runPhase({
            state,
            requests: {},
            completedRequests: {
                [requestId]: {
                    ...request,
                    completedAt: 1795075460279,
                    status: 'approved',
                    decision: 'approved',
                    structuredAnswersV1: { [questionText]: ['Begge steder'] },
                },
            },
        });

        const answered = state.messages.get('question-message')?.tool;
        expect(answered?.permission?.status).toBe('approved');
        expect(answered?.result).toEqual({ answers: { [questionText]: 'Begge steder' } });

        // Late settlement for the same request id (e.g. coordinator dispose after the answer).
        runPhase({
            state,
            requests: {},
            completedRequests: {
                [requestId]: {
                    ...request,
                    completedAt: 1795075560000,
                    status: 'canceled',
                    decision: 'abort',
                    reason: 'Permission coordinator disposed',
                },
            },
        });

        const afterCancel = state.messages.get('question-message')?.tool;
        expect(afterCancel?.permission?.status).toBe('approved');
        expect(afterCancel?.result).toEqual({ answers: { [questionText]: 'Begge steder' } });
        expect(afterCancel?.state).toBe('completed');
    });

    it('also protects legacy entries that carry no kind, keyed only by the tool name', () => {
        const state = createReducer();
        const { kind: _kind, ...requestWithoutKind } = request;

        runPhase({ state, requests: { [requestId]: requestWithoutKind }, completedRequests: null });
        runPhase({
            state,
            requests: {},
            completedRequests: {
                [requestId]: {
                    ...requestWithoutKind,
                    completedAt: 1795075460279,
                    status: 'approved',
                    decision: 'approved',
                    structuredAnswersV1: { [questionText]: ['Begge steder'] },
                },
            },
        });
        runPhase({
            state,
            requests: {},
            completedRequests: {
                [requestId]: {
                    ...requestWithoutKind,
                    completedAt: 1795075560000,
                    status: 'canceled',
                    decision: 'abort',
                    reason: 'Permission coordinator disposed',
                },
            },
        });

        const afterCancel = state.messages.get('question-message')?.tool;
        expect(afterCancel?.permission?.status).toBe('approved');
        expect(afterCancel?.result).toEqual({ answers: { [questionText]: 'Begge steder' } });
    });
});
