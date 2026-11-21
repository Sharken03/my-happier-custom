import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import type { Credentials } from '@/persistence';

/**
 * Row-first spawn for ordinary new Sessions (opt-in with HAPPIER_SPAWN_ROW_FIRST=1): the daemon
 * commits the Session row from the launch nonce and answers with its id at once; the runner
 * attaches to that row when it has booted. Without the setting the runner creates the row.
 */
const readCredentials = vi.hoisted(() => vi.fn<() => Promise<Credentials | null>>());
const getOrCreateSessionByTag = vi.hoisted(() => vi.fn());
const fetchSessionById = vi.hoisted(() => vi.fn());
const archiveSessionByIdBestEffort = vi.hoisted(() => vi.fn(async () => {}));
const psList = vi.hoisted(() => vi.fn(async () => [] as unknown[]));

vi.mock('ps-list', () => ({ default: psList }));

vi.mock('@/persistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/persistence')>(),
  readCredentials,
  readDaemonState: async () => null,
}));

vi.mock('@/configuration', () => ({
  configuration: {
    serverUrl: 'http://example.invalid',
    apiServerUrl: 'http://example.invalid',
    activeServerId: 'cloud',
    activeServerDir: '/tmp/happier-test-active-server',
    happyHomeDir: '/tmp/happier-test-home',
    logsDir: '/tmp',
    daemonStateFile: '/tmp/happier-test-home/daemon.state.json',
    daemonReattachCatchUpConcurrency: 0,
    isDaemonProcess: false,
  },
}));

// The relay's session HTTP API is the network boundary.
vi.mock('@/session/transport/http/sessionsHttp', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/session/transport/http/sessionsHttp')>(),
  getOrCreateSessionByTag,
  fetchSessionById,
}));

vi.mock('@/session/services/setSessionArchivedState', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/session/services/setSessionArchivedState')>(),
  archiveSessionByIdBestEffort,
}));

import { registerMachineRpcHandlers } from './rpcHandlers';

function registerSpawnHandler(spawnSession: ReturnType<typeof vi.fn>) {
  const registered = new Map<string, (params: any) => Promise<any>>();
  registerMachineRpcHandlers({
    rpcHandlerManager: {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any,
    machineId: 'machine-8t',
    handlers: {
      spawnSession: spawnSession as any,
      stopSession: async () => true,
      requestShutdown: () => {},
    },
  });
  const handler = registered.get(RPC_METHODS.SPAWN_HAPPY_SESSION);
  expect(handler).toBeDefined();
  return handler!;
}

const FIRST_INPUT = { text: 'Hvad koster det?', localId: 'first-turn-1' };
let workspace = '';

function spawnRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'spawn-in-directory',
    directory: workspace,
    backendTarget: { kind: 'builtInAgent', agentId: 'pi' },
    approvedNewDirectoryCreation: true,
    spawnNonce: 'nonce-1',
    pendingFirstInput: FIRST_INPUT,
    ...overrides,
  };
}

describe('SPAWN_HAPPY_SESSION row-first ingress', () => {
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'row-first-spawn-'));
    readCredentials.mockReset();
    getOrCreateSessionByTag.mockReset();
    fetchSessionById.mockReset();
    archiveSessionByIdBestEffort.mockClear();
    readCredentials.mockResolvedValue({
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(5) },
    } as Credentials);
    getOrCreateSessionByTag.mockImplementation(async (request: { metadata: Record<string, unknown> }) => ({
      session: {
        id: 'sess_new',
        seq: 0,
        createdAt: 10,
        updatedAt: 10,
        active: false,
        activeAt: 0,
        encryptionMode: 'plain',
        metadata: JSON.stringify(request.metadata),
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        dataEncryptionKey: null,
      },
      created: true,
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(workspace, { recursive: true, force: true });
  });

  it('answers with the committed row id and attaches the runner, first input included', async () => {
    vi.stubEnv('HAPPIER_SPAWN_ROW_FIRST', '1');
    const spawnSession = vi.fn(async (_options: Record<string, unknown>) => (
      { type: 'success', spawnNonce: 'nonce-1', sessionIdStatus: 'pending' } as const
    ));
    const handler = registerSpawnHandler(spawnSession);

    const result = await handler(spawnRequest());

    expect(result).toMatchObject({ type: 'success', sessionId: 'sess_new', pendingFirstInputAccepted: true });
    const creation = getOrCreateSessionByTag.mock.calls[0]![0] as { tag: string; metadata: Record<string, unknown> };
    expect(creation.tag).toBe('nonce-1');
    expect(creation.metadata).toMatchObject({ path: workspace, flavor: 'pi', machineId: 'machine-8t' });
    expect(spawnSession).toHaveBeenCalledTimes(1);
    expect(spawnSession.mock.calls[0]![0]).toMatchObject({
      existingSessionId: 'sess_new',
      spawnNonce: 'nonce-1',
      pendingFirstInput: FIRST_INPUT,
    });
  });

  it('asks to approve a missing directory before it commits a row', async () => {
    vi.stubEnv('HAPPIER_SPAWN_ROW_FIRST', '1');
    const spawnSession = vi.fn();
    const handler = registerSpawnHandler(spawnSession);
    const missing = join(workspace, 'new-project');

    const result = await handler(spawnRequest({ directory: missing, approvedNewDirectoryCreation: false }));

    // A declined approval must not leave an empty Session row behind.
    expect(result).toMatchObject({ type: 'requestToApproveDirectoryCreation', directory: missing });
    expect(getOrCreateSessionByTag).not.toHaveBeenCalled();
  });

  it('leaves row creation to the runner when the setting is off', async () => {
    const spawnSession = vi.fn(async (_options: Record<string, unknown>) => (
      { type: 'success', spawnNonce: 'nonce-1', sessionIdStatus: 'pending' } as const
    ));
    const handler = registerSpawnHandler(spawnSession);

    await handler(spawnRequest());

    expect(getOrCreateSessionByTag).not.toHaveBeenCalled();
    expect(spawnSession.mock.calls[0]![0]).not.toHaveProperty('existingSessionId');
  });
});
