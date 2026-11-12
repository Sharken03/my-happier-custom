import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Credentials } from '@/persistence';

import { SPAWN_SESSION_ERROR_CODES } from '@/rpc/handlers/registerSessionHandlers';

const spawnDaemonSession = vi.hoisted(() => vi.fn());
const resolveDaemonSpawnSessionByNonce = vi.hoisted(() => vi.fn());
const fetchSessionById = vi.hoisted(() => vi.fn());
const getOrCreateSessionByTag = vi.hoisted(() => vi.fn());
const archiveSessionByIdBestEffort = vi.hoisted(() => vi.fn(async () => {}));

// Daemon control and the relay's session HTTP API are the process/network boundaries.
vi.mock('@/daemon/controlClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/daemon/controlClient')>(),
  spawnDaemonSession,
  resolveDaemonSpawnSessionByNonce,
}));

vi.mock('@/session/transport/http/sessionsHttp', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/session/transport/http/sessionsHttp')>(),
  fetchSessionById,
  getOrCreateSessionByTag,
}));

vi.mock('@/session/services/setSessionArchivedState', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/session/services/setSessionArchivedState')>(),
  archiveSessionByIdBestEffort,
}));

import { createSpawnedSession, type CreateSpawnedSessionParams } from './createSpawnedSession';

const credentials: Credentials = {
  token: 'token',
  encryption: { type: 'legacy', secret: new Uint8Array([1, 2, 3, 4]) },
};

function rawSession(metadata: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'sess_new',
    seq: 0,
    createdAt: 10,
    updatedAt: 10,
    active: false,
    activeAt: 0,
    encryptionMode: 'plain',
    metadata: JSON.stringify(metadata),
    metadataVersion: 0,
    agentState: null,
    agentStateVersion: 0,
    dataEncryptionKey: null,
  };
}

function rowFirstParams(overrides: Partial<CreateSpawnedSessionParams> = {}): CreateSpawnedSessionParams {
  return {
    credentials,
    directory: '/repo',
    backendTarget: { kind: 'builtInAgent', agentId: 'pi' },
    spawnNonce: 'nonce-1',
    rowFirstCreation: { tag: 'nonce-1', agentId: 'pi', metadata: { machineId: 'machine-8t' } },
    ...overrides,
  } as CreateSpawnedSessionParams;
}

describe('createSpawnedSession — row-first creation', () => {
  beforeEach(() => {
    spawnDaemonSession.mockReset();
    resolveDaemonSpawnSessionByNonce.mockReset();
    fetchSessionById.mockReset();
    getOrCreateSessionByTag.mockReset();
    archiveSessionByIdBestEffort.mockClear();
  });

  it('commits the row from the launch nonce before the runner starts and attaches the runner to it', async () => {
    getOrCreateSessionByTag.mockResolvedValue({
      session: rawSession({ tag: 'nonce-1', path: '/repo', flavor: 'pi', machineId: 'machine-8t' }),
      created: true,
    });
    spawnDaemonSession.mockResolvedValue({ success: true, spawnNonce: 'nonce-1', sessionIdStatus: 'pending' });

    const created = await createSpawnedSession(rowFirstParams());

    expect(created).toMatchObject({ created: true, sessionId: 'sess_new' });
    const creation = getOrCreateSessionByTag.mock.calls[0]![0] as { tag: string; metadata: Record<string, unknown> };
    expect(creation.tag).toBe('nonce-1');
    expect(creation.metadata).toMatchObject({ tag: 'nonce-1', path: '/repo', flavor: 'pi', machineId: 'machine-8t' });
    expect(spawnDaemonSession).toHaveBeenCalledTimes(1);
    expect(spawnDaemonSession.mock.calls[0]![0]).toMatchObject({ existingSessionId: 'sess_new', spawnNonce: 'nonce-1' });
    // The runner reports its identity later; the creator does not wait for it.
    expect(resolveDaemonSpawnSessionByNonce).not.toHaveBeenCalled();
    expect(fetchSessionById).not.toHaveBeenCalled();
  });

  it('refuses a returned row that does not carry the launch tag, before any runner attaches', async () => {
    getOrCreateSessionByTag.mockResolvedValue({
      session: rawSession({ tag: 'another-launch', path: '/repo', flavor: 'pi' }),
      created: false,
    });

    await expect(createSpawnedSession(rowFirstParams())).rejects.toMatchObject({ code: 'creation_conflict' });
    expect(spawnDaemonSession).not.toHaveBeenCalled();
    expect(archiveSessionByIdBestEffort).not.toHaveBeenCalled();
  });

  it('settles a fresh row when the daemon rejects the launch before admission', async () => {
    getOrCreateSessionByTag.mockResolvedValue({
      session: rawSession({ tag: 'nonce-1', path: '/repo', flavor: 'pi' }),
      created: true,
    });
    spawnDaemonSession.mockResolvedValue({
      type: 'error',
      errorCode: SPAWN_SESSION_ERROR_CODES.BACKEND_DISABLED,
      errorMessage: 'pi is disabled in your account settings',
    });

    await expect(createSpawnedSession(rowFirstParams())).rejects.toMatchObject({
      code: SPAWN_SESSION_ERROR_CODES.BACKEND_DISABLED,
    });
    expect(archiveSessionByIdBestEffort).toHaveBeenCalledWith({ token: 'token', sessionId: 'sess_new' });
  });
});
