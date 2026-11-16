import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { bindApiSessionSocketMock, createApiSessionSocketStub } from '@/testkit/backends/apiSessionSocketHarness';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import { captureConsoleJsonOutput } from '@/testkit/logger/captureOutput';

import { deriveBoxPublicKeyFromSeed, sealEncryptedDataKeyEnvelopeV1 } from '@happier-dev/protocol';
import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';
import { SOCKET_RPC_EVENTS } from '@happier-dev/protocol/socketRpc';

const { mockIo } = vi.hoisted(() => ({ mockIo: vi.fn() }));
vi.mock('socket.io-client', () => ({ io: mockIo }));

const SESSION_ID = 'sess_integration_review_fix_123';

function buildPublicRun(): Record<string, unknown> {
  return {
    runId: 'run_1',
    callId: 'call_1',
    sidechainId: 'sidechain_1',
    intent: 'review',
    backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
    permissionMode: 'read-only',
    retentionPolicy: 'ephemeral',
    runClass: 'bounded',
    ioMode: 'streaming',
    status: 'succeeded',
    startedAtMs: 1,
  };
}

function buildStructuredMeta(): Record<string, unknown> {
  return {
    kind: 'review_findings.v2',
    payload: {
      runRef: { runId: 'run_1', callId: 'call_1', backendId: 'codex' },
      summary: 'Review summary',
      overviewMarkdown: '## Overview',
      findings: [
        { id: 'f1', title: 'Finding one', severity: 'medium', category: 'correctness', summary: 'Summary one' },
        { id: 'f2', title: 'Finding two', severity: 'low', category: 'style', summary: 'Summary two' },
      ],
      publication: { findings: [{ id: 'f2', published: true, publishedMessageRef: 'rev_0' }] },
      generatedAtMs: 1,
    },
  };
}

describe('happier session review fix (integration)', () => {
  const envKeys = ['HAPPIER_SERVER_URL', 'HAPPIER_WEBAPP_URL', 'HAPPIER_HOME_DIR', 'HAPPIER_ACTIONS_SETTINGS_V1'] as const;
  let envScope = createEnvKeyScope(envKeys);
  let server: Server | null = null;
  let happyHomeDir = '';

  beforeEach(async () => {
    happyHomeDir = await createTempDir('happier-cli-session-review-fix-');

    const dek = new Uint8Array(32).fill(3);
    const machineKeySeed = new Uint8Array(32).fill(8);
    const recipientPublicKey = deriveBoxPublicKeyFromSeed(machineKeySeed);
    const envelope = sealEncryptedDataKeyEnvelopeV1({
      dataKey: dek,
      recipientPublicKey,
      randomBytes: (length) => new Uint8Array(length).fill(5),
    });

    const { encodeBase64: encodeBase64Session, encryptWithDataKey } = await import('@/api/encryption');
    const metadataCiphertext = encodeBase64Session(encryptWithDataKey({ path: '/tmp' }, dek), 'base64');
    const dataEncryptionKeyBase64 = encodeBase64Session(envelope, 'base64');

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      if (req.method === 'GET' && url.pathname === `/v2/sessions/${SESSION_ID}`) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            session: {
              id: SESSION_ID,
              seq: 1,
              createdAt: 1,
              updatedAt: 2,
              active: true,
              activeAt: 2,
              metadata: metadataCiphertext,
              metadataVersion: 0,
              agentState: null,
              agentStateVersion: 0,
              pendingCount: 0,
              pendingVersion: 0,
              dataEncryptionKey: dataEncryptionKeyBase64,
              machineId: 'machine-integration-1',
              share: null,
            },
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end();
    });

    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to resolve integration server address');

    process.env.HAPPIER_SERVER_URL = `http://127.0.0.1:${address.port}`;
    process.env.HAPPIER_WEBAPP_URL = 'http://127.0.0.1:3000';
    process.env.HAPPIER_HOME_DIR = happyHomeDir;
    process.env.HAPPIER_ACTIONS_SETTINGS_V1 = JSON.stringify({ v: 1, actions: {} });

    const { reloadConfiguration } = await import('@/configuration');
    reloadConfiguration();

    mockIo.mockReset();

    const { decodeBase64, decrypt, encodeBase64: encodeBase64Rpc, encrypt } = await import('@/api/encryption');

    const socket = createApiSessionSocketStub({
      emit: (event: string, args: unknown[]) => {
        const [data, cb] = args as [any, ((value: unknown) => void) | undefined];
        if (event !== SOCKET_RPC_EVENTS.CALL) return;
        const method = String(data?.method ?? '');
        const decodedParams = decodeBase64(String(data.params ?? ''), 'base64');
        const decrypted = decrypt(dek, 'dataKey', decodedParams) as any;

        if (method === `${SESSION_ID}:${SESSION_RPC_METHODS.EXECUTION_RUN_LIST}`) {
          // The `execution.run.list` service drops `sessionId` from the wire request;
          // only the method identity matters for run resolution here.
          cb?.({
            ok: true,
            result: encodeBase64Rpc(encrypt(dek, 'dataKey', { runs: [buildPublicRun()] }), 'base64'),
          });
          return;
        }

        if (method === `${SESSION_ID}:${SESSION_RPC_METHODS.EXECUTION_RUN_GET}`) {
          expect(decrypted).toMatchObject({ runId: 'run_1', includeStructured: true });
          cb?.({
            ok: true,
            result: encodeBase64Rpc(
              encrypt(dek, 'dataKey', { run: buildPublicRun(), structuredMeta: buildStructuredMeta() }),
              'base64',
            ),
          });
          return;
        }

        expect(method).toBe(`${SESSION_ID}:${SESSION_RPC_METHODS.EXECUTION_RUN_ACTION}`);
        expect(decrypted).toMatchObject({
          runId: 'run_1',
          actionId: 'review.finding.apply',
        });
        expect(decrypted.input).toEqual({
          runId: 'run_1',
          findingIds: ['f1'],
          mode: 'spawn_session',
          includePatch: true,
          permissionMode: 'read_only',
        });

        cb?.({
          ok: true,
          result: encodeBase64Rpc(
            encrypt(dek, 'dataKey', {
              ok: true,
              result: { mode: 'spawn_session', findingIds: ['f1'], spawned: { sessionId: 'sess_new' } },
            }),
            'base64',
          ),
        });
      },
    });
    bindApiSessionSocketMock(mockIo, socket);
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => server!.close((e) => (e ? reject(e) : resolve())));
    }
    server = null;
    if (happyHomeDir) {
      await removeTempDir(happyHomeDir);
      happyHomeDir = '';
    }

    envScope.restore();
    envScope = createEnvKeyScope(envKeys);

    const { reloadConfiguration } = await import('@/configuration');
    reloadConfiguration();
  });

  it('resolves the most recent review run and applies findings with explicit flags', async () => {
    const { handleSessionCommand } = await import('../handleSessionCommand');

    const output = captureConsoleJsonOutput();

    try {
      const machineKeySeed = new Uint8Array(32).fill(8);
      await handleSessionCommand(
        [
          'review',
          'fix',
          SESSION_ID,
          '--findings',
          'f1',
          '--mode',
          'spawn_session',
          '--patch',
          '--permission-mode',
          'read_only',
          '--json',
        ],
        {
          readCredentialsFn: async () => ({
            token: 'token_test',
            encryption: {
              type: 'dataKey',
              publicKey: deriveBoxPublicKeyFromSeed(machineKeySeed),
              machineKey: machineKeySeed,
            },
          }),
        },
      );

      const parsed = output.json();
      expect(parsed.ok).toBe(true);
      expect(parsed.kind).toBe('session_review_fix');
      expect(parsed.data?.sessionId).toBe(SESSION_ID);
      expect(parsed.data?.runId).toBe('run_1');
      expect(parsed.data?.result).toEqual({
        mode: 'spawn_session',
        findingIds: ['f1'],
        spawned: { sessionId: 'sess_new' },
      });
    } finally {
      output.restore();
    }
  });
});
