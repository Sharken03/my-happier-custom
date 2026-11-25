import { beforeEach, describe, expect, it, vi } from 'vitest';

const submitMessage = vi.hoisted(() => vi.fn());
const alert = vi.hoisted(() => vi.fn());
const stateRef = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('@/sync/sync', () => ({ sync: { submitMessage } }));

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { alert } }).module;
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({ storage: { getState: () => stateRef.current } });
});

import { pressMessageOption } from './pressMessageOption';

const SESSION_ID = 's1';

type PendingRow = Readonly<{
    text: string;
    sendState?: 'unconfirmed' | 'failed';
    pendingDeliveryStatus?: string;
    pendingOutboxOperation?: 'enqueue' | 'cancel';
}>;

function setState(params: Readonly<{
    queueOptions?: boolean;
    busy?: boolean;
    pending?: readonly PendingRow[];
    userTexts?: readonly string[];
}> = {}): void {
    const now = Date.now();
    const userTexts = params.userTexts ?? [];
    stateRef.current = {
        settings: { sessionMessageOptionsQueueV1: params.queueOptions ?? true },
        sessions: {
            [SESSION_ID]: {
                id: SESSION_ID,
                active: true,
                activeAt: now,
                presence: 'online',
                thinking: params.busy === true,
                thinkingAt: now,
            },
        },
        sessionPending: {
            [SESSION_ID]: { messages: params.pending ?? [], discarded: [], isLoaded: true },
        },
        sessionMessages: {
            [SESSION_ID]: {
                messageIdsOldestFirst: userTexts.flatMap((_, index) => [`u${index}`, `a${index}`]),
                messagesById: Object.fromEntries(userTexts.flatMap((text, index) => [
                    [`u${index}`, { kind: 'user-text', id: `u${index}`, text }],
                    [`a${index}`, { kind: 'agent-text', id: `a${index}`, text: 'answer' }],
                ])),
            },
        },
    };
}

function press(title: string, canSendMessages = true, sessionId = SESSION_ID): Promise<void> {
    return pressMessageOption({ sessionId, title, canSendMessages });
}

function submittedTexts(): unknown[] {
    return submitMessage.mock.calls.map((call) => call[1]);
}

describe('pressMessageOption', () => {
    beforeEach(() => {
        submitMessage.mockReset();
        submitMessage.mockResolvedValue({ type: 'sent' });
        alert.mockReset();
        setState();
    });

    it('submits the option title as a message option', async () => {
        await press('Run the tests');

        expect(submitMessage).toHaveBeenCalledWith(SESSION_ID, 'Run the tests', undefined, undefined, {
            callerSurface: 'message_option',
        });
    });

    it('does not submit the same option again while the first submit runs', async () => {
        let finish: () => void = () => {};
        submitMessage.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));

        const first = press('Run the tests');
        await press('Run the tests');
        await press('Update the docs');
        expect(submittedTexts()).toEqual(['Run the tests', 'Update the docs']);

        finish();
        await first;
        await press('Run the tests');
        expect(submittedTexts()).toEqual(['Run the tests', 'Update the docs', 'Run the tests']);
    });

    it('does not block the same option in another session', async () => {
        let finish: () => void = () => {};
        submitMessage.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));

        const first = press('Run the tests');
        await press('Run the tests', true, 's2');
        finish();
        await first;

        expect(submitMessage.mock.calls.map((call) => call[0])).toEqual([SESSION_ID, 's2']);
    });

    it('does not submit an option that already waits', async () => {
        setState({ busy: true, pending: [{ text: 'Run the tests', pendingDeliveryStatus: 'server_queued' }] });

        await press('Run the tests');
        await press('Update the docs');

        expect(submittedTexts()).toEqual(['Update the docs']);
    });

    it.each<PendingRow>([
        { text: 'Run the tests', sendState: 'failed' },
        { text: 'Run the tests', pendingDeliveryStatus: 'blocked' },
        { text: 'Run the tests', pendingOutboxOperation: 'cancel' },
    ])('submits an option again when its row cannot run: %o', async (row) => {
        setState({ pending: [row] });

        await press('Run the tests');

        expect(submittedTexts()).toEqual(['Run the tests']);
    });

    it('does not submit the option that the agent works on', async () => {
        setState({ busy: true, userTexts: ['Earlier task', 'Run the tests'] });

        await press('Run the tests');
        await press('Earlier task');

        expect(submittedTexts()).toEqual(['Earlier task']);
    });

    it('submits a finished option again', async () => {
        setState({ busy: false, userTexts: ['Run the tests'] });

        await press('Run the tests');

        expect(submittedTexts()).toEqual(['Run the tests']);
    });

    it('shows the error and frees the option after a failed submit', async () => {
        submitMessage.mockRejectedValueOnce(new Error('no connection'));

        await press('Run the tests');
        expect(alert).toHaveBeenCalledWith('common.error', 'no connection');

        await press('Run the tests');
        expect(submittedTexts()).toEqual(['Run the tests', 'Run the tests']);
    });

    it('submits every press when the option queue is off', async () => {
        setState({
            queueOptions: false,
            busy: true,
            pending: [{ text: 'Run the tests', pendingDeliveryStatus: 'server_queued' }],
            userTexts: ['Run the tests'],
        });

        await Promise.all([press('Run the tests'), press('Run the tests')]);

        expect(submittedTexts()).toEqual(['Run the tests', 'Run the tests']);
    });

    it('does not submit for a viewer without edit permission', async () => {
        await press('Run the tests', false);

        expect(submitMessage).not.toHaveBeenCalled();
        expect(alert).toHaveBeenCalledWith('session.sharing.viewOnly', 'session.sharing.noEditPermission');
    });
});
